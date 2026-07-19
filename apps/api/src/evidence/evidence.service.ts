import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
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
  select: {
    id: true,
    code: true,
    nameEn: true,
    nameAr: true,
    ownerPersonId: true,
    owner: { select: { id: true, email: true, userId: true, fullNameEn: true, fullNameAr: true } },
  },
};

const BROAD_EVIDENCE_ROLES = new Set(['system_admin', 'dmo_admin', 'auditor']);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

@Injectable()
export class EvidenceService {
  private readonly storageDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const configured = process.env.EVIDENCE_STORAGE_DIR || 'storage/evidence';
    this.storageDir = isAbsolute(configured) ? resolve(configured) : resolve(process.cwd(), configured);
    if (!existsSync(this.storageDir)) mkdirSync(this.storageDir, { recursive: true });
  }

  /** Adds a derived `effectiveStatus` using the shared helper (approved + past expiry -> expired). */
  private decorate<T extends { status: EvidenceStatus; expiryDate: Date | null }>(e: T) {
    return { ...e, effectiveStatus: effectiveEvidenceStatus(e) as EvidenceStatus };
  }

  private hasBroadEvidenceAccess(actor: Pick<AuthUser, 'roles'>): boolean {
    return actor.roles.some((role) => BROAD_EVIDENCE_ROLES.has(role));
  }

  private async actorPersonId(actor: Pick<AuthUser, 'id' | 'email'>): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ userId: actor.id }, { email: actor.email }],
      },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  private async scopedEvidenceWhere(
    actor: AuthUser,
    baseWhere: Prisma.NdiEvidenceWhereInput,
  ): Promise<Prisma.NdiEvidenceWhereInput> {
    if (this.hasBroadEvidenceAccess(actor)) return { ...baseWhere, deletedAt: null };
    const personId = await this.actorPersonId(actor);
    const visible: Prisma.NdiEvidenceWhereInput[] = [
      { submittedBy: actor.email },
      { reviewedBy: actor.email },
    ];
    if (personId) visible.push({ spec: { ownerPersonId: personId } });
    return { AND: [{ ...baseWhere, deletedAt: null }, { OR: visible }] };
  }

  private assertEvidenceOwnership(actor: AuthUser, evidence: { submittedBy: string }) {
    if (this.hasBroadEvidenceAccess(actor) || evidence.submittedBy === actor.email) return;
    throw new ForbiddenException('Only the submitter or evidence administrator can change this evidence');
  }

  private actorEmail(actor: AuthUser): string {
    return actor.email;
  }

  private storagePath(fileName: string): string {
    const target = resolve(this.storageDir, fileName);
    const rel = relative(this.storageDir, target);
    if (!fileName || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new NotFoundException('evidence file not found');
    }
    return target;
  }

  private assertFileContentMatchesMime(file: UploadedFile): void {
    const startsWith = (signature: Buffer | string) =>
      typeof signature === 'string'
        ? file.buffer.subarray(0, signature.length).toString('utf8') === signature
        : file.buffer.subarray(0, signature.length).equals(signature);
    const textLike = () => !file.buffer.includes(0);
    const officePackage = (requiredPart: string) =>
      startsWith('PK') &&
      file.buffer.includes(Buffer.from('[Content_Types].xml', 'utf8')) &&
      file.buffer.includes(Buffer.from(requiredPart, 'utf8'));
    const valid =
      (file.mimetype === 'application/pdf' && startsWith('%PDF-')) ||
      (file.mimetype === 'image/png' && startsWith(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
      (file.mimetype === 'image/jpeg' && startsWith(Buffer.from([0xff, 0xd8, 0xff]))) ||
      ((file.mimetype === 'text/plain' || file.mimetype === 'text/csv') && textLike()) ||
      (file.mimetype === 'application/msword' && startsWith(OLE_MAGIC)) ||
      (file.mimetype === 'application/vnd.ms-excel' && startsWith(OLE_MAGIC)) ||
      (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
        officePackage('word/document.xml')) ||
      (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
        officePackage('xl/workbook.xml'));
    if (!valid) throw new BadRequestException('File content does not match the declared file type');
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

  async listBySpec(specId: string, actor: AuthUser) {
    const rows = await this.prisma.ndiEvidence.findMany({
      where: await this.scopedEvidenceWhere(actor, { specId }),
      orderBy: { createdAt: 'desc' },
    });
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.read_list',
      entityType: 'evidence',
      entityId: specId,
      metadata: { specId, count: rows.length, sensitiveRead: true },
    });
    return rows.map((r) => this.decorate(r));
  }

  async get(id: string, actor: AuthUser) {
    const e = await this.prisma.ndiEvidence.findFirst({
      where: await this.scopedEvidenceWhere(actor, { id }),
      include: { spec: specSelect },
    });
    if (!e) throw new NotFoundException('evidence not found');
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.read',
      entityType: 'evidence',
      entityId: id,
      metadata: {
        specId: e.specId,
        status: e.status,
        sha256: e.sha256,
        sensitiveRead: true,
      },
    });
    return this.decorate(e);
  }

  private async requireSpec(specId: string, actor: AuthUser) {
    const spec = await this.prisma.ndiSpecification.findFirst({
      where: { id: specId, deletedAt: null },
      select: { id: true, ownerPersonId: true },
    });
    if (!spec) throw new BadRequestException('NDI specification not found');
    if (this.hasBroadEvidenceAccess(actor)) return spec;
    const personId = await this.actorPersonId(actor);
    if (spec.ownerPersonId && spec.ownerPersonId === personId) return spec;
    throw new ForbiddenException('NDI specification is outside your evidence responsibility');
  }

  private async requireReviewAccess(id: string, actor: AuthUser) {
    const evidence = await this.get(id, actor);
    if (this.hasBroadEvidenceAccess(actor)) return evidence;
    const personId = await this.actorPersonId(actor);
    if (personId && evidence.spec?.ownerPersonId === personId) return evidence;
    throw new ForbiddenException('Only an assigned evidence reviewer can review this evidence');
  }

  async create(dto: CreateEvidenceDto, file: UploadedFile, actor: AuthUser) {
    if (!file) throw new BadRequestException('A file is required');
    await this.requireSpec(dto.specId, actor);
    this.assertFileContentMatchesMime(file);

    const submitNow = dto.submit === 'true' || dto.submit === '1';
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException('Invalid expiry date');
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const safeExt = (file.originalname.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
    const storedName = `${randomUUID()}${safeExt}`;
    const storedPath = this.storagePath(storedName);
    await writeFile(storedPath, file.buffer);

    let evidence;
    try {
      evidence = await this.prisma.ndiEvidence.create({
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
          submittedBy: this.actorEmail(actor),
          submittedAt: submitNow ? new Date() : null,
          expiryDate,
        },
      });
    } catch (error) {
      await unlink(storedPath).catch(() => undefined);
      throw error;
    }
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: submitNow ? 'evidence.submit' : 'evidence.create',
      entityType: 'evidence',
      entityId: evidence.id,
      metadata: { specId: dto.specId, sha256, originalName: file.originalname },
    });
    return this.decorate(evidence);
  }

  async submit(id: string, actor: AuthUser) {
    const e = await this.get(id, actor);
    this.assertEvidenceOwnership(actor, e);
    if (e.status !== 'draft' && e.status !== 'rejected') {
      throw new BadRequestException('Only draft or rejected evidence can be submitted');
    }
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: { status: 'submitted', submittedBy: this.actorEmail(actor), submittedAt: new Date() },
    });
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.submit',
      entityType: 'evidence',
      entityId: id,
    });
    return this.decorate(updated);
  }

  async review(id: string, dto: ReviewEvidenceDto, actor: AuthUser) {
    const e = await this.requireReviewAccess(id, actor);
    if (e.status !== 'submitted' && e.status !== 'under_review') {
      throw new BadRequestException('Only submitted evidence can be reviewed');
    }
    // Separation of duties: the submitter cannot review their own evidence.
    if (e.submittedBy === this.actorEmail(actor)) {
      throw new ForbiddenException('You cannot review evidence you submitted');
    }
    const status: EvidenceStatus = dto.decision === 'approve' ? 'approved' : 'rejected';
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: {
        status,
        reviewedBy: this.actorEmail(actor),
        reviewedAt: new Date(),
        reviewComment: dto.comment ?? null,
      },
    });
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: `evidence.${dto.decision}`,
      entityType: 'evidence',
      entityId: id,
      metadata: { comment: dto.comment ?? null },
    });
    return this.decorate(updated);
  }

  async revoke(id: string, actor: AuthUser) {
    const e = await this.requireReviewAccess(id, actor);
    if (e.status !== 'approved') {
      throw new BadRequestException('Only approved evidence can be revoked');
    }
    const updated = await this.prisma.ndiEvidence.update({
      where: { id },
      data: { status: 'revoked', reviewedBy: this.actorEmail(actor), reviewedAt: new Date() },
    });
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.revoke',
      entityType: 'evidence',
      entityId: id,
    });
    return this.decorate(updated);
  }

  async remove(id: string, actor: AuthUser) {
    const e = await this.get(id, actor);
    this.assertEvidenceOwnership(actor, e);
    await this.prisma.ndiEvidence.update({ where: { id }, data: { deletedAt: new Date() } });
    // Best-effort file cleanup; never fail the request on a missing file.
    try {
      await unlink(this.storagePath(e.fileName));
    } catch {
      /* ignore */
    }
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.delete',
      entityType: 'evidence',
      entityId: id,
    });
    return { success: true };
  }

  /** Resolves the absolute file path for download and records the access in the audit trail. */
  async fileFor(id: string, actor: AuthUser) {
    const e = await this.get(id, actor);
    const path = this.storagePath(e.fileName);
    if (!existsSync(path)) throw new NotFoundException('evidence file not found');
    await this.audit.log({
      actor: this.actorEmail(actor),
      action: 'evidence.download',
      entityType: 'evidence',
      entityId: id,
      metadata: {
        specId: e.specId,
        sha256: e.sha256,
        originalName: e.originalName,
        sensitiveRead: true,
      },
    });
    return { path, originalName: e.originalName, mimeType: e.mimeType };
  }
}
