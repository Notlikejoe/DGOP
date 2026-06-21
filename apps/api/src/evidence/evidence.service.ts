import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEvidenceDto, EvidenceStatus, ReviewEvidenceDto } from './evidence.dto';
import {
  EvidenceEffectiveStatus,
  effectiveEvidenceStatus,
  isCurrentApproved,
} from './evidence-status';

/** Per-specification evidence rollup consumed by the scoring engine. */
export interface SpecEvidenceRollup {
  total: number;
  counts: Record<EvidenceEffectiveStatus, number>;
  hasCurrentApproved: boolean;
  latestApprovedAt: Date | null;
  nearestExpiry: Date | null;
  /** submittedAt of the oldest still-pending (submitted/under_review) record. */
  oldestPendingAt: Date | null;
}

function emptyCounts(): Record<EvidenceEffectiveStatus, number> {
  return {
    draft: 0,
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    revoked: 0,
  };
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const specSelect = {
  select: { id: true, code: true, nameEn: true, nameAr: true },
};

@Injectable()
export class EvidenceService {
  private readonly storageDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const configured = process.env.EVIDENCE_STORAGE_DIR || 'storage/evidence';
    this.storageDir = isAbsolute(configured) ? configured : join(process.cwd(), configured);
    if (!existsSync(this.storageDir)) mkdirSync(this.storageDir, { recursive: true });
  }

  /** Adds a derived `effectiveStatus` using the shared helper (approved + past expiry -> expired). */
  private decorate<T extends { status: EvidenceStatus; expiryDate: Date | null }>(e: T) {
    return { ...e, effectiveStatus: effectiveEvidenceStatus(e) as EvidenceStatus };
  }

  /**
   * Aggregates evidence per specification in a single query for the scoring engine.
   * Returns a map keyed by specId (specs with no evidence are simply absent).
   */
  async rollupForSpecs(specIds: string[]): Promise<Map<string, SpecEvidenceRollup>> {
    const result = new Map<string, SpecEvidenceRollup>();
    if (specIds.length === 0) return result;
    const rows = await this.prisma.ndiEvidence.findMany({
      where: { specId: { in: specIds }, deletedAt: null },
      select: {
        specId: true,
        status: true,
        expiryDate: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });
    const now = new Date();
    for (const r of rows) {
      let roll = result.get(r.specId);
      if (!roll) {
        roll = {
          total: 0,
          counts: emptyCounts(),
          hasCurrentApproved: false,
          latestApprovedAt: null,
          nearestExpiry: null,
          oldestPendingAt: null,
        };
        result.set(r.specId, roll);
      }
      const eff = effectiveEvidenceStatus(r, now);
      roll.total += 1;
      roll.counts[eff] += 1;
      if (isCurrentApproved(r, now)) {
        roll.hasCurrentApproved = true;
        if (r.reviewedAt && (!roll.latestApprovedAt || r.reviewedAt > roll.latestApprovedAt)) {
          roll.latestApprovedAt = r.reviewedAt;
        }
        if (r.expiryDate && (!roll.nearestExpiry || r.expiryDate < roll.nearestExpiry)) {
          roll.nearestExpiry = r.expiryDate;
        }
      }
      if (eff === 'submitted' || eff === 'under_review') {
        const at = r.submittedAt ?? null;
        if (at && (!roll.oldestPendingAt || at < roll.oldestPendingAt)) {
          roll.oldestPendingAt = at;
        }
      }
    }
    return result;
  }

  async listBySpec(specId: string) {
    const rows = await this.prisma.ndiEvidence.findMany({
      where: { specId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.decorate(r));
  }

  async get(id: string) {
    const e = await this.prisma.ndiEvidence.findFirst({
      where: { id, deletedAt: null },
      include: { spec: specSelect },
    });
    if (!e) throw new NotFoundException('evidence not found');
    return this.decorate(e);
  }

  private async requireSpec(specId: string) {
    const spec = await this.prisma.ndiSpecification.findFirst({
      where: { id: specId, deletedAt: null },
    });
    if (!spec) throw new BadRequestException('NDI specification not found');
    return spec;
  }

  async create(dto: CreateEvidenceDto, file: UploadedFile, actor: string) {
    if (!file) throw new BadRequestException('A file is required');
    await this.requireSpec(dto.specId);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const safeExt = (file.originalname.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
    const storedName = `${randomUUID()}${safeExt}`;
    await writeFile(join(this.storageDir, storedName), file.buffer);

    const submitNow = dto.submit === 'true' || dto.submit === '1';
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException('Invalid expiry date');
    }

    const evidence = await this.prisma.ndiEvidence.create({
      data: {
        specId: dto.specId,
        title: dto.title,
        descriptionEn: dto.descriptionEn ?? null,
        status: submitNow ? 'submitted' : 'draft',
        fileName: storedName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        submittedBy: actor,
        submittedAt: submitNow ? new Date() : null,
        expiryDate,
      },
    });
    await this.audit.log({
      actor,
      action: submitNow ? 'evidence.submit' : 'evidence.create',
      entityType: 'evidence',
      entityId: evidence.id,
      metadata: { specId: dto.specId, sha256, originalName: file.originalname },
    });
    return this.decorate(evidence);
  }

  async submit(id: string, actor: string) {
    const e = await this.get(id);
    if (e.status !== 'draft' && e.status !== 'rejected') {
      throw new BadRequestException('Only draft or rejected evidence can be submitted');
    }
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: { status: 'submitted', submittedBy: actor, submittedAt: new Date() },
    });
    await this.audit.log({
      actor,
      action: 'evidence.submit',
      entityType: 'evidence',
      entityId: id,
    });
    return this.decorate(updated);
  }

  async review(id: string, dto: ReviewEvidenceDto, actor: string) {
    const e = await this.get(id);
    if (e.status !== 'submitted' && e.status !== 'under_review') {
      throw new BadRequestException('Only submitted evidence can be reviewed');
    }
    // Separation of duties: the submitter cannot review their own evidence.
    if (e.submittedBy === actor) {
      throw new ForbiddenException('You cannot review evidence you submitted');
    }
    const status: EvidenceStatus = dto.decision === 'approve' ? 'approved' : 'rejected';
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: {
        status,
        reviewedBy: actor,
        reviewedAt: new Date(),
        reviewComment: dto.comment ?? null,
      },
    });
    await this.audit.log({
      actor,
      action: `evidence.${dto.decision}`,
      entityType: 'evidence',
      entityId: id,
      metadata: { comment: dto.comment ?? null },
    });
    return this.decorate(updated);
  }

  async revoke(id: string, actor: string) {
    const e = await this.get(id);
    if (e.status !== 'approved') {
      throw new BadRequestException('Only approved evidence can be revoked');
    }
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: { status: 'revoked', reviewedBy: actor, reviewedAt: new Date() },
    });
    await this.audit.log({
      actor,
      action: 'evidence.revoke',
      entityType: 'evidence',
      entityId: id,
    });
    return this.decorate(updated);
  }

  async remove(id: string, actor: string) {
    const e = await this.get(id);
    await this.prisma.ndiEvidence.update({ where: { id }, data: { deletedAt: new Date() } });
    // Best-effort file cleanup; never fail the request on a missing file.
    try {
      await unlink(join(this.storageDir, e.fileName));
    } catch {
      /* ignore */
    }
    await this.audit.log({
      actor,
      action: 'evidence.delete',
      entityType: 'evidence',
      entityId: id,
    });
    return { success: true };
  }

  /** Resolves the absolute file path for download and records the access in the audit trail. */
  async fileFor(id: string, actor: string) {
    const e = await this.get(id);
    const path = join(this.storageDir, e.fileName);
    if (!existsSync(path)) throw new NotFoundException('evidence file not found');
    await this.audit.log({
      actor,
      action: 'evidence.download',
      entityType: 'evidence',
      entityId: id,
    });
    return { path, originalName: e.originalName, mimeType: e.mimeType };
  }
}
