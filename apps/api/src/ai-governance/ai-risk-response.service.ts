import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskDecision, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService, aiDutyViolation } from './ai-authorization.service';
import { AiRiskIntakeService, riskSelect } from './ai-risk-intake.service';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { jsonRecord } from './ai-risk-scoring';
import { ProposeRiskResponseDto, RESPONSE_STRATEGIES } from './ai-risk-response.dto';
import { ReviewRiskAssessmentDto } from './ai-risk-adoption.dto';

const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 };
const stages = { MITIGATE: 'airs-treatment-plan', TRANSFER: 'airs-treatment-plan', AVOID: 'airs-avoidance-review',
  ACCEPT: 'airs-acceptance-gate', ESCALATE: 'airs-escalation-gate' } as const;
const roles = { officer: 'AI_GOVERNANCE_OFFICER', privacy: 'privacy_officer', security: 'security_reviewer' } as const;
function text(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000) throw new BadRequestException('Written justification is required');
  return value.trim();
}
function ids(value: unknown, required = true): string[] {
  if (!Array.isArray(value) || (required && !value.length) || value.length > 20 || value.some(id => typeof id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) throw new BadRequestException('Use existing DGOP evidence identifiers');
  return [...new Set(value as string[])];
}

@Injectable()
export class AiRiskResponseService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService,
    private readonly risks: AiRiskIntakeService, private readonly routing: AiWorkflowRoutingService, private readonly audit: AuditService) {}

  private async references(tx: Prisma.TransactionClient) {
    const now = new Date(), versions = await tx.governedReferenceVersion.findMany({ where: { listCode: 'R_STRATEGY', state: 'published',
      effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 });
    const version = versions.length === 1 ? versions[0] : null;
    const ready = !!version && version.values.length === 5 && RESPONSE_STRATEGIES.every(code => version.values.some(value => value.code === code));
    return { ready, versionId: version?.id ?? null, values: version?.values.map(value => ({ code: value.code, labelEn: value.labelEn, labelAr: value.labelAr })) ?? [] };
  }
  private async referenceCurrent(tx: Prisma.TransactionClient, versionId: string, lock = false) {
    if (lock) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM governed_reference_versions WHERE id = ${versionId} AND "listCode" = 'R_STRATEGY'
        AND state = 'published' AND "effectiveFrom" <= CURRENT_TIMESTAMP AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP) FOR SHARE`;
      return rows.length === 1;
    }
    return !!await tx.governedReferenceVersion.findFirst({ where: { id: versionId, listCode: 'R_STRATEGY', state: 'published',
      effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] } });
  }
  private async gate(tx: Prisma.TransactionClient, userId: string, id: string) {
    const access = await this.risks.visibility(userId, tx);
    const risk = await tx.aiRisk.findFirst({ where: { AND: [access.where, { id }] }, select: riskSelect });
    if (!risk) throw new NotFoundException('AI risk not found');
    const assessment = await tx.aiAssessmentRound.findFirst({ where: { riskId: id, kind: 'inherent' }, orderBy: { round: 'desc' }, include: { decisions: true } });
    const adoption = assessment?.decisions.find(value => value.kind === 'adoption' && value.decision === 'approve');
    const tasks = risk.workflowCase?.templateId ? await tx.workflowTask.findMany({ where: { caseId: risk.workflowCase.id, status: TaskStatus.pending,
      templateStage: { is: { templateId: risk.workflowCase.templateId, code: { in: [AIRS_STAGE.response, AIRS_STAGE.proposal, AIRS_STAGE.consultation] },
        isActive: true, template: { is: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } } } } }, include: { templateStage: { select: { code: true } } } }) : [];
    const coordinators = tasks.filter(task => task.templateStage?.code === AIRS_STAGE.response && task.assigneeRoleCode === roles.officer
      && jsonRecord(task.formDataJson)['assessmentId'] === assessment?.id && jsonRecord(task.formDataJson)['adoptionDecisionId'] === adoption?.id);
    const coordinator = coordinators.length === 1 ? coordinators[0] : null;
    const responseId = jsonRecord(coordinator?.formDataJson)['responseId'];
    const response = typeof responseId === 'string' ? await tx.aiRiskResponse.findFirst({ where: { id: responseId, riskId: id, assessmentId: assessment?.id }, include: { decisions: true } }) : null;
    const proposals = tasks.filter(task => task.templateStage?.code === AIRS_STAGE.proposal && task.assigneeRoleCode === 'AI_RISK_OWNER'
      && task.assigneeUserId === risk.owner?.userId && jsonRecord(task.formDataJson)['coordinatorTaskId'] === coordinator?.id);
    const consultations = response ? tasks.filter(task => task.templateStage?.code === AIRS_STAGE.consultation && jsonRecord(task.formDataJson)['responseId'] === response.id) : [];
    const active = risk.workflowCase?.status === 'under_review' && !!risk.riskRef && !!adoption && !!coordinator
      && (!response || !response.decisions.some(value => value.kind === 'officer' || value.decision === 'return'));
    const facts = { riskOwnerId: risk.owner?.userId ?? undefined, useCaseOwnerId: risk.useCase.owner?.userId ?? undefined,
      assessmentAssessorIds: response ? [response.submittedBy] : [] };
    return { ...access, risk, assessment, adoption, tasks, coordinator, response, proposals, consultations, active, facts };
  }
  private owner(actor: { id: string; roles: string[] }, ownerId: string | null | undefined) {
    if (!actor.roles.includes('AI_RISK_OWNER') || actor.id !== ownerId) throw new ForbiddenException('Only the assigned Risk Owner proposes the response');
  }
  private version(gate: { active: boolean; risk: { version: number } }, expectedVersion: number) {
    if (!gate.active) throw new ConflictException('An adopted assessment and one pending response coordinator are required');
    if (gate.risk.version !== expectedVersion) throw new ConflictException('AI risk changed; reload before response action');
  }
  private async evidence(tx: Prisma.TransactionClient, evidenceIds: string[]) {
    if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
      throw new BadRequestException('Every evidence identifier must exist in the DGOP evidence store');
  }
  async context(userId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const gate = await this.gate(tx, userId, id), refs = await this.references(tx), { actor, permissions, response } = gate;
      const owner = gate.active && permissions.has('airs.risk.assess') && actor.roles.includes('AI_RISK_OWNER') && actor.id === gate.risk.owner?.userId && !actor.roles.includes('auditor');
      const current = !!response && await this.referenceCurrent(tx, response.referenceVersionId);
      const consultationRequired = jsonRecord(response?.payload)['consultationRequired'] === true;
      const consulted = !consultationRequired || ['privacy','security'].every(kind => response?.decisions.some(value => value.kind === kind && value.decision === 'approve'));
      const officer = gate.active && permissions.has('case.approve.airs') && actor.roles.includes(roles.officer)
        && !aiDutyViolation(actor.id, actor.roles, 'adopt_assessment', gate.facts);
      const queue = response ? [gate.coordinator!, ...gate.consultations] : [];
      return { version: gate.risk.version, references: refs, awaitingProposal: gate.active && !response, canPrepare: !!owner && !response && !gate.proposals.length,
        canPropose: !!owner && !response && gate.proposals.length === 1 && refs.ready, response, consultationRequired, consulted, referencesCurrent: current,
        tasks: queue.map(task => {
          const kind = task.templateStage?.code === AIRS_STAGE.response ? 'officer' : jsonRecord(task.formDataJson)['kind'] as 'privacy' | 'security';
          const eligible = kind === 'officer' ? officer : gate.active && permissions.has('case.view.airs.org') && actor.roles.includes(roles[kind]) && !actor.roles.includes('auditor');
          const assigned = !task.assigneeUserId || task.assigneeUserId === actor.id;
          return { id: task.id, kind, canReturn: !!eligible && assigned, canApprove: !!eligible && assigned && current && (kind !== 'officer' || consulted) };
        }), history: await tx.aiRiskResponse.findMany({ where: { riskId: id }, orderBy: { round: 'desc' }, take: 20, include: { decisions: true } }) };
    }, options);
  }
  async prepare(userId: string, id: string, expectedVersion: number, clientIp?: string) {
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'airs.risk.assess', tx), gate = await this.gate(tx, userId, id);
      this.owner(actor, gate.risk.owner?.userId); this.version(gate, expectedVersion);
      if (gate.response || gate.proposals.length) throw new ConflictException('Response proposal is already initialized');
      await this.routing.createStageTask(tx, gate.risk.workflowCase!.id, AIRS_STAGE.proposal, new Date(), { templateCode: AIRS_TEMPLATE_CODE, assigneeUserId: actor.id,
        formDataJson: { ...jsonRecord(gate.coordinator!.formDataJson), coordinatorTaskId: gate.coordinator!.id } as Prisma.InputJsonObject });
      await this.commit(tx, id, gate.risk.workflowCase!.id, expectedVersion, actor.id, 'airs.response.prepared', { clientIp: clientIp ?? null });
      return { id, version: expectedVersion + 1 };
    }, options);
  }
  async propose(userId: string, id: string, dto: ProposeRiskResponseDto, clientIp?: string) {
    const justification = text(dto.justification), evidenceIds = ids(dto.evidenceIds), contractEvidenceIds = ids(dto.contractEvidenceIds ?? [], false);
    if (!RESPONSE_STRATEGIES.includes(dto.strategyCode) || typeof dto.offshoreProcessing !== 'boolean') throw new BadRequestException('A governed strategy and offshore confirmation are required');
    const provider = dto.provider?.trim() ?? '';
    if (provider.length > 400 || (dto.strategyCode === 'TRANSFER' && (!provider || !contractEvidenceIds.length))) throw new BadRequestException('Transfer requires a provider and contract evidence');
    return this.prisma.$transaction(async tx => {
      const actor = await this.authorization.authorize(userId, 'airs.risk.assess', tx), gate = await this.gate(tx, userId, id);
      this.owner(actor, gate.risk.owner?.userId); this.version(gate, dto.expectedVersion);
      if (gate.response || gate.proposals.length !== 1) throw new ConflictException('Exactly one unsubmitted response proposal task is required');
      const refs = await this.references(tx), choice = refs.values.find(value => value.code === dto.strategyCode);
      if (!refs.ready || !refs.versionId || !choice || !await this.referenceCurrent(tx, refs.versionId, true)) throw new ConflictException('Published R_STRATEGY with all five approved codes is required');
      await this.evidence(tx, [...new Set([...evidenceIds, ...contractEvidenceIds])]);
      const thirdParty = jsonRecord(gate.risk.intakeData)['third_party_involved'] === true || jsonRecord(gate.risk.handoffPayload)['thirdPartyInvolved'] === true;
      const offshoreProcessing = dto.offshoreProcessing || jsonRecord(gate.risk.intakeData)['offshore_processing'] === true || jsonRecord(gate.risk.handoffPayload)['offshoreProcessing'] === true;
      const consultationRequired = dto.strategyCode === 'TRANSFER' && (thirdParty || offshoreProcessing), now = new Date();
      const previous = await tx.aiRiskResponse.aggregate({ where: { riskId: id }, _max: { round: true } });
      const payload = { justification, evidenceIds, provider, contractEvidenceIds, thirdParty, offshoreProcessing, consultationRequired,
        choice, coordinatorTaskId: gate.coordinator!.id, adoptionDecisionId: gate.adoption!.id };
      const response = await tx.aiRiskResponse.create({ data: { riskId: id, assessmentId: gate.assessment!.id, round: (previous._max.round ?? 0) + 1,
        proposalTaskId: gate.proposals[0].id, referenceVersionId: refs.versionId, strategyCode: dto.strategyCode, payload, submittedBy: actor.id } });
      await tx.workflowTask.update({ where: { id: gate.proposals[0].id }, data: { status: TaskStatus.completed, completedAt: now,
        formSubmittedAt: now, formSubmittedBy: actor.id, formDataJson: { ...jsonRecord(gate.proposals[0].formDataJson), responseId: response.id } as Prisma.InputJsonObject } });
      await tx.workflowTask.update({ where: { id: gate.coordinator!.id }, data: { formDataJson: { ...jsonRecord(gate.coordinator!.formDataJson), responseId: response.id } as Prisma.InputJsonObject } });
      if (consultationRequired) for (const kind of ['privacy','security'] as const) await this.routing.createStageTask(tx, gate.risk.workflowCase!.id, AIRS_STAGE.consultation, now,
        { templateCode: AIRS_TEMPLATE_CODE, assigneeRoleCode: roles[kind], formDataJson: { responseId: response.id, assessmentId: gate.assessment!.id, kind } });
      await this.commit(tx, id, gate.risk.workflowCase!.id, dto.expectedVersion, actor.id, 'airs.response.proposed', { responseId: response.id, referenceVersionId: refs.versionId, payload, clientIp: clientIp ?? null });
      return { id, version: dto.expectedVersion + 1, responseId: response.id };
    }, options);
  }
  async decide(userId: string, id: string, taskId: string, dto: ReviewRiskAssessmentDto, clientIp?: string) {
    const justification = text(dto.justification), evidenceIds = ids(dto.evidenceIds);
    if (!['approve','return'].includes(dto.decision)) throw new BadRequestException('Approve or Return is required');
    return this.prisma.$transaction(async tx => {
      const gate = await this.gate(tx, userId, id); this.version(gate, dto.expectedVersion);
      if (!gate.response) throw new ConflictException('A submitted response is required');
      const task = [gate.coordinator!, ...gate.consultations].find(task => task.id === taskId);
      const kind = task?.templateStage?.code === AIRS_STAGE.response ? 'officer' : jsonRecord(task?.formDataJson)['kind'] as 'privacy' | 'security';
      if (!task || !roles[kind] || task.assigneeRoleCode !== roles[kind] || (task.assigneeUserId && task.assigneeUserId !== userId)) throw new ConflictException('Active response decision task not found');
      const actor = await this.authorization.authorize(userId, kind === 'officer' ? 'case.approve.airs' : 'case.view.airs.org', tx);
      if (!actor.roles.includes(roles[kind])) throw new ForbiddenException('The configured response role is required');
      await this.authorization.enforceDuty(actor, kind === 'officer' ? 'adopt_assessment' : 'task', gate.facts, id);
      if (dto.decision === 'approve') {
        if (!await this.referenceCurrent(tx, gate.response.referenceVersionId, true)) throw new ConflictException('Strategy publication changed; return for a fresh response proposal');
        if (gate.response.strategyCode === 'TRANSFER') {
          const payload = jsonRecord(gate.response.payload);
          if (typeof payload['provider'] !== 'string' || !payload['provider'].trim()) throw new ConflictException('Transfer provider is required');
          await this.evidence(tx, ids(payload['contractEvidenceIds']));
        }
        if (kind === 'officer' && jsonRecord(gate.response.payload)['consultationRequired'] === true
          && !['privacy','security'].every(kind => gate.response!.decisions.some(value => value.kind === kind && value.decision === 'approve')))
          throw new ConflictException('Both required transfer consultations must approve this response');
      }
      await this.evidence(tx, evidenceIds);
      const now = new Date(), decision = await tx.aiRiskResponseDecision.create({ data: { responseId: gate.response.id, taskId: task.id, kind,
        decision: dto.decision, actorId: actor.id, actorRoleCode: roles[kind], justification, evidenceIds, clientIp } });
      await tx.workflowTask.update({ where: { id: task.id }, data: { status: TaskStatus.completed, assigneeUserId: actor.id, completedAt: now,
        decision: dto.decision === 'approve' ? TaskDecision.approved : TaskDecision.rejected, decisionComment: justification,
        formSubmittedAt: now, formSubmittedBy: actor.id, formDataJson: { ...jsonRecord(task.formDataJson), decisionId: decision.id } as Prisma.InputJsonObject } });
      let nextTaskId: string | null = null;
      if (dto.decision === 'return') {
        await tx.workflowTask.updateMany({ where: { id: { in: [gate.coordinator!.id, ...gate.consultations.map(task => task.id)] }, status: TaskStatus.pending }, data: { status: TaskStatus.cancelled, completedAt: now } });
        const next = await this.routing.openResponseGate(tx, gate.risk.workflowCase!.id, gate.assessment!.id, gate.adoption!.id, gate.risk.riskRef!, gate.risk.owner!.userId!, now, gate.response.id);
        nextTaskId = next.id;
      } else if (kind === 'officer') {
        const strategy = gate.response.strategyCode as keyof typeof stages;
        const next = await this.routing.createStageTask(tx, gate.risk.workflowCase!.id, stages[strategy], now, { templateCode: AIRS_TEMPLATE_CODE,
          formDataJson: { responseId: gate.response.id, responseDecisionId: decision.id, assessmentId: gate.assessment!.id, strategyCode: strategy,
            prerequisitesPending: true, riskAccepted: false, planApproved: false, plannedActionsRequired: ['MITIGATE','TRANSFER'].includes(strategy) ? 1 : 0,
            acceptanceAuthorityFromResidualOnly: true, completedActionsRequired: ['HIGH','CRITICAL'].includes(jsonRecord(gate.assessment!.result)['bandCode'] as string) } });
        nextTaskId = next.id;
      }
      await this.commit(tx, id, gate.risk.workflowCase!.id, dto.expectedVersion, actor.id, `airs.response.${kind}.${dto.decision}`,
        { responseId: gate.response.id, decisionId: decision.id, taskId, justification, evidenceIds, nextTaskId, clientIp: clientIp ?? null });
      return { id, version: dto.expectedVersion + 1, decisionId: decision.id, nextTaskId };
    }, options);
  }
  private async commit(tx: Prisma.TransactionClient, id: string, caseId: string, version: number, actor: string, action: string, metadata: Record<string, unknown>) {
    if ((await tx.aiRisk.updateMany({ where: { id, version }, data: { version: { increment: 1 } } })).count !== 1) throw new ConflictException('AI risk changed; reload before response action');
    await tx.workflowEvent.create({ data: { caseId, actor, action } });
    await this.audit.logRequired({ actor, action, entityType: 'ai_risk', entityId: id, metadata }, tx);
  }
}
