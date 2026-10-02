import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { CompleteRiskAssessmentDto, RiskDimensionScoreDto } from './ai-risk-assessment.dto';
import { computeInherentRisk, jsonRecord, RISK_DIMENSIONS, RiskDimension, RiskScoringConfiguration, scoringConfigurationIssues } from './ai-risk-scoring';
import { isSystemAdministrator } from '../auth/system-admin';

const ENGINE_VERSION = 'airs-inherent-max8-v1';
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 };
type Risk = Prisma.AiRiskGetPayload<{ select: typeof riskSelect }>;
function justified(value: number, justification: string) {
  if (!Number.isInteger(value) || value < 1 || value > 4 || typeof justification !== 'string' || !justification.trim() || justification.length > 5000)
    throw new BadRequestException('A 1–4 integer and written justification are required');
}

@Injectable()
export class AiRiskAssessmentService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService,
    private readonly risks: AiRiskIntakeService, private readonly routing: AiWorkflowRoutingService, private readonly audit: AuditService) {}

  private async scoped(tx: Prisma.TransactionClient, userId: string, id: string) {
    const access = await this.risks.visibility(userId, tx);
    const risk = await tx.aiRisk.findFirst({ where: { AND: [access.where, { id }] }, select: riskSelect });
    if (!risk) throw new NotFoundException('AI risk not found');
    return { ...access, risk };
  }
  private taskWhere(risk: Risk): Prisma.WorkflowTaskWhereInput {
    return { caseId: risk.workflowCase!.id, templateStage: { is: { code: AIRS_STAGE.inherent,
      templateId: risk.workflowCase!.templateId ?? '', isActive: true, template: { is: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } } } } };
  }
  private async tasks(tx: Prisma.TransactionClient, risk: Risk) {
    if (!risk.workflowCase?.templateId) return [];
    return tx.workflowTask.findMany({ where: this.taskWhere(risk), orderBy: { createdAt: 'asc' } });
  }
  private async writable(tx: Prisma.TransactionClient, userId: string, id: string, version: number) {
    const actor = await this.authorization.authorize(userId, 'airs.risk.assess', tx);
    const { risk } = await this.scoped(tx, userId, id);
    if (!risk.riskRef || risk.workflowCase?.status !== 'under_review') throw new ConflictException('Risk is not awaiting assessment');
    if (risk.version !== version) throw new ConflictException('AI risk changed; reload before scoring');
    const tasks = await this.tasks(tx, risk);
    const coordinators = tasks.filter(task => task.assigneeRoleCode === 'AI_RISK_OWNER' && task.assigneeUserId === risk.owner?.userId
      && !jsonRecord(task.formDataJson)['dimension'] && [TaskStatus.pending, TaskStatus.in_progress].includes(task.status as 'pending' | 'in_progress'));
    if (coordinators.length !== 1) throw new ConflictException('Exactly one assigned inherent-assessment coordinator is required');
    return { actor, risk, tasks, coordinator: coordinators[0] };
  }
  private owner(actor: { id: string; roles: string[] }, risk: Risk) {
    if (isSystemAdministrator(actor.roles)) return;
    if (!actor.roles.includes('AI_RISK_OWNER') || actor.id !== risk.owner?.userId) throw new ForbiddenException('Only the assigned Risk Owner coordinates this assessment');
  }

  async referencesCurrent(tx: Prisma.TransactionClient, config: RiskScoringConfiguration, lock = false) {
    const ids = Object.values(config.referenceVersions);
    if (lock) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM governed_reference_versions
        WHERE id IN (${Prisma.join(ids)}) AND state = 'published' AND "effectiveFrom" <= CURRENT_TIMESTAMP
        AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP) FOR SHARE`;
      return rows.length === 3;
    }
    return await tx.governedReferenceVersion.count({ where: { id: { in: ids }, state: 'published', effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] } }) === 3;
  }

  async configuration(tx: Prisma.TransactionClient = this.prisma) {
    const now = new Date();
    const versions = await Promise.all(['R_SCORE14', 'R_IMPD', 'R_LEVEL'].map(async listCode => {
      const matches = await tx.governedReferenceVersion.findMany({ where: { listCode, state: 'published', effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, take: 2, include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } } });
      return matches.length === 1 ? matches[0] : null;
    }));
    const [scores, dimensions, bands] = versions;
    const config = {
      referenceVersions: { R_SCORE14: scores?.id ?? '', R_IMPD: dimensions?.id ?? '', R_LEVEL: bands?.id ?? '' },
      scores: (scores?.values ?? []).map(value => ({ code: value.code, labelEn: value.labelEn, labelAr: value.labelAr,
        score: jsonRecord(value.metadata)['score'], anchors: jsonRecord(value.metadata)['anchors'] })),
      dimensions: (dimensions?.values ?? []).map(value => ({ code: value.code, labelEn: value.labelEn, labelAr: value.labelAr,
        dimension: jsonRecord(value.metadata)['dimension'], assessorRoleCode: jsonRecord(value.metadata)['assessorRoleCode'], tieBreakOrder: jsonRecord(value.metadata)['tieBreakOrder'] })),
      bands: (bands?.values ?? []).map(value => ({ code: value.code, labelEn: value.labelEn, labelAr: value.labelAr,
        minScore: jsonRecord(value.metadata)['minScore'], maxScore: jsonRecord(value.metadata)['maxScore'], severityCode: jsonRecord(value.metadata)['severityCode'] })),
    } as RiskScoringConfiguration;
    const issues = scoringConfigurationIssues(config);
    return { ready: issues.length === 0, issues, ...config };
  }
  async context(userId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const { risk, actor, permissions } = await this.scoped(tx, userId, id);
      const tasks = await this.tasks(tx, risk);
      const coordinator = tasks.find(task => !jsonRecord(task.formDataJson)['dimension'] && task.assigneeRoleCode === 'AI_RISK_OWNER'
        && [TaskStatus.pending, TaskStatus.in_progress].includes(task.status as 'pending' | 'in_progress'));
      const pinned = (coordinator ? jsonRecord(coordinator.formDataJson)['configuration'] : jsonRecord(risk.assessments[0]?.inputs)['configuration']) as RiskScoringConfiguration | undefined;
      const config = pinned ? { ...pinned, ready: scoringConfigurationIssues(pinned).length === 0, issues: scoringConfigurationIssues(pinned) } : await this.configuration(tx);
      const referencesCurrent = !!pinned && await this.referencesCurrent(tx, pinned);
      const administratorOverride = isSystemAdministrator(actor.roles);
      const canAssess = risk.workflowCase?.status === 'under_review' && (administratorOverride || permissions.has('airs.risk.assess') && !actor.roles.includes('auditor'));
      const owner = canAssess && (administratorOverride || actor.id === risk.owner?.userId && actor.roles.includes('AI_RISK_OWNER'));
      const contributions = tasks.filter(task => jsonRecord(task.formDataJson)['coordinatorTaskId'] === coordinator?.id && jsonRecord(task.formDataJson)['dimension']);
      return { version: risk.version, configuration: config, canStart: !!owner && !!coordinator && !pinned && config.ready,
        canComplete: !!owner && !!pinned && referencesCurrent && contributions.length === 8 && contributions.every(task => task.status === TaskStatus.completed),
        canRestart: !!owner && !!coordinator && !!pinned, referencesCurrent,
        started: !!pinned, administratorOverride, assignedOwner: risk.owner ? { userId:risk.owner.userId,
          fullNameEn:risk.owner.fullNameEn,fullNameAr:risk.owner.fullNameAr } : null, tasks: contributions.map(task => {
          const data = jsonRecord(task.formDataJson), dimension = data['dimension'] as RiskDimension;
          const mapping = config.dimensions.find(value => value.dimension === dimension);
          return { id: task.id, dimension, status: task.status, dueDate: task.dueDate, assessorRoleCode: task.assigneeRoleCode,
            score: data['score'] ?? null, submittedBy: task.formSubmittedBy, canContribute: referencesCurrent && !!canAssess && !!mapping && task.status === TaskStatus.pending
              && (administratorOverride || actor.roles.includes(mapping.assessorRoleCode) && (!task.assigneeUserId || task.assigneeUserId === actor.id)
              && (mapping.assessorRoleCode !== 'AI_RISK_OWNER' || actor.id === risk.owner?.userId)) };
        }), rounds: risk.assessments };
    }, options);
  }

  async start(userId: string, id: string, expectedVersion: number, clientIp?: string, restart = false, restartReason = '') {
    if (restart && (!restartReason.trim() || restartReason.length > 2000)) throw new BadRequestException('Assessment restart requires written justification');
    return this.prisma.$transaction(async tx => {
      const { actor, risk, tasks, coordinator: currentCoordinator } = await this.writable(tx, userId, id, expectedVersion);
      let coordinator = currentCoordinator;
      this.owner(actor, risk);
      const started = !!jsonRecord(coordinator.formDataJson)['configuration'];
      if (started && !restart) throw new ConflictException('Assessment already started');
      if (!started && restart) throw new ConflictException('No started assessment to restart');
      const config = await this.configuration(tx);
      if (!config.ready) throw new BadRequestException({ message: 'Risk scoring configuration is not ready', issues: config.issues });
      const template = await this.routing.binding(tx, AIRS_TEMPLATE_CODE);
      const stage = template.stages.find(stage => stage.code === AIRS_STAGE.inherent)!;
      if (jsonRecord(stage.assignmentConfigJson)['dimensionsReferenceList'] !== 'R_IMPD') throw new ConflictException('AIRS dimension-assessment configuration is required');
      const sourceIntakeTaskId = jsonRecord(coordinator.formDataJson)['sourceIntakeTaskId'];
      const intakeTask = typeof sourceIntakeTaskId === 'string' ? await tx.workflowTask.findFirst({ where: { id: sourceIntakeTaskId,
        caseId: risk.workflowCase!.id, status: TaskStatus.completed, templateStage: { code: AIRS_STAGE.identification } } }) : null;
      if (!intakeTask || JSON.stringify(jsonRecord(intakeTask.formDataJson)['submittedIntake']) !== JSON.stringify(risk.intakeData)) throw new ConflictException('The submitted risk intake snapshot must match its completed identification task');
      const source = await tx.aiUseCase.findUniqueOrThrow({ where: { id: risk.useCase.id }, include: { owner: true } });
      if (!source.owner?.userId) throw new BadRequestException('The linked Use-Case Owner must be an active eligible user');
      const nominee = await this.authorization.authorize(source.owner.userId, 'airs.risk.assess', tx);
      if (!nominee.roles.includes('AI_USECASE_OWNER') || !source.owner.isActive || source.owner.deletedAt) throw new BadRequestException('The linked Use-Case Owner is not eligible to assess reputation');
      await this.scoped(tx, nominee.id, id);
      if (restart) {
        await tx.workflowTask.updateMany({ where: { id: { in: [coordinator.id, ...tasks.filter(task => jsonRecord(task.formDataJson)['coordinatorTaskId'] === coordinator.id).map(task => task.id)] },
          status: { in: [TaskStatus.pending, TaskStatus.in_progress] } }, data: { status: TaskStatus.cancelled } });
        coordinator = await this.routing.createStageTask(tx, risk.workflowCase!.id, AIRS_STAGE.inherent, new Date(), { templateCode: AIRS_TEMPLATE_CODE,
          assigneeUserId: actor.id, formDataJson: { sourceIntakeTaskId, riskRef: risk.riskRef, restartedFromTaskId: currentCoordinator.id } as Prisma.InputJsonObject });
      }
      const previous = await tx.aiAssessmentRound.aggregate({ where: { riskId: id, kind: 'inherent' }, _max: { round: true } });
      const round = (previous._max.round ?? 0) + 1, now = new Date();
      await tx.workflowTask.update({ where: { id: coordinator.id }, data: { formDataJson: { ...jsonRecord(coordinator.formDataJson), configuration: config, assessmentRound: round } as Prisma.InputJsonObject } });
      for (const dimension of config.dimensions) {
        await this.routing.createStageTask(tx, risk.workflowCase!.id, AIRS_STAGE.inherent, now, { templateCode: AIRS_TEMPLATE_CODE,
          title: `${dimension.labelEn} / ${dimension.labelAr}`,
          assigneeRoleCode: dimension.assessorRoleCode,
          assigneeUserId: dimension.assessorRoleCode === 'AI_RISK_OWNER' ? actor.id : dimension.assessorRoleCode === 'AI_USECASE_OWNER' ? source.owner.userId : undefined,
          formDataJson: { coordinatorTaskId: coordinator.id, dimension: dimension.dimension, referenceVersionId: config.referenceVersions.R_IMPD, assessmentRound: round } });
      }
      await tx.aiRisk.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.workflowEvent.create({ data: { caseId: risk.workflowCase!.id, taskId: coordinator.id, actor: actor.id, action: restart ? 'airs.impact.restarted' : 'airs.impact.started', comment: `Round ${round}` } });
      await this.audit.logRequired({ actor: actor.id, action: restart ? 'airs.impact.restarted' : 'airs.impact.started', entityType: 'ai_risk', entityId: id,
        metadata: { coordinatorTaskId: coordinator.id, restartedFromTaskId: restart ? currentCoordinator.id : null, justification: restart ? restartReason.trim() : null,
          round, referenceVersions: config.referenceVersions, administratorOverride: isSystemAdministrator(actor.roles), clientIp: clientIp ?? null } }, tx);
      return { id, version: expectedVersion + 1 };
    }, options);
  }

  async contribute(userId: string, id: string, taskId: string, dto: RiskDimensionScoreDto, clientIp?: string) {
    justified(dto.value, dto.justification);
    return this.prisma.$transaction(async tx => {
      const { actor, risk, tasks, coordinator } = await this.writable(tx, userId, id, dto.expectedVersion);
      const config = jsonRecord(coordinator.formDataJson)['configuration'] as RiskScoringConfiguration;
      if (!config || scoringConfigurationIssues(config).length) throw new ConflictException('A pinned risk scoring configuration is required');
      if (!await this.referencesCurrent(tx, config, true)) throw new ConflictException('Scoring references changed; the Risk Owner must restart this assessment');
      const task = tasks.find(task => task.id === taskId && jsonRecord(task.formDataJson)['coordinatorTaskId'] === coordinator.id);
      const data = jsonRecord(task?.formDataJson), mapping = config.dimensions.find(value => value.dimension === data['dimension']);
      if (!task || task.status !== TaskStatus.pending || !mapping || task.assigneeRoleCode !== mapping.assessorRoleCode) throw new ConflictException('Active dimension task not found');
      const administratorOverride = isSystemAdministrator(actor.roles);
      if (!administratorOverride && (!actor.roles.includes(mapping.assessorRoleCode) || task.assigneeUserId && task.assigneeUserId !== actor.id
        || mapping.assessorRoleCode === 'AI_RISK_OWNER' && risk.owner?.userId !== actor.id)) throw new ForbiddenException('Only the competent assigned role can score this dimension');
      const now = new Date(), score = { value: dto.value, justification: dto.justification.trim() };
      await tx.workflowTask.update({ where: { id: task.id }, data: { status: TaskStatus.completed, assigneeUserId: actor.id,
        completedAt: now, formSubmittedAt: now, formSubmittedBy: actor.id,
        formDataJson: { ...data, score, assessedBy: actor.id, assessedRoleCode: mapping.assessorRoleCode } as Prisma.InputJsonObject } });
      await tx.aiRisk.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.workflowEvent.create({ data: { caseId: risk.workflowCase!.id, taskId: task.id, actor: actor.id, action: 'airs.dimension.scored', comment: `${mapping.dimension}: ${dto.value}` } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.dimension.scored', entityType: 'ai_risk', entityId: id,
        metadata: { dimension: mapping.dimension, taskId, score, referenceVersions: config.referenceVersions, administratorOverride, clientIp: clientIp ?? null } }, tx);
      return { id, version: dto.expectedVersion + 1 };
    }, options);
  }

  async complete(userId: string, id: string, dto: CompleteRiskAssessmentDto, clientIp?: string) {
    justified(dto.likelihood, dto.justification);
    return this.prisma.$transaction(async tx => {
      const { actor, risk, tasks, coordinator } = await this.writable(tx, userId, id, dto.expectedVersion);
      this.owner(actor, risk);
      const data = jsonRecord(coordinator.formDataJson), config = data['configuration'] as RiskScoringConfiguration;
      if (!config || scoringConfigurationIssues(config).length) throw new ConflictException('A pinned risk scoring configuration is required');
      if (!await this.referencesCurrent(tx, config, true)) throw new ConflictException('Scoring references changed; the Risk Owner must restart this assessment');
      const contributions = tasks.filter(task => jsonRecord(task.formDataJson)['coordinatorTaskId'] === coordinator.id);
      if (contributions.length !== 8 || contributions.some(task => task.status !== TaskStatus.completed)) throw new BadRequestException('All eight competent-role dimension tasks must be completed');
      const inputs = contributions.map(task => {
        const entry = jsonRecord(task.formDataJson), score = jsonRecord(entry['score']);
        const dimension = entry['dimension'] as RiskDimension, mapping = config.dimensions.find(value => value.dimension === dimension);
        if (!mapping || task.assigneeRoleCode !== mapping.assessorRoleCode || entry['assessedRoleCode'] !== mapping.assessorRoleCode
          || !task.formSubmittedBy || task.formSubmittedBy !== task.assigneeUserId || entry['assessedBy'] !== task.formSubmittedBy) throw new ConflictException('Dimension assessment provenance is inconsistent');
        justified(score['value'] as number, score['justification'] as string);
        return { dimension, value: score['value'] as number, justification: score['justification'] as string, assessedBy: task.formSubmittedBy,
          assessedRoleCode: mapping.assessorRoleCode, taskId: task.id };
      });
      let computed: ReturnType<typeof computeInherentRisk>;
      try { computed = computeInherentRisk(dto.likelihood, inputs, config); } catch (error) { throw new BadRequestException((error as Error).message); }
      const ethicsReviewRequired = ['HIGH', 'CRITICAL'].includes(computed.bandCode) || jsonRecord(risk.handoffPayload)['approvedTierCode'] === 'HIGH';
      const result = { ...computed, ethicsReviewRequired, adopted: false };
      const round = data['assessmentRound'] as number, now = new Date();
      if (!Number.isInteger(round) || round < 1) throw new ConflictException('Assessment round is missing');
      const assessment = await tx.aiAssessmentRound.create({ data: { riskId: id, useCaseId: risk.useCase.id, kind: 'inherent', round,
        engineVersion: ENGINE_VERSION, ruleReferenceVersionId: config.referenceVersions.R_LEVEL, createdBy: actor.id,
        inputs: { likelihood: { value: dto.likelihood, justification: dto.justification.trim(), assessedBy: actor.id }, dimensions: inputs,
          configuration: config, coordinatorTaskId: coordinator.id, sourceIntakeTaskId: data['sourceIntakeTaskId'] } as Prisma.InputJsonObject,
        result: result as Prisma.InputJsonObject } });
      await tx.workflowTask.update({ where: { id: coordinator.id }, data: { status: TaskStatus.completed, completedAt: now,
        formSubmittedAt: now, formSubmittedBy: actor.id, formDataJson: { ...data, assessmentId: assessment.id } as Prisma.InputJsonObject } });
      const adoption = await this.routing.openRiskAssessmentGate(tx, risk.workflowCase!.id, assessment.id, ethicsReviewRequired, risk.riskRef!, now);
      await tx.aiRisk.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.workflowEvent.create({ data: { caseId: risk.workflowCase!.id, taskId: adoption.id, actor: actor.id,
        action: 'airs.inherent.scored', comment: `${computed.score}: ${computed.bandCode}; pending adoption` } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.inherent.scored', entityType: 'ai_risk', entityId: id,
        metadata: { assessmentId: assessment.id, round, result, adoptionTaskId: adoption.id,
          administratorOverride: isSystemAdministrator(actor.roles), clientIp: clientIp ?? null } }, tx);
      return { id, version: dto.expectedVersion + 1, assessmentId: assessment.id, result, nextTaskId: adoption.id };
    }, options);
  }
}
