import { aiReviewParams } from './ai-review-query.dto';
import { toPaged } from '../common/pagination';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../access/scope.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiRiskAssessmentService } from './ai-risk-assessment.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { parseMigrationWorkbook, SourceWorkbook } from './ai-migration-workbook';
import { buildMigrationPreview, MIGRATION_PREVIEW_VERSION, PreviewEnvironment, PreviewRow } from './ai-migration-preview';
import { jsonRecord } from './ai-risk-scoring';
import { reportCsvCell } from './ai-dashboard-reports.service';
import { migrationSources } from './ai-migration-sources';
const include = Prisma.validator<Prisma.AiMigrationPreviewInclude>()({ dispositions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, review: true });
type Saved = Prisma.AiMigrationPreviewGetPayload<{
    include: typeof include;
}>;
@Injectable()
export class AiMigrationPreviewService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly risks: AiRiskIntakeService, private readonly scope: ScopeService, private readonly scoring: AiRiskAssessmentService, private readonly audit: AuditService) { }
    private async access(tx: Prisma.TransactionClient, userId: string, operation: 'read' | 'propose' | 'review' = 'read') {
        const a = await this.risks.visibility(userId, tx), scope = await this.scope.resolve(a.actor.roles);
        // Unresolved source departments cannot safely be assigned to a partial organization/domain scope.
        if (!(a.actor.administratorOversight || a.actor.roles.some(r => ['AI_GOVERNANCE_OFFICER', 'dmo_admin', 'auditor'].includes(r))) || scope.orgUnits !== 'all' || scope.domains !== 'all' || scope.maxClassRank !== null)
            throw new ForbiddenException('Source preparation requires full organization, domain and classification coverage with a governance role');
        if (operation === 'propose') {
            await this.authorization.authorize(userId, 'refdata.propose.ai', tx);
            if (!a.actor.administratorOverride && !a.actor.roles.includes('AI_GOVERNANCE_OFFICER'))
                throw new ForbiddenException('Responsible AI Officer proposes source preparation');
        }
        if (operation === 'review') {
            await this.authorization.authorize(userId, 'airs.library.import', tx);
            await this.authorization.authorize(userId, 'refdata.publish', tx);
            if (!a.actor.administratorOverride && !a.actor.roles.includes('dmo_admin'))
                throw new ForbiddenException('Independent DMO source-preparation review required');
        }
        return a;
    }
    protected async sources(): Promise<SourceWorkbook[]> {
        // Operator-controlled fixed directory, never a request-supplied path or remote URL.
        const root = resolve(process.env.AI_MIGRATION_SOURCE_DIR ?? resolve(__dirname, '../../../../storage/ai-sources'));
        try {
            return await Promise.all(migrationSources().sources.map(async (s) => parseMigrationWorkbook(await readFile(resolve(root, s.file)), s.source, s.sha256)));
        }
        catch {
            throw new ConflictException('Retained source files are unavailable or differ from the approved source manifest');
        }
    }
    private async environment(tx: Prisma.TransactionClient): Promise<PreviewEnvironment> {
        const now = new Date(), versions = await tx.governedReferenceVersion.findMany({ where: { state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: { orderBy: { code: 'asc' } } }, orderBy: [{ listCode: 'asc' }, { id: 'asc' }] });
        const people = await tx.person.findMany({ where: { isActive: true, deletedAt: null, OR: [{ userId: null }, { user: { is: { isActive: true } } }] }, select: { id: true, fullNameAr: true, fullNameEn: true, email: true }, orderBy: { id: 'asc' } });
        const units = await tx.organizationUnit.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, nameAr: true, nameEn: true, code: true }, orderBy: { id: 'asc' } });
        return { references: versions.map(v => ({ listCode: v.listCode, id: v.id, values: v.values.map(x => ({ code: x.code, labelEn: x.labelEn, labelAr: x.labelAr, metadata: x.metadata })) })), people: people.map(p => ({ id: p.id, labels: [p.fullNameAr, p.fullNameEn, ...p.email ? [p.email] : []] })), units: units.map(u => ({ id: u.id, labels: [u.nameAr, u.nameEn, u.code] })), scoring: await this.scoring.configuration(tx) };
    }
    private report(row: Saved) { const report = jsonRecord(row.report); if (governanceDigest(report) !== row.digest || report['version'] !== MIGRATION_PREVIEW_VERSION || !Array.isArray(report['rows']))
        throw new ConflictException('Saved source preview integrity differs'); return report; }
    private view(row: Saved) { return { id: row.id, digest: row.digest, createdAt: row.createdAt, createdBy: row.createdBy, justification: row.justification, report: this.report(row), dispositions: row.dispositions, review: row.review, productionReady: false }; }
    async context(userId: string) {
        const a = await this.access(this.prisma, userId), permissions = await this.prisma.rolePermission.findMany({ where: { role: { code: { in: a.actor.roles }, isActive: true, deletedAt: null } }, include: { permission: true, role: { select: { code: true } } } });
        const holds = (role: string, code: string) => permissions.some(p => p.role.code === role && p.permission.resource + '.' + p.permission.action === code);
        const administratorOverride = a.actor.administratorOverride;
        return { version: MIGRATION_PREVIEW_VERSION, administratorOverride, canPropose: administratorOverride || !a.actor.roles.includes('auditor') && holds('AI_GOVERNANCE_OFFICER', 'refdata.propose.ai'), canReview: administratorOverride || !a.actor.roles.includes('auditor') && holds('dmo_admin', 'airs.library.import') && holds('dmo_admin', 'refdata.publish'), sourceMode: migrationSources().sourceMode, sources: migrationSources().sources.map(s => ({ source: s.source, file: s.file, sha256: s.sha256 })), productionReady: false };
    }
    async create(userId: string, dto: {
        requestKey: string;
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestKey))
            throw new BadRequestException('Use a stable source-preparation request key');
        await this.access(this.prisma, userId, 'propose');
        return governanceTransaction(this.prisma, async (tx) => {
            await this.access(tx, userId, 'propose');
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds), requestDigest = governanceDigest({ userId, justification, evidenceIds }), existing = await tx.aiMigrationPreview.findUnique({ where: { requestKey: dto.requestKey }, include });
            if (existing) {
                if (existing.requestDigest !== requestDigest)
                    throw new ConflictException('Source request key belongs to another proposal');
                return { ...this.view(existing), created: false };
            }
            const books = await this.sources();
            const env = await this.environment(tx), report = { ...buildMigrationPreview(books, env), sourceMode: migrationSources().sourceMode, demoOnly: migrationSources().sourceMode === 'synthetic_demo' }, digest = governanceDigest(report), row = await tx.aiMigrationPreview.create({ data: { requestKey: dto.requestKey, requestDigest, digest, environmentDigest: governanceDigest(env), report: report as unknown as Prisma.InputJsonObject, createdBy: userId, justification, evidenceIds }, include });
            await this.audit.logRequired({ actor: userId, action: 'ai.migration.preview.propose', entityType: 'ai_migration_preview', entityId: row.id, metadata: { digest, sources: report.sources, counts: report.reconciliation.counts, mode: 'VALIDATE_ONLY', justification, evidenceIds } }, tx);
            return { ...this.view(row), created: true };
        });
    }
    async list(userId: string, page = 1, pageSize = 25, search = '') {
        const paging=aiReviewParams({page,pageSize,search}),where:Prisma.AiMigrationPreviewWhereInput=search.trim()?{justification:{contains:search.trim(),mode:'insensitive'}}:{};
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
            throw new BadRequestException('Use supported source-preview pagination');
        await this.access(this.prisma, userId);
        const [total, rows] = await Promise.all([this.prisma.aiMigrationPreview.count({where}), this.prisma.aiMigrationPreview.findMany({ where,include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
        const data=rows.map(r => ({ id: r.id, digest: r.digest, createdAt: r.createdAt, createdBy: r.createdBy, review: r.review, reconciliation: this.report(r)['reconciliation'] }));
        return {...toPaged(data,total,paging),rows:data};
    }
    async get(userId: string, id: string) { await this.access(this.prisma, userId); const row = await this.prisma.aiMigrationPreview.findUnique({ where: { id }, include }); if (!row)
        throw new NotFoundException('Source preview not found'); return this.view(row); }
    /** Internal governed-mapping facade. No additional HTTP endpoint or client-supplied scope facts. */
    async mappingBase(tx: Prisma.TransactionClient, userId: string, id: string, operation: 'read' | 'propose' | 'review' = 'read', fresh = false) {
        const access = await this.access(tx, userId, operation);
        const row = await tx.aiMigrationPreview.findUnique({ where: { id }, include });
        if (!row)
            throw new NotFoundException('Source preview not found');
        const report = this.report(row), environment = await this.environment(tx);
        if (operation !== 'read' && row.review?.outcome !== 'accept')
            throw new ConflictException('Accept source preparation before proposing source mappings');
        if (fresh) {
            const books = await this.sources();
            if (governanceDigest(environment) !== row.environmentDigest || governanceDigest(books.map(b => ({ source: b.source, sha256: b.sha256 }))) !== governanceDigest(report['sources']))
                throw new ConflictException('Source or reference/identity configuration changed; propose a fresh preview');
            await governanceEvidence(tx, row.evidenceIds);
            if (row.review)
                await governanceEvidence(tx, row.review.evidenceIds);
        }
        return { row, report, environment, actor: access.actor };
    }
    async disposition(userId: string, id: string, dto: {
        rowKey: string;
        outcome: string;
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) {
        if (!['defer', 'reject'].includes(dto.outcome) || typeof dto.rowKey !== 'string' || dto.rowKey.length > 300)
            throw new BadRequestException('Use an evidenced defer or reject disposition; corrections require a new verified source');
        const justification = governanceText(dto.justification);
        return governanceTransaction(this.prisma, async (tx) => {
            await this.access(tx, userId, 'propose');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-source-preview'),hashtext(${id}))`;
            const row = await tx.aiMigrationPreview.findUnique({ where: { id }, include });
            if (!row)
                throw new NotFoundException('Source preview not found');
            const report = this.report(row);
            if (row.review || dto.expectedDigest !== row.digest)
                throw new ConflictException('Source preview changed or its review is closed');
            const source = (report['rows'] as PreviewRow[]).find(r => r.key === dto.rowKey);
            if (!source || source.status !== 'quarantined')
                throw new BadRequestException('Disposition must identify a quarantined row in this preview');
            if (row.dispositions.some(d => d.rowKey === dto.rowKey))
                throw new ConflictException('Source-row disposition is immutable; propose a fresh preview to reconsider');
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds), d = await tx.aiMigrationDisposition.create({ data: { previewId: id, rowKey: dto.rowKey, outcome: dto.outcome, actorId: userId, justification, evidenceIds } });
            await this.audit.logRequired({ actor: userId, action: 'ai.migration.preview.disposition', entityType: 'ai_migration_preview', entityId: id, metadata: { dispositionId: d.id, rowKey: dto.rowKey, outcome: dto.outcome, justification, evidenceIds } }, tx);
            return d;
        });
    }
    async review(userId: string, id: string, dto: {
        outcome: string;
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) {
        if (!['accept', 'reject'].includes(dto.outcome))
            throw new BadRequestException('Use a source-preparation accept or reject outcome');
        const justification = governanceText(dto.justification);
        await this.access(this.prisma, userId, 'review');
        const books = dto.outcome === 'accept' ? await this.sources() : null;
        return governanceTransaction(this.prisma, async (tx) => {
            const access = await this.access(tx, userId, 'review');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-source-preview'),hashtext(${id}))`;
            const row = await tx.aiMigrationPreview.findUnique({ where: { id }, include });
            if (!row)
                throw new NotFoundException('Source preview not found');
            const report = this.report(row);
            if (!access.actor.administratorOverride && row.createdBy === userId)
                throw new ForbiddenException('Source-preparation reviewer must be independent of its proposer');
            if (row.review || dto.expectedDigest !== row.digest)
                throw new ConflictException('Source preview changed or its review is closed');
            if (dto.outcome === 'accept') {
                if (governanceDigest(await this.environment(tx)) !== row.environmentDigest || governanceDigest(books!.map(b => ({ source: b.source, sha256: b.sha256 }))) !== governanceDigest(report['sources']))
                    throw new ConflictException('Source or reference/identity configuration changed; propose a fresh preview');
                const recon = jsonRecord(report['reconciliation']);
                if ((recon['globalIssues'] as unknown[]).length)
                    throw new ConflictException('Source structure must reconcile before preparation acceptance');
                const quarantines = (report['rows'] as PreviewRow[]).filter(r => r.status === 'quarantined');
                if (quarantines.some(r => !row.dispositions.some(d => d.rowKey === r.key)))
                    throw new ConflictException('Every quarantined row requires an evidenced disposition');
                for (const d of row.dispositions)
                    await governanceEvidence(tx, d.evidenceIds);
            }
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds);
            await governanceEvidence(tx, row.evidenceIds);
            const review = await tx.aiMigrationPreviewReview.create({ data: { previewId: id, outcome: dto.outcome, actorId: userId, justification, evidenceIds } });
            await this.audit.logRequired({ actor: userId, action: 'ai.migration.preview.review', entityType: 'ai_migration_preview', entityId: id, metadata: { reviewId: review.id, outcome: dto.outcome, digest: row.digest, mode: 'VALIDATE_ONLY', productionReady: false, justification, evidenceIds } }, tx);
            return { ...review, productionReady: false };
        });
    }
    async export(userId: string, id: string, format: string) {
        const v = await this.get(userId, id);
        if (format === 'json')
            return JSON.stringify(v, null, 2);
        if (format !== 'csv')
            throw new BadRequestException('Use a JSON or CSV source-preview export');
        const report = v.report, rows = report['rows'] as PreviewRow[];
        return '\uFEFF' + [['kind', 'source', 'sheet', 'row', 'sourceRef', 'parentRef', 'sample', 'status', 'issues', 'disposition', 'computedDiffCount', 'mode'], ...rows.map(r => [r.kind, r.source, r.sheet, r.row, r.sourceRef, r.parentRef, r.sample, r.status, r.issues.join('; '), v.dispositions.find(d => d.rowKey === r.key)?.outcome ?? '', r.checks.filter(c => c.equal === false).length, 'VALIDATE_ONLY'])].map(r => r.map(reportCsvCell).join(',')).join('\r\n');
    }
}
