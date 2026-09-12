/** FD §5.2.3: fixed dimensions and installed DGOP role identities; labels/anchors are governed data. */
export const RISK_DIMENSION_ROLES = {
  dim_privacy: 'privacy_officer', dim_bias: 'AI_RISK_OWNER', dim_safety: 'AI_RISK_OWNER',
  dim_transparency: 'AI_MODEL_OWNER', dim_security: 'security_reviewer', dim_operational: 'AI_MLOPS_LEAD',
  dim_reputation: 'AI_USECASE_OWNER', dim_data_quality: 'business_steward',
} as const;
export type RiskDimension = keyof typeof RISK_DIMENSION_ROLES;
export const RISK_DIMENSIONS = Object.keys(RISK_DIMENSION_ROLES) as RiskDimension[];
export type BilingualAnchor = { en: string; ar: string };
export type RiskScoringConfiguration = {
  referenceVersions: { R_SCORE14: string; R_IMPD: string; R_LEVEL: string };
  scores: Array<{ code: string; score: number; labelEn: string; labelAr: string;
    anchors: { likelihood: BilingualAnchor; impact: BilingualAnchor } }>;
  dimensions: Array<{ code: string; dimension: RiskDimension; assessorRoleCode: string; tieBreakOrder: number; labelEn: string; labelAr: string }>;
  bands: Array<{ code: string; minScore: number; maxScore: number; severityCode: string; labelEn: string; labelAr: string }>;
};
export function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bilingual(value: unknown): value is BilingualAnchor {
  const anchor = jsonRecord(value);
  return typeof anchor.en === 'string' && !!anchor.en.trim() && typeof anchor.ar === 'string' && !!anchor.ar.trim();
}
/** Fail closed on incomplete/ambiguous configuration before any dimension task is opened. */
export function scoringConfigurationIssues(config: RiskScoringConfiguration): string[] {
  const issues: string[] = [];
  if (Object.values(config.referenceVersions).some(id => !id)) issues.push('One effective published version of R_SCORE14, R_IMPD and R_LEVEL is required');
  if (config.scores.length !== 4 || [1, 2, 3, 4].some(score => config.scores.filter(value => value.score === score).length !== 1)) issues.push('R_SCORE14 requires exactly one metadata.score for each integer 1–4');
  if (config.scores.some(value => !bilingual(value.anchors?.likelihood) || !bilingual(value.anchors?.impact))) issues.push('R_SCORE14 requires bilingual likelihood and impact anchors');
  if (config.dimensions.length !== 8 || RISK_DIMENSIONS.some(dimension => config.dimensions.filter(value => value.dimension === dimension
    && value.assessorRoleCode === RISK_DIMENSION_ROLES[dimension]).length !== 1)) issues.push('R_IMPD requires reviewed dimension-to-competent-role mappings for all eight design dimensions');
  if (config.dimensions.some(value => !Number.isInteger(value.tieBreakOrder) || value.tieBreakOrder < 1 || value.tieBreakOrder > 8)
    || new Set(config.dimensions.map(value => value.tieBreakOrder)).size !== 8) issues.push('R_IMPD requires a unique metadata.tieBreakOrder from 1–8');
  const expected = { LOW: [1, 2, 'P4'], MEDIUM: [3, 6, 'P3'], HIGH: [8, 12, 'P2'], CRITICAL: [16, 16, 'P1'] };
  if (config.bands.length !== 4 || Object.entries(expected).some(([code, [min, max, severity]]) => config.bands.filter(value =>
    value.code === code && value.minScore === min && value.maxScore === max && value.severityCode === severity).length !== 1)) issues.push('R_LEVEL must publish the approved four methodology bands and severity mappings');
  return issues;
}
export function computeInherentRisk(likelihood: number, dimensions: Array<{ dimension: RiskDimension; value: number; justification: string }>, config: RiskScoringConfiguration) {
  const issues = scoringConfigurationIssues(config);
  if (issues.length) throw new Error(issues.join('; '));
  if (!Number.isInteger(likelihood) || likelihood < 1 || likelihood > 4 || dimensions.length !== 8
    || RISK_DIMENSIONS.some(dimension => dimensions.filter(value => value.dimension === dimension).length !== 1)
    || dimensions.some(value => !Number.isInteger(value.value) || value.value < 1 || value.value > 4 || !value.justification.trim())) throw new Error('One justified 1–4 score is required for every dimension and likelihood must be 1–4');
  const impactFinal = Math.max(...dimensions.map(value => value.value));
  const topDimensions = config.dimensions.filter(value => dimensions.find(score => score.dimension === value.dimension)!.value === impactFinal)
    .sort((a, b) => a.tieBreakOrder - b.tieBreakOrder);
  const score = likelihood * impactFinal;
  const band = config.bands.find(value => score >= value.minScore && score <= value.maxScore)!;
  return { likelihood, impactFinal, impactTopDimension: topDimensions[0].dimension, impactTopDimensionCode: topDimensions[0].code,
    tiedDimensions: topDimensions.map(value => value.dimension), score, bandCode: band.code, bandLabelEn: band.labelEn,
    bandLabelAr: band.labelAr, severityCode: band.severityCode, referenceVersions: config.referenceVersions };
}
