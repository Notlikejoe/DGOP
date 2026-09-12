import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiPermission, aiRoleMayHold, splitAiPermission } from './ai-permissions';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { AssignAiRiskOwnerDto } from './ai-risk-intake.dto';

export const RISK_INTAKE_LISTS = { risk_category: 'R_RISKCAT', ethics_principle: 'R_ETHICS', dev_stage: 'R_LIFECYCLE',
  control_effectiveness: 'R_CTRLEFF', risk_source: 'R_SOURCE', risk_intent: 'R_INTENT', risk_timing: 'R_TIMING' } as const;
const VIEW: AiPermission[] = ['case.view.airs.own', 'case.view.airs.org', 'case.view.airs.all'];
const TEXT = { title: 200, cause: 5000, event: 5000, effect: 5000, current_controls: 5000, notes: 5000 };
export const riskSelect = {
  id: true, riskRef: true, version: true, title: true, cause: true, event: true, effect: true,
  ownerPersonId: true, intakeData: true, handoffPayload: true, aiucHandoffSourceId: true,
  owner: { select: { id: true, userId: true, fullNameEn: true, fullNameAr: true } },
  useCase: { select: { id: true, useCaseRef: true, name: true, assetId: true, organizationUnitId: true,
    owner: { select: { userId: true } }, organizationUnit: { select: { nameEn: true, nameAr: true } }, asset: { select: { code: true, nameEn: true, nameAr: true } } } },
  obligations: { where: { deletedAt: null }, select: { id: true, description: true } },
  assessments: { where: { kind: 'inherent' }, orderBy: { round: 'desc' }, take: 20,
    select: { id: true, round: true, engineVersion: true, inputs: true, result: true, createdAt: true, decisions: true } },
  workflowCase: { select: { id: true, code: true, type: true, status: true, templateId: true,
    tasks: { where: { status: { in: [TaskStatus.pending, TaskStatus.in_progress] } }, select: {
      id: true, assigneeUserId: true, assigneeRoleCode: true, dueDate: true, templateStage: { select: { code: true } },
    } } } },
} satisfies Prisma.AiRiskSelect;

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function validateInput(value: unknown, complete = false): Record<string, unknown> {
  const input = record(value), issues: Array<{ field: string; message: string }> = [];
  const known = new Set([...Object.keys(TEXT), ...Object.keys(RISK_INTAKE_LISTS), 'evidence', 'third_party_involved']);
  for (const [field, entry] of Object.entries(input)) {
    if (!known.has(field)) { issues.push({ field, message: 'Computed or unknown fields cannot be submitted' }); continue; }
    if (field === 'evidence') {
      if (!Array.isArray(entry) || entry.length > 20 || entry.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) issues.push({ field, message: 'Use up to 20 DGOP evidence identifiers' });
    } else if (field === 'third_party_involved') {
      if (typeof entry !== 'boolean') issues.push({ field, message: 'Confirm the third-party flag as Yes or No' });
    } else if (typeof entry !== 'string' || entry.length > (TEXT[field as keyof typeof TEXT] ?? 80)) issues.push({ field, message: 'Text value is required within the supported length' });
  }
  if (complete) {
    for (const field of ['title', 'cause', 'event', 'effect', 'current_controls', ...Object.keys(RISK_INTAKE_LISTS)]) {
      if (typeof input[field] !== 'string' || !(input[field] as string).trim()) issues.push({ field, message: 'Required before risk submission' });
    }
    if (typeof input['third_party_involved'] !== 'boolean') issues.push({ field: 'third_party_involved', message: 'Third-party involvement must be confirmed' });
  }
  if (issues.length) throw new BadRequestException({ message: 'Risk intake validation failed', issues });
  return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, typeof entry === 'string' ? entry.trim() : entry]));
}

