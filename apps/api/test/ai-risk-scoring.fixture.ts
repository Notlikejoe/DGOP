import { RISK_DIMENSIONS, RISK_DIMENSION_ROLES, RiskScoringConfiguration } from '../src/ai-governance/ai-risk-scoring';
/** Synthetic governed publication fixture, never a production seed. */
export function riskScoringFixture(): RiskScoringConfiguration {
  return { referenceVersions: { R_SCORE14: 'scores-fixture', R_IMPD: 'dimensions-fixture', R_LEVEL: 'bands-fixture' },
    scores: [1, 2, 3, 4].map(score => ({ code: `SCORE_${score}`, score, labelEn: `Score ${score}`, labelAr: `درجة ${score}`,
      anchors: { likelihood: { en: `Likelihood anchor ${score}`, ar: `معيار الاحتمالية ${score}` }, impact: { en: `Impact anchor ${score}`, ar: `معيار الأثر ${score}` } } })),
    dimensions: RISK_DIMENSIONS.map((dimension, index) => ({ code: dimension.toUpperCase(), dimension, assessorRoleCode: RISK_DIMENSION_ROLES[dimension],
      tieBreakOrder: index + 1, labelEn: dimension, labelAr: dimension })),
    bands: [{ code: 'LOW', minScore: 1, maxScore: 2, severityCode: 'P4', labelEn: 'Low', labelAr: 'منخفض' },
      { code: 'MEDIUM', minScore: 3, maxScore: 6, severityCode: 'P3', labelEn: 'Medium', labelAr: 'متوسط' },
      { code: 'HIGH', minScore: 8, maxScore: 12, severityCode: 'P2', labelEn: 'High', labelAr: 'مرتفع' },
      { code: 'CRITICAL', minScore: 16, maxScore: 16, severityCode: 'P1', labelEn: 'Critical', labelAr: 'كارثي' }] };
}
