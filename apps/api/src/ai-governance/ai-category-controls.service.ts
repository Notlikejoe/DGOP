import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from './ai-authorization.service';
import { AiControlDomainsService } from './ai-control-domains.service';
import { governanceDigest, governanceEvidence, governanceText, governanceTransaction } from './ai-governance-ledger';
@Injectable()
export class AiCategoryControlsService {
    constructor(private readonly db: PrismaService, private readonly auth: AiAuthorizationService, private readonly controls: AiControlDomainsService, private readonly audit: AuditService) { }
    private async actor(tx: Prisma.TransactionClient, userId: string, review = false) { const a = await this.auth.authorize(userId, review ? 'airs.library.import' : 'refdata.propose.ai', tx); if (review)
        await this.auth.authorize(userId, 'refdata.publish', tx); if (!a.roles.includes(review ? 'dmo_admin' : 'AI_GOVERNANCE_OFFICER'))
        throw new ForbiddenException('Governed category mapping authority required'); return a; }
    async category(tx: Prisma.TransactionClient, code: string) { const now = new Date(), versions = await tx.governedReferenceVersion.findMany({ where: { listCode: 'R_RISKCAT', state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 }); const v = versions.length === 1 ? versions[0] : null, value = v?.values.find(x => x.code === code); if (!v || !value)
        throw new ConflictException('Select one current published risk category'); await tx.$queryRaw `SELECT id FROM governed_reference_versions WHERE id=${v.id} FOR SHARE`; return { listCode: 'R_RISKCAT', versionId: v.id, code: value.code, labelEn: value.labelEn, labelAr: value.labelAr }; }
    async current(tx: Prisma.TransactionClient, code: string, expectedId?: string) { const v = await tx.aiCategoryControlMappingVersion.findFirst({ where: { categoryCode: code, review: { is: { outcome: 'approve' } } }, include: { review: true }, orderBy: { round: 'desc' } }); if (!v)
        return null; if (expectedId && expectedId !== v.id)
        throw new ConflictException('Category mapping publication changed'); const categoryPin = await this.category(tx, code); if (governanceDigest(categoryPin) !== governanceDigest(v.categoryPin) || governanceDigest({ categoryPin: v.categoryPin, controlPins: v.controlPins }) !== v.digest)
        throw new ConflictException('Category mapping pins changed'); await this.controls.verify(tx, v.controlPins); await governanceEvidence(tx, v.evidenceIds); await governanceEvidence(tx, v.review!.evidenceIds); return v; }
    async context(userId: string) { const a = await this.auth.authorizeAny(userId, ['case.view.airs.own', 'case.view.airs.org', 'case.view.airs.all']), now = new Date(); const categories = await this.db.governedReferenceVersion.findMany({ where: { listCode: 'R_RISKCAT', state: 'published', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { values: true }, take: 2 }); const grants = await this.db.rolePermission.findMany({ where: { role: { is: { code: { in: a.roles }, isActive: true, deletedAt: null } } }, include: { permission: true } }); const holds = (code: string) => grants.some(g => g.permission.resource + '.' + g.permission.action === code), administratorOverride = false; return { categories: categories.length === 1 ? categories[0].values.map(v => ({ code: v.code, labelEn: v.labelEn, labelAr: v.labelAr })) : [], controls: (await this.controls.list(userId)).rows, versions: await this.db.aiCategoryControlMappingVersion.findMany({ include: { review: true }, orderBy: [{ categoryCode: 'asc' }, { round: 'desc' }] }), administratorOverride, canPropose: administratorOverride || !a.roles.includes('auditor') && a.roles.includes('AI_GOVERNANCE_OFFICER') && holds('refdata.propose.ai'), canReview: administratorOverride || !a.roles.includes('auditor') && a.roles.includes('dmo_admin') && holds('airs.library.import') && holds('refdata.publish'), suggestionsOnly: true }; }
    async propose(userId: string, code: string, dto: {
        expectedRound: number;
        controlVersionIds: string[];
        justification: string;
        evidenceIds: string[];
    }) { const justification = governanceText(dto.justification); if (!Number.isInteger(dto.expectedRound) || dto.expectedRound < 0)
        throw new BadRequestException('Current category mapping round required'); return governanceTransaction(this.db, async (tx) => { await this.actor(tx, userId); await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-category-controls'),hashtext(${code}))`; const latest = await tx.aiCategoryControlMappingVersion.findFirst({ where: { categoryCode: code }, orderBy: { round: 'desc' } }); if ((latest?.round ?? 0) !== dto.expectedRound)
        throw new ConflictException('Category mapping round changed'); const categoryPin = await this.category(tx, code), controlPins = await this.controls.pins(tx, dto.controlVersionIds), evidenceIds = await governanceEvidence(tx, dto.evidenceIds), digest = governanceDigest({ categoryPin, controlPins }); const v = await tx.aiCategoryControlMappingVersion.create({ data: { categoryCode: code, round: dto.expectedRound + 1, categoryPin, controlPins: controlPins as unknown as Prisma.InputJsonArray, digest, proposedBy: userId, justification, evidenceIds } }); await this.audit.logRequired({ actor: userId, action: 'ai.category.controls.propose', entityType: 'ai_category_control_mapping', entityId: v.id, metadata: { categoryCode: code, digest, justification, evidenceIds } }, tx); return v; }); }
    async review(userId: string, id: string, dto: {
        outcome: string;
        expectedDigest: string;
        justification: string;
        evidenceIds: string[];
    }) { const justification = governanceText(dto.justification); if (!['approve', 'return'].includes(dto.outcome))
        throw new BadRequestException('Approve or return required'); return governanceTransaction(this.db, async (tx) => { const actor = await this.actor(tx, userId, true); const v = await tx.aiCategoryControlMappingVersion.findUnique({ where: { id }, include: { review: true } }); if (!v)
        throw new NotFoundException('Category mapping not found'); await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('ai-category-controls'),hashtext(${v.categoryCode}))`; const latest = await tx.aiCategoryControlMappingVersion.findFirst({ where: { categoryCode: v.categoryCode }, orderBy: { round: 'desc' } }); if (v.review || latest?.id !== id || v.digest !== dto.expectedDigest)
        throw new ConflictException('Review latest pending category mapping'); if (v.proposedBy === userId)
        throw new ForbiddenException('Independent category mapping reviewer required'); if (dto.outcome === 'approve') {
        if (governanceDigest(await this.category(tx, v.categoryCode)) !== governanceDigest(v.categoryPin) || governanceDigest({ categoryPin: v.categoryPin, controlPins: v.controlPins }) !== v.digest)
            throw new ConflictException('Category mapping integrity changed');
        await this.controls.verify(tx, v.controlPins);
    } await governanceEvidence(tx, v.evidenceIds); const evidenceIds = await governanceEvidence(tx, dto.evidenceIds); const r = await tx.aiCategoryControlMappingReview.create({ data: { versionId: id, outcome: dto.outcome, actorId: userId, justification, evidenceIds } }); await this.audit.logRequired({ actor: userId, action: 'ai.category.controls.review', entityType: 'ai_category_control_mapping', entityId: id, metadata: { outcome: dto.outcome, digest: v.digest, justification, evidenceIds } }, tx); return r; }); }
}
