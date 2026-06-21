import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceService, SpecEvidenceRollup } from '../evidence/evidence.service';
import {
  GAP_SEVERITY,
  GapType,
  detectGaps,
  maturityBand,
  readinessPct,
  specScore,
  specWeight,
} from './scoring.logic';

export interface DomainReadiness {
  domainId: string;
  code: string;
  shortCode: string | null;
  nameEn: string;
  nameAr: string;
  specCount: number;
  satisfiedCount: number;
  score: number;
  maturity: string;
}

export interface ReadinessOverview {
  overall: {
    score: number;
    maturity: string;
    specCount: number;
    satisfiedCount: number;
  };
  domains: DomainReadiness[];
  gapTotals: Record<GapType, number>;
}

export interface SpecScoreRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  maturityLevel: string;
  ownerPersonId: string | null;
  ownerName: string | null;
  weight: number;
  satisfied: boolean;
  score: number;
  evidenceStatus: string;
  evidenceCounts: SpecEvidenceRollup['counts'] | null;
  gaps: GapType[];
}

export interface DomainDetail extends DomainReadiness {
  specs: SpecScoreRow[];
}

export interface GapRow {
  specId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  domainId: string;
  domainCode: string;
  domainShortCode: string | null;
  gapType: GapType;
  severity: 'high' | 'medium' | 'low';
}

type ActiveSpec = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  maturityLevel: string;
  ownerPersonId: string | null;
  domainId: string;
  owner: { fullNameEn: string; fullNameAr: string } | null;
  domain: { id: string; code: string; shortCode: string | null; nameEn: string; nameAr: string };
};

