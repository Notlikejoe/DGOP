import {
  ArchitectureReviewDecision,
  MdmMatchStatus,
  MdmResolutionStep,
  MetadataCertificationStatus,
  ReferenceDataVersionStatus,
} from '@prisma/client';

export function clampScore(value: number | undefined, fallback = 0): number {
  const score = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, score));
}

export function defaultMatchStep(score: number): MdmResolutionStep {
  if (score >= 95) return MdmResolutionStep.survivorship;
  if (score >= 80) return MdmResolutionStep.compare;
  return MdmResolutionStep.identify;
}

export function defaultMatchStatus(score: number): MdmMatchStatus {
  return score >= 80 ? MdmMatchStatus.under_review : MdmMatchStatus.candidate;
}

export interface MdmMatchAssetProfile {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  description?: string | null;
  ownerName?: string | null;
  domainId?: string | null;
  domainCode?: string | null;
  orgUnitId?: string | null;
  systemId?: string | null;
  systemCode?: string | null;
  capabilityId?: string | null;
  classificationId?: string | null;
  externalCatalogId?: string | null;
  catalogSource?: string | null;
  catalogTrustLevel?: string | null;
  subjects?: string[];
}

export interface MdmMatchFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  evidence: string;
}

export interface MdmMatchEvaluation {
  sourceAssetId: string;
  candidateAssetId: string;
  pairKey: string;
  matchScore: number;
  confidence: 'low' | 'medium' | 'high' | 'exact';
  status: MdmMatchStatus;
  resolutionStep: MdmResolutionStep;
  sourceTrustRank: number;
  candidateTrustRank: number;
  factors: MdmMatchFactor[];
  explanation: string;
  survivorshipRulesJson: Record<string, unknown>;
  proposedGoldenRecordJson: Record<string, unknown>;
}

export interface MdmMatchRunOptions {
  threshold?: number;
  limit?: number;
}

const MDM_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'asset',
  'data',
  'dataset',
  'feed',
  'file',
  'for',
  'from',
  'list',
  'of',
  'record',
  'records',
  'registry',
  'source',
  'system',
  'table',
  'the',
]);

const TRUST_RANKS: Record<string, number> = {
  authoritative: 95,
  trusted: 85,
  observed: 65,
  simulated: 45,
};

function normalizeMdmText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function compact(value: string | null | undefined): string {
  return normalizeMdmText(value).replace(/\s+/g, '');
}

function tokens(...values: Array<string | null | undefined>): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    for (const token of normalizeMdmText(value).split(/\s+/)) {
      if (token.length >= 2 && !MDM_STOP_WORDS.has(token)) result.add(token);
    }
  }
  return result;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return clampScore((intersection / union) * 100);
}

function textScore(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeMdmText(left);
  const b = normalizeMdmText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 86;
  return overlapScore(tokens(a), tokens(b));
}

function codeScore(left: string | null | undefined, right: string | null | undefined): number {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 82;
  return overlapScore(tokens(a), tokens(b));
}

function exactScore(left: string | null | undefined, right: string | null | undefined): number {
  return left && right && left === right ? 100 : 0;
}

function sourceTrustRank(asset: MdmMatchAssetProfile): number {
  return TRUST_RANKS[normalizeMdmText(asset.catalogTrustLevel)] ?? 55;
}

