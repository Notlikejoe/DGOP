import { AiReviewQueryDto } from './ai-review-query.dto';
import { readAiReviewQueue, reviewWorkflowSelection } from './ai-review-queue';
import { logAiRequired } from './ai-notifications';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Prisma, TaskStatus } from '@prisma/client';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { MIN_PERSONAL_DATA_CLASSIFICATION_RANK } from '../assets/assets.logic';
import { PrismaService } from '../prisma/prisma.service';
import { AiAssetFacade } from './ai-asset.facade';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { ApproveAiRegistrationDto, ProposeAiRegistrationDto } from './ai-registration.dto';
import { AIUC_STAGE, AIUC_TEMPLATE_CODE, AiWorkflowRoutingService } from './ai-workflow-routing.service';
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const registrationCase = {
    id: true, name: true, description: true, useCaseRef: true, assetId: true, version: true,
    requesterUserId: true, organizationUnitId: true, ownerPersonId: true,
    owner: { select: { userId: true, isActive: true, deletedAt: true, organization: true } },
    obligations: { where: { deletedAt: null }, select: { id: true, description: true } },
    workflowCase: { select: { id: true, code: true, status: true, templateId: true } },
    intakeRevisions: { take: 1, orderBy: { revision: 'desc' as const }, select: { payload: true, revision: true } },
    assessments: { where: { kind: 'classification' as const }, take: 1, orderBy: { round: 'desc' as const }, select: {
            id: true, result: true, inputs: true, ruleReferenceVersionId: true,
            ruleReferenceVersion: { select: { values: { select: { code: true, labelEn: true, labelAr: true, metadata: true } } } },
        } },
} satisfies Prisma.AiUseCaseSelect;
@Injectable()
export class AiRegistrationService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly routing: AiWorkflowRoutingService, private readonly assets: AiAssetFacade, private readonly identifiers: AiIdentifiersService, private readonly audit: AuditService, private readonly scope: ScopeService) { }
    async queue(userId: string, query: AiReviewQueryDto = new AiReviewQueryDto()) {
        const actor = await this.authorization.authorizeRead(userId, ['aiuc.asset.register', 'aiuc.asset.approve']);
        const stages: string[] = actor.administratorOversight ? [AIUC_STAGE.assetRegistration, AIUC_STAGE.assetApproval]
            : actor.roles.includes('AI_WORKING_GROUP') ? [AIUC_STAGE.assetRegistration] : [];
        if (actor.roles.includes('data_owner')) stages.push(AIUC_STAGE.assetApproval);
        const tasks: Prisma.WorkflowTaskWhereInput = {
            status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
            ...(actor.administratorOversight ? {} : { assigneeRoleCode: { in: actor.roles }, OR: [{ assigneeUserId: null }, { assigneeUserId: actor.id }] }),
            templateStage: { is: { code: { in: stages }, template: { is: { code: AIUC_TEMPLATE_CODE } } } },
        };
        const queue = await readAiReviewQueue(this.prisma, this.authorization, actor, query,
            { deletedAt: null, assetId: null, workflowCase: { is: { status: CaseStatus.approved, tasks: { some: tasks } } } }, tasks,
            { ...registrationCase, updatedAt: true, workflowCase: reviewWorkflowSelection(tasks) }, async (rows, tx) => {
                // Resolve directory mappings in one bounded query. Mapping conflicts and
                // infrastructure errors remain actionable; neither becomes an empty queue.
                if (!rows.length) return rows;
                const organizations = [...new Set(rows.map(row => row.owner?.organization?.trim()).filter((value): value is string => !!value))];
                const ids = rows.filter(row => !row.owner?.organization?.trim()).map(row => row.organizationUnitId ?? '');
                const units = await tx.organizationUnit.findMany({ where: { isActive: true, deletedAt: null, OR: [
                    { code: { in: organizations } }, { nameEn: { in: organizations } }, { nameAr: { in: organizations } }, { id: { in: ids } },
                ] } });
                for (const item of rows) {
                    const organization = item.owner?.organization?.trim();
                    const matches = units.filter(unit => organization ? [unit.code, unit.nameEn, unit.nameAr].includes(organization) : unit.id === item.organizationUnitId);
                    if (matches.length !== 1 || item.organizationUnitId && item.organizationUnitId !== matches[0].id)
                        throw new ConflictException('Map the use-case owner directory organization to one active DGOP department before registration');
                }
                return rows.filter(item => {
                    const task = item.workflowCase?.tasks[0], proposal = record(record(task?.formDataJson)['registrationProposal']);
                    return actor.administratorOversight || task?.templateStage?.code !== AIUC_STAGE.assetApproval
                        || ![item.requesterUserId, item.owner?.userId, proposal['registeredBy'], proposal['tierDecidedBy']].includes(actor.id);
                });
            });
        return { ...queue, data: queue.data.map(item => ({ ...item,
            approvedTier: item.assessments[0]?.ruleReferenceVersion.values.find(value => value.code === record(item.assessments[0]?.result)['approvedTierCode']) ?? null,
        })) };
    }
    async lookups(userId: string) {
        const actor = await this.authorization.authorizeRead(userId, ['aiuc.asset.register', 'aiuc.asset.approve']);
        const scope = await this.scope.resolve(actor.roles);
        const [domains, classifications] = await Promise.all([
            this.prisma.dataDomain.findMany({ where: { isActive: true, deletedAt: null, ...(scope.domains === 'all' ? {} : { id: { in: scope.domains } }) }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: 'asc' } }),
            this.prisma.classification.findMany({ where: { isActive: true, deletedAt: null, ...(scope.maxClassRank === null ? {} : { rank: { lte: scope.maxClassRank } }) }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { rank: 'asc' } }),
        ]);
        return { domains, classifications };
    }
    private async context(tx: Prisma.TransactionClient, id: string, taskId: string, stageCode: string, version: number) {
        const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: registrationCase });
        if (!current?.workflowCase || !current.useCaseRef || current.assetId
            || current.workflowCase.status !== CaseStatus.approved)
            throw new NotFoundException('Approved AIUC is not available for registration');
        if (current.version !== version)
            throw new ConflictException('AI use case changed; reload before registration');
        const task = await tx.workflowTask.findFirst({ where: {
                id: taskId, caseId: current.workflowCase.id, status: { in: [TaskStatus.pending, TaskStatus.in_progress] },
                templateStage: { is: { code: stageCode, templateId: current.workflowCase.templateId ?? '', template: { is: { code: AIUC_TEMPLATE_CODE } } } },
            } });
        if (!task)
            throw new ConflictException('No matching active AIUC registration task exists');
        const form = record(task.formDataJson);
        const source = await tx.workflowTask.findFirst({ where: {
                id: String(form['sourceDecisionTaskId'] ?? ''), caseId: current.workflowCase.id,
                status: TaskStatus.completed, decision: 'approved', templateStage: { is: { code: AIUC_STAGE.decision } },
            } });
        const adoption = record(record(source?.formDataJson)['adoptionDecision']);
        const assessment = current.assessments[0];
        if (!source || !['approve', 'approve_with_conditions'].includes(String(adoption['decisionType']))
            || !assessment || assessment.id !== adoption['classificationDecisionId']
            || adoption['ruleReferenceVersionId'] !== assessment.ruleReferenceVersionId
            || adoption['approvedTierCode'] !== record(assessment.result)['approvedTierCode']
            || !['MINIMAL', 'LIMITED', 'HIGH'].includes(String(adoption['approvedTierCode']))) {
            throw new ConflictException('Registration requires the current completed adoption decision and pinned classification');
        }
        const payload = record(current.intakeRevisions[0]?.payload);
        const dataOwner = await tx.person.findFirst({ where: { userId: String(payload['data_owner'] ?? ''), isActive: true, deletedAt: null }, select: { id: true, userId: true, fullNameEn: true, user: { select: { isActive: true } } } });
        if (!dataOwner?.userId || !dataOwner.user?.isActive || !current.owner?.isActive || current.owner.deletedAt) {
            throw new ConflictException('An active linked Data Owner and use-case owner are required');
        }
        if (await tx.aiRisk.findUnique({ where: { aiucHandoffSourceId: current.id }, select: { id: true } })) {
            throw new ConflictException('An automatic AIRS handover already exists for this use case');
        }
        const organizationUnitId = await this.department(tx, current);
        return { current: { ...current, organizationUnitId }, task, form, source, adoption, assessment, payload,
            dataOwner: { ...dataOwner, userId: dataOwner.userId },
            assetContext: { id, useCaseRef: current.useCaseRef, organizationUnitId, ownerName: dataOwner.fullNameEn, ownerPersonId: dataOwner.id } };
    }
    async propose(userId: string, id: string, taskId: string, dto: ProposeAiRegistrationDto, clientIp?: string) {
        if (!dto.justification.trim())
            throw new BadRequestException('Registration justification is required');
        return this.prisma.$transaction(async (tx) => {
            const actor = await this.authorization.authorize(userId, 'aiuc.asset.register', tx, id);
            const context = await this.context(tx, id, taskId, AIUC_STAGE.assetRegistration, dto.expectedVersion);
            if (!actor.administratorOverride && (!actor.roles.includes('AI_WORKING_GROUP') || context.task.assigneeRoleCode !== 'AI_WORKING_GROUP'
                || context.task.assigneeUserId && context.task.assigneeUserId !== actor.id))
                throw new ForbiddenException('The working-group registration task is required');
            if (!actor.administratorOverride && [actor.id, context.current.requesterUserId, context.current.owner?.userId, context.adoption['actorId']].includes(context.dataOwner.userId)) {
                throw new ConflictException('The nominated Data Owner is not independent of registration, request, ownership and tier decision');
            }
            await this.authorization.authorize(context.dataOwner.userId!, 'aiuc.asset.approve', tx, id);
            await this.validateClassification(tx, dto, context.payload);
            await this.assets.validate(tx, actor.roles, dto, context.assetContext);
            const proposal = { mode: dto.mode, existingAssetId: dto.existingAssetId ?? null,
                nameEn: dto.nameEn?.trim() ?? null, nameAr: dto.nameAr?.trim() ?? null, assetSubtype: dto.assetSubtype ?? null,
                classificationId: dto.classificationId, domainId: dto.domainId,
                registeredBy: actor.id, tierDecidedBy: context.adoption['actorId'], dataOwnerUserId: context.dataOwner.userId,
                justification: dto.justification.trim(), recordedAt: new Date().toISOString() };
            await tx.workflowTask.update({ where: { id: taskId }, data: {
                    status: TaskStatus.completed, completedAt: new Date(), formSubmittedAt: new Date(), formSubmittedBy: actor.id,
                    formDataJson: { ...context.form, registrationProposal: proposal } as Prisma.InputJsonObject,
                } });
            const approval = await this.routing.createStageTask(tx, context.current.workflowCase!.id, AIUC_STAGE.assetApproval, new Date(), {
                assigneeUserId: context.dataOwner.userId!,
                formDataJson: { ...context.form, submittedRegistrationTaskId: taskId, registrationProposal: proposal } as Prisma.InputJsonObject,
            });
            await this.version(tx, id, dto.expectedVersion);
            await tx.workflowEvent.create({ data: { caseId: context.current.workflowCase!.id, taskId, actor: actor.id, action: 'aiuc.asset.proposed', comment: dto.justification.trim() } });
            await logAiRequired(this.audit, { actor: actor.id, action: 'aiuc.asset.proposed', entityType: 'ai_use_case', entityId: id, metadata: { proposal, approvalTaskId: approval.id, clientIp: clientIp ?? null } }, tx);
            return { id, version: dto.expectedVersion + 1, nextTaskId: approval.id };
        }, this.transactionOptions);
    }
    async decide(userId: string, id: string, taskId: string, dto: ApproveAiRegistrationDto, clientIp?: string) {
        const justification = dto.justification.trim();
        const evidenceIds = [...new Set(dto.evidenceIds)];
        if (!justification || !evidenceIds.length)
            throw new BadRequestException('Independent asset decision requires justification and evidence');
        return this.prisma.$transaction(async (tx) => {
            const actor = await this.authorization.authorize(userId, 'aiuc.asset.approve', tx, id);
            const context = await this.context(tx, id, taskId, AIUC_STAGE.assetApproval, dto.expectedVersion);
            const proposal = record(context.form['registrationProposal']);
            const administratorOverride = actor.administratorOverride;
            if (!administratorOverride && (!actor.roles.includes('data_owner') || context.task.assigneeRoleCode !== 'data_owner')
                || !administratorOverride && (actor.id !== context.task.assigneeUserId || actor.id !== context.dataOwner.userId
                    || actor.id !== proposal['dataOwnerUserId']))
                throw new ForbiddenException('Only the nominated active Data Owner can decide asset registration');
            if (!administratorOverride && [context.current.requesterUserId, context.current.owner?.userId, proposal['registeredBy'], context.adoption['actorId']].includes(actor.id)) {
                await logAiRequired(this.audit, { actor: actor.id, action: 'ai.sod.blocked', entityType: 'ai_use_case', entityId: id, metadata: { rule: 'AIUC-ASSET-INDEPENDENCE', taskId } });
                throw new ForbiddenException('Asset approval must be independent of registration and tier adoption');
            }
            const registration = await tx.workflowTask.findFirst({ where: { id: String(context.form['submittedRegistrationTaskId'] ?? ''), caseId: context.current.workflowCase!.id,
                    status: TaskStatus.completed, templateStage: { is: { code: AIUC_STAGE.assetRegistration } } } });
            if (!registration || JSON.stringify(record(record(registration.formDataJson)['registrationProposal'])) !== JSON.stringify(proposal)) {
                throw new ConflictException('Asset approval does not match its completed registration proposal');
            }
            if (await tx.ndiEvidence.count({ where: { id: { in: evidenceIds }, deletedAt: null } }) !== evidenceIds.length)
                throw new BadRequestException('Every asset decision evidence identifier must exist');
            const now = new Date();
            let assetId: string | null = null, airsCaseId: string | null = null, nextTaskId: string | null = null;
            if (dto.decision === 'return') {
                const { registrationProposal: _proposal, submittedRegistrationTaskId: _registration, ...sourceForm } = context.form;
                nextTaskId = (await this.routing.createStageTask(tx, context.current.workflowCase!.id, AIUC_STAGE.assetRegistration, now, {
                    formDataJson: { ...sourceForm, returnedFromAssetApprovalTaskId: taskId } as Prisma.InputJsonObject,
                })).id;
            }
            else {
                const input = { ...proposal, existingAssetId: proposal['existingAssetId'] ?? undefined, nameEn: proposal['nameEn'] ?? undefined,
                    nameAr: proposal['nameAr'] ?? undefined, assetSubtype: proposal['assetSubtype'] ?? undefined } as unknown as ProposeAiRegistrationDto;
                await this.validateClassification(tx, input, context.payload);
                const handoff = await this.handoff(tx, context.payload, context.adoption, context.assessment.ruleReferenceVersion.values, now);
                const asset = await this.assets.register(tx, actor.roles, input, context.assetContext);
                if (input.mode === 'create') {
                    const ownerRoleType = await tx.roleType.findFirst({ where: { code: 'data_owner', isActive: true, deletedAt: null }, select: { id: true } });
                    if (!ownerRoleType)
                        throw new ConflictException('The DGOP Data Owner responsibility type must be registered before handover');
                    await tx.stewardshipAssignment.create({ data: { targetType: 'asset', targetId: asset.id, roleTypeId: ownerRoleType.id,
                            personId: context.dataOwner.id, isPrimary: true, approvalStatus: 'approved', source: 'aiuc_asset_approval',
                            reviewedBy: actor.id, reviewedAt: now, justification } });
                }
                assetId = asset.id;
                const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(now));
                const airs = await tx.workflowCase.create({ data: {
                        code: await this.identifiers.nextCaseCode(tx, 'AIRS', year), type: 'AIRS', status: CaseStatus.draft,
                        title: context.current.name, description: context.current.description, assetId, createdBy: 'system:aiuc-handoff',
                    } });
                airsCaseId = airs.id;
                const obligations = await tx.aiApprovalObligation.findMany({ where: { useCaseId: id, deletedAt: null, sourceKey: { startsWith: `${context.source.id}:` } }, select: { id: true, description: true } });
                if (JSON.stringify(obligations.map(value => value.description).sort()) !== JSON.stringify((Array.isArray(context.adoption['conditions']) ? context.adoption['conditions'] as string[] : []).slice().sort())) {
                    throw new ConflictException('Approval obligations do not match the final decision');
                }
                const risk = await tx.aiRisk.create({ data: { useCaseId: id, aiucHandoffSourceId: id, workflowCaseId: airs.id,
                        title: context.current.name, createdBy: 'system:aiuc-handoff',
                        handoffPayload: { ...handoff, useCaseRef: context.current.useCaseRef, name: context.current.name,
                            description: context.current.description, objectiveValue: context.payload['objective_value'],
                            ownerPersonId: context.current.ownerPersonId, organizationUnitId: context.current.organizationUnitId,
                            relatedAssetId: assetId, sourceDecisionTaskId: context.source.id, assetApprovalTaskId: taskId,
                            obligations, intakeRevision: context.current.intakeRevisions[0].revision } as Prisma.InputJsonObject,
                    } });
                await tx.aiApprovalObligation.updateMany({ where: { id: { in: obligations.map(value => value.id) } }, data: { assetId, riskId: risk.id, version: { increment: 1 } } });
                await tx.workflowCase.update({ where: { id: context.current.workflowCase!.id }, data: { assetId, status: CaseStatus.implemented } });
                await tx.workflowEvent.create({ data: { caseId: context.current.workflowCase!.id, taskId, actor: actor.id, action: 'aiuc.asset.handed_off', fromStatus: CaseStatus.approved, toStatus: CaseStatus.implemented, comment: justification } });
                await tx.workflowEvent.create({ data: { caseId: airs.id, actor: 'system:aiuc-handoff', action: 'airs.handoff.created', toStatus: CaseStatus.draft, comment: context.current.useCaseRef } });
                await tx.workflowCase.update({ where: { id: context.current.workflowCase!.id }, data: { status: CaseStatus.closed } });
                await tx.workflowEvent.create({ data: { caseId: context.current.workflowCase!.id, taskId, actor: 'system:aiuc-handoff', action: 'aiuc.closed', fromStatus: CaseStatus.implemented, toStatus: CaseStatus.closed, comment: String(context.adoption['resolutionCode']) } });
                await logAiRequired(this.audit, { actor: actor.id, action: 'airs.handoff.created', entityType: 'ai_risk', entityId: risk.id, metadata: { sourceUseCaseId: id, assetId, airsCaseId, clientIp: clientIp ?? null } }, tx);
            }
            await tx.workflowTask.update({ where: { id: taskId }, data: {
                    status: TaskStatus.completed, decision: dto.decision === 'approve' ? 'approved' : 'rejected', decisionComment: justification,
                    completedAt: now, formSubmittedAt: now, formSubmittedBy: actor.id,
                    formDataJson: { ...context.form, assetDecision: { decision: dto.decision, actorId: actor.id, actorRole: 'data_owner',
                            justification, evidenceIds, recordedAt: now.toISOString(), assetId, airsCaseId, nextTaskId } } as Prisma.InputJsonObject,
                } });
            await this.version(tx, id, dto.expectedVersion, assetId, context.current.organizationUnitId);
            await tx.workflowEvent.create({ data: { caseId: context.current.workflowCase!.id, taskId, actor: actor.id, action: `aiuc.asset.${dto.decision}`, comment: justification } });
            await logAiRequired(this.audit, { actor: actor.id, action: `aiuc.asset.${dto.decision}`, entityType: 'ai_use_case', entityId: id, metadata: { taskId, justification, evidenceIds, assetId, airsCaseId, nextTaskId, clientIp: clientIp ?? null } }, tx);
            return { id, version: dto.expectedVersion + 1, assetId, airsCaseId, nextTaskId };
        }, this.transactionOptions);
    }
    private async published(tx: Prisma.TransactionClient, listCode: string, code: string, now: Date) {
        const versions = await tx.governedReferenceVersion.findMany({ where: { listCode, state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 });
        const value = versions.length === 1 ? versions[0].values.find(value => value.code === code) : null;
        if (!value)
            throw new ConflictException(`Publish an unambiguous ${listCode} mapping for ${code} before AI handover`);
        return { value, versionId: versions[0].id };
    }
    private async validateClassification(tx: Prisma.TransactionClient, dto: ProposeAiRegistrationDto, payload: Record<string, unknown>) {
        const mapping = await this.published(tx, 'L_CLASS', String(payload['data_classification']), new Date());
        const classification = await tx.classification.findFirst({ where: { id: dto.classificationId, isActive: true, deletedAt: null } });
        if (!classification || record(mapping.value.metadata)['assetClassificationCode'] !== classification.code)
            throw new ConflictException('Asset classification must match the published intake-to-asset classification mapping');
        const personal = await this.published(tx, 'R_YN', String(payload['personal_data_flag']), new Date());
        if (personal.value.labelAr === 'نعم' && classification.rank < MIN_PERSONAL_DATA_CLASSIFICATION_RANK)
            throw new BadRequestException('Personal-data assets require the DGOP minimum classification rank');
    }
    private async handoff(tx: Prisma.TransactionClient, payload: Record<string, unknown>, adoption: Record<string, unknown>, tiers: Array<{
        code: string;
        metadata: unknown;
    }>, now: Date) {
        const tierMetadata = record(tiers.find(value => value.code === adoption['approvedTierCode'])?.metadata);
        const [stage, model, cadence, personal, classification] = await Promise.all([
            this.published(tx, 'L_STAGE', String(payload['target_stage']), now),
            this.published(tx, 'L_MODEL', String(payload['execution_model']), now),
            this.published(tx, 'R_LEVEL_DAYS', String(tierMetadata['cadenceLevelCode'] ?? ''), now),
            this.published(tx, 'R_YN', String(payload['personal_data_flag']), now),
            this.published(tx, 'L_CLASS', String(payload['data_classification']), now),
        ]);
        const lifecycleCode = record(stage.value.metadata)['airsLifecycleCode'];
        const thirdParty = record(model.value.metadata)['thirdParty'];
        const days = record(cadence.value.metadata)['days'];
        if (typeof lifecycleCode !== 'string' || typeof thirdParty !== 'boolean' || !Number.isInteger(days) || Number(days) < 1 || Number(days) > 3660)
            throw new ConflictException('Approved lifecycle, third-party and cadence metadata are required for AIRS handover');
        const lifecycle = await this.published(tx, 'R_LIFECYCLE', lifecycleCode, now);
        return { schemaVersion: 1, proposedTierCode: adoption['proposedTierCode'], approvedTierCode: adoption['approvedTierCode'],
            classificationDecisionId: adoption['classificationDecisionId'], tierReferenceVersionId: adoption['ruleReferenceVersionId'],
            personalDataInvolved: personal.value.labelAr === 'نعم', sensitiveDataInvolved: classification.value.labelAr === 'سرية',
            thirdPartyInvolved: thirdParty, thirdPartyConfirmationRequired: true, lifecycleStage: lifecycleCode,
            targetPrograms: payload['program_platform'], strategicStreams: payload['strategic_streams'],
            nextReviewBasisDays: days, nextReviewBasisAt: new Date(now.getTime() + Number(days) * 86400000).toISOString(),
            cadenceProvisional: true, mappingReferenceVersionIds: { stage: stage.versionId, model: model.versionId,
                cadence: cadence.versionId, personal: personal.versionId, classification: classification.versionId, lifecycle: lifecycle.versionId },
        };
    }
    private async department(tx: Prisma.TransactionClient | PrismaService, current: {
        organizationUnitId: string | null;
        owner: {
            organization: string | null;
        } | null;
    }) {
        const organization = current.owner?.organization?.trim();
        const matches = await tx.organizationUnit.findMany({ where: { isActive: true, deletedAt: null,
                ...(organization ? { OR: [{ code: organization }, { nameEn: organization }, { nameAr: organization }] } : { id: current.organizationUnitId ?? '' }) }, take: 2 });
        if (matches.length !== 1 || current.organizationUnitId && current.organizationUnitId !== matches[0].id)
            throw new ConflictException('Map the use-case owner directory organization to one active DGOP department before registration');
        return matches[0].id;
    }
    private async version(tx: Prisma.TransactionClient, id: string, version: number, assetId?: string | null, organizationUnitId?: string) {
        if ((await tx.aiUseCase.updateMany({ where: { id, version }, data: { version: { increment: 1 }, ...(assetId ? { assetId } : {}), ...(organizationUnitId ? { organizationUnitId } : {}) } })).count !== 1)
            throw new ConflictException('AI use case changed; reload before registration');
    }
    private readonly transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 15000 };
}
