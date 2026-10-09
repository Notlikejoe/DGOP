import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { aiReviewDue, aiReviewStatus } from './ai-risk-review.service';
import { reviewMeasures } from './ai-review-report.service';
import { jsonRecord } from './ai-risk-scoring';
import { CompleteAnnualReviewDto, HandoverAnnualReviewDto } from './ai-review-operations.dto';
import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';
import { scopedHistoryPage, visibleSnapshots } from './ai-review-history';
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 15000 };
const include = { handovers: { orderBy: { round: 'desc' as const } }, completion: true, organizationUnit: { select: { nameEn: true, nameAr: true } }, task: true } satisfies Prisma.AiAnnualReviewInclude;
type Annual = Prisma.AiAnnualReviewGetPayload<{
    include: typeof include;
}>;
@Injectable()
export class AiAnnualReviewService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly scope: ScopeService, private readonly risks: AiRiskIntakeService, private readonly routing: AiWorkflowRoutingService, private readonly identifiers: AiIdentifiersService, private readonly audit: AuditService) { }
    private async access(tx: Prisma.TransactionClient, userId: string, write = false) {
        const access = await this.risks.visibility(userId, tx);
        let actor=access.actor;
        if (!access.permissions.has('case.view.airs.org') && !access.permissions.has('case.view.airs.all'))
            throw new ForbiddenException('Annual reviews require register visibility');
        if (write) {
            actor=await this.authorization.authorize(userId, 'airs.cadence.manage', tx);
            if (!actor.administratorOverride && (!actor.roles.includes('AI_GOVERNANCE_OFFICER') || actor.roles.includes('auditor')))
                throw new ForbiddenException('Annual comprehensive review is owned by the Responsible AI Officer');
        }
        return { ...access, actor, scope: await this.scope.resolve(actor.roles) };
    }
    async registerScope(tx: Prisma.TransactionClient, userId: string, unitId: string, write = false) {
        const access = await this.access(tx, userId, write);
        const unit = await tx.organizationUnit.findFirst({ where: { id: unitId, isActive: true, deletedAt: null } });
        if (!unit || access.scope.orgUnits !== 'all' && !access.scope.orgUnits.includes(unitId))
            throw new NotFoundException('AI organization register not found');
        // Full register coverage is required; never label a partial domain/classification view comprehensive.
        if (access.scope.domains !== 'all' || access.scope.maxClassRank !== null)
            throw new ForbiddenException('Annual review requires full domain and classification coverage of this organization register');
        const unitWhere: Prisma.AiRiskWhereInput = { deletedAt: null, isSampleData: false, riskRef: { not: null }, workflowCase: { is: { type: 'AIRS' } }, useCase: { is: { organizationUnitId: unitId, deletedAt: null, isSampleData: false, lifecycleState:{not:'retired'}, asset: { is: { isActive: true, deletedAt: null } } } } };
        if (await tx.aiRisk.count({ where: unitWhere }) !== await tx.aiRisk.count({ where: { AND: [unitWhere, access.where] } }))
            throw new ForbiddenException('Annual review requires visibility of every register member');
        return { ...access, unit, where: { AND: [unitWhere, access.where] } satisfies Prisma.AiRiskWhereInput };
    }
    /** Read authority is current; retained lineage may include inactive assets/units. No write authority is granted. */
    async historyScope(tx: Prisma.TransactionClient, userId: string, unitId: string) {
        const a = await this.access(tx, userId);
        const unit = await tx.organizationUnit.findFirst({where:{id:unitId,deletedAt:null}});
        if (!unit || a.scope.orgUnits !== 'all' && !a.scope.orgUnits.includes(unitId)) throw new NotFoundException('AI organization register not found');
        if (a.scope.domains !== 'all' || a.scope.maxClassRank !== null) throw new ForbiddenException('Historical register requires full domain and classification coverage');
        const where: Prisma.AiRiskWhereInput = {deletedAt:null,isSampleData:false,riskRef:{not:null},workflowCase:{is:{type:'AIRS'}},
            useCase:{is:{organizationUnitId:unitId,deletedAt:null,isSampleData:false,asset:{is:{orgUnitId:unitId,deletedAt:null}}}}};
        return {...a,unit,where};
    }
    private async visibleSnapshot(tx: Prisma.TransactionClient, where: Prisma.AiRiskWhereInput, row: Annual) {
        if (!(await visibleSnapshots(tx,where,[row],r=>jsonRecord(r.sourceSnapshot)['members'] as Prisma.JsonValue)).length)
            throw new ForbiddenException('Historical annual snapshot is outside current register visibility');
    }
    async units(userId: string) {
        return this.prisma.$transaction(async tx=>{
            const a=await this.access(tx,userId), canManage=(a.actor.administratorOverride||a.actor.roles.includes('AI_GOVERNANCE_OFFICER')&&a.permissions.has('airs.cadence.manage')&&!a.actor.roles.includes('auditor'))&&a.scope.domains==='all'&&a.scope.maxClassRank===null;
            const units=await tx.organizationUnit.findMany({where:{deletedAt:null,OR:[{isActive:true},{aiAnnualReviews:{some:{}}},{aiMonthlyReviewReports:{some:{}}}],
                ...(a.scope.orgUnits==='all'?{}:{id:{in:a.scope.orgUnits}})},select:{id:true,nameEn:true,nameAr:true},orderBy:[{nameEn:'asc'},{id:'asc'}]});
            return {canManage,units};
        },options);
    }
    async context(userId: string, unitId: string, query: AiReviewQueryDto = new AiReviewQueryDto()) {
        aiReviewParams(query);
        return this.prisma.$transaction(async tx=>{
            const a=await this.historyScope(tx,userId,unitId), search=(query.search??'').trim();
            const evaluatedAt=new Date(),summary={total:0,completed:0,pending:0,overdue:0};
            const where: Prisma.AiAnnualReviewWhereInput={organizationUnitId:unitId,...(search?{OR:[{round:/^\d+$/u.test(search)&&Number(search)<=2147483647?Number(search): -1},{completion:{is:{OR:[{trendsSummary:{contains:search,mode:'insensitive'}},{controlEffectivenessSummary:{contains:search,mode:'insensitive'}},{nonconformitySummary:{contains:search,mode:'insensitive'}}]}}}]}:{})};
            const paged=await scopedHistoryPage(query,cursor=>tx.aiAnnualReview.findMany({where,select:{id:true,sourceSnapshot:true,dueAt:true,completion:{select:{id:true}}},orderBy:[{round:'desc'},{id:'asc'}],take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})}),
                rows=>visibleSnapshots(tx,a.where,rows,r=>jsonRecord(r.sourceSnapshot)['members'] as Prisma.JsonValue),r=>{summary.total++;if(r.completion)summary.completed++;else{summary.pending++;if(r.dueAt<=evaluatedAt)summary.overdue++;}});
            const rows=await tx.aiAnnualReview.findMany({where:{id:{in:paged.ids}},include,orderBy:[{round:'desc'},{id:'asc'}]});
            let writable=false;
            if(a.actor.administratorOverride||a.actor.roles.includes('AI_GOVERNANCE_OFFICER')&&a.permissions.has('airs.cadence.manage')&&!a.actor.roles.includes('auditor')) {
                try{await this.registerScope(tx,userId,unitId,true);writable=true;}catch(e){if(!(e instanceof ForbiddenException)&&!(e instanceof NotFoundException))throw e;}
            }
            const hasCalendar=await tx.aiAnnualReview.count({where:{organizationUnitId:unitId}})>0;
            const data=rows.map(r=>({...r,task:undefined,currentOfficerId:r.handovers[0]?.toOfficerId??r.assignedOfficerId,handoverRound:r.handovers[0]?.round??0,
                canHandover:writable&&!r.completion&&r.task.status==='pending',status:aiReviewStatus(!!r.completion,r.dueAt),
                canComplete:writable&&!r.completion&&(a.actor.administratorOverride||((r.handovers[0]?.toOfficerId??r.assignedOfficerId)===userId&&r.task.assigneeUserId===userId))&&r.task.status==='pending'}));
            return {...paged.envelope,data,summary,evaluatedAt,organizationUnit:a.unit,administratorOverride:a.actor.administratorOverride,canCaptureMonthly:writable,canRegister:writable&&!hasCalendar,readOnly:true};
        },options);
    }
    async nomineeList(userId: string, unitId: string, query: AiReviewQueryDto = new AiReviewQueryDto()) {
        aiReviewParams(query);
        return this.prisma.$transaction(async tx=>{
            await this.registerScope(tx,userId,unitId,true);
            const search=(query.search??'').trim(), eligibility=new Map<string,boolean>();
            const where: Prisma.UserWhereInput={isActive:true,...(search?{email:{contains:search,mode:'insensitive'}}:{}),userRoles:{some:{role:{code:'AI_GOVERNANCE_OFFICER',isActive:true,deletedAt:null,permissions:{some:{permission:{resource:'airs.cadence',action:'manage'}}}}},none:{role:{code:'auditor',isActive:true,deletedAt:null}}}};
            const paged=await scopedHistoryPage(query,cursor=>tx.user.findMany({where,select:{id:true,email:true,userRoles:{where:{role:{isActive:true,deletedAt:null}},select:{role:{select:{code:true}}}}},orderBy:[{email:'asc'},{id:'asc'}],take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})}),async rows=>{
                const result: typeof rows=[];
                for(const user of rows){
                    // Full-register grants and ScopeService are role-based. Cache identical role sets within this snapshot.
                    const key=user.userRoles.map(r=>r.role.code).sort().join('|');
                    if(!eligibility.has(key)){try{await this.registerScope(tx,user.id,unitId,true);eligibility.set(key,true);}catch(e){if(!(e instanceof ForbiddenException)&&!(e instanceof NotFoundException))throw e;eligibility.set(key,false);}}
                    if(eligibility.get(key))result.push(user);
                }
                return result;
            });
            const users=await tx.user.findMany({where:{id:{in:paged.ids}},select:{id:true,email:true},orderBy:[{email:'asc'},{id:'asc'}]});
            return {...paged.envelope,data:users,summary:{eligible:paged.envelope.total}};
        },options);
    }
    private async open(tx: Prisma.TransactionClient, userId: string, unitId: string, anchorAt: Date, round: number, calendarId?: string, caseId?: string) {
        const a = await this.registerScope(tx, userId, unitId, true), now = new Date(), dueAt = aiReviewDue(anchorAt, 365), id = randomUUID();
        const members = await tx.aiRisk.findMany({ where: a.where, orderBy: { id: 'asc' }, select: { id: true, riskRef: true, version: true, assessments: { orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, round: true, result: true, createdAt: true } } } });
        const reviewRows = await tx.aiRiskReview.findMany({ where: { riskId: { in: members.map(m => m.id) } }, select: { dueAt: true, completion: { select: { completedAt: true } }, cancellation: { select: { id: true } } } });
        const sourceSnapshot = { asOf: now.toISOString(), members: members.map(m => ({ ...m, assessments: m.assessments.map(v => ({ ...v, createdAt: v.createdAt.toISOString() })) })), periodic: reviewMeasures(reviewRows, now) };
        const calendar = calendarId ? await tx.complianceCalendarTemplate.update({ where: { id: calendarId }, data: { status: 'active', lastRunAt: anchorAt, nextRunAt: dueAt, updatedBy: userId } }) : await tx.complianceCalendarTemplate.create({ data: { code: `CAL-AI-ANNUAL-${unitId}`, title: `${a.unit.nameEn} · Annual AI comprehensive review`, type: 'ai_annual_review', cadence: 'annual', ownerRoleCode: 'AI_GOVERNANCE_OFFICER', lastRunAt: anchorAt, nextRunAt: dueAt, defaultSlaBusinessDays: 0, createdBy: userId } });
        if (!caseId) {
            const template = await tx.workflowTemplate.findFirstOrThrow({ where: { code: AIRS_TEMPLATE_CODE, isActive: true, deletedAt: null } });
            caseId = (await tx.workflowCase.create({ data: { code: await this.identifiers.nextCaseCode(tx, 'AIRS', now.getUTCFullYear()), title: calendar.title, type: 'AIRS', status: 'implemented', templateId: template.id, createdBy: userId } })).id;
        }
        const occurrence = await tx.complianceCalendarOccurrence.create({ data: { templateId: calendar.id, code: `${calendar.code}-${round}`, title: calendar.title, dueAt, workflowCaseId: caseId, createdBy: userId } });
        const task = await this.routing.createStageTask(tx, caseId, 'airs-annual-review', now, { templateCode: AIRS_TEMPLATE_CODE, assigneeRoleCode: 'AI_GOVERNANCE_OFFICER', assigneeUserId: userId, formDataJson: { annualReviewId: id, organizationUnitId: unitId } });
        await tx.workflowTask.update({ where: { id: task.id }, data: { dueDate: dueAt } });
        return tx.aiAnnualReview.create({ data: { id, organizationUnitId: unitId, calendarTemplateId: calendar.id, calendarOccurrenceId: occurrence.id, workflowCaseId: caseId, taskId: task.id, round, anchorAt, dueAt, assignedOfficerId: userId, createdBy: userId, sourceSnapshot } });
    }
    async register(userId: string, unitId: string, clientIp?: string) {
        return this.prisma.$transaction(async (tx) => {
            await this.registerScope(tx, userId, unitId, true);
            if (await tx.aiAnnualReview.count({ where: { organizationUnitId: unitId } }))
                throw new ConflictException('Annual calendar already registered');
            const review = await this.open(tx, userId, unitId, new Date(), 1);
            await this.audit.logRequired({ actor: userId, action: 'ai.annual.review.register', entityType: 'ai_annual_review', entityId: review.id, metadata: { organizationUnitId: unitId, dueAt: review.dueAt, clientIp: clientIp ?? null } }, tx);
            await tx.workflowEvent.create({ data: { caseId: review.workflowCaseId, taskId: review.taskId, actor: userId, action: 'ai.annual.review.register' } });
            return { reviewId: review.id };
        }, options);
    }
    async complete(userId: string, reviewId: string, dto: CompleteAnnualReviewDto, clientIp?: string) {
        for (const v of [dto.trendsSummary, dto.controlEffectivenessSummary, dto.nonconformitySummary])
            if (typeof v !== 'string' || !v.trim() || v.length > 5000)
                throw new BadRequestException('Written trends, control effectiveness and non-conformity findings are required');
        if (!Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20 || dto.evidenceIds.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))
            throw new BadRequestException('Existing review evidence identifiers are required');
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.aiAnnualReview.findUnique({ where: { id: reviewId }, include });
            if (!row)
                throw new NotFoundException('Annual review not found');
            const a = await this.registerScope(tx, userId, row.organizationUnitId, true);
            await this.visibleSnapshot(tx, (await this.historyScope(tx,userId,row.organizationUnitId)).where, row);
            const administratorOverride = a.actor.administratorOverride;
            if (row.completion || row.round !== dto.expectedRound || (dto.expectedHandoverRound ?? 0) !== (row.handovers[0]?.round ?? 0) || row.task.status !== 'pending' || !administratorOverride && (row.task.assigneeUserId !== userId || (row.handovers[0]?.toOfficerId ?? row.assignedOfficerId) !== userId) || row.task.dueDate?.getTime() !== row.dueAt.getTime() || jsonRecord(row.task.formDataJson)['annualReviewId'] !== row.id)
                throw new ConflictException('Annual review gate changed or belongs to another officer');
            const evidenceIds = [...new Set(dto.evidenceIds)];
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every evidence identifier must exist');
            const completedAt = new Date();
            await tx.aiAnnualReviewCompletion.create({ data: { reviewId, actorId: userId, trendsSummary: dto.trendsSummary.trim(), controlEffectivenessSummary: dto.controlEffectivenessSummary.trim(), nonconformitySummary: dto.nonconformitySummary.trim(), evidenceIds, completedAt, clientIp } });
            await tx.workflowTask.update({ where: { id: row.taskId }, data: { status: 'completed', completedAt, formSubmittedBy: userId, formSubmittedAt: completedAt } });
            await tx.complianceCalendarOccurrence.update({ where: { id: row.calendarOccurrenceId }, data: { status: 'completed', completedAt } });
            const next = await this.open(tx, userId, row.organizationUnitId, completedAt, row.round + 1, row.calendarTemplateId, row.workflowCaseId);
            await tx.governanceNotification.updateMany({ where: { workflowTaskId: row.taskId, status: { not: 'archived' } }, data: { status: 'archived' } });
            await tx.governanceEscalation.updateMany({ where: { workflowTaskId: row.taskId, status: { not: 'resolved' } }, data: { status: 'resolved', resolvedAt: completedAt, updatedBy: userId } });
            await this.audit.logRequired({ actor: userId, action: 'ai.annual.review.complete', entityType: 'ai_annual_review', entityId: reviewId, metadata: { nextReviewId: next.id, completedAt, evidenceIds, clientIp: clientIp ?? null } }, tx);
            await tx.workflowEvent.create({ data: { caseId: row.workflowCaseId, taskId: row.taskId, actor: userId, action: 'ai.annual.review.complete' } });
            return { reviewId, nextReviewId: next.id };
        }, options);
    }
    async handover(userId: string, reviewId: string, dto: HandoverAnnualReviewDto, clientIp?: string) {
        if (typeof dto.justification !== 'string' || !dto.justification.trim() || dto.justification.length > 5000 || !Number.isInteger(dto.expectedHandoverRound) || dto.expectedHandoverRound < 0 || !Array.isArray(dto.evidenceIds) || !dto.evidenceIds.length || dto.evidenceIds.length > 20 || dto.evidenceIds.some(v => typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v)))
            throw new BadRequestException('Handover requires a current round, written justification and existing evidence');
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.aiAnnualReview.findUnique({ where: { id: reviewId }, include });
            if (!row)
                throw new NotFoundException('Annual review not found');
            const a = await this.registerScope(tx, userId, row.organizationUnitId, true);
            await this.visibleSnapshot(tx, (await this.historyScope(tx,userId,row.organizationUnitId)).where, row);
            const current = row.handovers[0]?.toOfficerId ?? row.assignedOfficerId, round = row.handovers[0]?.round ?? 0;
            if (row.completion || row.task.status !== 'pending' || dto.expectedHandoverRound !== round || row.task.assigneeUserId !== current || dto.toOfficerId === current)
                throw new ConflictException('Annual handover gate changed; reload');
            const nominee = await this.registerScope(tx, dto.toOfficerId, row.organizationUnitId, true);
            await this.visibleSnapshot(tx, (await this.historyScope(tx,dto.toOfficerId,row.organizationUnitId)).where, row);
            const evidenceIds = [...new Set(dto.evidenceIds)];
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every handover evidence identifier must exist');
            const entry = await tx.aiAnnualReviewHandover.create({ data: { reviewId, round: round + 1, fromOfficerId: current, toOfficerId: dto.toOfficerId, actorId: userId, justification: dto.justification.trim(), evidenceIds, clientIp } });
            await tx.workflowTask.update({ where: { id: row.taskId }, data: { assigneeUserId: dto.toOfficerId } });
            await tx.governanceNotification.updateMany({ where: { workflowTaskId: row.taskId, status: { not: 'archived' } }, data: { status: 'archived' } });
            await tx.governanceEscalation.updateMany({ where: { workflowTaskId: row.taskId, status: { not: 'resolved' } }, data: { status: 'resolved', resolvedAt: new Date(), updatedBy: userId } });
            await this.audit.logRequired({ actor: userId, action: 'ai.annual.review.handover', entityType: 'ai_annual_review', entityId: reviewId, metadata: { handoverId: entry.id, fromOfficerId: current, toOfficerId: dto.toOfficerId, round: entry.round, evidenceIds, justification: entry.justification, clientIp: clientIp ?? null } }, tx);
            await tx.workflowEvent.create({ data: { caseId: row.workflowCaseId, taskId: row.taskId, actor: userId, action: 'ai.annual.review.handover' } });
            return { reviewId, handoverId: entry.id, handoverRound: entry.round };
        }, options);
    }
}