function matchConfidence(score: number): MdmMatchEvaluation['confidence'] {
  if (score >= 95) return 'exact';
  if (score >= 85) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

function preferredValue(
  source: MdmMatchAssetProfile,
  candidate: MdmMatchAssetProfile,
  field: keyof MdmMatchAssetProfile,
  sourceTrust: number,
  candidateTrust: number,
): unknown {
  const sourceValue = source[field];
  const candidateValue = candidate[field];
  if (sourceValue && !candidateValue) return sourceValue;
  if (!sourceValue && candidateValue) return candidateValue;
  if (!sourceValue && !candidateValue) return null;
  return sourceTrust >= candidateTrust ? sourceValue : candidateValue;
}

export function canonicalMdmPairKey(sourceAssetId: string, candidateAssetId: string): string {
  return [sourceAssetId, candidateAssetId].sort().join('|');
}

export function evaluateMdmMatch(
  source: MdmMatchAssetProfile,
  candidate: MdmMatchAssetProfile,
): MdmMatchEvaluation | null {
  if (source.id === candidate.id) return null;

  const sourceTrust = sourceTrustRank(source);
  const candidateTrust = sourceTrustRank(candidate);
  const sourceSubjects = new Set(source.subjects ?? []);
  const candidateSubjects = new Set(candidate.subjects ?? []);

  const externalIdScore =
    source.externalCatalogId && candidate.externalCatalogId && source.externalCatalogId === candidate.externalCatalogId
      ? source.catalogSource && candidate.catalogSource && source.catalogSource === candidate.catalogSource
        ? 100
        : 88
      : 0;
  const nameTokens = overlapScore(
    tokens(source.code, source.nameEn, source.nameAr, source.description),
    tokens(candidate.code, candidate.nameEn, candidate.nameAr, candidate.description),
  );
  const systemCatalogScore = Math.max(
    externalIdScore,
    exactScore(source.systemId, candidate.systemId) ? 86 : 0,
    source.catalogSource && candidate.catalogSource && source.catalogSource === candidate.catalogSource ? 54 : 0,
  );
  const contextScore = clampScore(
    (exactScore(source.capabilityId, candidate.capabilityId) ? 60 : 0) +
      (exactScore(source.orgUnitId, candidate.orgUnitId) ? 40 : 0),
  );
  const ownerClassificationScore = clampScore(
    (exactScore(source.classificationId, candidate.classificationId) ? 48 : 0) +
      Math.round(textScore(source.ownerName, candidate.ownerName) * 0.52),
  );

  const factors: MdmMatchFactor[] = [
    {
      key: 'code',
      label: 'Code similarity',
      score: codeScore(source.code, candidate.code),
      weight: 15,
      evidence: `${source.code} compared with ${candidate.code}`,
    },
    {
      key: 'name',
      label: 'Name and description similarity',
      score: Math.max(textScore(source.nameEn, candidate.nameEn), textScore(source.nameAr, candidate.nameAr), nameTokens),
      weight: 25,
      evidence: `${source.nameEn} compared with ${candidate.nameEn}`,
    },
    {
      key: 'domain',
      label: 'Data domain alignment',
      score: exactScore(source.domainId, candidate.domainId),
      weight: 12,
      evidence: source.domainId === candidate.domainId ? `Both in ${source.domainCode ?? 'same domain'}` : 'Different or missing domains',
    },
    {
      key: 'system_catalog',
      label: 'System and catalog identity',
      score: systemCatalogScore,
      weight: 16,
      evidence: externalIdScore
        ? 'Same external catalog identity'
        : source.systemId === candidate.systemId
          ? `Both from ${source.systemCode ?? 'same system'}`
          : 'No shared system identity',
    },
    {
      key: 'business_context',
      label: 'Business context alignment',
      score: contextScore,
      weight: 12,
      evidence: contextScore ? 'Capability or organization context overlaps' : 'No shared capability or organization context',
    },
    {
      key: 'subjects',
      label: 'Data subject overlap',
      score: overlapScore(sourceSubjects, candidateSubjects),
      weight: 8,
      evidence: sourceSubjects.size || candidateSubjects.size ? 'Compared linked data subject categories' : 'No subject categories recorded',
    },
    {
      key: 'classification_owner',
      label: 'Classification and ownership',
      score: ownerClassificationScore,
      weight: 12,
      evidence: 'Compared classification and owner labels',
    },
  ];

  const activeFactors = factors.filter((factor) => factor.score > 0 || factor.key === 'code' || factor.key === 'name');
  const weightedFactors = activeFactors.length ? activeFactors : factors;
  const weightedTotal = weightedFactors.reduce((sum, factor) => sum + factor.score * factor.weight, 0);
  const totalWeight = weightedFactors.reduce((sum, factor) => sum + factor.weight, 0);
  const baseScore = clampScore(weightedTotal / totalWeight);
  const matchScore =
    externalIdScore === 100
      ? Math.max(baseScore, 96)
      : externalIdScore >= 88
        ? Math.max(baseScore, 86)
        : baseScore;
  const confidence = matchConfidence(matchScore);
  const pairKey = canonicalMdmPairKey(source.id, candidate.id);
  const resolutionStep = defaultMatchStep(matchScore);
  const status = defaultMatchStatus(matchScore);
  const preferredSource = sourceTrust >= candidateTrust ? source : candidate;
  const explanation = `${confidence} confidence match: ${factors
    .filter((factor) => factor.score >= 70)
    .map((factor) => factor.label.toLowerCase())
    .slice(0, 3)
    .join(', ') || 'limited similarity signals'}.`;

  const survivorshipRulesJson = {
    engine: 'mdm_asset_match_v1',
    ruleVersion: '2026-07-21',
    confidence,
    pairKey,
    sourceTrustRank: sourceTrust,
    candidateTrustRank: candidateTrust,
    preferredRecordAssetId: preferredSource.id,
    factors,
    explanation,
    suggestedResolutionStep: resolutionStep,
    suggestedStatus: status,
  };
  const proposedGoldenRecordJson = {
    sourceAssetId: source.id,
    candidateAssetId: candidate.id,
    matchScore,
    confidence,
    preferredRecordAssetId: preferredSource.id,
    fields: {
      code: preferredValue(source, candidate, 'code', sourceTrust, candidateTrust),
      nameEn: preferredValue(source, candidate, 'nameEn', sourceTrust, candidateTrust),
      nameAr: preferredValue(source, candidate, 'nameAr', sourceTrust, candidateTrust),
      description: preferredValue(source, candidate, 'description', sourceTrust, candidateTrust),
      domainId: preferredValue(source, candidate, 'domainId', sourceTrust, candidateTrust),
      systemId: preferredValue(source, candidate, 'systemId', sourceTrust, candidateTrust),
      capabilityId: preferredValue(source, candidate, 'capabilityId', sourceTrust, candidateTrust),
      classificationId: preferredValue(source, candidate, 'classificationId', sourceTrust, candidateTrust),
      ownerName: preferredValue(source, candidate, 'ownerName', sourceTrust, candidateTrust),
    },
  };

  return {
    sourceAssetId: source.id,
    candidateAssetId: candidate.id,
    pairKey,
    matchScore,
    confidence,
    status,
    resolutionStep,
    sourceTrustRank: sourceTrust,
    candidateTrustRank: candidateTrust,
    factors,
    explanation,
    survivorshipRulesJson,
    proposedGoldenRecordJson,
  };
}

export function rankMdmMatches(
  sources: MdmMatchAssetProfile[],
  candidates: MdmMatchAssetProfile[],
  options: MdmMatchRunOptions = {},
): MdmMatchEvaluation[] {
  const threshold = clampScore(options.threshold, 65);
  const limit = Math.max(1, Math.min(50, Math.round(Number(options.limit ?? 10))));
  const seen = new Set<string>();
  const evaluations: MdmMatchEvaluation[] = [];

  for (const source of sources) {
    for (const candidate of candidates) {
      const pairKey = canonicalMdmPairKey(source.id, candidate.id);
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const evaluation = evaluateMdmMatch(source, candidate);
      if (evaluation && evaluation.matchScore >= threshold) evaluations.push(evaluation);
    }
  }

  return evaluations
    .sort((a, b) => b.matchScore - a.matchScore || a.sourceAssetId.localeCompare(b.sourceAssetId) || a.candidateAssetId.localeCompare(b.candidateAssetId))
    .slice(0, limit);
}

export function certificationStatus(input: {
  qualityScore: number;
  completenessScore: number;
  ownerConfirmed: boolean;
  glossaryAligned: boolean;
  lineageReviewed: boolean;
}): MetadataCertificationStatus {
  const ready =
    input.qualityScore >= 80 &&
    input.completenessScore >= 80 &&
    input.ownerConfirmed &&
    input.glossaryAligned &&
    input.lineageReviewed;
  return ready ? MetadataCertificationStatus.certified : MetadataCertificationStatus.needs_remediation;
}

export function referenceVersionStatus(decision: 'submit' | 'approve' | 'reject' | 'activate' | 'retire'): ReferenceDataVersionStatus {
  if (decision === 'submit') return ReferenceDataVersionStatus.under_review;
  if (decision === 'approve') return ReferenceDataVersionStatus.approved;
  if (decision === 'activate') return ReferenceDataVersionStatus.active;
  if (decision === 'retire') return ReferenceDataVersionStatus.retired;
  return ReferenceDataVersionStatus.rejected;
}

export function isArchitectureDecisionFinal(decision: ArchitectureReviewDecision): boolean {
  return decision !== ArchitectureReviewDecision.pending;
}
