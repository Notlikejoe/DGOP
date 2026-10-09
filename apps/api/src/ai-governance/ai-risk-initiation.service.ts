import { AiLibraryControlLinksService } from './ai-library-control-links.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiRiskLibraryService } from './ai-risk-library.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AIRS_STAGE, AIRS_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
import { CreateAiRiskDto } from './ai-risk-library.dto';
import { governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord } from './ai-risk-scoring';
@Injectable()
export class AiRiskInitiationService {
    constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly authorization: AiAuthorizationService, private readonly risks: AiRiskIntakeService, private readonly library: AiRiskLibraryService, private readonly identifiers: AiIdentifiersService, private readonly routing: AiWorkflowRoutingService, private readonly audit: AuditService, private readonly controlLinks?: AiLibraryControlLinksService) { }
    private async parentWhere(roles: string[]) {
        const s = await this.scope.resolve(roles);
        return { deletedAt: null, isSampleData: false, useCaseRef: { not: null }, OR: [{ operationalStatusCode: null }, { operationalStatusCode: { notIn: ['SUSPENDED', 'ARCHIVED'] } }],
            ...(s.orgUnits === 'all' ? {} : { organizationUnitId: { in: s.orgUnits } }), asset: { is: { deletedAt: null, isActive: true, assetType: 'ai_data_product',
                    ...(s.orgUnits === 'all' ? {} : { orgUnitId: { in: s.orgUnits } }), ...(s.domains === 'all' ? {} : { domainId: { in: s.domains } }), ...(s.maxClassRank === null ? {} : { classification: { is: { rank: { lte: s.maxClassRank } } } }) } } } satisfies Prisma.AiUseCaseWhereInput;
    }
    async context(userId: string) {
        const a = await this.risks.visibility(userId), administratorOverride = a.actor.administratorOverride, canCreate = administratorOverride || a.permissions.has('case.create.airs') && a.actor.roles.some(r => ['AI_RISK_OWNER', 'AI_WORKING_GROUP'].includes(r)) && !a.actor.roles.includes('auditor');
        const parents = canCreate ? await this.prisma.aiUseCase.findMany({ where: await this.parentWhere(a.actor.roles), select: { id: true, useCaseRef: true, name: true, assessments: { where: { kind: 'classification', riskId: null }, orderBy: { round: 'desc' }, take: 1, select: { result: true } } }, orderBy: { useCaseRef: 'asc' }, take: 500 }) : [];
        const owner = a.actor.roles.includes('AI_RISK_OWNER') ? await this.prisma.person.findFirst({ where: { userId, isActive: true, deletedAt: null }, select: { id: true } }) : null;
        return { administratorOverride, canCreate: canCreate && (administratorOverride || !a.actor.roles.includes('AI_RISK_OWNER') || !!owner), parents: parents.filter(p => ['MINIMAL', 'LIMITED', 'HIGH'].includes(String(jsonRecord(p.assessments[0]?.result)['approvedTierCode']))).map(({ assessments, ...p }) => p), librarySuggestionsOnly: true };
    }
    async create(userId: string, dto: CreateAiRiskDto) {
        return governanceTransaction(this.prisma, tx => this.createInTransaction(tx, userId, dto));
    }
    async createInTransaction(tx: Prisma.TransactionClient, userId: string, dto: CreateAiRiskDto) {
        const justification = governanceText(dto.justification);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(dto.initiationKey))
            throw new BadRequestException('Use a stable UUID initiation key');
        const actor = await this.authorization.authorize(userId, 'case.create.airs', tx);
        if (!actor.roles.some(r => ['AI_RISK_OWNER', 'AI_WORKING_GROUP'].includes(r)))
            throw new ForbiddenException('Manual initiation requires a Risk Owner or Working Group role');
        const parent = await tx.aiUseCase.findFirst({ where: { AND: [await this.parentWhere(actor.roles), { id: dto.useCaseId }] }, select: { id: true, useCaseRef: true, name: true, assetId: true, assessments: { where: { kind: 'classification', riskId: null }, orderBy: { round: 'desc' }, take: 1, select: { result: true } } } });
        if (!parent || !['MINIMAL', 'LIMITED', 'HIGH'].includes(String(jsonRecord(parent.assessments[0]?.result)['approvedTierCode'])))
            throw new NotFoundException('Active scoped registered AI use case not found');
        const old = await tx.aiRisk.findUnique({ where: { initiationKey: dto.initiationKey }, select: { id: true, useCaseId: true, libraryVersionId: true, createdBy: true } });
        if (old) {
            if (old.createdBy !== userId || old.useCaseId !== parent.id || old.libraryVersionId !== (dto.libraryVersionId ?? null))
                throw new ConflictException('Initiation key belongs to another request');
            return { id: old.id, created: false };
        }
        const source = dto.libraryVersionId ? await this.library.publishedVersion(tx, dto.libraryVersionId) : null, content = jsonRecord(source?.content);
        const person = actor.roles.includes('AI_RISK_OWNER') ? await tx.person.findFirst({ where: { userId, isActive: true, deletedAt: null } }) : null;
        if (actor.roles.includes('AI_RISK_OWNER') && !person)
            throw new ForbiddenException('Risk Owner requires an active directory identity');
        const binding = await this.routing.binding(tx, AIRS_TEMPLATE_CODE), now = new Date(), year = new Date(now.getTime() + 10800000).getUTCFullYear();
        const wc = await tx.workflowCase.create({ data: { code: await this.identifiers.nextCaseCode(tx, 'AIRS', year), title: source ? String(content['titleAr']) : parent.name + ' · Risk identification', type: 'AIRS', status: 'draft', assetId: parent.assetId, templateId: binding.id, templateVersion: binding.designerVersion, createdBy: userId } });
        const suggestedControlPins = source && this.controlLinks ? await this.controlLinks.suggestions(tx, source.id) : null;
        const intakeData = source ? { title: content['titleAr'], cause: content['probable_causes'], event: '', effect: content['probable_impacts'], risk_category: content['risk_category'], ethics_principle: content['ethics_principle'], dev_stage: content['dev_stage'], current_controls: '', notes: content['example_controls'] } : {};
        const risk = await tx.aiRisk.create({ data: { useCaseId: parent.id, workflowCaseId: wc.id, ownerPersonId: person?.id, libraryVersionId: source?.id, ...(suggestedControlPins ? { suggestedControlPins: suggestedControlPins as Prisma.InputJsonObject } : {}), initiationKey: dto.initiationKey, title: source ? String(content['titleAr']) : null, cause: source ? String(content['probable_causes']) : null, effect: source ? String(content['probable_impacts']) : null, intakeData: intakeData as Prisma.InputJsonObject, createdBy: userId } });
        let taskId: string | null = null;
        if (person) {
            taskId = (await this.routing.createStageTask(tx, wc.id, AIRS_STAGE.identification, now, { templateCode: AIRS_TEMPLATE_CODE, assigneeUserId: userId, formDataJson: { sourceRiskId: risk.id, initiation: 'manual', libraryVersionId: source?.id ?? null } })).id;
        }
        await tx.workflowEvent.create({ data: { caseId: wc.id, taskId, actor: userId, action: source ? 'airs.library.instantiate' : 'airs.workshop.initiate', comment: justification } });
        await this.audit.logRequired({ actor: userId, action: source ? 'airs.library.instantiate' : 'airs.workshop.initiate', entityType: 'ai_risk', entityId: risk.id, metadata: { useCaseId: parent.id, assetId: parent.assetId, caseCode: wc.code, libraryRef: source?.entry.libraryRef ?? null, libraryVersionId: source?.id ?? null, libraryDigest: source?.digest ?? null, ownerPersonId: person?.id ?? null, justification, autoSubmitted: false } }, tx);
        return { id: risk.id, created: true };
    }
}
