import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiAuthorizationService } from '../ai-governance/ai-authorization.service';
import { AI_REGULATORY_LISTS, canonicalAiReference } from './ai-reference.catalog';
import { ProposeAiReferenceDto } from './ai-reference.dto';
import { isSystemAdministrator } from '../auth/system-admin';
function stable(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(stable);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
    return value;
}
export function referenceDigest(version: {
    listCode: string;
    version: number;
    sourceSha256: string | null;
    sourceLocator: string | null;
    values: unknown[];
}) {
    return createHash('sha256').update(JSON.stringify(stable({ listCode: version.listCode, version: version.version, sourceSha256: version.sourceSha256, sourceLocator: version.sourceLocator, values: version.values }))).digest('hex');
}
@Injectable()
export class AiReferencePublicationService {
    constructor(private readonly prisma: PrismaService, private readonly auth: AiAuthorizationService, private readonly audit: AuditService) { }
    private reason(value: string) { if (!value?.trim())
        throw new BadRequestException('Justification required'); }
    async review(userId: string, id: string) {
        await this.auth.authorizeRead(userId, ['refdata.propose.ai', 'refdata.approve.ai', 'refdata.publish']);
        const version = await this.prisma.governedReferenceVersion.findFirst({ where: { id, list: { ownerRoleCode: 'AI_GOVERNANCE_OFFICER' } }, include: { list: true, values: { orderBy: { code: 'asc' } } } });
        if (!version)
            throw new NotFoundException('AI reference version not found');
        return version;
    }
    private async lock(tx: Prisma.TransactionClient) {
        // Shared lock order for all reference writes avoids approval/publication races.
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(1832705421)`;
    }
    private async draft(tx: Prisma.TransactionClient, id: string) {
        await tx.$queryRaw `SELECT id FROM governed_reference_versions WHERE id = ${id} FOR UPDATE`;
        const version = await tx.governedReferenceVersion.findUnique({ where: { id }, include: { list: true, values: { orderBy: { code: 'asc' } } } });
        if (!version)
            throw new NotFoundException('Reference proposal not found');
        if (version.state !== 'draft' || version.list.ownerRoleCode !== 'AI_GOVERNANCE_OFFICER')
            throw new ConflictException('An AI draft proposal is required');
        canonicalAiReference(version.listCode);
        return version;
    }
    async propose(userId: string, listCode: string, dto: ProposeAiReferenceDto) {
        this.reason(dto.justification);
        let code: string;
        try {
            code = canonicalAiReference(listCode);
        }
        catch {
            throw new BadRequestException('Unknown AI reference list');
        }
        if (code !== listCode)
            throw new BadRequestException(`Propose changes through canonical list ${code}`);
        if (!dto.values?.length || new Set(dto.values.map(v => v.code)).size !== dto.values.length)
            throw new BadRequestException('Unique reference values required');
        return this.prisma.$transaction(async (tx) => {
            await this.lock(tx);
            await this.auth.authorize(userId, 'refdata.propose.ai', tx);
            const list = await tx.governedReferenceList.upsert({ where: { code }, create: { code, nameEn: dto.nameEn, nameAr: dto.nameAr, ownerRoleCode: 'AI_GOVERNANCE_OFFICER', regulatory: AI_REGULATORY_LISTS.has(code) }, update: {} });
            if (list.ownerRoleCode !== 'AI_GOVERNANCE_OFFICER')
                throw new ConflictException('Reference list belongs to another domain');
            const last = await tx.governedReferenceVersion.aggregate({ where: { listCode: code }, _max: { version: true } });
            const created = await tx.governedReferenceVersion.create({ data: { listCode: code, version: (last._max.version ?? 0) + 1, createdBy: userId, sourceSha256: dto.sourceSha256, sourceLocator: dto.sourceLocator,
                    values: { create: dto.values.map(v => ({ ...v, metadata: (v.metadata ?? {}) as Prisma.InputJsonValue })) } } });
            await this.audit.logRequired({ actor: userId, action: 'ai.refdata.proposed', entityType: 'governed_reference_version', entityId: created.id,
                metadata: { listCode: code, version: created.version, sourceSha256: dto.sourceSha256, values: dto.values, justification: dto.justification } }, tx);
            return created;
        });
    }
    async approve(userId: string, id: string, justification: string) {
        this.reason(justification);
        return this.prisma.$transaction(async (tx) => {
            await this.lock(tx);
            const actor = await this.auth.authorize(userId, 'refdata.approve.ai', tx);
            const version = await this.draft(tx, id);
            if (version.createdBy === userId)
                throw new ForbiddenException('The proposer cannot independently approve the proposal');
            if (!AI_REGULATORY_LISTS.has(version.listCode))
                throw new BadRequestException('This list does not require regulatory approval');
            const updated = await tx.governedReferenceVersion.update({ where: { id }, data: { approvedBy: userId, approvedAt: new Date(), approvalDigest: referenceDigest(version) } });
            await this.audit.logRequired({ actor: userId, action: 'ai.refdata.approved', entityType: 'governed_reference_version', entityId: id, metadata: { digest: updated.approvalDigest, justification } }, tx);
            return updated;
        });
    }
    async publish(userId: string, id: string, justification: string) {
        this.reason(justification);
        return this.prisma.$transaction(async (tx) => {
            await this.lock(tx);
            const actor = await this.auth.authorize(userId, 'refdata.publish', tx);
            const version = await this.draft(tx, id);
            if ((version.createdBy === userId || version.approvedBy === userId))
                throw new ForbiddenException('Publication requires an independent custodian');
            if (!version.values.length)
                throw new BadRequestException('An empty reference list cannot be published');
            if (AI_REGULATORY_LISTS.has(version.listCode)) {
                if (!version.approvedBy || !version.approvedAt || version.approvalDigest !== referenceDigest(version))
                    throw new ConflictException('Current regulatory content needs committee approval');
                await this.auth.authorize(version.approvedBy, 'refdata.approve.ai', tx);
            }
            const current = await tx.governedReferenceVersion.findFirst({ where: { listCode: version.listCode, state: 'published' } });
            if (current && current.version >= version.version)
                throw new ConflictException('A newer reference version is already published');
            const now = new Date();
            if (current)
                await tx.governedReferenceVersion.update({ where: { id: current.id }, data: { state: 'retired', effectiveTo: now } });
            const published = await tx.governedReferenceVersion.update({ where: { id }, data: { state: 'published', effectiveFrom: now,
                    ...(!AI_REGULATORY_LISTS.has(version.listCode) ? { approvedBy: userId, approvedAt: now } : {}) } });
            await this.audit.logRequired({ actor: userId, action: 'ai.refdata.published', entityType: 'governed_reference_version', entityId: id,
                metadata: { listCode: version.listCode, oldVersionId: current?.id ?? null, newVersionId: id, digest: referenceDigest(version), justification } }, tx);
            return published;
        });
    }
}
