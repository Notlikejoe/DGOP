import { requiredInherentRound } from './ai-reassessment-state';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService, aiDutyViolation } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { computeInherentRisk, jsonRecord, RiskScoringConfiguration } from './ai-risk-scoring';
import { ReviewRiskAssessmentDto } from './ai-risk-adoption.dto';

const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 };
const open = [TaskStatus.pending, TaskStatus.in_progress];

@Injectable()
export class AiRiskAdoptionService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService,
    private readonly risks: AiRiskIntakeService, private readonly routing: AiWorkflowRoutingService, private readonly audit: AuditService) {}

  private async gate(tx: Prisma.TransactionClient, userId: string, id: string) {
    const access = await this.risks.visibility(userId, tx);
    const risk = await tx.aiRisk.findFirst({ where: { AND: [access.where, { id }] }, select: riskSelect });
    if (!risk) throw new NotFoundException('AI risk not found');
    const assessment = await tx.aiAssessmentRound.findFirst({ where: { riskId: id, kind: 'inherent', round: { gte: await requiredInherentRound(tx,id) } }, orderBy: { round: 'desc' }, include: { decisions: true } });
    const tasks = risk.workflowCase?.templateId && assessment ? await tx.workflowTask.findMany({ where: { caseId: risk.workflowCase.id,
      templateStage: { is: { code: { in: [AIRS_STAGE.adoption, AIRS_STAGE.ethics] }, isActive: true, templateId: risk.workflowCase.templateId,
        template: { is: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } } } } }, include: { templateStage: { select: { code: true } } } }) : [];
    const current = tasks.filter(task => jsonRecord(task.formDataJson)['assessmentId'] === assessment?.id);
    const result = jsonRecord(assessment?.result), input = jsonRecord(assessment?.inputs);
    const dimensions = Array.isArray(input['dimensions']) ? input['dimensions'].map(jsonRecord) : [];
    const facts = { riskOwnerId: risk.owner?.userId ?? undefined, useCaseOwnerId: risk.useCase.owner?.userId ?? undefined,
      assessmentAssessorIds: [assessment?.createdBy, ...dimensions.map(value => value['assessedBy'])].filter((value): value is string => typeof value === 'string') };
    const ethicsRequired = !!assessment && (['HIGH','CRITICAL'].includes(result['bandCode'] as string)
      || result['ethicsReviewRequired'] === true || jsonRecord(risk.handoffPayload)['approvedTierCode'] === 'HIGH');
    const ethicsDecision = assessment?.decisions.find(value => value.kind === 'ethics');
    const ethicsApproved = ethicsDecision?.decision === 'approve' && ethicsDecision.actorRoleCode === 'AI_ETHICS_COMMITTEE'
      && ![facts.useCaseOwnerId, facts.riskOwnerId].includes(ethicsDecision.actorId);
    const active = risk.workflowCase?.status === 'under_review' && !!risk.riskRef && !!assessment && !assessment.decisions.some(value => value.kind === 'adoption' || value.decision === 'return');
    const adoptionTasks = current.filter(task => task.templateStage?.code === AIRS_STAGE.adoption && task.assigneeRoleCode === 'AI_GOVERNANCE_OFFICER' && open.includes(task.status as 'pending' | 'in_progress'));
    const ethicsTasks = current.filter(task => task.templateStage?.code === AIRS_STAGE.ethics && task.assigneeRoleCode === 'AI_ETHICS_COMMITTEE' && open.includes(task.status as 'pending' | 'in_progress'));
    return { ...access, risk, assessment, current, adoptionTasks, ethicsTasks, facts, ethicsRequired, ethicsApproved: !!ethicsApproved, active };
  }

  private async currentReferences(tx: Prisma.TransactionClient, configuration: unknown, lock = false) {
    const refs = jsonRecord(jsonRecord(configuration)['referenceVersions']);
    const ids = ['R_SCORE14','R_IMPD','R_LEVEL'].map(code => refs[code]);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== 3) return false;
    if (lock) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM governed_reference_versions WHERE id IN (${Prisma.join(ids)})
        AND state = 'published' AND "effectiveFrom" <= CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP) FOR SHARE`;
      return rows.length === 3;
    }
    return await tx.governedReferenceVersion.count({ where: { id: { in: ids as string[] }, state: 'published', effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] } }) === 3;
  }

  async context(userId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const gate = await this.gate(tx, userId, id), { actor, permissions, risk, assessment } = gate;
      const referencesCurrent = !!assessment && await this.currentReferences(tx, jsonRecord(assessment.inputs)['configuration']);
      const officer = gate.active && permissions.has('case.approve.airs') && actor.roles.includes('AI_GOVERNANCE_OFFICER')
        && !aiDutyViolation(actor.id, actor.roles, 'adopt_assessment', gate.facts);
      const committee = gate.active && permissions.has('case.view.airs.org') && actor.roles.includes('AI_ETHICS_COMMITTEE')
        && !aiDutyViolation(actor.id, actor.roles, 'ethics_review', gate.facts);
      return { version: risk.version, assessmentId: assessment?.id ?? null, round: assessment?.round ?? null, ethicsRequired: gate.ethicsRequired,
        ethicsApproved: gate.ethicsApproved, referencesCurrent, recused: actor.roles.includes('AI_ETHICS_COMMITTEE')
          && aiDutyViolation(actor.id, actor.roles, 'ethics_review', gate.facts) === 'GEN-29',
        canPrepare: !!officer && gate.adoptionTasks.length === 1 && (!gate.adoptionTasks[0].assigneeUserId || gate.adoptionTasks[0].assigneeUserId === actor.id)
          && gate.ethicsRequired && !gate.ethicsApproved && !gate.ethicsTasks.length,
        tasks: [...gate.adoptionTasks, ...gate.ethicsTasks].map(task => {
          const isEthics = task.assigneeRoleCode === 'AI_ETHICS_COMMITTEE';
          const eligible = (isEthics ? committee : officer) && (!task.assigneeUserId || task.assigneeUserId === actor.id);
          return { id: task.id, kind: isEthics ? 'ethics' : 'adoption', canReturn: !!eligible,
            canApprove: !!eligible && referencesCurrent && (isEthics || !gate.ethicsRequired || gate.ethicsApproved) };
        }), history: risk.assessments.map(round => ({ id: round.id, round: round.round, decisions: round.decisions })) };
    }, options);
  }

  /** Explicit repair of a pending Phase 3B gate; GET never creates business tasks. */
  async prepare(userId: string, id: string, expectedVersion: number, clientIp?: string) {
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'case.approve.airs', tx), gate = await this.gate(tx, userId, id);
      if (!actor.roles.includes('AI_GOVERNANCE_OFFICER')) throw new ForbiddenException('Only the Responsible AI Officer prepares assessment adoption');
      await this.authorization.enforceDuty(actor, 'adopt_assessment', gate.facts, id);
      if (!gate.active || gate.risk.version !== expectedVersion || gate.adoptionTasks.length !== 1 || !gate.ethicsRequired || gate.ethicsApproved || gate.ethicsTasks.length)
        throw new ConflictException('Assessment review gate changed; reload before preparation');
      if (gate.adoptionTasks[0].assigneeUserId && gate.adoptionTasks[0].assigneeUserId !== actor.id) throw new ForbiddenException('The adoption coordinator is assigned to another officer');
      const task = await this.routing.createStageTask(tx, gate.risk.workflowCase!.id, AIRS_STAGE.ethics, new Date(), { templateCode: AIRS_TEMPLATE_CODE,
        formDataJson: { assessmentId: gate.assessment!.id, ethicsReviewRequired: true, riskRef: gate.risk.riskRef } });
      await tx.aiRisk.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.workflowEvent.create({ data: { caseId: gate.risk.workflowCase!.id, taskId: task.id, actor: actor.id, action: 'airs.assessment.review.prepared' } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.assessment.review.prepared', entityType: 'ai_risk', entityId: id,
        metadata: { assessmentId: gate.assessment!.id, taskId: task.id, clientIp: clientIp ?? null } }, tx);
      return { id, version: expectedVersion + 1 };
    }, options);
  }

  async review(userId: string, id: string, taskId: string, dto: ReviewRiskAssessmentDto, clientIp?: string) {
    if (!['approve','return'].includes(dto.decision) || typeof dto.justification !== 'string' || !dto.justification.trim() || dto.justification.length > 5000)
      throw new BadRequestException('A supported decision and written justification are required');
    if (!Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20
      || dto.evidenceIds.some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)))
      throw new BadRequestException('Use 1–20 existing DGOP evidence identifiers');
    const evidenceIds = [...new Set(dto.evidenceIds)], justification = dto.justification.trim();
    return this.prisma.$transaction(async tx => {
      const gate = await this.gate(tx, userId, id), { risk, assessment } = gate;
      if (!gate.active || !assessment) throw new ConflictException('Risk assessment is not awaiting review/adoption');
      if (risk.version !== dto.expectedVersion) throw new ConflictException('AI risk changed; reload before recording the decision');
      const task = [...gate.adoptionTasks, ...gate.ethicsTasks].find(task => task.id === taskId);
      if (!task || task.status !== TaskStatus.pending || (task.assigneeUserId && task.assigneeUserId !== userId)) throw new ConflictException('Active assessment decision task not found');
      const kind = task.assigneeRoleCode === 'AI_ETHICS_COMMITTEE' ? 'ethics' : 'adoption';
      const actor = await this.authorization.authorize(userId, kind === 'ethics' ? 'case.view.airs.org' : 'case.approve.airs', tx);
      if (!actor.roles.includes(task.assigneeRoleCode!)) throw new ForbiddenException('The assessment task requires its configured competent role');
      await this.authorization.enforceDuty(actor, kind === 'ethics' ? 'ethics_review' : 'adopt_assessment', gate.facts, id);
      if (kind === 'ethics' && !gate.ethicsRequired) throw new ConflictException('Independent Ethics review is not required for this round');
      if (kind === 'ethics' && gate.ethicsTasks.length !== 1) throw new ConflictException('Exactly one pending independent Ethics task is required');
      if (kind === 'adoption' && gate.adoptionTasks.length !== 1) throw new ConflictException('Exactly one pending adoption task is required');
      if (dto.decision === 'approve') {
        const input = jsonRecord(assessment.inputs), result = jsonRecord(assessment.result);
        if (!await this.currentReferences(tx, input['configuration'], true)) throw new ConflictException('Scoring references changed; return the assessment for a fresh round');
        let recomputed: ReturnType<typeof computeInherentRisk>;
        try { recomputed = computeInherentRisk(jsonRecord(input['likelihood'])['value'] as number, input['dimensions'] as Parameters<typeof computeInherentRisk>[1], input['configuration'] as RiskScoringConfiguration); }
        catch { throw new ConflictException('The immutable assessment input/configuration is inconsistent'); }
        if (['score','bandCode','severityCode','impactFinal','impactTopDimension','likelihood'].some(key => result[key] !== recomputed[key as keyof typeof recomputed]))
          throw new ConflictException('The immutable computed assessment result is inconsistent');
        if (kind === 'adoption' && gate.ethicsRequired && !gate.ethicsApproved) throw new ConflictException('Independent Ethics approval of this assessment round is required before adoption');
      }
      if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length) throw new BadRequestException('Every decision evidence identifier must exist in the DGOP evidence store');
      const now = new Date();
      const decision = await tx.aiRiskAssessmentDecision.create({ data: { assessmentId: assessment.id, taskId: task.id, kind,
        decision: dto.decision, actorId: actor.id, actorRoleCode: task.assigneeRoleCode!, justification, evidenceIds, clientIp } });
      await tx.workflowTask.update({ where: { id: task.id }, data: { status: TaskStatus.completed, completedAt: now, assigneeUserId: actor.id,
        decision: dto.decision === 'approve' ? TaskDecision.approved : TaskDecision.rejected, decisionComment: justification,
        formSubmittedAt: now, formSubmittedBy: actor.id, formDataJson: { ...jsonRecord(task.formDataJson), decisionId: decision.id,
          reviewDecision: dto.decision, justification, evidenceIds } as Prisma.InputJsonObject } });
      let nextTaskId: string | null = null;
      if (dto.decision === 'return') {
        await tx.workflowTask.updateMany({ where: { id: { in: gate.current.map(task => task.id) }, status: { in: open } },
          data: { status: TaskStatus.cancelled, completedAt: now, decisionComment: 'Cancelled after assessment return' } });
        const sourceIntakeTaskId = jsonRecord(assessment.inputs)['sourceIntakeTaskId'];
        if (typeof sourceIntakeTaskId !== 'string' || !risk.owner?.userId) throw new ConflictException('A submitted intake and assigned Risk Owner are required for reassessment');
        const next = await this.routing.createStageTask(tx, risk.workflowCase!.id, AIRS_STAGE.inherent, now, { templateCode: AIRS_TEMPLATE_CODE,
          assigneeUserId: risk.owner.userId, formDataJson: { sourceIntakeTaskId, riskRef: risk.riskRef, returnedAssessmentId: assessment.id,
            returnDecisionId: decision.id, returnJustification: justification } });
        nextTaskId = next.id;
      } else if (kind === 'adoption') {
        if (!risk.owner?.userId) throw new ConflictException('An assigned Risk Owner is required for response preparation');
        const next = await this.routing.openResponseGate(tx, risk.workflowCase!.id, assessment.id, decision.id, risk.riskRef!, risk.owner.userId, now);
        nextTaskId = next.id;
      }
      const updated = await tx.aiRisk.updateMany({ where: { id, version: dto.expectedVersion }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('AI risk changed; reload before recording the decision');
      const action = `airs.assessment.${kind}.${dto.decision}`;
      await tx.workflowEvent.create({ data: { caseId: risk.workflowCase!.id, taskId: task.id, actor: actor.id, action, comment: justification } });
      await this.audit.logRequired({ actor: actor.id, action, entityType: 'ai_risk', entityId: id,
        metadata: { assessmentId: assessment.id, round: assessment.round, decisionId: decision.id, taskId, actorRoleCode: task.assigneeRoleCode,
          decision: dto.decision, justification, evidenceIds, nextTaskId, clientIp: clientIp ?? null } }, tx);
      return { id, version: dto.expectedVersion + 1, decisionId: decision.id, nextTaskId };
    }, options);
  }
}