@Injectable()
export class AiRiskIntakeService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService,
    private readonly scope: ScopeService, private readonly routing: AiWorkflowRoutingService,
    private readonly identifiers: AiIdentifiersService, private readonly audit: AuditService) {}

  async visibility(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const actor = await this.authorization.authorizeAny(userId, VIEW, tx);
    const candidates = [...VIEW, 'case.create.airs', 'airs.risk.assess', 'case.approve.airs',
      'airs.risk.accept.low', 'airs.risk.accept.medium', 'airs.risk.accept.high'] as AiPermission[];
    const grants = await tx.rolePermission.findMany({ where: { role: { is: { code: { in: actor.roles }, isActive: true, deletedAt: null } },
      permission: { is: { OR: candidates.map(splitAiPermission) } } }, include: { permission: true, role: { select: { code: true } } } });
    const permissions = new Set(grants.filter(grant => aiRoleMayHold(grant.role.code, `${grant.permission.resource}.${grant.permission.action}` as AiPermission))
      .map(grant => `${grant.permission.resource}.${grant.permission.action}`));
    const scope = await this.scope.resolve(actor.roles);
    const asset: Prisma.DataAssetWhereInput = { deletedAt: null, isActive: true,
      ...(scope.orgUnits === 'all' ? {} : { orgUnitId: { in: scope.orgUnits } }),
      ...(scope.domains === 'all' ? {} : { domainId: { in: scope.domains } }),
      ...(scope.maxClassRank === null ? {} : { classification: { is: { rank: { lte: scope.maxClassRank } } } }) };
    const where: Prisma.AiRiskWhereInput = { deletedAt: null, workflowCase: { is: { type: 'AIRS' } },
      useCase: { is: { deletedAt: null, asset: { is: asset } } },
      ...(permissions.has('case.view.airs.all') || permissions.has('case.view.airs.org') ? {} : {
        OR: [{ owner: { is: { userId: actor.id } } }, { useCase: { is: { owner: { is: { userId: actor.id } } } } },
          { useCase: { is: { requesterUserId: actor.id } } }, { createdBy: actor.id },
          { workflowCase: { is: { tasks: { some: { OR: [{ assigneeUserId: actor.id },
            { assigneeUserId: null, assigneeRoleCode: { in: actor.roles }, status: { in: [TaskStatus.pending, TaskStatus.in_progress] } }] } } } } }],
      }) };
    return { actor, permissions, where };
  }

  private decorate(item: Prisma.AiRiskGetPayload<{ select: typeof riskSelect }>, actor: { id: string; roles: string[] }, permissions: Set<string>) {
    const draft = item.workflowCase?.status === 'draft' && !item.riskRef && !actor.roles.includes('auditor');
    return { ...item, canAssignOwner: draft && actor.roles.includes('AI_WORKING_GROUP') && permissions.has('case.create.airs'),
      canEdit: draft && item.owner?.userId === actor.id && actor.roles.includes('AI_RISK_OWNER') && permissions.has('case.create.airs') };
  }

  async list(userId: string) {
    const { actor, permissions, where } = await this.visibility(userId);
    return (await this.prisma.aiRisk.findMany({ where, select: riskSelect, orderBy: { updatedAt: 'desc' }, take: 100 })).map(item => this.decorate(item, actor, permissions));
  }
  async get(userId: string, id: string) {
    const { actor, permissions, where } = await this.visibility(userId);
    const item = await this.prisma.aiRisk.findFirst({ where: { AND: [where, { id }] }, select: riskSelect });
    if (!item) throw new NotFoundException('AI risk not found');
    return this.decorate(item, actor, permissions);
  }

  private async references(tx: Prisma.TransactionClient = this.prisma) {
    const now = new Date();
    const lists = await Promise.all(Object.entries(RISK_INTAKE_LISTS).map(async ([field, listCode]) => {
      const versions = await tx.governedReferenceVersion.findMany({ where: { listCode, state: 'published', effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, take: 2,
        select: { id: true, values: { select: { code: true, labelEn: true, labelAr: true }, orderBy: { sortOrder: 'asc' } } } });
      return { field, listCode, versionId: versions.length === 1 ? versions[0].id : null, values: versions.length === 1 ? versions[0].values : [] };
    }));
    return lists;
  }
  async lookups(userId: string) {
    const { actor, permissions } = await this.visibility(userId);
    const lists = await this.references();
    const riskOwners = actor.roles.includes('AI_WORKING_GROUP') && permissions.has('case.create.airs') ? await this.prisma.person.findMany({ where: {
      isActive: true, deletedAt: null, user: { is: { isActive: true, userRoles: { none: { role: { is: { code: 'auditor', isActive: true, deletedAt: null } } }, some: { role: { is: { code: 'AI_RISK_OWNER', isActive: true, deletedAt: null,
        permissions: { some: { permission: { is: splitAiPermission('case.create.airs') } } } } } } } } },
    }, select: { userId: true, fullNameEn: true, fullNameAr: true }, orderBy: { fullNameEn: 'asc' }, take: 500 }) : [];
    return { ready: lists.every(list => !!list.versionId && list.values.length > 0), lists, riskOwners };
  }

  private async writable(tx: Prisma.TransactionClient, userId: string, id: string, version: number, ownerOnly: boolean) {
    const actor = await this.authorization.authorize(userId, 'case.create.airs', tx);
    const visibility = await this.visibility(userId, tx);
    const item = await tx.aiRisk.findFirst({ where: { AND: [visibility.where, { id }] }, select: riskSelect });
    if (!item || item.workflowCase?.status !== 'draft' || item.riskRef) throw new NotFoundException('AI risk draft not available');
    if (item.version !== version) throw new ConflictException('AI risk changed; reload before editing');
    if (ownerOnly && (!actor.roles.includes('AI_RISK_OWNER') || item.owner?.userId !== actor.id)) throw new ForbiddenException('Only the assigned Risk Owner can edit or submit this intake');
    return { actor, item };
  }

  async assign(userId: string, id: string, dto: AssignAiRiskOwnerDto, clientIp?: string) {
    if (!dto.justification.trim()) throw new BadRequestException('Owner assignment justification is required');
    return this.prisma.$transaction(async tx => {
      const { actor, item } = await this.writable(tx, userId, id, dto.expectedVersion, false);
      if (!actor.roles.includes('AI_WORKING_GROUP')) throw new ForbiddenException('The working group assigns the risk intake owner');
      const nominee = await this.authorization.authorize(dto.ownerUserId, 'case.create.airs', tx);
      if (!nominee.roles.includes('AI_RISK_OWNER')) throw new BadRequestException('Select an existing eligible AI Risk Owner');
      const person = await tx.person.findFirst({ where: { userId: nominee.id, isActive: true, deletedAt: null } });
      if (!person) throw new BadRequestException('Risk Owner must have an active directory person');
      const visibleToNominee = await this.visibility(nominee.id, tx);
      // Scope check excludes the own-record relation because this is the first assignment.
      const scope = await this.scope.resolve(nominee.roles);
      const asset = await tx.dataAsset.findUniqueOrThrow({ where: { id: item.useCase.assetId! }, include: { classification: true } });
      if ((scope.orgUnits !== 'all' && (!asset.orgUnitId || !scope.orgUnits.includes(asset.orgUnitId)))
        || (scope.domains !== 'all' && (!asset.domainId || !scope.domains.includes(asset.domainId)))
        || scope.maxClassRank !== null && (!asset.classification || asset.classification.rank > scope.maxClassRank)
        || !visibleToNominee.permissions.has('case.view.airs.own') && !visibleToNominee.permissions.has('case.view.airs.org') && !visibleToNominee.permissions.has('case.view.airs.all')) throw new ForbiddenException('Risk Owner must have scope and read access to the linked asset');
      await this.routing.bindExistingCase(tx, item.workflowCase!.id, AIRS_TEMPLATE_CODE);
      await tx.workflowTask.updateMany({ where: { caseId: item.workflowCase!.id, status: { in: [TaskStatus.pending, TaskStatus.in_progress] } }, data: { status: TaskStatus.cancelled } });
      const task = await this.routing.createStageTask(tx, item.workflowCase!.id, AIRS_STAGE.identification, new Date(), {
        templateCode: AIRS_TEMPLATE_CODE, assigneeUserId: nominee.id, formDataJson: { sourceRiskId: id, handoffSourceId: item.aiucHandoffSourceId } });
      await tx.aiRisk.update({ where: { id }, data: { ownerPersonId: person.id, version: { increment: 1 } } });
      await tx.workflowEvent.create({ data: { caseId: item.workflowCase!.id, taskId: task.id, actor: actor.id, action: 'airs.owner.assigned', comment: dto.justification.trim() } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.owner.assigned', entityType: 'ai_risk', entityId: id,
        metadata: { oldOwnerPersonId: item.ownerPersonId, newOwnerPersonId: person.id, taskId: task.id, justification: dto.justification.trim(), clientIp: clientIp ?? null } }, tx);
      return { id, version: item.version + 1 };
    }, this.options);
  }

  private async validatedReferences(tx: Prisma.TransactionClient, input: Record<string, unknown>) {
    const lists = await this.references(tx), issues: Array<{ field: string; message: string }> = [];
    const resolvedValues: Record<string, unknown> = {}, referenceVersionIds: Record<string, string> = {};
    for (const list of lists) {
      if (!input[list.field]) continue;
      const value = list.versionId ? list.values.find(value => value.code === input[list.field]) : null;
      if (!value) issues.push({ field: list.field, message: `Select a value from unambiguous published ${list.listCode}` });
      else { resolvedValues[list.field] = value; referenceVersionIds[list.field] = list.versionId!; }
    }
    const evidence = [...new Set((input['evidence'] ?? []) as string[])];
    if (await tx.ndiEvidence.count({ where: { id: { in: evidence }, deletedAt: null } }) !== evidence.length) issues.push({ field: 'evidence', message: 'Every evidence identifier must exist in DGOP' });
    if (issues.length) throw new BadRequestException({ message: 'Risk intake references are not ready', issues });
    return { resolvedValues, referenceVersionIds };
  }

  async save(userId: string, id: string, version: number, patch: Record<string, unknown>, clientIp?: string) {
    const normalized = validateInput(patch);
    return this.prisma.$transaction(async tx => {
      const { actor, item } = await this.writable(tx, userId, id, version, true);
      const input = { ...record(item.intakeData), ...normalized };
      await this.validatedReferences(tx, input);
      await tx.aiRisk.update({ where: { id }, data: { intakeData: input as Prisma.InputJsonObject,
        title: typeof input['title'] === 'string' ? input['title'] : item.title,
        cause: typeof input['cause'] === 'string' ? input['cause'] : item.cause,
        event: typeof input['event'] === 'string' ? input['event'] : item.event,
        effect: typeof input['effect'] === 'string' ? input['effect'] : item.effect, version: { increment: 1 } } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.intake.saved', entityType: 'ai_risk', entityId: id,
        metadata: { oldValue: item.intakeData, newValue: input, version: version + 1, clientIp: clientIp ?? null } }, tx);
      return { id, version: version + 1 };
    }, this.options);
  }

  async submit(userId: string, id: string, version: number, clientIp?: string) {
    return this.prisma.$transaction(async tx => {
      const { actor, item } = await this.writable(tx, userId, id, version, true);
      const input = validateInput(record(item.intakeData), true);
      const references = await this.validatedReferences(tx, input);
      const task = await tx.workflowTask.findFirst({ where: { caseId: item.workflowCase!.id,
        status: { in: [TaskStatus.pending, TaskStatus.in_progress] }, assigneeUserId: actor.id, assigneeRoleCode: 'AI_RISK_OWNER',
        templateStage: { is: { code: AIRS_STAGE.identification, templateId: item.workflowCase!.templateId ?? '', isActive: true,
          template: { is: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } } } } } });
      if (!task || !item.workflowCase!.templateId) throw new ConflictException('An assigned AIRS identification task is required');
      const now = new Date(), riskRef = await this.identifiers.nextRiskRef(tx);
      const snapshot = { ...input, ...references, riskRef, ownerPersonId: item.ownerPersonId, registeredAt: now.toISOString() };
      await tx.aiRisk.update({ where: { id }, data: { riskRef, intakeData: snapshot as Prisma.InputJsonObject, version: { increment: 1 } } });
      await tx.workflowTask.update({ where: { id: task.id }, data: { status: TaskStatus.completed, completedAt: now,
        formSubmittedAt: now, formSubmittedBy: actor.id, formDataJson: { submittedIntake: snapshot } as Prisma.InputJsonObject } });
      await tx.workflowCase.update({ where: { id: item.workflowCase!.id }, data: { title: String(input['title']), status: 'submitted' } });
      await tx.workflowEvent.create({ data: { caseId: item.workflowCase!.id, taskId: task.id, actor: actor.id,
        action: 'airs.intake.submitted', fromStatus: 'draft', toStatus: 'submitted', comment: riskRef } });
      const assessment = await this.routing.createStageTask(tx, item.workflowCase!.id, AIRS_STAGE.inherent, now, {
        templateCode: AIRS_TEMPLATE_CODE, assigneeUserId: actor.id, formDataJson: { sourceIntakeTaskId: task.id, riskRef } });
      await tx.workflowCase.update({ where: { id: item.workflowCase!.id }, data: { status: 'under_review' } });
      await tx.workflowEvent.create({ data: { caseId: item.workflowCase!.id, taskId: assessment.id, actor: 'system',
        action: 'airs.assessment.opened', fromStatus: 'submitted', toStatus: 'under_review', comment: riskRef } });
      await this.audit.logRequired({ actor: actor.id, action: 'airs.intake.submitted', entityType: 'ai_risk', entityId: id,
        metadata: { ...snapshot, sourceUseCaseId: item.useCase.id, relatedAssetId: item.useCase.assetId,
          caseCode: item.workflowCase!.code, assessmentTaskId: assessment.id, clientIp: clientIp ?? null } }, tx);
      return { id, version: version + 1, riskRef, nextTaskId: assessment.id };
    }, this.options);
  }
  private readonly options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 };
}
