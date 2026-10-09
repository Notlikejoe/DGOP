import { AiSourceCorrectionsService } from './ai-source-corrections.service';
import { aiRoleMayHold, AiPermission } from './ai-permissions';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskIntakeService } from './ai-risk-intake.service';
import { AiIdentifiersService } from './ai-identifiers.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
import { jsonRecord } from './ai-risk-scoring';
export const LIBRARY_LISTS = { risk_category: 'R_RISKCAT', ethics_principle: 'R_ETHICS', dev_stage: 'R_LIFECYCLE', default_strategy: 'R_STRATEGY' } as const;
export const LIBRARY_TEXT = ['titleEn', 'titleAr', 'risk_domain', 'description', 'probable_causes', 'probable_impacts', 'example_controls', 'attention_indicators'] as const;
type Version = Prisma.AiRiskLibraryVersionGetPayload<{
    include: {
        entry: true;
        publication: true;
    };
}>;
@Injectable()
export class AiRiskLibraryService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly risks: AiRiskIntakeService, private readonly identifiers: AiIdentifiersService, private readonly audit: AuditService, private readonly corrections?: AiSourceCorrectionsService) { }
    async lookups(userId: string) {
        const a = await this.risks.visibility(userId), now = new Date();
        const lists = await this.prisma.governedReferenceVersion.findMany({ where: { listCode: { in: Object.values(LIBRARY_LISTS) }, state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true } });
        const roleGrants = await this.prisma.rolePermission.findMany({ where: { role: { is: { code: { in: a.actor.roles }, isActive: true, deletedAt: null } } }, include: { permission: true, role: { select: { code: true } } } }), permissions = new Set(roleGrants.filter(g => ['refdata.propose.ai', 'airs.library.import', 'refdata.publish'].includes(g.permission.resource + '.' + g.permission.action) && aiRoleMayHold(g.role.code, (g.permission.resource + '.' + g.permission.action) as AiPermission)).map(g => g.permission.resource + '.' + g.permission.action));
        const administratorOverride = a.actor.administratorOverride;
        return { administratorOverride, canPropose: administratorOverride || a.actor.roles.includes('AI_GOVERNANCE_OFFICER') && permissions.has('refdata.propose.ai') && !a.actor.roles.includes('auditor'), canPublish: administratorOverride || a.actor.roles.includes('dmo_admin') && permissions.has('airs.library.import') && permissions.has('refdata.publish') && !a.actor.roles.includes('auditor'), lists: Object.entries(LIBRARY_LISTS).map(([field, code]) => { const v = lists.filter(v => v.listCode === code); return { field, ready: v.length === 1, values: v.length === 1 ? v[0].values.map(x => ({ code: x.code, labelEn: x.labelEn, labelAr: x.labelAr })) : [] }; }) };
    }
    private async pins(tx: Prisma.TransactionClient, content: Record<string, unknown>) {
        const result: Record<string, unknown> = {};
        for (const [field, listCode] of Object.entries(LIBRARY_LISTS)) {
            if (field === 'default_strategy' && !content[field])
                continue;
            const now = new Date(), versions = await tx.governedReferenceVersion.findMany({ where: { listCode, state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 });
            if (versions.length !== 1 || !versions[0].values.some(v => v.code === content[field]))
                throw new BadRequestException('Select a value from unambiguous published ' + listCode);
            const v = versions[0], value = v.values.find(v => v.code === content[field])!;
            await tx.$queryRaw `SELECT id FROM governed_reference_versions WHERE id=${v.id} FOR SHARE`;
            result[field] = { listCode, versionId: v.id, code: value.code, labelEn: value.labelEn, labelAr: value.labelAr };
        }
        return result;
    }
    private content(value: unknown) {
        const c = jsonRecord(value), known = new Set<string>([...LIBRARY_TEXT, ...Object.keys(LIBRARY_LISTS)]);
        if (Object.keys(c).some(k => !known.has(k)))
            throw new BadRequestException('Unknown or computed library fields cannot be submitted');
        for (const key of LIBRARY_TEXT)
            if (typeof c[key] !== 'string' || !String(c[key]).trim() || String(c[key]).length > (key.startsWith('title') ? 200 : 5000))
                throw new BadRequestException('Complete library field ' + key);
        for (const key of Object.keys(LIBRARY_LISTS))
            if (key !== 'default_strategy' && (typeof c[key] !== 'string' || !String(c[key]).trim()))
                throw new BadRequestException('Select library field ' + key);
        if (c['default_strategy'] !== undefined && (typeof c['default_strategy'] !== 'string' || String(c['default_strategy']).length > 80))
            throw new BadRequestException('Invalid strategy suggestion');
        return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    }
    async propose(userId: string, dto: {
        entryId?: string;
        expectedRound: number;
        content: Record<string, unknown>;
        justification: string;
        evidenceIds: string[];
    }) {
        const content = this.content(dto.content), justification = governanceText(dto.justification);
        if (!Number.isInteger(dto.expectedRound) || dto.expectedRound < 0)
            throw new BadRequestException('Use the current library round');
        return governanceTransaction(this.prisma, async (tx) => {
            const actor = await this.authorization.authorize(userId, 'refdata.propose.ai', tx);
            if (!actor.roles.includes('AI_GOVERNANCE_OFFICER'))
                throw new ForbiddenException('Library changes are proposed by the Responsible AI Officer');
            const evidenceIds = await governanceEvidence(tx, dto.evidenceIds), referencePins = await this.pins(tx, content);
            let entry = dto.entryId ? await tx.aiRiskLibraryEntry.findUnique({ where: { id: dto.entryId } }) : null;
            if (dto.entryId && !entry)
                throw new NotFoundException('Library entry not found');
            if (!entry) {
                if (dto.expectedRound !== 0)
                    throw new ConflictException('New library entries start at round zero');
                entry = await tx.aiRiskLibraryEntry.create({ data: { libraryRef: await this.identifiers.nextLibraryRef(tx), createdBy: userId } });
            }
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-risk-library'),hashtext(${entry.id}))`;
            const latest = await tx.aiRiskLibraryVersion.findFirst({ where: { entryId: entry.id }, orderBy: { round: 'desc' } });
            if ((latest?.round ?? 0) !== dto.expectedRound)
                throw new ConflictException('Library entry changed; reload');
            const digest = governanceDigest({ content, referencePins }), version = await tx.aiRiskLibraryVersion.create({ data: { entryId: entry.id, round: dto.expectedRound + 1, content: content as Prisma.InputJsonObject, referencePins: referencePins as Prisma.InputJsonObject, digest, proposedBy: userId, justification, evidenceIds, createdAt: new Date() } });
            await this.audit.logRequired({ actor: userId, action: 'airs.library.propose', entityType: 'ai_risk_library_version', entityId: version.id, metadata: { libraryRef: entry.libraryRef, round: version.round, digest, justification, evidenceIds } }, tx);
            return { entryId: entry.id, versionId: version.id, libraryRef: entry.libraryRef, round: version.round };
        });
    }
    async sourceProposal(tx: Prisma.TransactionClient, userId: string, libraryRef: string, value: Record<string, unknown>, justification: string, evidenceIds: string[]) {
        const actor = await this.authorization.authorize(userId, 'refdata.propose.ai', tx);
        if (!actor.roles.includes('AI_GOVERNANCE_OFFICER'))
            throw new ForbiddenException('Officer source proposal required');
        if (!/^AIRL-\d{3,}$/.test(libraryRef) || await tx.aiRiskLibraryEntry.findUnique({ where: { libraryRef } }))
            throw new ConflictException('Source AIRL identifier collides with an existing target');
        const content = this.content(value), referencePins = await this.pins(tx, content), entry = await tx.aiRiskLibraryEntry.create({ data: { libraryRef, createdBy: userId } }), digest = governanceDigest({ content, referencePins });
        const v = await tx.aiRiskLibraryVersion.create({ data: { entryId: entry.id, round: 1, content: content as Prisma.InputJsonObject, referencePins: referencePins as Prisma.InputJsonObject, digest, proposedBy: userId, justification, evidenceIds } });
        await this.audit.logRequired({ actor: userId, action: 'airs.library.source.propose', entityType: 'ai_risk_library_version', entityId: v.id, metadata: { libraryRef, digest, justification, evidenceIds } }, tx);
        return v;
    }
    async publish(userId: string, id: string, justificationValue: string, evidenceValue: string[]) {
        const justification = governanceText(justificationValue);
        return governanceTransaction(this.prisma, async (tx) => {
            const actor = await this.authorization.authorize(userId, 'airs.library.import', tx, id);
            await this.authorization.authorize(userId, 'refdata.publish', tx, id);
            if (!actor.roles.includes('dmo_admin'))
                throw new ForbiddenException('DMO administration publishes library records');
            const v = await tx.aiRiskLibraryVersion.findUnique({ where: { id }, include: { entry: true, publication: true } });
            if (!v)
                throw new NotFoundException('Library version not found');
            if (v.proposedBy === userId)
                throw new ForbiddenException('Library publisher must be independent of its proposer');
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-risk-library'),hashtext(${v.entryId}))`;
            const latest = await tx.aiRiskLibraryVersion.findFirst({ where: { entryId: v.entryId }, orderBy: { round: 'desc' } });
            if (v.publication || latest?.id !== v.id)
                throw new ConflictException('Publish only the latest unpublished proposal');
            const pins = await this.pins(tx, this.content(v.content));
            if (governanceDigest({ content: v.content, referencePins: v.referencePins }) !== v.digest || governanceDigest(pins) !== governanceDigest(v.referencePins))
                throw new ConflictException('Reference publication changed; propose a fresh version');
            const source = await tx.aiLibrarySourceItem.findUnique({ where: { libraryVersionId: id } });
            if (source) {
                if (!this.corrections)
                    throw new ConflictException('Source publication validator unavailable');
                await this.corrections.approvedSnapshot(tx, userId, source.snapshotId, 'review');
                if (governanceDigest(v.content) !== source.projectionDigest || v.entry.libraryRef !== source.sourceRef)
                    throw new ConflictException('Source target provenance differs');
            }
            const evidenceIds = await governanceEvidence(tx, evidenceValue);
            await governanceEvidence(tx, v.evidenceIds);
            const publication = await tx.aiRiskLibraryPublication.create({ data: { versionId: id, publishedBy: userId, justification, evidenceIds, createdAt: new Date() } });
            await this.audit.logRequired({ actor: userId, action: 'airs.library.publish', entityType: 'ai_risk_library_version', entityId: id, metadata: { libraryRef: v.entry.libraryRef, round: v.round, digest: v.digest, justification, evidenceIds, publicationId: publication.id } }, tx);
            return { versionId: id, publicationId: publication.id };
        });
    }
    async publishedVersion(tx: Prisma.TransactionClient, id: string) {
        const v = await tx.aiRiskLibraryVersion.findUnique({ where: { id }, include: { entry: true, publication: true } });
        if (!v?.publication)
            throw new ConflictException('Use a published library version');
        const latest = await tx.aiRiskLibraryVersion.findFirst({ where: { entryId: v.entryId, publication: { isNot: null } }, orderBy: { round: 'desc' } });
        if (latest?.id !== id)
            throw new ConflictException('Library publication changed; select the current version');
        const pins = await this.pins(tx, this.content(v.content));
        if (governanceDigest({ content: v.content, referencePins: v.referencePins }) !== v.digest || governanceDigest(pins) !== governanceDigest(v.referencePins))
            throw new ConflictException('Library reference pins require a new reviewed publication');
        return v;
    }
    private row(v: Version) { return { entryId: v.entryId, versionId: v.id, libraryRef: v.entry.libraryRef, round: v.round, content: v.content, referencePins: v.referencePins, digest: v.digest, published: !!v.publication, createdAt: v.createdAt, justification: v.justification }; }
    async list(userId: string, page = 1, pageSize = 20, search = '') {
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || search.length > 200)
            throw new BadRequestException('Use supported library pagination/search');
        await this.risks.visibility(userId);
        const entries = await this.prisma.aiRiskLibraryEntry.findMany({ include: { versions: { where: { publication: { isNot: null } }, orderBy: { round: 'desc' }, take: 1, include: { publication: true, entry: true } } }, orderBy: { libraryRef: 'asc' } });
        const needle = search.trim().toLocaleLowerCase(), rows = entries.flatMap(e => e.versions.map(v => this.row(v))).filter(v => !needle || (v.libraryRef + ' ' + JSON.stringify(v.content)).toLocaleLowerCase().includes(needle));
        return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, readOnly: true };
    }
    async proposals(userId: string) {
        const a = await this.risks.visibility(userId);
        if (!a.actor.roles.some(r => ['AI_GOVERNANCE_OFFICER', 'dmo_admin', 'auditor'].includes(r)))
            throw new ForbiddenException('Governed library proposal visibility required');
        const rows = await this.prisma.aiRiskLibraryVersion.findMany({ where: { publication: { is: null } }, include: { entry: true, publication: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
        return rows.map(v => this.row(v));
    }
}
