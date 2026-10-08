import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiMigrationPreviewService } from './ai-migration-preview.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord, scoringConfigurationIssues } from './ai-risk-scoring';
import { PreviewEnvironment, PreviewRow } from './ai-migration-preview';
import { reportCsvCell } from './ai-dashboard-reports.service';
type Rule = {
    column: string;
    kind: 'reference' | 'person' | 'unit' | 'text' | 'control';
    listCode?: string;
};
const ref = (column: string, listCode: string): Rule => ({ column, listCode, kind: 'reference' });
export const SOURCE_CORRECTION_RULES: Record<string, Record<string, Rule>> = {
    library: { titleEn: { column: 'C', kind: 'text' }, titleAr: { column: 'C', kind: 'text' }, dev_stage: ref('D', 'R_LIFECYCLE'), ethics_principle: ref('J', 'R_ETHICS'), risk_category: ref('K', 'R_RISKCAT') },
    usecase: { department: ref('E', 'R_DEPT'), organizationUnitId: { column: 'E', kind: 'unit' }, ownerPersonId: { column: 'F', kind: 'person' }, technology: ref('H', 'R_TECH'), stage: ref('I', 'R_LIFECYCLE'), personalData: ref('M', 'R_YN'), sensitiveData: ref('N', 'R_YN'), thirdParty: ref('O', 'R_YN'), offshore: ref('P', 'R_YN'), reliance: ref('Q', 'R_RELIANCE'), humanIntervention: ref('R', 'R_HITL'), operationalStatus: ref('W', 'R_UCSTATUS') },
    risk: { category: ref('D', 'R_RISKCAT'), principle: ref('E', 'R_ETHICS'), devStage: ref('G', 'R_LIFECYCLE'), controlEffectiveness: ref('M', 'R_CTRLEFF'), strategy: ref('R', 'R_STRATEGY'), ownerPersonId: { column: 'T', kind: 'person' }, executorPersonId: { column: 'U', kind: 'person' }, riskSource: ref('AJ', 'R_SOURCE'), riskIntent: ref('AK', 'R_INTENT'), riskTiming: ref('AL', 'R_TIMING') },
    action: { actionType: ref('E', 'R_ACTTYPE'), priority: ref('F', 'R_PRIORITY'), status: ref('J', 'R_TREATSTATUS'), executorPersonId: { column: 'G', kind: 'person' } },
    control: { controlVersionId: { column: 'B', kind: 'control' } },
};
export type CorrectionInput = {
    rowKey: string;
    field: string;
    value: string;
};
type Binding = CorrectionInput & {
    rule: Rule;
    source: unknown;
    target: unknown;
};
const correctionInclude = Prisma.validator<Prisma.AiSourceCorrectionVersionInclude>()({ review: true, snapshot: true });
const contextInclude = Prisma.validator<Prisma.AiSourceCorrectionVersionInclude>()({ review: true, snapshot: { select: { id: true, digest: true, createdAt: true } } });
const domainInclude = Prisma.validator<Prisma.AiControlDomainVersionInclude>()({ entry: true, publication: true });
type Correction = Prisma.AiSourceCorrectionVersionGetPayload<{
    include: typeof correctionInclude;
}>;
type Domain = Prisma.AiControlDomainVersionGetPayload<{
    include: typeof domainInclude;
}>;
@Injectable()
export class AiSourceCorrectionsService {
    constructor(private readonly prisma: PrismaService, private readonly previews: AiMigrationPreviewService, private readonly audit: AuditService) { }
    private rows(report: Record<string, unknown>) { return report['rows'] as PreviewRow[]; }
    private async domain(tx: Prisma.TransactionClient, id: string, previewId: string, rowKey: string) {
        const v = await tx.aiControlDomainVersion.findUnique({ where: { id }, include: domainInclude });
        if (!v?.publication || v.previewId !== previewId || v.sourceRowKey !== rowKey)
            throw new ConflictException('Select a published control version bound to this source row');
        const latest = await tx.aiControlDomainVersion.findFirst({ where: { entryId: v.entryId, publication: { isNot: null } }, orderBy: { round: 'desc' } });
        if (latest?.id !== id || governanceDigest({ content: v.content, dimensionPins: v.dimensionPins }) !== v.digest)
            throw new ConflictException('Control publication changed; select the current version');
        return v;
    }
    private async bindings(tx: Prisma.TransactionClient, report: Record<string, unknown>, environment: PreviewEnvironment, previewId: string, input: CorrectionInput[]): Promise<Binding[]> {
        if (!Array.isArray(input) || input.length < 1 || input.length > 400)
            throw new BadRequestException('Propose between 1 and 400 source bindings');
        const keys = new Set<string>(), result: Binding[] = [];
        for (const b of input) {
            if (!b || Object.keys(b).some(k => !['rowKey', 'field', 'value'].includes(k)) || typeof b.value !== 'string' || !b.value.trim() || b.value.length > 5000)
                throw new BadRequestException('Use a supported source binding value');
            const row = this.rows(report).find(r => r.key === b.rowKey), rule = row && SOURCE_CORRECTION_RULES[row.kind]?.[b.field];
            if (!row || !rule)
                throw new BadRequestException('Scores, approval authority, sample flags, identifiers and unsupported fields cannot be corrected');
            const key = b.rowKey + '|' + b.field;
            if (keys.has(key))
                throw new BadRequestException('Duplicate source-field binding');
            keys.add(key);
            let target: unknown;
            if (rule.kind === 'text') {
                if (b.value.trim().length > 200)
                    throw new BadRequestException('Library titles must fit 200 characters');
                target = b.value.trim();
            }
            else if (rule.kind === 'reference') {
                const versions = environment.references.filter(v => v.listCode === rule.listCode), v = versions.length === 1 ? versions[0] : null, value = v?.values.find(x => x.code === b.value);
                if (!v || !value)
                    throw new BadRequestException('Select a code from one current published ' + rule.listCode);
                target = { listCode: rule.listCode, versionId: v.id, code: value.code, labelEn: value.labelEn, labelAr: value.labelAr };
            }
            else if (rule.kind === 'person' || rule.kind === 'unit') {
                const candidates = rule.kind === 'person' ? environment.people : environment.units, person = candidates.find(p => p.id === b.value);
                if (!person)
                    throw new BadRequestException('Select a current active directory identity');
                target = { id: person.id, labels: person.labels };
            }
            else {
                const domain = await this.domain(tx, b.value, previewId, b.rowKey);
                target = { versionId: domain.id, controlCode: domain.entry.controlCode, digest: domain.digest, dimensionPins: domain.dimensionPins };
            }
            result.push({ rowKey: b.rowKey, field: b.field, value: rule.kind === 'text' ? b.value.trim() : b.value, rule, source: row.raw[rule.column] ?? null, target });
        }
        return result.sort((a, b) => (a.rowKey + '|' + a.field).localeCompare(b.rowKey + '|' + b.field));
    }
    private inputs(entries: Prisma.JsonValue) { return (entries as unknown as Binding[]).map(b => ({ rowKey: b.rowKey, field: b.field, value: b.value })); }
    private async current(tx: Prisma.TransactionClient, userId: string, v: Correction, operation: 'propose' | 'review') {
        const base = await this.previews.mappingBase(tx, userId, v.previewId, operation, true), entries = await this.bindings(tx, base.report, base.environment, v.previewId, this.inputs(v.entries));
        if (governanceDigest({ baseDigest: base.row.digest, entries: v.entries }) !== v.digest || governanceDigest(entries) !== governanceDigest(v.entries))
            throw new ConflictException('Source correction pins changed; propose a fresh correction version');
        return base;
    }
    async context(userId: string, previewId: string) {
        const base = await this.previews.mappingBase(this.prisma, userId, previewId), permissions = await this.previews.context(userId), versions = await this.prisma.aiSourceCorrectionVersion.findMany({ where: { previewId }, include: contextInclude, orderBy: { round: 'desc' }, take: 100 }), controls = await this.prisma.aiControlDomainVersion.findMany({ where: { previewId }, include: domainInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
        const published = controls.filter(v => v.publication && !controls.some(x => x.entryId === v.entryId && x.publication && x.round > v.round));
        return { canPropose: permissions.canPropose && base.row.review?.outcome === 'accept', canReview: permissions.canReview, rules: SOURCE_CORRECTION_RULES, rows: this.rows(base.report).filter(r => SOURCE_CORRECTION_RULES[r.kind]).map(r => ({ key: r.key, kind: r.kind, sourceRef: r.sourceRef, prepared: r.prepared })), references: base.environment.references.map(v => ({ listCode: v.listCode, versionId: v.id, values: v.values.map(x => ({ code: x.code, labelEn: x.labelEn, labelAr: x.labelAr })) })), people: base.environment.people, units: base.environment.units, dimensions: base.environment.scoring.dimensions, controls, selectableControls: published, versions, latestRound: versions[0]?.round ?? 0, productionReady: false };
    }
    async propose(userId: string, previewId: string, dto: {
        expectedRound: number;
        requestKey: string;
        entries: CorrectionInput[];
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        if (!Number.isInteger(dto.expectedRound) || dto.expectedRound < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestKey))
            throw new BadRequestException('Use a current correction round and stable request UUID');
        return governanceTransaction(this.prisma, async (tx) => {
            const base = await this.previews.mappingBase(tx, userId, previewId, 'propose', true), evidenceIds = await governanceEvidence(tx, dto.evidenceIds), requestDigest = governanceDigest({ userId, previewId, expectedRound: dto.expectedRound, entries: dto.entries, justification, evidenceIds });
            const existing = await tx.aiSourceCorrectionVersion.findUnique({ where: { requestKey: dto.requestKey }, include: correctionInclude });
            if (existing) {
                if (existing.requestDigest !== requestDigest)
                    throw new ConflictException('Correction request key belongs to another proposal');
                return { ...existing, created: false };
            }
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-source-corrections'),hashtext(${previewId}))`;
            const latest = await tx.aiSourceCorrectionVersion.findFirst({ where: { previewId }, orderBy: { round: 'desc' } });
            if ((latest?.round ?? 0) !== dto.expectedRound)
                throw new ConflictException('Source correction round changed; reload');
            const entries = await this.bindings(tx, base.report, base.environment, previewId, dto.entries), digest = governanceDigest({ baseDigest: base.row.digest, entries }), v = await tx.aiSourceCorrectionVersion.create({ data: { previewId, round: dto.expectedRound + 1, requestKey: dto.requestKey, requestDigest, digest, entries: entries as unknown as Prisma.InputJsonArray, proposedBy: userId, justification, evidenceIds }, include: correctionInclude });
            await this.audit.logRequired({ actor: userId, action: 'ai.source.corrections.propose', entityType: 'ai_source_correction', entityId: v.id, metadata: { previewId, round: v.round, digest, count: entries.length, justification, evidenceIds } }, tx);
            return { ...v, created: true };
        });
    }
    async review(userId: string, id: string, dto: {
        expectedDigest: string;
        outcome: string;
        justification: string;
        evidenceIds: string[];
    }) {
        if (!['approve', 'return'].includes(dto.outcome))
            throw new BadRequestException('Use an approve or return correction outcome');
        const justification = governanceText(dto.justification);
        return governanceTransaction(this.prisma, async (tx) => {
            const v = await tx.aiSourceCorrectionVersion.findUnique({ where: { id }, include: correctionInclude });
            if (!v)
                throw new NotFoundException('Source correction not found');
            const base = await this.previews.mappingBase(tx, userId, v.previewId, 'review');
            if (v.proposedBy === userId)
                throw new ForbiddenException('Source correction reviewer must be independent');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-source-corrections'),hashtext(${v.previewId}))`;
            const latest = await tx.aiSourceCorrectionVersion.findFirst({ where: { previewId: v.previewId }, orderBy: { round: 'desc' } });
            if (v.review || latest?.id !== id || dto.expectedDigest !== v.digest)
                throw new ConflictException('Review only the latest pending correction version');
            if (dto.outcome === 'approve')
                await this.current(tx, userId, v, 'review');
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds);
            await governanceEvidence(tx, v.evidenceIds);
            const review = await tx.aiSourceCorrectionReview.create({ data: { versionId: id, outcome: dto.outcome, actorId: userId, justification, evidenceIds } });
            await this.audit.logRequired({ actor: userId, action: 'ai.source.corrections.review', entityType: 'ai_source_correction', entityId: id, metadata: { outcome: dto.outcome, digest: v.digest, justification, evidenceIds, productionReady: false } }, tx);
            return review;
        });
    }
    private dimensionPins(environment: PreviewEnvironment, codes: string[]) {
        if (!environment.scoring.referenceVersions.R_IMPD || !Array.isArray(codes) || !codes.length || codes.length > 8 || new Set(codes).size !== codes.length)
            throw new BadRequestException('Select unique governed impact dimensions');
        const versions = environment.references.filter(v => v.listCode === 'R_IMPD');
        if (versions.length !== 1 || versions[0].id !== environment.scoring.referenceVersions.R_IMPD || scoringConfigurationIssues(environment.scoring).length)
            throw new ConflictException('Reviewed eight-dimension reference configuration is required');
        return codes.sort().map(code => { const d = environment.scoring.dimensions.find(x => x.code === code); if (!d)
            throw new BadRequestException('Unknown governed control dimension'); return { versionId: versions[0].id, code, dimension: d.dimension, labelEn: d.labelEn, labelAr: d.labelAr }; });
    }
    async proposeControl(userId: string, previewId: string, dto: {
        sourceRowKey: string;
        controlCode: string;
        expectedRound: number;
        titleEn: string;
        titleAr: string;
        dimensionCodes: string[];
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(dto.controlCode) || !Number.isInteger(dto.expectedRound) || dto.expectedRound < 0 || [dto.titleEn, dto.titleAr].some(t => typeof t !== 'string' || !t.trim() || t.length > 200))
            throw new BadRequestException('Use a stable control code, bilingual titles and current round');
        return governanceTransaction(this.prisma, async (tx) => {
            const base = await this.previews.mappingBase(tx, userId, previewId, 'propose', true), source = this.rows(base.report).find(r => r.key === dto.sourceRowKey && r.kind === 'control');
            if (!source)
                throw new BadRequestException('Control proposal must identify an original ISO control source row');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-control-domain'),hashtext(${dto.controlCode}))`;
            let entry = await tx.aiControlDomainEntry.findUnique({ where: { controlCode: dto.controlCode } }), latest = entry ? await tx.aiControlDomainVersion.findFirst({ where: { entryId: entry.id }, orderBy: { round: 'desc' } }) : null;
            if ((latest?.round ?? 0) !== dto.expectedRound)
                throw new ConflictException('Control proposal round changed');
            if (latest && latest.sourceRowKey !== dto.sourceRowKey)
                throw new ConflictException('A stable control code cannot be rebound to a different source area');
            const content = { titleEn: dto.titleEn.trim(), titleAr: dto.titleAr.trim(), sourceDimensions: source.raw.A?.value, sourceTitle: source.raw.B?.value, sourceCitation: source.raw.C?.value, technicalControls: source.raw.D?.value, organizationalControls: source.raw.E?.value, legalEthicalControls: source.raw.F?.value, suggestionsOnly: true };
            if (Object.values(content).some(v => v === null || v === undefined || v === ''))
                throw new ConflictException('Original control source content is incomplete');
            const dimensionPins = this.dimensionPins(base.environment, [...dto.dimensionCodes]), digest = governanceDigest({ content, dimensionPins }), evidenceIds = await governanceEvidence(tx, dto.evidenceIds);
            entry ??= await tx.aiControlDomainEntry.create({ data: { controlCode: dto.controlCode, createdBy: userId } });
            const v = await tx.aiControlDomainVersion.create({ data: { entryId: entry.id, previewId, sourceRowKey: dto.sourceRowKey, round: dto.expectedRound + 1, content: content as Prisma.InputJsonObject, dimensionPins, digest, proposedBy: userId, justification, evidenceIds }, include: domainInclude });
            await this.audit.logRequired({ actor: userId, action: 'ai.control.domain.propose', entityType: 'ai_control_domain', entityId: v.id, metadata: { controlCode: entry.controlCode, previewId, sourceRowKey: dto.sourceRowKey, round: v.round, digest, justification, evidenceIds } }, tx);
            return v;
        });
    }
    async publishControl(userId: string, id: string, dto: {
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        return governanceTransaction(this.prisma, async (tx) => {
            const v = await tx.aiControlDomainVersion.findUnique({ where: { id }, include: domainInclude });
            if (!v)
                throw new NotFoundException('Control proposal not found');
            const base = await this.previews.mappingBase(tx, userId, v.previewId, 'review', true);
            if (v.proposedBy === userId)
                throw new ForbiddenException('Control publisher must be independent');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-control-domain'),hashtext(${v.entry.controlCode}))`;
            const latest = await tx.aiControlDomainVersion.findFirst({ where: { entryId: v.entryId }, orderBy: { round: 'desc' } }), pins = this.dimensionPins(base.environment, (v.dimensionPins as Array<{
                code: string;
            }>).map(p => p.code));
            if (v.publication || latest?.id !== id || dto.expectedDigest !== v.digest || governanceDigest({ content: v.content, dimensionPins: v.dimensionPins }) !== v.digest || governanceDigest(pins) !== governanceDigest(v.dimensionPins))
                throw new ConflictException('Control source/dimension pins or proposal changed');
            // One current publication per source area prevents aliases from creating duplicate selectable domains.
            const others = await tx.aiControlDomainVersion.count({ where: { sourceRowKey: v.sourceRowKey, entryId: { not: v.entryId }, publication: { isNot: null } } });
            if (others)
                throw new ConflictException('This control source area already has a published stable identity');
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds);
            await governanceEvidence(tx, v.evidenceIds);
            const p = await tx.aiControlDomainPublication.create({ data: { versionId: id, publishedBy: userId, justification, evidenceIds } });
            await this.audit.logRequired({ actor: userId, action: 'ai.control.domain.publish', entityType: 'ai_control_domain', entityId: id, metadata: { publicationId: p.id, controlCode: v.entry.controlCode, justification, evidenceIds, suggestionsOnly: true } }, tx);
            return p;
        });
    }
    private async collisions(tx: Prisma.TransactionClient, rows: PreviewRow[]) {
        const refs = (kind: string) => rows.filter(r => r.kind === kind).map(r => r.sourceRef);
        const [u, r, a, l] = await Promise.all([tx.aiUseCase.findMany({ where: { useCaseRef: { in: refs('usecase') } }, select: { id: true, useCaseRef: true } }), tx.aiRisk.findMany({ where: { riskRef: { in: refs('risk') } }, select: { id: true, riskRef: true } }), tx.aiTreatmentAction.findMany({ where: { actionRef: { in: refs('action') } }, select: { id: true, actionRef: true } }), tx.aiRiskLibraryEntry.findMany({ where: { libraryRef: { in: refs('library') } }, select: { id: true, libraryRef: true } })]);
        return [...u.map(x => ({ kind: 'usecase', reference: x.useCaseRef!, targetId: x.id })), ...r.map(x => ({ kind: 'risk', reference: x.riskRef!, targetId: x.id })), ...a.map(x => ({ kind: 'action', reference: x.actionRef, targetId: x.id })), ...l.map(x => ({ kind: 'library', reference: x.libraryRef, targetId: x.id }))];
    }
    async capture(userId: string, id: string, dto: {
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        return governanceTransaction(this.prisma, async (tx) => {
            const v = await tx.aiSourceCorrectionVersion.findUnique({ where: { id }, include: correctionInclude });
            if (!v)
                throw new NotFoundException('Source correction not found');
            const base = await this.current(tx, userId, v, 'propose');
            const latest = await tx.aiSourceCorrectionVersion.findFirst({ where: { previewId: v.previewId, review: { is: { outcome: 'approve' } } }, orderBy: { round: 'desc' } });
            if (v.review?.outcome !== 'approve' || latest?.id !== id || dto.expectedDigest !== v.digest)
                throw new ConflictException('Capture only the current independently approved correction version');
            await governanceEvidence(tx, v.review.evidenceIds);
            await governanceEvidence(tx, v.evidenceIds);
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds);
            if (v.snapshot) {
                if (v.snapshot.createdBy !== userId || v.snapshot.justification !== justification || governanceDigest(v.snapshot.evidenceIds) !== governanceDigest(evidenceIds))
                    throw new ConflictException('Correction capture already belongs to another request');
                return { ...v.snapshot, created: false };
            }
            const report = structuredClone(base.report), rows = this.rows(report), changes: Array<Record<string, unknown>> = [];
            for (const b of v.entries as unknown as Binding[]) {
                const row = rows.find(r => r.key === b.rowKey)!, before = structuredClone(row.prepared[b.field] ?? null), oldIssues = [...row.issues];
                row.prepared[b.field] = b.rule.kind === 'reference' ? b.target : b.rule.kind === 'control' ? b.target : b.value;
                row.issues = row.issues.filter(issue => !this.correctedIssue(issue, b));
                changes.push({ rowKey: b.rowKey, field: b.field, source: b.source, before, after: row.prepared[b.field], removedIssues: oldIssues.filter(i => !row.issues.includes(i)) });
            }
            const collisions = await this.collisions(tx, rows);
            for (const c of collisions) {
                const row = rows.find(r => r.kind === c.kind && r.sourceRef === c.reference)!;
                row.issues.push('TARGET_REF_COLLISION');
            }
            for (const row of rows)
                row.issues = row.issues.filter(i => i !== 'PARENT_QUARANTINED');
            const parentKinds: Record<string, string> = { risk: 'usecase', action: 'risk', assessment: 'risk', classification: 'usecase' };
            for (let pass = 0; pass < 3; pass++)
                for (const row of rows) {
                    const p = rows.find(r => r.kind === parentKinds[row.kind] && r.sourceRef === row.parentRef);
                    if (p?.issues.length && !row.issues.includes('PARENT_QUARANTINED'))
                        row.issues.push('PARENT_QUARANTINED');
                }
            for (const row of rows) {
                row.issues = [...new Set(row.issues)];
                row.status = row.issues.length ? 'quarantined' : 'prepared';
            }
            const recon = jsonRecord(report['reconciliation']);
            recon['quarantinedCount'] = rows.filter(r => r.status === 'quarantined').length;
            recon['preparedCount'] = rows.length - (recon['quarantinedCount'] as number);
            recon['targetCollisionCount'] = collisions.length;
            recon['productionReady'] = false;
            report['version'] = 'ai-corrected-source-preview-v1';
            report['correction'] = { basePreviewId: base.row.id, baseDigest: base.row.digest, versionId: v.id, round: v.round, digest: v.digest, changes, collisions };
            const digest = governanceDigest(report), snapshot = await tx.aiCorrectedSourceSnapshot.create({ data: { correctionVersionId: id, report: report as Prisma.InputJsonObject, digest, createdBy: userId, justification, evidenceIds } });
            if (governanceDigest(snapshot.report) !== digest)
                throw new ConflictException('Corrected snapshot persistence integrity differs');
            await this.audit.logRequired({ actor: userId, action: 'ai.source.corrections.capture', entityType: 'ai_corrected_source_snapshot', entityId: snapshot.id, metadata: { versionId: id, digest, changeCount: changes.length, targetCollisionCount: collisions.length, justification, evidenceIds, mode: 'VALIDATE_ONLY' } }, tx);
            return { ...snapshot, created: true };
        });
    }
    private correctedIssue(issue: string, b: Binding) {
        if (b.rule.kind === 'text')
            return b.field === 'titleEn' ? issue === 'ENGLISH_TITLE_REVIEW_REQUIRED' : issue === 'MISSING_FIELD:titleAr';
        if (b.rule.kind === 'person' || b.rule.kind === 'unit')
            return ['UNRESOLVED_IDENTITY:', 'AMBIGUOUS_IDENTITY:'].some(p => issue === p + b.field);
        if (b.rule.kind === 'control')
            return issue === 'CONTROL_CODE_AND_MAPPING_REVIEW_REQUIRED';
        return ['UNKNOWN_LABEL:', 'AMBIGUOUS_LABEL:', 'REFERENCE_VERSION:'].some(p => issue === p + b.rule.listCode + ':' + b.rule.column) || issue === 'MISSING_FIELD:' + b.field;
    }
    /** A saved result may be replayed without reloading mutable source files. This
     * facade grants no permission to create a draft from superseded mappings. */
    async replaySnapshot(tx: Prisma.TransactionClient, userId: string, id: string) {
        const snapshot = await tx.aiCorrectedSourceSnapshot.findUnique({ where: { id }, include: { correctionVersion: true } });
        if (!snapshot) throw new NotFoundException('Corrected source snapshot not found');
        await this.previews.mappingBase(tx,userId,snapshot.correctionVersion.previewId,'propose',false);
        if (governanceDigest(snapshot.report) !== snapshot.digest) throw new ConflictException('Corrected source snapshot integrity differs');
        return snapshot;
    }
    async approvedSnapshot(tx: Prisma.TransactionClient, userId: string, id: string, operation: 'propose' | 'review' = 'propose') {
        const snapshot = await tx.aiCorrectedSourceSnapshot.findUnique({ where: { id }, include: { correctionVersion: { include: correctionInclude } } });
        if (!snapshot)
            throw new NotFoundException('Corrected source snapshot not found');
        const v = snapshot.correctionVersion;
        const base = await this.current(tx, userId, v, operation), latest = await tx.aiSourceCorrectionVersion.findFirst({ where: { previewId: v.previewId, review: { is: { outcome: 'approve' } } }, orderBy: { round: 'desc' } });
        if (v.review?.outcome !== 'approve' || latest?.id !== v.id || governanceDigest(snapshot.report) !== snapshot.digest)
            throw new ConflictException('Use the current independently approved corrected source snapshot');
        await governanceEvidence(tx, v.evidenceIds);
        await governanceEvidence(tx, v.review.evidenceIds);
        await governanceEvidence(tx, snapshot.evidenceIds);
        return { snapshot, base };
    }
    async snapshot(userId: string, id: string) { const snapshot = await this.prisma.aiCorrectedSourceSnapshot.findUnique({ where: { id }, include: { correctionVersion: true } }); if (!snapshot)
        throw new NotFoundException('Corrected source snapshot not found'); await this.previews.mappingBase(this.prisma, userId, snapshot.correctionVersion.previewId); if (governanceDigest(snapshot.report) !== snapshot.digest)
        throw new ConflictException('Corrected source snapshot integrity differs'); return { ...snapshot, productionReady: false }; }
    async export(userId: string, id: string, format: string) {
        const s = await this.snapshot(userId, id);
        if (format === 'json')
            return JSON.stringify(s, null, 2);
        if (format !== 'csv')
            throw new BadRequestException('Use JSON or CSV corrected-source exports');
        const correction = jsonRecord(jsonRecord(s.report)['correction']), changes = correction['changes'] as Array<Record<string, unknown>>;
        return '\uFEFF' + [['rowKey', 'field', 'originalSource', 'before', 'after', 'removedIssues', 'mode'], ...changes.map(c => [c['rowKey'], c['field'], JSON.stringify(c['source']), JSON.stringify(c['before']), JSON.stringify(c['after']), JSON.stringify(c['removedIssues']), 'VALIDATE_ONLY'])].map(r => r.map(reportCsvCell).join(',')).join('\r\n');
    }
}
