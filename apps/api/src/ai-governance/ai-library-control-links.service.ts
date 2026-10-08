import { AiCategoryControlsService } from './ai-category-controls.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiRiskLibraryService } from './ai-risk-library.service';
import { AiControlDomainsService } from './ai-control-domains.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
@Injectable()
export class AiLibraryControlLinksService {
    constructor(private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService, private readonly library: AiRiskLibraryService, private readonly controls: AiControlDomainsService, private readonly audit: AuditService, private readonly categories: AiCategoryControlsService) { }
    private async operator(tx: Prisma.TransactionClient, userId: string, review = false) { const actor = await this.authorization.authorize(userId, review ? 'airs.library.import' : 'refdata.propose.ai', tx); if (review)
        await this.authorization.authorize(userId, 'refdata.publish', tx); if (!actor.roles.includes(review ? 'dmo_admin' : 'AI_GOVERNANCE_OFFICER'))
        throw new ForbiddenException('Governed library control-link authority required'); return actor; }
    private digest(v: {
        libraryVersionId: string;
        controlPins: unknown;
        categoryMappingVersionId?: string | null;
    }) { return governanceDigest({ libraryVersionId: v.libraryVersionId, controlPins: v.controlPins, ...(v.categoryMappingVersionId ? { categoryMappingVersionId: v.categoryMappingVersionId } : {}) }); }
    async context(userId: string, id: string) { const permissions = await this.library.lookups(userId); const version = await this.prisma.aiRiskLibraryVersion.findUnique({ where: { id }, include: { publication: true, entry: true } }); if (!version?.publication)
        throw new NotFoundException('Published library version not found'); const versions = await this.prisma.aiLibraryControlLinkVersion.findMany({ where: { libraryVersionId: id }, include: { review: true }, orderBy: { round: 'desc' }, take: 100 }); let categoryMapping: null | {
        id: string;
        controlPins: Prisma.JsonValue;
    } = null, categoryIssue = false; try {
        categoryMapping = await this.categories.current(this.prisma, String((version.content as Record<string, unknown>)['risk_category']));
    }
    catch (e) {
        if (!(e instanceof ConflictException))
            throw e;
        categoryIssue = true;
    } return { categoryMapping, categoryIssue, versions, latestRound: versions[0]?.round ?? 0, canPropose: permissions.canPropose, canReview: permissions.canPublish, controls: (await this.controls.list(userId)).rows }; }
    async propose(userId: string, id: string, dto: {
        expectedRound: number;
        controlVersionIds: string[];
        categoryMappingVersionId?: string;
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        if (!Number.isInteger(dto.expectedRound) || dto.expectedRound < 0)
            throw new BadRequestException('Current control-link round required');
        return governanceTransaction(this.prisma, async (tx) => {
            await this.operator(tx, userId);
            const libraryVersion = await this.library.publishedVersion(tx, id);
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-library-control-links'),hashtext(${id}))`;
            const latest = await tx.aiLibraryControlLinkVersion.findFirst({ where: { libraryVersionId: id }, orderBy: { round: 'desc' } });
            if ((latest?.round ?? 0) !== dto.expectedRound)
                throw new ConflictException('Library control-link round changed');
            let ids = dto.controlVersionIds;
            if (dto.categoryMappingVersionId) {
                if (ids.length)
                    throw new BadRequestException('Category derivation cannot override control selection');
                const category = String((libraryVersion.content as Record<string, unknown>)['risk_category']), mapping = await this.categories.current(tx, category, dto.categoryMappingVersionId);
                if (!mapping)
                    throw new ConflictException('Approved category mapping required');
                const categoryPin = (libraryVersion.referencePins as Record<string, {
                    versionId: string;
                    code: string;
                }>)['risk_category'];
                if (governanceDigest(categoryPin) !== governanceDigest(mapping.categoryPin))
                    throw new ConflictException('Library category reference changed');
                ids = (mapping.controlPins as Array<{
                    versionId: string;
                }>).map(p => p.versionId);
            }
            const controlPins = await this.controls.pins(tx, ids), evidenceIds = await governanceEvidence(tx, dto.evidenceIds), digest = this.digest({ libraryVersionId: id, controlPins, categoryMappingVersionId: dto.categoryMappingVersionId });
            const v = await tx.aiLibraryControlLinkVersion.create({ data: { libraryVersionId: id, categoryMappingVersionId: dto.categoryMappingVersionId, round: dto.expectedRound + 1, controlPins: controlPins as unknown as Prisma.InputJsonArray, digest, proposedBy: userId, justification, evidenceIds } });
            await this.audit.logRequired({ actor: userId, action: 'airs.library.controls.propose', entityType: 'ai_library_control_link', entityId: v.id, metadata: { libraryVersionId: id, digest, count: controlPins.length, justification, evidenceIds } }, tx);
            return v;
        });
    }
    async review(userId: string, id: string, dto: {
        outcome: string;
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) {
        const justification = governanceText(dto.justification);
        if (!['approve', 'return'].includes(dto.outcome))
            throw new BadRequestException('Approve or return required');
        return governanceTransaction(this.prisma, async (tx) => { const actor = await this.operator(tx, userId, true); const v = await tx.aiLibraryControlLinkVersion.findUnique({ where: { id }, include: { review: true } }); if (!v)
            throw new NotFoundException('Library control-link proposal not found'); await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-library-control-links'),hashtext(${v.libraryVersionId}))`; const latest = await tx.aiLibraryControlLinkVersion.findFirst({ where: { libraryVersionId: v.libraryVersionId }, orderBy: { round: 'desc' } }); if (v.review || latest?.id !== id || v.digest !== dto.expectedDigest)
            throw new ConflictException('Review only latest pending control-link proposal'); if (v.proposedBy === userId)
            throw new ForbiddenException('Independent library control-link reviewer required'); if (dto.outcome === 'approve') {
            const lv = await this.library.publishedVersion(tx, v.libraryVersionId);
            if (v.categoryMappingVersionId)
                await this.categories.current(tx, String((lv.content as Record<string, unknown>)['risk_category']), v.categoryMappingVersionId);
            await this.controls.verify(tx, v.controlPins);
            if (this.digest(v) !== v.digest)
                throw new ConflictException('Control-link integrity differs');
        } const evidenceIds = await governanceEvidence(tx, dto.evidenceIds); await governanceEvidence(tx, v.evidenceIds); const r = await tx.aiLibraryControlLinkReview.create({ data: { versionId: id, outcome: dto.outcome, actorId: userId, justification, evidenceIds } }); await this.audit.logRequired({ actor: userId, action: 'airs.library.controls.review', entityType: 'ai_library_control_link', entityId: id, metadata: { outcome: dto.outcome, digest: v.digest, justification, evidenceIds } }, tx); return r; });
    }
    async suggestions(tx: Prisma.TransactionClient, libraryVersionId: string) { const v = await tx.aiLibraryControlLinkVersion.findFirst({ where: { libraryVersionId, review: { is: { outcome: 'approve' } } }, include: { review: true }, orderBy: { round: 'desc' } }); if (!v)
        return null; if (v.categoryMappingVersionId) {
        const lv = await tx.aiRiskLibraryVersion.findUniqueOrThrow({ where: { id: libraryVersionId } });
        await this.categories.current(tx, String((lv.content as Record<string, unknown>)['risk_category']), v.categoryMappingVersionId);
    } if (this.digest(v) !== v.digest)
        throw new ConflictException('Library control-link integrity differs'); await this.controls.verify(tx, v.controlPins); await governanceEvidence(tx, v.evidenceIds); await governanceEvidence(tx, v.review!.evidenceIds); return { mappingVersionId: v.id, digest: v.digest, controlPins: v.controlPins, suggestionsOnly: true }; }
}
