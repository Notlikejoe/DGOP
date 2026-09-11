import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import {
  AI_CLASSIFICATION_CRITERIA,
  AiCalculationInputV1,
  assertCalculationInputV1,
} from './ai-governance.contracts';

const CLASSIFICATION_TASK_TITLE = 'Six-criterion SDAIA classification assessment';
const ENGINE_VERSION = 'AIUC_CLASSIFICATION_MAX_V1';

type JsonRecord = Record<string, unknown>;
type ConfigValue = {
  code: string;
  labelEn: string;
  labelAr: string;
  score?: number;
  minScore?: number;
  maxScore?: number;
  automatic?: boolean;
  anchors?: Record<string, unknown>;
};

const classificationCase = {
  id: true,
  useCaseRef: true,
  workflowCaseId: true,
  requesterUserId: true,
  ownerPersonId: true,
  name: true,
  description: true,
  version: true,
  updatedAt: true,
  workflowCase: { select: { id: true, code: true, status: true } },
  intakeRevisions: {
    orderBy: { revision: 'desc' as const },
    take: 1,
    select: { id: true, revision: true, payload: true, submittedAt: true, createdAt: true },
  },
  assessments: {
    where: { kind: 'classification' as const },
    orderBy: { round: 'desc' as const },
    take: 1,
    select: { id: true, round: true, engineVersion: true, inputs: true, result: true, createdBy: true, createdAt: true },
  },
} satisfies Prisma.AiUseCaseSelect;

function metadata(value: Prisma.JsonValue): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}

function validAnchor(value: unknown): boolean {
  const anchor = metadata(value as Prisma.JsonValue);
  return typeof anchor['labelEn'] === 'string' && !!anchor['labelEn'].trim()
    && typeof anchor['labelAr'] === 'string' && !!anchor['labelAr'].trim();
}

