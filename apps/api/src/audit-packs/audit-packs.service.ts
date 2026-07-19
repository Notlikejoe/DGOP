import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NdiAuditPackStatus, NdiEvidenceStatus, Prisma, TaskDecision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { ScoringService } from '../scoring/scoring.service';
import { CreateNdiAuditPackDto } from './audit-packs.dto';
import { buildManifest, packReadiness, sha256, zipStore, type ZipEntry } from './audit-packs.logic';

type StoredFile = { path: string; body: string };
type StoredPackPayload = {
  summary: Record<string, unknown>;
  files: StoredFile[];
};
const BROAD_AUDIT_PACK_ROLES = new Set(['system_admin', 'dmo_admin', 'auditor']);

const packSelect = {
  domain: { select: { id: true, code: true, shortCode: true, nameEn: true, nameAr: true } },
};

@Injectable()
export class AuditPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scoring: ScoringService,
  ) {}

  private hasBroadAuditPackAccess(actor: Pick<AuthUser, 'roles'>): boolean {
    return actor.roles.some((role) => BROAD_AUDIT_PACK_ROLES.has(role));
  }

  async list(actor: AuthUser) {
    return this.prisma.ndiAuditPack.findMany({
      where: this.hasBroadAuditPackAccess(actor) ? undefined : { requestedBy: actor.email },
      include: packSelect,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async readiness(actor: AuthUser, domainId?: string) {
    return this.buildBundle('preview', domainId, new Date(), false, actor);
  }

  async generate(dto: CreateNdiAuditPackDto, actor: AuthUser) {
    const code = await this.nextCode();
    const generatedAt = new Date();
    const bundle = await this.buildBundle(code, dto.domainId, generatedAt, true, actor);
    const zip = this.zipFromStored(bundle.stored, bundle.manifest);

    const pack = await this.prisma.ndiAuditPack.create({
      data: {
        code,
        scopeType: dto.domainId ? 'domain' : 'full',
        domainId: dto.domainId ?? null,
        status: NdiAuditPackStatus.generated,
        readinessScore: bundle.summary.readinessScore,
        specCount: bundle.summary.specCount,
        approvedEvidenceCount: bundle.summary.approvedEvidenceCount,
        gapCount: bundle.summary.gapCount,
        blockerCount: bundle.summary.blockerCount,
        manifestJson: bundle.manifest as unknown as Prisma.InputJsonValue,
        summaryJson: bundle.stored as unknown as Prisma.InputJsonValue,
        fileSha256: sha256(zip),
        generatedAt,
        requestedBy: actor.email,
      },
      include: packSelect,
    });
    await this.audit.log({
      actor: actor.email,
      action: 'ndi_audit_pack.generate',
      entityType: 'ndi_audit_pack',
      entityId: pack.id,
      metadata: { code, domainId: dto.domainId ?? null, fileSha256: pack.fileSha256 },
    });
    return pack;
  }

  async exportZip(id: string, actor: AuthUser) {
    const pack = await this.prisma.ndiAuditPack.findFirst({
      where: { id, ...(this.hasBroadAuditPackAccess(actor) ? {} : { requestedBy: actor.email }) },
      include: packSelect,
    });
    if (!pack) throw new NotFoundException('ndi_audit_pack not found');
    if (pack.status !== NdiAuditPackStatus.generated) throw new BadRequestException('Audit pack is not ready for download');
    const zip = this.zipFromStored(pack.summaryJson as unknown as StoredPackPayload, pack.manifestJson as Record<string, unknown>);
    await this.audit.log({
      actor: actor.email,
      action: 'ndi_audit_pack.download',
      entityType: 'ndi_audit_pack',
      entityId: pack.id,
      metadata: { code: pack.code, fileSha256: sha256(zip) },
    });
    return {
      filename: `${pack.code}.zip`,
      contentType: 'application/zip',
      body: zip,
    };
  }

  private zipFromStored(stored: StoredPackPayload, manifest: unknown): Buffer {
    const files: ZipEntry[] = [
      { path: 'manifest.json', body: JSON.stringify(manifest, null, 2) },
      ...stored.files,
    ];
    return zipStore(files);
  }

  private async nextCode(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.ndiAuditPack.count({
      where: { code: { startsWith: `NDI-PACK-${day}` } },
    });
    return `NDI-PACK-${day}-${String(count + 1).padStart(3, '0')}`;
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

  private async specVisibilityWhere(
    actor: AuthUser,
    domainId?: string,
  ): Promise<{ where: Prisma.NdiSpecificationWhereInput; personId: string | null }> {
    const base: Prisma.NdiSpecificationWhereInput = {
      deletedAt: null,
      isActive: true,
      ...(domainId ? { domainId } : {}),
    };
    if (this.hasBroadAuditPackAccess(actor)) return { where: base, personId: null };
    const personId = await this.actorPersonId(actor);
    const visible: Prisma.NdiSpecificationWhereInput[] = [
      {
        evidence: {
          some: {
            deletedAt: null,
            OR: [{ submittedBy: actor.email }, { reviewedBy: actor.email }],
          },
        },
      },
    ];
    if (personId) visible.push({ ownerPersonId: personId });
    return { where: { AND: [base, { OR: visible }] }, personId };
  }

  private async buildBundle(
    packCode: string,
    domainId: string | undefined,
    generatedAt: Date,
    includePayload: boolean,
    actor: AuthUser,
  ) {
    if (domainId) {
      const exists = await this.prisma.ndiDomain.findUnique({ where: { id: domainId }, select: { id: true } });
      if (!exists) throw new BadRequestException('NDI domain not found');
    }
    const [detail, gaps, specs, workflowDecisions, hooks] = await Promise.all([
      domainId ? this.scoring.domainDetail(actor, domainId) : this.scoring.readiness(actor),
      this.scoring.gaps(actor, domainId ? { domainId } : undefined),
      this.specifications(actor, domainId),
      this.workflowDecisions(actor),
      this.complianceHooks(actor),
    ]);

    const specRows = specs.map((spec) => ({
      id: spec.id,
      code: spec.code,
      domain: spec.domain.shortCode ?? spec.domain.code,
      nameEn: spec.nameEn,
      type: spec.type,
      maturityLevel: spec.maturityLevel,
      owner: spec.owner?.fullNameEn ?? null,
      evidence: spec.evidence.map((evidence) => ({
        id: evidence.id,
        title: evidence.title,
        originalName: evidence.originalName,
        sha256: evidence.sha256,
        status: evidence.status,
        reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
        expiryDate: evidence.expiryDate?.toISOString() ?? null,
      })),
    }));
    const approvedEvidenceCount = specRows.reduce((sum, spec) => sum + spec.evidence.length, 0);
    const score = 'overall' in detail ? detail.overall.score : detail.score;
    const specCount = 'overall' in detail ? detail.overall.specCount : detail.specCount;
    const blockerCount = gaps.filter((gap) => gap.severity === 'high').length;
    const readiness = packReadiness(score, blockerCount);
    const scope = domainId ? `domain:${domainId}` : 'full';
    const summary = {
      packCode,
      scope,
      status: readiness,
      readinessScore: score,
      specCount,
      approvedEvidenceCount,
      gapCount: gaps.length,
      blockerCount,
      generatedAt: generatedAt.toISOString(),
      frameworks: ['SDAIA NDI', 'NCA ECC-2:2024', 'PDPL 2023', 'DGOP ABAC', 'Data Quality', 'Training & Certification', 'Stewardship'],
    };
    const baseFiles: ZipEntry[] = [
      { path: 'summary.json', body: JSON.stringify(summary, null, 2) },
      { path: 'specifications.json', body: JSON.stringify(specRows, null, 2) },
      { path: 'gaps.json', body: JSON.stringify(gaps, null, 2) },
      { path: 'workflow-decisions.json', body: JSON.stringify(workflowDecisions, null, 2) },
      { path: 'cross-domain-hooks.json', body: JSON.stringify(hooks, null, 2) },
    ];
    const manifest = buildManifest(
      {
        packCode,
        scope,
        generatedAt: generatedAt.toISOString(),
        frameworks: summary.frameworks,
        evidence: specRows.flatMap((spec) =>
          spec.evidence.map((evidence) => ({
            id: evidence.id,
            specCode: spec.code,
            originalName: evidence.originalName,
            sha256: evidence.sha256,
            status: evidence.status,
            expiryDate: evidence.expiryDate,
          })),
        ),
      },
      baseFiles,
    );
    return {
      summary,
      manifest,
      stored: {
        summary,
        files: includePayload
          ? baseFiles.map((file) => ({ path: file.path, body: String(file.body) }))
          : [],
      } satisfies StoredPackPayload,
    };
  }

  private async specifications(actor: AuthUser, domainId?: string) {
    const { where, personId } = await this.specVisibilityWhere(actor, domainId);
    const evidenceWhere: Prisma.NdiEvidenceWhereInput = this.hasBroadAuditPackAccess(actor)
      ? { deletedAt: null, status: NdiEvidenceStatus.approved }
      : {
          AND: [
            { deletedAt: null, status: NdiEvidenceStatus.approved },
            {
              OR: [
                { submittedBy: actor.email },
                { reviewedBy: actor.email },
                ...(personId ? [{ spec: { ownerPersonId: personId } }] : []),
              ],
            },
          ],
        };
    return this.prisma.ndiSpecification.findMany({
      where,
      orderBy: [{ domain: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameEn: true,
        type: true,
        maturityLevel: true,
        domain: { select: { code: true, shortCode: true, nameEn: true } },
        owner: { select: { fullNameEn: true, email: true } },
        evidence: {
          where: evidenceWhere,
          orderBy: { reviewedAt: 'desc' },
          select: {
            id: true,
            title: true,
            originalName: true,
            sha256: true,
            status: true,
            reviewedAt: true,
            expiryDate: true,
          },
        },
      },
    });
  }

  private async workflowDecisions(actor: AuthUser) {
    const rows = await this.prisma.workflowTask.findMany({
      where: {
        decision: { in: [TaskDecision.approved, TaskDecision.rejected] },
        ...(this.hasBroadAuditPackAccess(actor)
          ? {}
          : {
              OR: [
                { assigneeUserId: actor.id },
                { assigneeRoleCode: { in: actor.roles } },
                { events: { some: { actor: actor.email } } },
                { case: { is: { createdBy: actor.email } } },
              ],
            }),
      },
      orderBy: { completedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        decision: true,
        decisionComment: true,
        completedAt: true,
        case: { select: { code: true, title: true, type: true } },
      },
    });
    return rows.map((row) => ({
      taskId: row.id,
      caseCode: row.case.code,
      caseType: row.case.type,
      task: row.title,
      decision: row.decision,
      comment: row.decisionComment,
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }

  private async complianceHooks(actor: AuthUser) {
    if (!this.hasBroadAuditPackAccess(actor)) {
      return {
        scoped: true,
        note: 'Cross-domain compliance hook totals are available in admin and auditor audit packs only.',
      };
    }
    const [dq, masking, abac, training, stewardship, privacy, sharing] = await Promise.all([
      this.prisma.dataQualityIssue.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.maskingPolicy.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.abacDecisionLog.count(),
      this.prisma.trainingAssignment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.stewardshipAssignment.count({ where: { deletedAt: null, isActive: true, approvalStatus: 'approved' } }),
      this.prisma.privacyDpia.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.dataSharingRequest.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    return {
      ncaEcc: { maskingPoliciesActive: masking, abacDecisionsLogged: abac },
      pdpl: Object.fromEntries(privacy.map((row) => [row.status, row._count._all])),
      dataQuality: Object.fromEntries(dq.map((row) => [row.status, row._count._all])),
      trainingCertification: Object.fromEntries(training.map((row) => [row.status, row._count._all])),
      stewardship: { approvedAssignments: stewardship },
      dataSharing: Object.fromEntries(sharing.map((row) => [row.status, row._count._all])),
    };
  }
}
