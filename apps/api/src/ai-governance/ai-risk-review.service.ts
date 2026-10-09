import { logAiRequired, notifyReviewWindow } from './ai-notifications';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { businessDaysBetween, escalationLevel, escalationPenalty, escalationOwnerRole } from '../governance-operations/governance-operations.logic';
import { formatBusinessSequence, nextAvailableBusinessCode } from '../common/business-sequence';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiResidualDecisionService } from './ai-residual-decision.service';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { jsonRecord } from './ai-risk-scoring';
import { CompleteAiRiskReviewDto, ReassessAiRiskDto, REASSESSMENT_TRIGGERS } from './ai-risk-review.dto';
import { AiReviewDisplayService } from './ai-review-display.service';
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 15000 };
const KSA = 10800000;
export function aiReviewStatus(completed: boolean, dueAt: Date, now = new Date()) {
    if (completed)
        return 'completed';
    if (dueAt <= now)
        return 'overdue';
    return dueAt.getTime() - now.getTime() <= 7 * 86400000 ? 'due_soon' : 'scheduled';
}
export function aiReviewDue(anchor: Date, intervalDays: number, immediate = false) {
    if (immediate)
        return new Date(anchor);
    const date = new Date(anchor.getTime() + KSA);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + intervalDays + 1) - KSA - 1);
}
export function aiReviewThresholds(anchor: Date, due: Date, now: Date, holidays: string[] = [], recurring: string[] = []) {
    if (now >= due)
        return [50, 80, 95, 100].filter(t => t === 100 || due > anchor);
    const shift = (d: Date) => new Date(d.getTime() + KSA);
    const total = businessDaysBetween(shift(anchor), shift(due), holidays, recurring);
    const elapsed = businessDaysBetween(shift(anchor), shift(now), holidays, recurring);
    return total > 0 ? [50, 80, 95].filter(t => elapsed / total * 100 >= t) : [];
}
type Gate = Awaited<ReturnType<AiResidualDecisionService['gate']>>;
const authorityLevels: Record<string, number> = { AI_USECASE_OWNER: 0, AI_GOVERNANCE_OFFICER: 1, AI_ETHICS_COMMITTEE: 2, AI_EXECUTIVE_TEAM: 3, STEERING_COMMITTEE: 4 };
const reviewInclude = { completion: true, cancellation: { include: { reassessment: true } }, signals: { orderBy: { threshold: 'asc' as const } }, task: { include: { templateStage: true } } } satisfies Prisma.AiRiskReviewInclude;
@Injectable()
export class AiRiskReviewService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly risks: AiRiskIntakeService, private readonly decisions: AiResidualDecisionService, private readonly routing: AiWorkflowRoutingService, private readonly audit: AuditService, private readonly display: AiReviewDisplayService = new AiReviewDisplayService(prisma)) { }
    private terminal(g: Gate) {
        if (!g.parentCurrent || !g.assessment || g.assessment.decisions.some(d => d.decision === 'return'))
            return undefined;
        const kind = { LOW: 'accept_owner', MEDIUM: 'countersign', HIGH: 'executive', CRITICAL: 'steering' }[g.result['bandCode'] as string];
        return g.assessment.decisions.find(d => d.kind === kind && (g.result['bandCode'] === 'CRITICAL' ? ['restrict', 'stop'].includes(d.decision) : d.decision === 'accept'));
    }
    private manages(g: Gate) { return g.actor.administratorOverride || !g.actor.roles.includes('auditor') && g.permissions.has('airs.cadence.manage') && g.actor.roles.some(r => ['AI_WORKING_GROUP', 'AI_GOVERNANCE_OFFICER'].includes(r)); }
    private reversalAuthority(g: Gate) {
        const previous = this.terminal(g);
        if (!previous || !g.permissions.has('airs.risk.reverse'))
            return null;
        const previousLevel = authorityLevels[previous.actorRoleCode];
        ;
        if (!g.actor.administratorOverride && (g.actor.roles.includes('auditor') || [previous.actorId, g.risk.owner?.userId, g.facts.useCaseOwnerId].includes(g.actor.id)))
            return null;
        const role = g.actor.administratorOverride ? 'STEERING_COMMITTEE' : g.actor.roles.filter(r => authorityLevels[r] > previousLevel && g.permissionRoles['airs.risk.reverse']?.includes(r)).sort((a, b) => authorityLevels[b] - authorityLevels[a])[0];
        return role ? { role, level: authorityLevels[role], previousLevel } : null;
    }
    private async cadence(tx: Prisma.TransactionClient) {
        const now = new Date(), versions = await tx.governedReferenceVersion.findMany({ where: { listCode: 'R_LEVEL_DAYS', state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 });
        const v = versions[0], codes = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        if (versions.length !== 1 || v.values.length !== 4 || codes.some(code => !v.values.some(value => value.code === code && Number.isInteger(jsonRecord(value.metadata)['intervalDays']) && (jsonRecord(value.metadata)['intervalDays'] as number) > 0 && (jsonRecord(value.metadata)['intervalDays'] as number) <= 3660 && jsonRecord(value.metadata)['firstReviewImmediate'] === (code === 'CRITICAL'))))
            return null;
        await tx.$queryRaw `SELECT id FROM governed_reference_versions WHERE id=${v.id} FOR SHARE`;
        return v;
    }
    private async owner(tx: Prisma.TransactionClient, g: Gate) {
        const id = g.risk.owner?.userId;
        if (!id || !await tx.person.findFirst({ where: { id: g.risk.ownerPersonId!, userId: id, isActive: true, deletedAt: null }, select: { id: true } }))
            throw new ConflictException('An active actual Risk Owner is required');
        const actor = await this.authorization.authorize(id, 'airs.risk.assess', tx);
        if (!actor.roles.includes('AI_RISK_OWNER'))
            throw new ConflictException('Actual Risk Owner requires the explicit assessment grant');
        const access = await this.risks.visibility(id, tx);
        if (!await tx.aiRisk.findFirst({ where: { AND: [access.where, { id: g.risk.id }] }, select: { id: true } }))
            throw new ConflictException('Actual Risk Owner must retain risk scope');
        return id;
    }
    private async open(tx: Prisma.TransactionClient, g: Gate, anchor: Date, actorId: string, round: number, templateId?: string, cycleStart = round === 1) {
        const terminal = this.terminal(g), cadence = await this.cadence(tx);
        if (!terminal || !cadence)
            throw new ConflictException('Current terminal residual decision and published four-band R_LEVEL_DAYS metadata are required');
        const bandCode = g.result['bandCode'] as string, value = cadence.values.find(v => v.code === bandCode)!, intervalDays = jsonRecord(value.metadata)['intervalDays'] as number;
        const assignedOwnerId = await this.owner(tx, g), dueAt = aiReviewDue(anchor, intervalDays, cycleStart && bandCode === 'CRITICAL'), id = randomUUID();
        const template = templateId ? await tx.complianceCalendarTemplate.update({ where: { id: templateId }, data: { status: 'active', lastRunAt: anchor, nextRunAt: dueAt, updatedBy: actorId } }) : await tx.complianceCalendarTemplate.create({ data: { code: `CAL-AIRS-${g.risk.id}`, title: `${g.risk.riskRef} · AI risk review`, type: 'ai_risk_review', cadence: 'governed_days', ownerRoleCode: 'AI_RISK_OWNER', nextRunAt: dueAt, lastRunAt: anchor, defaultSlaBusinessDays: 0, createdBy: actorId } });
        const occurrence = await tx.complianceCalendarOccurrence.create({ data: { templateId: template.id, code: `${template.code}-${round}`, title: template.title, dueAt, workflowCaseId: g.risk.workflowCase!.id, createdBy: actorId } });
        const task = await this.routing.createStageTask(tx, g.risk.workflowCase!.id, 'airs-periodic-review', new Date(), { templateCode: AIRS_TEMPLATE_CODE, assigneeRoleCode: 'AI_RISK_OWNER', assigneeUserId: assignedOwnerId, formDataJson: { reviewId: id, acceptanceDecisionId: terminal.id, referenceVersionId: cadence.id, bandCode, intervalDays } });
        await tx.workflowTask.update({ where: { id: task.id }, data: { dueDate: dueAt } });
        return tx.aiRiskReview.create({ data: { ...(await this.display.pin(tx, bandCode, intervalDays, cadence.id)), id, riskId: g.risk.id, acceptanceDecisionId: terminal.id, referenceVersionId: cadence.id, calendarTemplateId: template.id, calendarOccurrenceId: occurrence.id, taskId: task.id, round, bandCode, intervalDays, cadenceLabelEn: value.labelEn, cadenceLabelAr: value.labelAr, anchorAt: anchor, dueAt, assignedOwnerId, createdBy: actorId } });
    }
    async context(userId: string, id: string) {
        return this.prisma.$transaction(async (tx) => {
            const g = await this.decisions.gate(tx, userId, id), history = await tx.aiRiskReview.findMany({ where: { riskId: id }, include: reviewInclude, orderBy: { round: 'desc' } }), cadence = await this.cadence(tx);
            const ownerActive = !!g.risk.owner?.userId && !!await tx.person.findFirst({ where: { id: g.risk.ownerPersonId!, isActive: true, deletedAt: null }, select: { id: true } });
            const reassessments = await tx.aiRiskReassessment.findMany({ where: { riskId: id }, orderBy: { inherentRound: 'desc' }, include: { additionalTriggers: { orderBy: { createdAt: 'desc' } } } });
            const administratorOverride = g.actor.administratorOverride;
            return { version: g.risk.version, administratorOverride, reassessments, reversals: await tx.aiRiskAuthorityReversal.findMany({ where: { riskId: id }, orderBy: { createdAt: 'desc' } }), canReverseAuthority: !!this.reversalAuthority(g) && ['implemented', 'decision_made'].includes(g.risk.workflowCase?.status ?? ''), canAddTrigger: !!reassessments.length && g.risk.workflowCase?.status === 'under_review' && (this.manages(g) || ownerActive && g.risk.owner?.userId === userId && g.actor.roles.includes('AI_RISK_OWNER') && g.permissions.has('airs.risk.assess') && !g.actor.roles.includes('auditor')), canReassess: !!this.terminal(g) && ['implemented', 'decision_made'].includes(g.risk.workflowCase?.status ?? '') && (this.manages(g) || ownerActive && g.risk.owner?.userId === userId && g.actor.roles.includes('AI_RISK_OWNER') && g.permissions.has('airs.risk.assess') && !g.actor.roles.includes('auditor')), cadenceReady: !!cadence, canRegister: !!cadence && this.manages(g) && !!this.terminal(g) && (!history.length || !!history[0].cancellation) && g.risk.workflowCase?.status === 'decision_made', canRecalculate: this.manages(g) && history.length > 0,
                history: history.map(r => ({ ...r, task: undefined, status: r.cancellation ? 'superseded' : aiReviewStatus(!!r.completion, r.dueAt), canComplete: !!cadence && !!this.terminal(g) && !r.completion && !r.cancellation && ownerActive && g.risk.workflowCase?.status === 'implemented' && (administratorOverride || r.assignedOwnerId === userId && g.risk.owner?.userId === userId && g.permissions.has('airs.risk.assess') && g.actor.roles.includes('AI_RISK_OWNER') && !g.actor.roles.includes('auditor')) && r.task.status === 'pending' })) };
        }, options);
    }
    async register(userId: string, id: string, expectedVersion: number, clientIp?: string) {
        return this.prisma.$transaction(async (tx) => {
            const g = await this.decisions.gate(tx, userId, id);
            await this.authorization.authorize(userId, 'airs.cadence.manage', tx, id);
            if (!this.manages(g))
                throw new ForbiddenException('Working Group or Responsible AI Officer cadence authority required');
            const latest = await tx.aiRiskReview.findFirst({ where: { riskId: id }, orderBy: { round: 'desc' }, include: reviewInclude });
            const terminal = this.terminal(g), tasks = await tx.workflowTask.findMany({ where: { caseId: g.risk.workflowCase!.id, status: 'pending', templateStage: { is: { code: 'airs-monitoring', template: { is: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } } } } } });
            if (g.risk.version !== expectedVersion || g.risk.workflowCase?.status !== 'decision_made' || !terminal || tasks.length !== 1 || jsonRecord(tasks[0].formDataJson)['acceptanceDecisionId'] !== terminal.id || (latest && !latest.cancellation) || (latest && latest.acceptanceDecisionId === terminal.id))
                throw new ConflictException('Monitoring gate/version changed; reload');
            const review = await this.open(tx, g, terminal.createdAt, userId, (latest?.round ?? 0) + 1, latest?.calendarTemplateId, true);
            await tx.workflowTask.update({ where: { id: tasks[0].id }, data: { status: 'completed', completedAt: new Date(), formSubmittedBy: userId, formSubmittedAt: new Date() } });
            await tx.workflowCase.update({ where: { id: g.risk.workflowCase!.id }, data: { status: 'implemented' } });
            await this.changed(tx, g, userId, 'airs.review.register', { reviewId: review.id, referenceVersionId: review.referenceVersionId, dueAt: review.dueAt, clientIp: clientIp ?? null });
            return { id, version: expectedVersion + 1, reviewId: review.id };
        }, options);
    }
    async complete(userId: string, id: string, reviewId: string, dto: CompleteAiRiskReviewDto, clientIp?: string) {
        if (!dto.justification?.trim() || dto.justification.length > 5000 || !Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20 || dto.evidenceIds.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))
            throw new BadRequestException('Written review justification and 1–20 existing evidence identifiers are required');
        return this.prisma.$transaction(async (tx) => {
            const g = await this.decisions.gate(tx, userId, id), actor = await this.authorization.authorize(userId, 'airs.risk.assess', tx, id), administratorOverride = actor.administratorOverride;
            const r = await tx.aiRiskReview.findFirst({ where: { id: reviewId, riskId: id }, include: reviewInclude });
            if (!r || r.completion || r.cancellation || g.risk.version !== dto.expectedVersion || g.risk.workflowCase?.status !== 'implemented' || !this.terminal(g) || this.terminal(g)!.id !== r.acceptanceDecisionId)
                throw new ConflictException('Review gate/version changed; reload');
            const actualOwner = await this.owner(tx, g);
            if (!administratorOverride && (userId !== r.assignedOwnerId || userId !== actualOwner) || r.task.status !== 'pending' || !administratorOverride && r.task.assigneeUserId !== userId || r.task.assigneeRoleCode !== 'AI_RISK_OWNER' || r.task.templateStage?.code !== 'airs-periodic-review' || r.task.dueDate?.getTime() !== r.dueAt.getTime() || jsonRecord(r.task.formDataJson)['reviewId'] !== r.id)
                throw new ForbiddenException('Only the active actual assigned Risk Owner may complete this protected review');
            const evidenceIds = [...new Set(dto.evidenceIds)];
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every review evidence identifier must exist');
            const completedAt = new Date();
            await tx.aiRiskReviewCompletion.create({ data: { reviewId, actorId: userId, justification: dto.justification.trim(), evidenceIds, completedAt, clientIp } });
            await tx.workflowTask.update({ where: { id: r.taskId }, data: { status: 'completed', completedAt, formSubmittedBy: userId, formSubmittedAt: completedAt } });
            await tx.complianceCalendarOccurrence.update({ where: { id: r.calendarOccurrenceId }, data: { status: 'completed', completedAt } });
            const next = await this.open(tx, g, completedAt, userId, r.round + 1, r.calendarTemplateId);
            await tx.governanceNotification.updateMany({ where: { sourceType: 'ai_risk_review', sourceId: reviewId, status: { not: 'archived' } }, data: { status: 'archived' } });
            await tx.governanceNotificationDeliveryAttempt.updateMany({ where: { notification: { sourceType: 'ai_risk_review', sourceId: reviewId, status: 'archived' }, status: { in: ['planned', 'failed'] } }, data: { status: 'skipped', nextRetryAt: null, errorMessage: 'Native AI work completed or superseded' } });
            await tx.governanceEscalation.updateMany({ where: { sourceType: 'ai_risk_review', sourceId: reviewId, status: { not: 'resolved' } }, data: { status: 'resolved', resolvedAt: completedAt, updatedBy: userId } });
            await this.changed(tx, g, userId, 'airs.review.complete', { reviewId, nextReviewId: next.id, completedAt, justification: dto.justification.trim(), evidenceIds, clientIp: clientIp ?? null });
            return { id, version: dto.expectedVersion + 1, nextReviewId: next.id };
        }, options);
    }
    async reverseAuthority(userId: string, id: string, dto: CompleteAiRiskReviewDto, clientIp?: string) {
        return this.startReassessment(userId, id, { ...dto, triggerCode: 'authority_reversal' }, clientIp, true);
    }
    async reassess(userId: string, id: string, dto: ReassessAiRiskDto, clientIp?: string) {
        return this.startReassessment(userId, id, dto, clientIp, false);
    }
    private async startReassessment(userId: string, id: string, dto: CompleteAiRiskReviewDto & {
        triggerCode: string;
    }, clientIp?: string, reversal = false) {
        if ((!reversal && !REASSESSMENT_TRIGGERS.includes(dto.triggerCode as typeof REASSESSMENT_TRIGGERS[number])) || !dto.justification?.trim() || dto.justification.length > 5000 || !Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20 || dto.evidenceIds.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))
            throw new BadRequestException('Recognized PRC-05 trigger, written justification and existing evidence are required');
        return this.prisma.$transaction(async (tx) => {
            const g = await this.decisions.gate(tx, userId, id), terminal = this.terminal(g);
            if (reversal) {
                await this.authorization.authorize(userId, 'airs.risk.reverse', tx, id);
                if (!this.reversalAuthority(g)) {
                    await logAiRequired(this.audit, { actor: userId, action: 'ai.sod.blocked', entityType: 'ai_risk', entityId: id, metadata: { attemptedAction: 'higher_authority_reversal', rule: 'GEN-31', previousDecisionId: terminal?.id ?? null } });
                    throw new ForbiddenException('An independent higher actual decision authority is required');
                }
            }
            else if (this.manages(g))
                await this.authorization.authorize(userId, 'airs.cadence.manage', tx, id);
            else {
                await this.authorization.authorize(userId, 'airs.risk.assess', tx, id);
                if (!g.actor.roles.includes('AI_RISK_OWNER') || userId !== g.risk.owner?.userId)
                    throw new ForbiddenException('Only the actual Risk Owner or governed cadence authority may initiate reassessment');
            }
            if (!terminal || !['implemented', 'decision_made'].includes(g.risk.workflowCase?.status ?? '') || g.risk.version !== dto.expectedVersion)
                throw new ConflictException('Reassessment gate/version changed; reload');
            const assignedOwnerId = await this.owner(tx, g), evidenceIds = [...new Set(dto.evidenceIds)];
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every trigger evidence identifier must exist');
            const intake = await tx.workflowTask.findMany({ where: { caseId: g.risk.workflowCase!.id, status: 'completed', templateStage: { is: { code: 'airs-identification' } } } });
            const sources = intake.filter(t => JSON.stringify(jsonRecord(t.formDataJson)['submittedIntake']) === JSON.stringify(g.risk.intakeData));
            if (sources.length !== 1)
                throw new ConflictException('Exactly one matching original submitted intake is required');
            const previous = await tx.aiAssessmentRound.aggregate({ where: { riskId: id, kind: 'inherent' }, _max: { round: true } }), inherentRound = (previous._max.round ?? 0) + 1;
            const task = await this.routing.createStageTask(tx, g.risk.workflowCase!.id, 'airs-inherent-assessment', new Date(), { templateCode: AIRS_TEMPLATE_CODE, assigneeRoleCode: 'AI_RISK_OWNER', assigneeUserId: assignedOwnerId, formDataJson: { sourceIntakeTaskId: sources[0].id, riskRef: g.risk.riskRef, previousAcceptanceDecisionId: terminal.id, reassessmentRequiredRound: inherentRound } });
            const reassessment = await tx.aiRiskReassessment.create({ data: { riskId: id, previousAcceptanceDecisionId: terminal.id, coordinatorTaskId: task.id, sourceIntakeTaskId: sources[0].id, inherentRound, triggerCode: dto.triggerCode, justification: dto.justification.trim(), evidenceIds, actorId: userId, clientIp } });
            if (reversal) {
                const authority = this.reversalAuthority(g)!;
                await tx.aiRiskAuthorityReversal.create({ data: { riskId: id, previousDecisionId: terminal.id, reassessmentId: reassessment.id, actorId: userId, actorRoleCode: authority.role, authorityLevel: authority.level, previousAuthorityLevel: authority.previousLevel, justification: dto.justification.trim(), evidenceIds } });
            }
            const pending = await tx.aiRiskReview.findMany({ where: { riskId: id, completion: { is: null }, cancellation: { is: null } } });
            for (const review of pending) {
                const cancellation = await tx.aiRiskReviewCancellation.create({ data: { reviewId: review.id, reassessmentId: reassessment.id } });
                await tx.workflowTask.update({ where: { id: review.taskId }, data: { status: 'cancelled', completedAt: cancellation.createdAt } });
                await tx.complianceCalendarOccurrence.update({ where: { id: review.calendarOccurrenceId }, data: { status: 'archived', completedAt: null } });
                await tx.complianceCalendarTemplate.update({ where: { id: review.calendarTemplateId }, data: { status: 'paused', updatedBy: userId } });
                await tx.governanceNotification.updateMany({ where: { sourceType: 'ai_risk_review', sourceId: review.id }, data: { status: 'archived' } });
                await tx.governanceNotificationDeliveryAttempt.updateMany({ where: { notification: { sourceType: 'ai_risk_review', sourceId: review.id, status: 'archived' }, status: { in: ['planned', 'failed'] } }, data: { status: 'skipped', nextRetryAt: null, errorMessage: 'Native AI work completed or superseded' } });
                await tx.governanceEscalation.updateMany({ where: { sourceType: 'ai_risk_review', sourceId: review.id, status: { not: 'resolved' } }, data: { status: 'resolved', resolvedAt: cancellation.createdAt, updatedBy: userId } });
            }
            await tx.workflowTask.updateMany({ where: { caseId: g.risk.workflowCase!.id, status: 'pending', templateStage: { is: { code: 'airs-monitoring' } } }, data: { status: 'cancelled', completedAt: new Date() } });
            await tx.workflowCase.update({ where: { id: g.risk.workflowCase!.id }, data: { status: 'under_review' } });
            await this.changed(tx, g, userId, 'airs.reassessment.started', { reassessmentId: reassessment.id, coordinatorTaskId: task.id, inherentRound, triggerCode: dto.triggerCode, justification: dto.justification.trim(), evidenceIds, supersededReviewIds: pending.map(r => r.id), previousAcceptanceDecisionId: terminal.id, clientIp: clientIp ?? null });
            return { id, version: dto.expectedVersion + 1, reassessmentId: reassessment.id, coordinatorTaskId: task.id };
        }, options);
    }
    async addTrigger(userId: string, id: string, dto: ReassessAiRiskDto, clientIp?: string) {
        if (!REASSESSMENT_TRIGGERS.includes(dto.triggerCode) || typeof dto.justification !== 'string' || !dto.justification.trim() || dto.justification.length > 5000 || !Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20 || dto.evidenceIds.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))
            throw new BadRequestException('Recognized PRC-05 trigger, written justification and existing evidence are required');
        return this.prisma.$transaction(async (tx) => {
            const g = await this.decisions.gate(tx, userId, id);
            if (this.manages(g))
                await this.authorization.authorize(userId, 'airs.cadence.manage', tx, id);
            else {
                await this.authorization.authorize(userId, 'airs.risk.assess', tx, id);
                if (!g.actor.roles.includes('AI_RISK_OWNER') || g.risk.owner?.userId !== userId)
                    throw new ForbiddenException('Only the actual Risk Owner or cadence authority may record additional triggers');
            }
            const entry = await tx.aiRiskReassessment.findFirst({ where: { riskId: id }, orderBy: { inherentRound: 'desc' } });
            if (!entry || g.risk.workflowCase?.status !== 'under_review' || g.risk.version !== dto.expectedVersion)
                throw new ConflictException('An active reassessment and current version are required');
            const assignedOwnerId = await this.owner(tx, g), evidenceIds = [...new Set(dto.evidenceIds)];
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every trigger evidence identifier must exist');
            const source = await tx.workflowTask.findUniqueOrThrow({ where: { id: entry.sourceIntakeTaskId }, include: { templateStage: true } });
            if (source.caseId !== g.risk.workflowCase.id || source.status !== 'completed' || source.templateStage?.code !== 'airs-identification' || JSON.stringify(jsonRecord(source.formDataJson)['submittedIntake']) !== JSON.stringify(g.risk.intakeData))
                throw new ConflictException('Original intake provenance changed');
            const requiredInherentRound = (await tx.aiAssessmentRound.aggregate({ where: { riskId: id, kind: 'inherent' }, _max: { round: true } }))._max.round ?? 0;
            const pending = await tx.workflowTask.findMany({ where: { caseId: g.risk.workflowCase.id, status: { in: ['pending', 'in_progress'] }, templateStage: { is: { templateId: g.risk.workflowCase.templateId!, code: { startsWith: 'airs-' }, isActive: true } } }, select: { id: true } });
            await tx.workflowTask.updateMany({ where: { id: { in: pending.map(t => t.id) }, status: { in: ['pending', 'in_progress'] } }, data: { status: 'cancelled', completedAt: new Date() } });
            const task = await this.routing.createStageTask(tx, g.risk.workflowCase.id, 'airs-inherent-assessment', new Date(), { templateCode: AIRS_TEMPLATE_CODE, assigneeRoleCode: 'AI_RISK_OWNER', assigneeUserId: assignedOwnerId, formDataJson: { sourceIntakeTaskId: source.id, riskRef: g.risk.riskRef, previousAcceptanceDecisionId: entry.previousAcceptanceDecisionId, reassessmentRequiredRound: requiredInherentRound + 1, reassessmentId: entry.id } });
            const trigger = await tx.aiReassessmentTrigger.create({ data: { reassessmentId: entry.id, coordinatorTaskId: task.id, requiredInherentRound: requiredInherentRound + 1, triggerCode: dto.triggerCode, justification: dto.justification.trim(), evidenceIds, actorId: userId, clientIp } });
            await this.changed(tx, g, userId, 'airs.reassessment.trigger.recorded', { triggerId: trigger.id, reassessmentId: entry.id, requiredInherentRound: trigger.requiredInherentRound, coordinatorTaskId: task.id, cancelledTaskIds: pending.map(t => t.id), triggerCode: dto.triggerCode, justification: dto.justification.trim(), evidenceIds, clientIp: clientIp ?? null });
            return { id, version: dto.expectedVersion + 1, triggerId: trigger.id, coordinatorTaskId: task.id };
        }, options);
    }
    private async changed(tx: Prisma.TransactionClient, g: Gate, actor: string, action: string, metadata: Record<string, unknown>) {
        if ((await tx.aiRisk.updateMany({ where: { id: g.risk.id, version: g.risk.version }, data: { version: { increment: 1 } } })).count !== 1)
            throw new ConflictException('AI risk changed; reload');
        await tx.workflowEvent.create({ data: { caseId: g.risk.workflowCase!.id, actor, action } });
        await logAiRequired(this.audit, { actor, action, entityType: 'ai_risk', entityId: g.risk.id, metadata: { ...metadata, before: { version: g.risk.version }, after: { version: g.risk.version + 1 } } }, tx);
    }
    async recalculate(userId: string, id: string, expectedVersion: number) {
        const access = await this.risks.get(userId, id);
        await this.authorization.authorize(userId, 'airs.cadence.manage');
        if (access.version !== expectedVersion)
            throw new ConflictException('AI risk changed; reload');
        return this.processSignals(new Date(), id, userId, expectedVersion);
    }
    // Called by DGOP's existing scheduler; dates/thresholds are never public inputs.
    async processSignals(now = new Date(), riskId?: string, actor = 'system:governance-operations', expectedVersion?: number) {
        const holidays = await this.prisma.ksaHoliday.findMany(), dates = holidays.filter(h => !h.isRecurring).map(h => h.date.toISOString().slice(0, 10)), recurring = holidays.filter(h => h.isRecurring).map(h => h.date.toISOString().slice(5, 10));
        let cursor: string | undefined, created = 0;
        do {
            const rows = await this.prisma.aiRiskReview.findMany({ where: { ...(riskId ? { riskId } : {}), completion: { is: null }, cancellation: { is: null }, risk: { is: { deletedAt: null, useCase: { is: { deletedAt: null, asset: { is: { isActive: true, deletedAt: null } } } }, workflowCase: { is: { status: 'implemented' } } } } }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
            if (!rows.length)
                break;
            for (const row of rows)
                created += await this.prisma.$transaction(async (tx) => {
                    if (expectedVersion !== undefined) {
                        await this.authorization.authorize(actor, 'airs.cadence.manage', tx, riskId);
                        const access = await this.risks.visibility(actor, tx);
                        if (!await tx.aiRisk.findFirst({ where: { AND: [access.where, { id: row.riskId, version: expectedVersion }] }, select: { id: true } }))
                            throw new ConflictException('AI review scope/version changed; reload');
                    }
                    const r = await tx.aiRiskReview.findUniqueOrThrow({ where: { id: row.id }, include: { ...reviewInclude, risk: { include: { owner: true } } } });
                    if (r.completion || r.cancellation || r.task.status !== 'pending' || r.task.assigneeUserId !== r.assignedOwnerId || r.task.dueDate?.getTime() !== r.dueAt.getTime() || r.risk.owner?.userId !== r.assignedOwnerId || !r.risk.owner.isActive || r.risk.owner.deletedAt || !await tx.user.findFirst({ where: { id: r.assignedOwnerId, isActive: true, userRoles: { none: { role: { code: 'auditor', isActive: true, deletedAt: null } }, some: { role: { code: 'AI_RISK_OWNER', isActive: true, deletedAt: null, permissions: { some: { permission: { resource: 'airs.risk', action: 'assess' } } } } } } }, select: { id: true } }))
                        return 0;
                    let count = 0;
                    const ownerScope = await this.risks.visibility(r.assignedOwnerId, tx);
                    if (!await tx.aiRisk.findFirst({ where: { AND: [ownerScope.where, { id: r.riskId }] }, select: { id: true } }))
                        return 0;
                    const windowNotices = await notifyReviewWindow(tx, this.audit, r.id, now);
                    for (const threshold of aiReviewThresholds(r.anchorAt, r.dueAt, now, dates, recurring)) {
                        if (r.signals.some(s => s.threshold === threshold))
                            continue;
                        const notificationIds = windowNotices, breach = threshold === 100;
                        let escalationId: string | undefined;
                        if (breach) {
                            const overdue = Math.max(0, businessDaysBetween(new Date(r.dueAt.getTime() + KSA), new Date(now.getTime() + KSA), dates, recurring)), level = escalationLevel(overdue), day = now.toISOString().slice(0, 10).replace(/-/g, '');
                            const code = await nextAvailableBusinessCode(tx, `governance_operations:governanceEscalation:${day}`, v => `ESC-${day}-${formatBusinessSequence(v, 3)}`, async (code) => !await tx.governanceEscalation.findUnique({ where: { code }, select: { id: true } }));
                            escalationId = (await tx.governanceEscalation.create({ data: { code, dedupeKey: `ai-review:${r.id}:breach`, level, sourceType: 'ai_risk_review', sourceId: r.id, reason: 'AI periodic review deadline breached', penaltyPoints: escalationPenalty(overdue), ownerRoleCode: escalationOwnerRole(level), dueAt: r.dueAt, escalatedAt: now, workflowCaseId: r.task.caseId, workflowTaskId: r.taskId, createdBy: actor } })).id;
                        }
                        await tx.aiRiskReviewSignal.create({ data: { reviewId: r.id, threshold, notificationIds, escalationId } });
                        count++;
                        await tx.workflowEvent.create({ data: { caseId: r.task.caseId, taskId: r.taskId, actor, action: breach ? 'governance.airs.review.overdue.v1' : 'governance.airs.review.due.v1', comment: JSON.stringify({ reviewId: r.id, threshold, notificationIds, escalationId: escalationId ?? null }) } });
                        await logAiRequired(this.audit, { actor, action: 'airs.review.sla.signal', entityType: 'ai_risk', entityId: r.riskId, metadata: { reviewId: r.id, threshold, notificationIds, escalationId: escalationId ?? null } }, tx);
                    }
                    const existing = await tx.governanceEscalation.findUnique({ where: { dedupeKey: `ai-review:${r.id}:breach` } });
                    if (existing && existing.status !== 'resolved') {
                        const overdue = Math.max(0, businessDaysBetween(new Date(r.dueAt.getTime() + KSA), new Date(now.getTime() + KSA), dates, recurring)), level = escalationLevel(overdue), penaltyPoints = escalationPenalty(overdue);
                        if (existing.level !== level || existing.penaltyPoints !== penaltyPoints) {
                            await tx.governanceEscalation.update({ where: { id: existing.id }, data: { level, penaltyPoints, ownerRoleCode: escalationOwnerRole(level), updatedBy: actor } });
                            await logAiRequired(this.audit, { actor, action: 'airs.review.sla.escalate', entityType: 'ai_risk', entityId: r.riskId, metadata: { reviewId: r.id, escalationId: existing.id, level, penaltyPoints } }, tx);
                        }
                    }
                    return count;
                }, options);
            cursor = rows[rows.length - 1].id;
            if (rows.length < 100)
                break;
        } while (true);
        return { created };
    }
}