@Injectable()
export class AiClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AiAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async published(listCode: string, at: Date, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    return client.governedReferenceVersion.findFirst({
      where: {
        listCode,
        state: 'published',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { version: 'desc' },
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
  }

  private async resolveConfiguration(client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const now = new Date();
    const [scoreVersion, tierVersion] = await Promise.all([
      this.published('R_SDAIA_SCORE', now, client),
      this.published('R_SDAIA_TIER', now, client),
    ]);
    const issues: string[] = [];
    if (!scoreVersion) issues.push('Published R_SDAIA_SCORE is required');
    if (!tierVersion) issues.push('Published R_SDAIA_TIER is required');

    const scores: ConfigValue[] = (scoreVersion?.values ?? []).map(value => {
      const meta = metadata(value.metadata);
      return {
        code: value.code,
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        score: integer(meta['score']),
        anchors: metadata(meta['anchors'] as Prisma.JsonValue),
      };
    });
    const numericScores = scores.map(value => value.score).filter((value): value is number => value !== undefined);
    if (numericScores.length !== 5 || new Set(numericScores).size !== 5 || ![1, 2, 3, 4, 5].every(value => numericScores.includes(value))) {
      issues.push('R_SDAIA_SCORE must publish one metadata.score entry for each integer 1–5');
    }
    for (const criterion of AI_CLASSIFICATION_CRITERIA) {
      if (scores.some(value => !value.anchors || !validAnchor(value.anchors[criterion]))) {
        issues.push(`R_SDAIA_SCORE metadata must include bilingual ${criterion} anchors for every score`);
      }
    }

    const tiers: ConfigValue[] = (tierVersion?.values ?? []).map(value => {
      const meta = metadata(value.metadata);
      return {
        code: value.code,
        labelEn: value.labelEn,
        labelAr: value.labelAr,
        minScore: integer(meta['minScore']),
        maxScore: integer(meta['maxScore']),
        automatic: meta['automatic'] === true,
      };
    });
    const automaticTiers = tiers.filter(value => value.automatic);
    for (const score of [1, 2, 3, 4, 5]) {
      const matches = automaticTiers.filter(value => value.minScore !== undefined && value.maxScore !== undefined
        && score >= value.minScore && score <= value.maxScore);
      if (matches.length !== 1) issues.push(`R_SDAIA_TIER must map score ${score} to exactly one automatic tier`);
    }
    if (automaticTiers.length !== 3) issues.push('R_SDAIA_TIER must publish exactly three automatic tier bands');

    return {
      ready: issues.length === 0,
      issues: [...new Set(issues)],
      criteria: [...AI_CLASSIFICATION_CRITERIA],
      scoreVersionId: scoreVersion?.id ?? null,
      tierVersionId: tierVersion?.id ?? null,
      scores,
      tiers,
    };
  }

  async configuration(userId: string) {
    await this.authorization.authorize(userId, 'aiuc.classify.assess');
    return this.resolveConfiguration();
  }

  async queue(userId: string) {
    await this.authorization.authorize(userId, 'aiuc.classify.assess');
    return this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null,
        useCaseRef: { not: null },
        workflowCase: {
          is: {
            status: CaseStatus.under_review,
            tasks: { some: { status: TaskStatus.pending, assigneeRoleCode: 'AI_WORKING_GROUP', title: CLASSIFICATION_TASK_TITLE } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: classificationCase,
    });
  }

  async assess(userId: string, id: string, expectedVersion: number, value: unknown) {
    let input: AiCalculationInputV1;
    try {
      assertCalculationInputV1(value);
      input = value;
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (input.kind !== 'classification') throw new BadRequestException('Classification input is required');

    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess', tx);
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use case changed; reload before recording classification');
      const task = await tx.workflowTask.findFirst({
        where: {
          caseId: current.workflowCaseId,
          status: TaskStatus.pending,
          assigneeRoleCode: 'AI_WORKING_GROUP',
          title: CLASSIFICATION_TASK_TITLE,
        },
      });
      if (!task) throw new ConflictException('No active AIUC classification task exists');

      const config = await this.resolveConfiguration(tx);
      if (!config.ready || !config.scoreVersionId || !config.tierVersionId) {
        throw new BadRequestException({ message: 'AI classification reference configuration is incomplete', issues: config.issues });
      }
      const permitted = new Set(config.scores.map(value => value.score));
      if (input.scores.some(score => !permitted.has(score.value))) {
        throw new BadRequestException('A classification score is outside the published R_SDAIA_SCORE version');
      }
      const scoreMax = Math.max(...input.scores.map(score => score.value));
      const tier = config.tiers.find(value => value.automatic && value.minScore !== undefined && value.maxScore !== undefined
        && scoreMax >= value.minScore && scoreMax <= value.maxScore);
      if (!tier) throw new BadRequestException('Published tier bands do not resolve the calculated score');

      const previous = await tx.aiAssessmentRound.findFirst({
        where: { useCaseId: id, riskId: null, kind: 'classification' },
        orderBy: { round: 'desc' },
        select: { round: true },
      });
      const round = (previous?.round ?? 0) + 1;
      const now = new Date();
      const result = {
        scoreMax,
        proposedTierCode: tier.code,
        criteria: AI_CLASSIFICATION_CRITERIA.map((criterion, index) => ({ criterion, score: input.scores[index].value })),
        referenceVersions: { R_SDAIA_SCORE: config.scoreVersionId, R_SDAIA_TIER: config.tierVersionId },
      };
      const assessment = await tx.aiAssessmentRound.create({
        data: {
          useCaseId: id,
          kind: 'classification',
          round,
          engineVersion: ENGINE_VERSION,
          ruleReferenceVersionId: config.tierVersionId,
          inputs: {
            kind: 'classification',
            criteria: AI_CLASSIFICATION_CRITERIA.map((criterion, index) => ({ criterion, ...input.scores[index] })),
            scoreReferenceVersionId: config.scoreVersionId,
          } as Prisma.InputJsonObject,
          result: result as Prisma.InputJsonObject,
          createdBy: userId,
        },
      });
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.approved,
          decisionComment: `Proposed tier ${tier.code}; maximum score ${scoreMax}`,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: userId,
        },
      });
      await tx.workflowTask.create({
        data: {
          caseId: current.workflowCaseId,
          title: 'Verify proposed SDAIA classification',
          type: 'review',
          status: TaskStatus.pending,
          assigneeRoleCode: 'AI_GOVERNANCE_OFFICER',
        },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording classification');
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: userId,
          action: 'aiuc.classification.assessed',
          fromStatus: CaseStatus.under_review,
          toStatus: CaseStatus.under_review,
          comment: `Proposed tier ${tier.code}; maximum score ${scoreMax}`,
        },
      });
      await this.audit.logRequired({
        actor: userId,
        action: 'aiuc.classification.assessed',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          assessmentId: assessment.id,
          round,
          scoreMax,
          proposedTierCode: tier.code,
          referenceVersions: result.referenceVersions,
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
