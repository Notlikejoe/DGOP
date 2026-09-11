import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
const OFFICER_TASK_TITLE = 'Verify proposed SDAIA classification';
const ETHICS_TASK_TITLE = 'Review High-tier AI use case ethics';
const ADOPTION_TASK_TITLE = 'Adopt verified SDAIA classification';
const STEERING_TASK_TITLE = 'Decide restriction or stop for Unacceptable AI use case';
const ENGINE_VERSION = 'AIUC_CLASSIFICATION_MAX_V1';
const DECISION_ENGINE_VERSION = 'AIUC_CLASSIFICATION_DECISION_V1';

type JsonRecord = Record<string, unknown>;
type OfficerDecisionMode = 'verify' | 'override' | 'unacceptable';
type OfficerDecisionOptions = {
  expectedVersion: number;
  approvedTierCode?: string;
  justification?: string;
  evidenceIds?: string[];
  authorityReference?: string;
  clientIp?: string;
};
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
    select: { id: true, round: true, engineVersion: true, ruleReferenceVersionId: true, inputs: true, result: true, createdBy: true, createdAt: true },
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

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new BadRequestException(`${label} is required`);
  return normalized;
}

function classificationResult(value: Prisma.JsonValue): { scoreMax: number; proposedTierCode: string } {
  const result = metadata(value);
  const scoreMax = integer(result['scoreMax']);
  const proposedTierCode = typeof result['proposedTierCode'] === 'string' ? result['proposedTierCode'].trim() : '';
  if (!scoreMax || !proposedTierCode) throw new ConflictException('The latest classification round has no calculated proposal');
  return { scoreMax, proposedTierCode };
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
    for (const code of ['MINIMAL', 'LIMITED', 'HIGH']) {
      if (automaticTiers.filter(value => value.code.toUpperCase() === code).length !== 1) {
        issues.push(`R_SDAIA_TIER must publish one automatic ${code} tier`);
      }
    }
    const unacceptable = tiers.filter(value => !value.automatic && value.code.toUpperCase() === 'UNACCEPTABLE');
    if (unacceptable.length !== 1) issues.push('R_SDAIA_TIER must publish exactly one manual UNACCEPTABLE tier');

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

  async verificationQueue(userId: string) {
    const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess');
    if (!actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
      throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
    }
    return this.prisma.aiUseCase.findMany({
      where: {
        deletedAt: null,
        useCaseRef: { not: null },
        workflowCase: {
          is: {
            status: CaseStatus.under_review,
            tasks: { some: { status: TaskStatus.pending, assigneeRoleCode: 'AI_GOVERNANCE_OFFICER', title: OFFICER_TASK_TITLE } },
          },
        },
        assessments: { some: { kind: 'classification' } },
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
          title: OFFICER_TASK_TITLE,
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

  async verify(userId: string, id: string, expectedVersion: number, justification?: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'verify', { expectedVersion, justification, clientIp });
  }

  async override(userId: string, id: string, expectedVersion: number, approvedTierCode: string,
    justification: string, evidenceIds: string[], authorityReference: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'override', {
      expectedVersion, approvedTierCode, justification, evidenceIds, authorityReference, clientIp,
    });
  }

  async unacceptable(userId: string, id: string, expectedVersion: number, justification: string,
    evidenceIds: string[], authorityReference: string, clientIp?: string) {
    return this.recordOfficerDecision(userId, id, 'unacceptable', {
      expectedVersion, justification, evidenceIds, authorityReference, clientIp,
    });
  }

  private async recordOfficerDecision(userId: string, id: string, mode: OfficerDecisionMode, options: OfficerDecisionOptions) {
    return this.prisma.$transaction(async tx => {
      const permission = mode === 'override' ? 'aiuc.classify.override' as const
        : mode === 'unacceptable' ? 'aiuc.tier.unacceptable' as const
          : 'aiuc.classify.assess' as const;
      const actor = await this.authorization.authorize(userId, permission, tx);
      if (mode === 'verify' && !actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
        throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
      }
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification verification');
      }
      if (current.version !== options.expectedVersion) {
        throw new ConflictException('AI use case changed; reload before recording classification verification');
      }
      const task = await tx.workflowTask.findFirst({
        where: {
          caseId: current.workflowCaseId,
          status: TaskStatus.pending,
          assigneeRoleCode: 'AI_GOVERNANCE_OFFICER',
          title: OFFICER_TASK_TITLE,
        },
      });
      if (!task) throw new ConflictException('No active Responsible AI Officer verification task exists');

      const source = current.assessments[0];
      if (!source) throw new ConflictException('A calculated classification round is required before verification');
      if (source.createdBy === actor.id) {
        throw new ForbiddenException('The classification assessor cannot verify or override the same round');
      }
      const calculated = classificationResult(source.result);
      const tierVersion = await tx.governedReferenceVersion.findUnique({
        where: { id: source.ruleReferenceVersionId },
        include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
      });
      if (!tierVersion || tierVersion.listCode !== 'R_SDAIA_TIER') {
        throw new ConflictException('The classification tier reference version is unavailable');
      }
      const tiers = tierVersion.values.map(value => ({ value, meta: metadata(value.metadata) }));
      const proposedTier = tiers.find(entry => entry.value.code === calculated.proposedTierCode);
      if (!proposedTier || proposedTier.meta['automatic'] !== true) {
        throw new ConflictException('The calculated proposal is not an automatic tier in its pinned reference version');
      }

      let approvedTier = proposedTier;
      let justification = options.justification?.trim() || undefined;
      let authorityReference: string | undefined;
      let evidenceIds: string[] = [];
      if (mode === 'override') {
        const code = requiredText(options.approvedTierCode, 'Approved tier code');
        const targetTier = tiers.find(entry => entry.value.code === code);
        if (!targetTier) throw new BadRequestException('Approved tier is outside the assessment reference version');
        approvedTier = targetTier;
        if (approvedTier.value.code === proposedTier.value.code) {
          throw new BadRequestException('An override must differ from the calculated proposed tier');
        }
        if (approvedTier.meta['automatic'] !== true) {
          throw new BadRequestException('Use the manual Unacceptable operation for a non-automatic tier');
        }
      } else if (mode === 'unacceptable') {
        const manual = tiers.filter(entry => entry.meta['automatic'] !== true && entry.value.code.toUpperCase() === 'UNACCEPTABLE');
        if (manual.length !== 1) throw new ConflictException('The pinned tier version has no unique manual Unacceptable value');
        approvedTier = manual[0];
      }

      if (mode !== 'verify') {
        justification = requiredText(options.justification, 'Override justification');
        authorityReference = requiredText(options.authorityReference, 'Higher-authority reference');
        evidenceIds = [...new Set((options.evidenceIds ?? []).map(value => value.trim()).filter(Boolean))];
        if (!evidenceIds.length) throw new BadRequestException('At least one DGOP evidence identifier is required');
        const evidenceCount = await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } });
        if (evidenceCount !== evidenceIds.length) throw new BadRequestException('Every override evidence identifier must exist in the DGOP evidence store');
      }

      const actorRole = ['STEERING_COMMITTEE', 'AI_EXECUTIVE_TEAM', 'AI_ETHICS_COMMITTEE', 'AI_GOVERNANCE_OFFICER']
        .find(role => actor.roles.includes(role));
      if (!actorRole) throw new ForbiddenException('A higher classification authority role is required');
      const now = new Date();
      const sourceResult = metadata(source.result);
      const officerDecision: Prisma.InputJsonObject = {
        decisionType: mode,
        approvedTierCode: approvedTier.value.code,
        actorRole,
        verifiedBy: actor.id,
        verifiedAt: now.toISOString(),
        evidenceIds,
        ...(justification ? { justification } : {}),
        ...(authorityReference ? { authorityReference } : {}),
      };
      const result: Prisma.InputJsonObject = {
        scoreMax: calculated.scoreMax,
        proposedTierCode: calculated.proposedTierCode,
        approvedTierCode: approvedTier.value.code,
        sourceAssessmentId: source.id,
        officerDecision,
        ...(sourceResult['criteria'] !== undefined ? { criteria: sourceResult['criteria'] as Prisma.InputJsonValue } : {}),
        ...(sourceResult['referenceVersions'] !== undefined
          ? { referenceVersions: sourceResult['referenceVersions'] as Prisma.InputJsonValue }
          : {}),
      };
      const decisionRound = await tx.aiAssessmentRound.create({
        data: {
          useCaseId: id,
          kind: 'classification',
          round: source.round + 1,
          engineVersion: DECISION_ENGINE_VERSION,
          ruleReferenceVersionId: source.ruleReferenceVersionId,
          inputs: source.inputs as Prisma.InputJsonValue,
          result,
          createdBy: actor.id,
        },
      });
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.approved,
          decisionComment: `${mode}: ${calculated.proposedTierCode} -> ${approvedTier.value.code}`,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: actor.id,
        },
      });

      const isHigh = approvedTier.meta['automatic'] === true && approvedTier.value.code.toUpperCase() === 'HIGH';
      const nextTask = mode === 'unacceptable'
        ? { title: STEERING_TASK_TITLE, type: 'decision', role: 'STEERING_COMMITTEE' }
        : isHigh
          ? { title: ETHICS_TASK_TITLE, type: 'review', role: 'AI_ETHICS_COMMITTEE' }
          : { title: ADOPTION_TASK_TITLE, type: 'decision', role: 'AI_GOVERNANCE_OFFICER' };
      await tx.workflowTask.create({
        data: {
          caseId: current.workflowCaseId,
          title: nextTask.title,
          type: nextTask.type,
          status: TaskStatus.pending,
          assigneeRoleCode: nextTask.role,
        },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: options.expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before recording classification verification');
      const action = `aiuc.classification.${mode === 'verify' ? 'verified' : mode === 'override' ? 'overridden' : 'unacceptable'}`;
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: actor.id,
          action,
          fromStatus: CaseStatus.under_review,
          toStatus: CaseStatus.under_review,
          comment: `${calculated.proposedTierCode} -> ${approvedTier.value.code}; next ${nextTask.role}`,
        },
      });
      await this.audit.logRequired({
        actor: actor.id,
        action,
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          actorRole,
          clientIp: options.clientIp ?? null,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          sourceAssessmentId: source.id,
          decisionAssessmentId: decisionRound.id,
          scoreMax: calculated.scoreMax,
          oldValue: calculated.proposedTierCode,
          newValue: approvedTier.value.code,
          justification: justification ?? null,
          evidenceIds,
          authorityReference: authorityReference ?? null,
          nextRole: nextTask.role,
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async returnForReassessment(userId: string, id: string, expectedVersion: number, justificationValue: string, clientIp?: string) {
    const justification = requiredText(justificationValue, 'Return justification');
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'aiuc.classify.assess', tx);
      if (!actor.roles.includes('AI_GOVERNANCE_OFFICER')) {
        throw new ForbiddenException('Responsible AI Officer role is required for classification verification');
      }
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: classificationCase });
      if (!current || !current.workflowCaseId || !current.useCaseRef || current.workflowCase?.status !== CaseStatus.under_review) {
        throw new NotFoundException('AI use case is not available for classification verification');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use case changed; reload before returning classification');
      const task = await tx.workflowTask.findFirst({
        where: { caseId: current.workflowCaseId, status: TaskStatus.pending, assigneeRoleCode: 'AI_GOVERNANCE_OFFICER', title: OFFICER_TASK_TITLE },
      });
      if (!task) throw new ConflictException('No active Responsible AI Officer verification task exists');
      const source = current.assessments[0];
      if (!source) throw new ConflictException('A calculated classification round is required before verification');
      if (source.createdBy === actor.id) throw new ForbiddenException('The classification assessor cannot verify the same round');
      const calculated = classificationResult(source.result);
      const now = new Date();
      await tx.workflowTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.completed,
          decision: TaskDecision.rejected,
          decisionComment: justification,
          completedAt: now,
          formSubmittedAt: now,
          formSubmittedBy: actor.id,
        },
      });
      await tx.workflowTask.create({
        data: {
          caseId: current.workflowCaseId,
          title: CLASSIFICATION_TASK_TITLE,
          type: 'review',
          status: TaskStatus.pending,
          assigneeRoleCode: 'AI_WORKING_GROUP',
        },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: current.workflowCaseId },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('AI use case changed; reload before returning classification');
      await tx.workflowEvent.create({
        data: {
          caseId: current.workflowCaseId,
          taskId: task.id,
          actor: actor.id,
          action: 'aiuc.classification.returned',
          fromStatus: CaseStatus.under_review,
          toStatus: CaseStatus.under_review,
          comment: justification,
        },
      });
      await this.audit.logRequired({
        actor: actor.id,
        action: 'aiuc.classification.returned',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          actorRoles: actor.roles,
          clientIp: clientIp ?? null,
          caseCode: current.workflowCase.code,
          useCaseRef: current.useCaseRef,
          sourceAssessmentId: source.id,
          proposedTierCode: calculated.proposedTierCode,
          scoreMax: calculated.scoreMax,
          justification,
          nextRole: 'AI_WORKING_GROUP',
        },
      }, tx);
      return tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: classificationCase });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
