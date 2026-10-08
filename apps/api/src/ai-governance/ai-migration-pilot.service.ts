import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiSourceCorrectionsService } from './ai-source-corrections.service';
import { AiMigrationPreviewService } from './ai-migration-preview.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AI_RISK_REPORT_SELECT, projectRisk } from './ai-dashboard.service';
import { PreviewRow } from './ai-migration-preview';
import { jsonRecord, RISK_DIMENSIONS } from './ai-risk-scoring';
import { projectSourceLibrary } from './ai-library-source.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { reportCsvCell } from './ai-dashboard-reports.service';
export type PilotBinding = {
    rowKey: string;
    targetId: string;
};
type Check = {
    field: string;
    source: unknown;
    target: unknown;
    equal: boolean;
};
@Injectable()
export class AiMigrationPilotService {
    constructor(private readonly db: PrismaService, private readonly corrections: AiSourceCorrectionsService, private readonly previews: AiMigrationPreviewService, private readonly auth: AiAuthorizationService, private readonly audit: AuditService) { }
    private async snapshot(tx: Prisma.TransactionClient, userId: string, id: string, operation: 'read' | 'propose' | 'review' = 'read') {
        const s = await tx.aiCorrectedSourceSnapshot.findUnique({ where: { id }, include: { correctionVersion: true } });
        if (!s)
            throw new NotFoundException('Corrected source snapshot not found');
        await this.previews.mappingBase(tx, userId, s.correctionVersion.previewId, operation);
        await this.auth.authorizeAny(userId, ['case.view.airs.org', 'case.view.airs.all'], tx);
        await this.auth.authorizeAny(userId, ['case.view.aiuc.org', 'case.view.aiuc.all'], tx);
        if (governanceDigest(s.report) !== s.digest)
            throw new ConflictException('Source snapshot integrity differs');
        return s;
    }
    private async report(tx: Prisma.TransactionClient, snapshotId: string, report: Prisma.JsonValue, bindings: PilotBinding[]) {
        const all = jsonRecord(report), sourceRows = all['rows'] as PreviewRow[], rows = sourceRows.filter(r => ['library', 'control', 'usecase', 'risk', 'assessment', 'classification', 'action'].includes(r.kind) && !r.sample), keys = new Set<string>(), targets = new Set<string>();
        if (!Array.isArray(bindings) || bindings.length > 250)
            throw new BadRequestException('Use up to 250 source-to-native bindings');
        for (const b of bindings) {
            const row = rows.find(r => r.key === b.rowKey);
            if (!row || Object.keys(b).some(k => !['rowKey', 'targetId'].includes(k)) || !/^[0-9a-f-]{36}$/i.test(b.targetId) || keys.has(b.rowKey) || targets.has(row.kind + ':' + b.targetId))
                throw new BadRequestException('Unique supported source rows and native targets required');
            keys.add(b.rowKey);
            targets.add(row.kind + ':' + b.targetId);
        }
        const byKey = new Map(bindings.map(b => [b.rowKey, b.targetId])), members: Array<{
            rowKey: string;
            kind: string;
            sourceRef: string;
            targetId: string | null;
            targetRef: string | null;
            checks: Check[];
            gaps: string[];
            equal: boolean;
        }> = [];
        const referenceCode = (v: unknown) => jsonRecord(v)['code'];
        for (const row of rows) {
            const checks: Check[] = [], gaps = [...row.issues], compare = (field: string, source: unknown, target: unknown) => checks.push({ field, source: source ?? null, target: target ?? null, equal: source !== undefined && target !== undefined && governanceDigest(source) === governanceDigest(target) });
            let targetId = byKey.get(row.key) ?? null, targetRef: string | null = null;
            if (row.kind === 'library') {
                const item = await tx.aiLibrarySourceItem.findFirst({ where: { snapshotId, rowKey: row.key }, include: { version: { include: { entry: true, publication: true } } } });
                if (targetId && targetId !== item?.libraryVersionId)
                    throw new BadRequestException('Library binding must retain its source import lineage');
                targetId = item?.libraryVersionId ?? null;
                targetRef = item?.version.entry.libraryRef ?? null;
                if (item) {
                    compare('identifier', row.sourceRef, targetRef);
                    compare('sourceDigest', governanceDigest(row.raw), item.sourceDigest);
                    compare('projection', projectSourceLibrary(row), item.version.content);
                    compare('nativeDigest', governanceDigest({ content: item.version.content, referencePins: item.version.referencePins }), item.version.digest);
                    if (!item.version.publication)
                        gaps.push('LIBRARY_NOT_PUBLISHED');
                    const current = await tx.aiRiskLibraryVersion.findFirst({ where: { entryId: item.version.entryId, publication: { isNot: null } }, orderBy: { round: 'desc' }, select: { id: true } });
                    if (current?.id !== item.libraryVersionId)
                        gaps.push('LIBRARY_VERSION_SUPERSEDED');
                }
            }
            else if (row.kind === 'control') {
                const pin = jsonRecord(row.prepared['controlVersionId']), versionId = typeof pin['versionId'] === 'string' ? pin['versionId'] : null;
                if (targetId && targetId !== versionId)
                    throw new BadRequestException('Control binding must retain corrected source version');
                targetId = versionId;
                const v = versionId ? await tx.aiControlDomainVersion.findUnique({ where: { id: versionId }, include: { publication: true, entry: true } }) : null;
                targetRef = v?.entry.controlCode ?? null;
                if (v) {
                    compare('sourceRow', row.key, v.sourceRowKey);
                    compare('digest', pin['digest'], v.digest);
                    compare('nativeDigest', governanceDigest({ content: v.content, dimensionPins: v.dimensionPins }), v.digest);
                    if (!v.publication)
                        gaps.push('CONTROL_NOT_PUBLISHED');
                    const latest = await tx.aiControlDomainVersion.findFirst({ where: { entryId: v.entryId, publication: { isNot: null } }, orderBy: { round: 'desc' } });
                    if (latest?.id !== v.id)
                        gaps.push('CONTROL_VERSION_SUPERSEDED');
                }
            }
            else if (row.kind === 'usecase') {
                const v = targetId ? await tx.aiUseCase.findFirst({ where: { id: targetId, deletedAt: null, isSampleData: false }, include: { asset: true } }) : null;
                if (targetId && !v)
                    throw new NotFoundException('Native nonsample use case not found');
                targetRef = v?.useCaseRef ?? null;
                if (v) {
                    compare('identifier', row.sourceRef, targetRef);
                    compare('title', row.prepared['title'], v.name);
                    compare('description', row.prepared['description'], v.description);
                    compare('owner', row.prepared['ownerPersonId'], v.ownerPersonId);
                    compare('organization', row.prepared['organizationUnitId'], v.organizationUnitId);
                    if (!v.asset?.isActive || v.asset.deletedAt || v.asset.assetType !== 'ai_data_product')
                        gaps.push('ACTIVE_APPROVED_AI_ASSET_REQUIRED');
                }
            }
            else if (row.kind === 'risk') {
                const v = targetId ? await tx.aiRisk.findFirst({ where: { id: targetId, deletedAt: null, isSampleData: false, useCase: { is: { deletedAt: null, isSampleData: false } } }, select: { ...AI_RISK_REPORT_SELECT, useCaseId: true, cause: true, event: true, effect: true, intakeData: true, useCase: { select: { useCaseRef: true } }, assessments: { orderBy: { round: 'desc' }, select: { id: true, riskId: true, kind: true, round: true, inputs: true, result: true, decisions: true } } } }) : null;
                if (targetId && !v)
                    throw new NotFoundException('Native nonsample risk not found');
                targetRef = v?.riskRef ?? null;
                if (v) {
                    compare('identifier', row.sourceRef, targetRef);
                    compare('parent', row.parentRef, v.useCase.useCaseRef);
                    for (const field of ['title', 'cause', 'event', 'effect'] as const)
                        compare(field, row.prepared[field], v[field]);
                    const projected = projectRisk({ ...v, assessments: v.assessments.map(a => ({ ...a, riskId: a.riskId! })) }, new Date()), inherent = v.assessments.find(a => a.kind === 'inherent'), residual = v.assessments.find(a => a.kind === 'residual');
                    compare('inherentScore', row.raw['P']?.value, projected.inherentScore);
                    compare('residualScore', row.raw['AB']?.value, projected.residualScore);
                    compare('likelihood', row.prepared['likelihood'], jsonRecord(inherent?.result)['likelihood']);
                    compare('impact', row.raw['O']?.value, jsonRecord(inherent?.result)['impactFinal']);
                    if (!inherent?.decisions.some(d => d.kind === 'adoption' && d.decision === 'approve'))
                        gaps.push('NATIVE_INHERENT_ADOPTION_REQUIRED');
                    const band = jsonRecord(residual?.result)['bandCode'], decisions = residual?.decisions ?? [], has = (kind: string, outcomes: string[]) => decisions.some(d => d.kind === kind && outcomes.includes(d.decision));
                    const accepted = band === 'LOW' ? has('accept_owner', ['accept']) : band === 'MEDIUM' ? has('accept_owner', ['accept']) && has('countersign', ['accept']) : band === 'HIGH' ? has('ethics', ['approve']) && has('executive', ['accept']) : band === 'CRITICAL' ? has('steering', ['restrict', 'stop']) : false;
                    if (!accepted || !has('adoption', ['approve']) || projected.residualScore === null)
                        gaps.push('CURRENT_NATIVE_RESIDUAL_AUTHORITY_REQUIRED');
                }
            }
            else if (row.kind === 'assessment' || row.kind === 'classification') {
                const v = targetId ? await tx.aiAssessmentRound.findUnique({ where: { id: targetId }, include: { useCase: true, risk: true, decisions: true } }) : null;
                if (targetId && (!v || v.useCase.deletedAt || v.useCase.isSampleData || v.risk?.deletedAt || v.risk?.isSampleData))
                    throw new NotFoundException('Native nonsample assessment not found');
                targetRef = row.kind === 'classification' ? v?.useCase.useCaseRef ?? null : v?.risk?.riskRef ?? null;
                if (v) {
                    compare('parent', row.parentRef, targetRef);
                    compare('kind', row.kind === 'classification' ? 'classification' : 'inherent', v.kind);
                    const latest = await tx.aiAssessmentRound.findFirst({ where: { useCaseId: v.useCaseId, riskId: v.riskId, kind: v.kind }, orderBy: { round: 'desc' } });
                    if (latest?.id !== v.id)
                        gaps.push('ASSESSMENT_VERSION_SUPERSEDED');
                    const result = jsonRecord(v.result), input = jsonRecord(v.inputs);
                    if (row.kind === 'classification') {
                        compare('score', row.prepared['maxScore'], result['scoreMax']);
                        compare('approvedTier', referenceCode(row.prepared['sourceApprovedTier']), result['approvedTierCode']);
                        const criteria = input['criteria'] as Array<{
                            value: number;
                            justification: string;
                        }> | undefined;
                        compare('criteria', row.prepared['criteria'], criteria?.map(c => c.value));
                        if (!criteria?.every(c => c.justification?.trim()))
                            gaps.push('CLASSIFICATION_JUSTIFICATION_REQUIRED');
                        if (!result['approvedTierCode'])
                            gaps.push('NATIVE_CLASSIFICATION_AUTHORITY_REQUIRED');
                    }
                    else {
                        compare('impact', row.prepared['impactPreview'], result['impactFinal']);
                        const dimensions = input['dimensions'] as Array<{
                            dimension: string;
                            value: number;
                            assessedBy: string;
                            taskId: string;
                            justification: string;
                        }> | undefined, source = row.prepared['dimensions'] as Array<{
                            dimension: string;
                            value: number;
                        }>;
                        compare('dimensions', RISK_DIMENSIONS.map(d => source?.find(x => x.dimension === d)?.value), RISK_DIMENSIONS.map(d => dimensions?.find(x => x.dimension === d)?.value));
                        if (dimensions?.length !== 8 || !dimensions.every(d => d.assessedBy && d.taskId && d.justification?.trim()))
                            gaps.push('COMPETENT_NATIVE_DIMENSION_PROVENANCE_REQUIRED');
                    }
                }
            }
            else if (row.kind === 'action') {
                const v = targetId ? await tx.aiTreatmentAction.findFirst({ where: { id: targetId, deletedAt: null, risk: { is: { deletedAt: null, isSampleData: false, useCase: { is: { deletedAt: null, isSampleData: false } } } } }, include: { risk: { select: { riskRef: true } }, workflowTask: true, progress: { orderBy: { round: 'desc' }, take: 1 }, response: { include: { plans: { orderBy: { round: 'desc' }, take: 1, include: { decision: true } } } } } }) : null;
                if (targetId && !v)
                    throw new NotFoundException('Native nonsample action not found');
                targetRef = v?.actionRef ?? null;
                if (v) {
                    compare('identifier', row.sourceRef, targetRef);
                    compare('parent', row.parentRef, v.risk.riskRef);
                    compare('description', row.prepared['description'], jsonRecord(v.planData)['description']);
                    compare('completionPct', row.prepared['completionPct'], v.progress[0]?.completionPct ?? 0);
                    compare('targetDate', typeof row.prepared['targetDate'] === 'string' ? row.prepared['targetDate'].slice(0, 10) : row.prepared['targetDate'], v.targetDate?.toISOString().slice(0, 10));
                    const plan = v.response?.plans[0], ids = jsonRecord(plan?.snapshot)['actionIds'];
                    if (plan?.decision?.decision !== 'approve' || !Array.isArray(ids) || !ids.includes(v.id) || !v.workflowTask || v.workflowTask.status === 'cancelled')
                        gaps.push('CURRENT_NATIVE_APPROVED_PLAN_REQUIRED');
                    if (row.prepared['completionPct'] === 100 && (!v.progress[0]?.completedAt || v.workflowTask?.status !== 'completed'))
                        gaps.push('NATIVE_ACTION_COMPLETION_REQUIRED');
                }
            }
            if (!targetId)
                gaps.push('NATIVE_TARGET_MISSING');
            for (const c of checks)
                if (!c.equal)
                    gaps.push('TARGET_DIFFERENCE:' + c.field);
            members.push({ rowKey: row.key, kind: row.kind, sourceRef: row.sourceRef, targetId, targetRef, checks, gaps: [...new Set(gaps)], equal: !!targetId && checks.length > 0 && !gaps.length });
        }
        const expectedRefs = Array.from({ length: 20 }, (_, i) => 'AI-' + String(i + 1).padStart(3, '0')), available = rows.filter(r => r.kind === 'usecase').map(r => r.sourceRef), missingPilotRefs = expectedRefs.filter(r => !available.includes(r)), globalIssues = (jsonRecord(all['reconciliation'])['globalIssues'] as string[] | undefined) ?? [];
        const targetZeroDiff = members.length > 0 && members.every(r => r.equal), pilotReady = targetZeroDiff && !missingPilotRefs.length && !globalIssues.length;
        return { version: 'ai-native-pilot-v1', snapshotId, sourceCount: members.length, linkedCount: members.filter(r => r.targetId).length, equalCount: members.filter(r => r.equal).length, gapCount: members.filter(r => r.gaps.length).length, members, missingPilotRefs, globalIssues, targetZeroDiff, pilotReady, productionReady: false };
    }
    async targets(userId: string, id: string, kind: string, search: string) { await this.snapshot(this.db, userId, id); if (search.length > 200)
        throw new BadRequestException('Search must fit 200 characters'); const contains = { contains: search, mode: Prisma.QueryMode.insensitive }; if (kind === 'usecase') {
        const where: Prisma.AiUseCaseWhereInput = { deletedAt: null, isSampleData: false, OR: [{ useCaseRef: contains }, { name: contains }] };
        return { rows: await this.db.aiUseCase.findMany({ where, select: { id: true, useCaseRef: true, name: true }, orderBy: [{ useCaseRef: 'asc' }, { id: 'asc' }], take: 100 }), total: await this.db.aiUseCase.count({ where }) };
    } if (kind === 'risk') {
        const where: Prisma.AiRiskWhereInput = { deletedAt: null, isSampleData: false, useCase: { is: { deletedAt: null, isSampleData: false } }, OR: [{ riskRef: contains }, { title: contains }] };
        return { rows: await this.db.aiRisk.findMany({ where, select: { id: true, riskRef: true, title: true }, orderBy: [{ riskRef: 'asc' }, { id: 'asc' }], take: 100 }), total: await this.db.aiRisk.count({ where }) };
    } if (kind === 'action') {
        const where: Prisma.AiTreatmentActionWhereInput = { deletedAt: null, risk: { is: { deletedAt: null, isSampleData: false, useCase: { is: { deletedAt: null, isSampleData: false } } } }, OR: [{ actionRef: contains }, { title: contains }] };
        return { rows: await this.db.aiTreatmentAction.findMany({ where, select: { id: true, actionRef: true, title: true }, orderBy: [{ actionRef: 'asc' }, { id: 'asc' }], take: 100 }), total: await this.db.aiTreatmentAction.count({ where }) };
    } if (['assessment', 'classification'].includes(kind)) {
        const where: Prisma.AiAssessmentRoundWhereInput = { kind: kind === 'classification' ? 'classification' : 'inherent', ...(kind === 'classification' ? { riskId: null, useCase: { is: { deletedAt: null, isSampleData: false, useCaseRef: contains } } } : { risk: { is: { deletedAt: null, isSampleData: false, riskRef: contains } } }) };
        return { rows: await this.db.aiAssessmentRound.findMany({ where, select: { id: true, round: true, useCase: { select: { useCaseRef: true } }, risk: { select: { riskRef: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 }), total: await this.db.aiAssessmentRound.count({ where }) };
    } throw new BadRequestException('Select a native record kind'); }
    async context(userId: string, id: string, page = 1) { if (!Number.isInteger(page) || page < 1)
        throw new BadRequestException('Valid archive page required'); await this.snapshot(this.db, userId, id); const where = { snapshotId: id }; return { rows: await this.db.aiMigrationPilotCapture.findMany({ where, include: { review: true }, orderBy: { round: 'desc' }, skip: (page - 1) * 10, take: 10 }), total: await this.db.aiMigrationPilotCapture.count({ where }), page, pageSize: 10, latestRound: (await this.db.aiMigrationPilotCapture.findFirst({ where, orderBy: { round: 'desc' }, select: { round: true } }))?.round ?? 0 }; }
    async capture(userId: string, id: string, dto: {
        expectedRound: number;
        expectedDigest: string;
        requestKey: string;
        bindings: PilotBinding[];
        justification: string;
        evidenceIds: string[];
    }) { const justification = governanceText(dto.justification); if (!Number.isInteger(dto.expectedRound) || dto.expectedRound < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestKey))
        throw new BadRequestException('Current pilot round and stable request UUID required'); return governanceTransaction(this.db, async (tx) => { await this.snapshot(tx, userId, id, 'propose'); const { snapshot } = await this.corrections.approvedSnapshot(tx, userId, id); if (snapshot.digest !== dto.expectedDigest)
        throw new ConflictException('Source snapshot changed'); const evidenceIds = await governanceEvidence(tx, dto.evidenceIds), bindings = [...dto.bindings].sort((a, b) => a.rowKey.localeCompare(b.rowKey)), requestDigest = governanceDigest({ userId, id, expectedRound: dto.expectedRound, expectedDigest: dto.expectedDigest, bindings, justification, evidenceIds }), old = await tx.aiMigrationPilotCapture.findUnique({ where: { requestKey: dto.requestKey } }); if (old) {
        if (old.requestDigest !== requestDigest)
            throw new ConflictException('Pilot request key belongs to another capture');
        return { ...old, created: false };
    } await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-native-pilot'),hashtext(${id}))`; const head = await tx.aiMigrationPilotCapture.findFirst({ where: { snapshotId: id }, orderBy: { round: 'desc' } }); if ((head?.round ?? 0) !== dto.expectedRound)
        throw new ConflictException('Pilot round changed'); const report = await this.report(tx, id, snapshot.report, bindings), digest = governanceDigest(report), saved = await tx.aiMigrationPilotCapture.create({ data: { snapshotId: id, round: dto.expectedRound + 1, bindings, report: report as unknown as Prisma.InputJsonObject, digest, requestKey: dto.requestKey, requestDigest, createdBy: userId, justification, evidenceIds } }); await this.audit.logRequired({ actor: userId, action: 'ai.migration.pilot.capture', entityType: 'ai_migration_pilot_capture', entityId: saved.id, metadata: { snapshotId: id, digest, targetZeroDiff: report.targetZeroDiff, pilotReady: report.pilotReady, justification, evidenceIds } }, tx); return { ...saved, created: true }; }); }
    async review(userId: string, id: string, dto: {
        outcome: string;
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) { const justification = governanceText(dto.justification); if (!['approve', 'return'].includes(dto.outcome))
        throw new BadRequestException('Approve or return required'); return governanceTransaction(this.db, async (tx) => { const v = await tx.aiMigrationPilotCapture.findUnique({ where: { id }, include: { review: true } }); if (!v)
        throw new NotFoundException('Pilot capture not found'); await this.snapshot(tx, userId, v.snapshotId, 'review'); const actor = await this.auth.authorizeAny(userId, ['case.view.airs.org', 'case.view.airs.all'], tx); await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-native-pilot'),hashtext(${v.snapshotId}))`; const head = await tx.aiMigrationPilotCapture.findFirst({ where: { snapshotId: v.snapshotId }, orderBy: { round: 'desc' } }); if (v.review || head?.id !== id || v.digest !== dto.expectedDigest || governanceDigest(v.report) !== v.digest)
        throw new ConflictException('Review latest intact pending pilot capture'); if (v.createdBy === userId)
        throw new ForbiddenException('Independent DMO pilot reviewer required'); if (dto.outcome === 'approve') {
        const { snapshot } = await this.corrections.approvedSnapshot(tx, userId, v.snapshotId, 'review'), fresh = await this.report(tx, v.snapshotId, snapshot.report, v.bindings as unknown as PilotBinding[]);
        if (!fresh.pilotReady || governanceDigest(fresh) !== v.digest)
            throw new ConflictException('Full current target equality and all twenty pilot anchors required');
    } await governanceEvidence(tx, v.evidenceIds); const evidenceIds = await governanceEvidence(tx, dto.evidenceIds), review = await tx.aiMigrationPilotReview.create({ data: { captureId: id, outcome: dto.outcome, actorId: userId, justification, evidenceIds } }); await this.audit.logRequired({ actor: userId, action: 'ai.migration.pilot.review', entityType: 'ai_migration_pilot_capture', entityId: id, metadata: { outcome: dto.outcome, justification, evidenceIds } }, tx); return review; }); }
    async export(userId: string, id: string, format: string) { if (!['json', 'csv'].includes(format))
        throw new BadRequestException('Use JSON or CSV'); const v = await this.db.aiMigrationPilotCapture.findUnique({ where: { id }, include: { review: true } }); if (!v)
        throw new NotFoundException('Pilot capture not found'); await this.snapshot(this.db, userId, v.snapshotId); if (governanceDigest(v.report) !== v.digest)
        throw new ConflictException('Pilot capture integrity differs'); if (format === 'json')
        return JSON.stringify(v, null, 2); const rows = jsonRecord(v.report)['members'] as Array<Record<string, unknown>>; return '\uFEFF' + ['rowKey,kind,sourceRef,targetRef,targetId,equal,gaps', ...rows.map(r => ['rowKey', 'kind', 'sourceRef', 'targetRef', 'targetId', 'equal', 'gaps'].map(k => reportCsvCell(r[k])).join(','))].join('\r\n'); }
}