@Injectable()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
  ) {}

  private async loadSpecs(domainId?: string): Promise<ActiveSpec[]> {
    return this.prisma.ndiSpecification.findMany({
      where: { deletedAt: null, isActive: true, ...(domainId ? { domainId } : {}) },
      orderBy: [{ domain: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        type: true,
        maturityLevel: true,
        ownerPersonId: true,
        domainId: true,
        owner: { select: { fullNameEn: true, fullNameAr: true } },
        domain: { select: { id: true, code: true, shortCode: true, nameEn: true, nameAr: true } },
      },
    }) as unknown as Promise<ActiveSpec[]>;
  }

  private gapInput(spec: ActiveSpec, roll: SpecEvidenceRollup | undefined) {
    return {
      ownerPersonId: spec.ownerPersonId,
      hasCurrentApproved: roll?.hasCurrentApproved ?? false,
      total: roll?.total ?? 0,
      expired: roll?.counts.expired ?? 0,
      rejected: roll?.counts.rejected ?? 0,
      pendingCount: (roll?.counts.submitted ?? 0) + (roll?.counts.under_review ?? 0),
      oldestPendingAt: roll?.oldestPendingAt ?? null,
    };
  }

  /** Dominant evidence status shown for a spec row. */
  private headlineStatus(roll: SpecEvidenceRollup | undefined): string {
    if (!roll || roll.total === 0) return 'none';
    if (roll.hasCurrentApproved) return 'approved';
    const c = roll.counts;
    if (c.submitted || c.under_review) return 'in_review';
    if (c.expired) return 'expired';
    if (c.rejected) return 'rejected';
    if (c.revoked) return 'revoked';
    if (c.draft) return 'draft';
    return 'none';
  }

  async readiness(): Promise<ReadinessOverview> {
    const specs = await this.loadSpecs();
    const rollups = await this.evidence.rollupForSpecs(specs.map((s) => s.id));
    const now = new Date();

    const gapTotals: Record<GapType, number> = {
      missing: 0,
      expired: 0,
      rejected: 0,
      unassigned: 0,
      stuck: 0,
    };

    const byDomain = new Map<string, { spec: ActiveSpec; weight: number; satisfied: boolean }[]>();
    let totalSatisfied = 0;
    const allWeighted: { weight: number; satisfied: boolean }[] = [];

    for (const spec of specs) {
      const roll = rollups.get(spec.id);
      const satisfied = roll?.hasCurrentApproved ?? false;
      const weight = specWeight(spec.type, spec.maturityLevel);
      if (satisfied) totalSatisfied += 1;
      allWeighted.push({ weight, satisfied });
      for (const g of detectGaps(this.gapInput(spec, roll), now)) gapTotals[g] += 1;
      const list = byDomain.get(spec.domainId) ?? [];
      list.push({ spec, weight, satisfied });
      byDomain.set(spec.domainId, list);
    }

    // Include domains with no specs so coverage gaps are visible.
    const domainRows = await this.prisma.ndiDomain.findMany({ orderBy: { sortOrder: 'asc' } });
    const domains: DomainReadiness[] = domainRows.map((d) => {
      const list = byDomain.get(d.id) ?? [];
      const score = readinessPct(list.map((x) => ({ weight: x.weight, satisfied: x.satisfied })));
      return {
        domainId: d.id,
        code: d.code,
        shortCode: d.shortCode,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        specCount: list.length,
        satisfiedCount: list.filter((x) => x.satisfied).length,
        score,
        maturity: maturityBand(score),
      };
    });

    const overallScore = readinessPct(allWeighted);
    return {
      overall: {
        score: overallScore,
        maturity: maturityBand(overallScore),
        specCount: specs.length,
        satisfiedCount: totalSatisfied,
      },
      domains,
      gapTotals,
    };
  }

  async domainDetail(domainId: string): Promise<DomainDetail> {
    const domain = await this.prisma.ndiDomain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('ndi_domain not found');
    const specs = await this.loadSpecs(domainId);
    const rollups = await this.evidence.rollupForSpecs(specs.map((s) => s.id));
    const now = new Date();

    const rows: SpecScoreRow[] = specs.map((spec) => {
      const roll = rollups.get(spec.id);
      const satisfied = roll?.hasCurrentApproved ?? false;
      const weight = specWeight(spec.type, spec.maturityLevel);
      return {
        id: spec.id,
        code: spec.code,
        nameEn: spec.nameEn,
        nameAr: spec.nameAr,
        type: spec.type,
        maturityLevel: spec.maturityLevel,
        ownerPersonId: spec.ownerPersonId,
        ownerName: spec.owner?.fullNameEn ?? null,
        weight: Math.round(weight * 100) / 100,
        satisfied,
        score: specScore(satisfied),
        evidenceStatus: this.headlineStatus(roll),
        evidenceCounts: roll?.counts ?? null,
        gaps: detectGaps(this.gapInput(spec, roll), now),
      };
    });

    const score = readinessPct(rows.map((r) => ({ weight: r.weight, satisfied: r.satisfied })));
    return {
      domainId: domain.id,
      code: domain.code,
      shortCode: domain.shortCode,
      nameEn: domain.nameEn,
      nameAr: domain.nameAr,
      specCount: rows.length,
      satisfiedCount: rows.filter((r) => r.satisfied).length,
      score,
      maturity: maturityBand(score),
      specs: rows,
    };
  }

  async gaps(filter?: { gapType?: GapType; domainId?: string }): Promise<GapRow[]> {
    const specs = await this.loadSpecs(filter?.domainId);
    const rollups = await this.evidence.rollupForSpecs(specs.map((s) => s.id));
    const now = new Date();
    const out: GapRow[] = [];
    for (const spec of specs) {
      const roll = rollups.get(spec.id);
      for (const g of detectGaps(this.gapInput(spec, roll), now)) {
        if (filter?.gapType && g !== filter.gapType) continue;
        out.push({
          specId: spec.id,
          code: spec.code,
          nameEn: spec.nameEn,
          nameAr: spec.nameAr,
          domainId: spec.domain.id,
          domainCode: spec.domain.code,
          domainShortCode: spec.domain.shortCode,
          gapType: g,
          severity: GAP_SEVERITY[g],
        });
      }
    }
    // High severity first, then by domain/code for a stable queue.
    const rank = { high: 0, medium: 1, low: 2 };
    out.sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        a.domainCode.localeCompare(b.domainCode) ||
        a.code.localeCompare(b.code),
    );
    return out;
  }
}
