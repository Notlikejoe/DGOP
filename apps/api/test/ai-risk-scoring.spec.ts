import assert from 'node:assert/strict';
import { computeInherentRisk, RISK_DIMENSIONS, scoringConfigurationIssues } from '../src/ai-governance/ai-risk-scoring';
import { riskScoringFixture } from './ai-risk-scoring.fixture';
const config = riskScoringFixture();
const matrix = [[1, 2, 3, 4], [2, 4, 6, 8], [3, 6, 9, 12], [4, 8, 12, 16]];
const bands = [['LOW', 'LOW', 'MEDIUM', 'MEDIUM'], ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH'],
  ['MEDIUM', 'MEDIUM', 'HIGH', 'HIGH'], ['MEDIUM', 'HIGH', 'HIGH', 'CRITICAL']];
for (let likelihood = 1; likelihood <= 4; likelihood++) {
  for (let impact = 1; impact <= 4; impact++) {
    const dimensions = RISK_DIMENSIONS.map(dimension => ({ dimension, value: impact, justification: 'Documented impact' }));
    const result = computeInherentRisk(likelihood, dimensions, config);
    assert.equal(result.score, matrix[likelihood - 1][impact - 1]); assert.equal(result.bandCode, bands[likelihood - 1][impact - 1]);
  }
}
for (const maximum of RISK_DIMENSIONS) {
  const dimensions = RISK_DIMENSIONS.map(dimension => ({ dimension, value: dimension === maximum ? 4 : 1, justification: 'Documented impact' }));
  const result = computeInherentRisk(2, dimensions, config);
  assert.equal(result.impactFinal, 4); assert.equal(result.impactTopDimension, maximum); assert.equal(result.score, 8);
}
const tied = RISK_DIMENSIONS.map(dimension => ({ dimension, value: 2, justification: 'Documented impact' }));
const reversed = { ...config, dimensions: config.dimensions.map(value => ({ ...value, tieBreakOrder: 9 - value.tieBreakOrder })) };
assert.equal(computeInherentRisk(3, tied, reversed).impactTopDimension, 'dim_data_quality');
assert.equal(computeInherentRisk(3, tied, reversed).tiedDimensions.length, 8);
assert.throws(() => computeInherentRisk(1, tied.slice(1), config));
assert.throws(() => computeInherentRisk(1, [...tied.slice(1), tied[1]], config));
assert.throws(() => computeInherentRisk(0, tied, config));
assert.throws(() => computeInherentRisk(1, tied.map(value => ({ ...value, justification: ' ' })), config));
assert.throws(() => computeInherentRisk(1, tied.map(value => ({ ...value, value: 5 })), config));
assert.ok(scoringConfigurationIssues({ ...config, scores: config.scores.slice(1) }).length);
assert.ok(scoringConfigurationIssues({ ...config, scores: config.scores.map(value => ({ ...value, anchors: { ...value.anchors, impact: { en: '', ar: '' } } })) }).length);
assert.ok(scoringConfigurationIssues({ ...config, dimensions: config.dimensions.map(value => ({ ...value, assessorRoleCode: 'AI_RISK_OWNER' })) }).length);
assert.ok(scoringConfigurationIssues({ ...config, dimensions: config.dimensions.map(value => ({ ...value, tieBreakOrder: 1 })) }).length);
assert.ok(scoringConfigurationIssues({ ...config, bands: config.bands.map(value => ({ ...value, maxScore: 16 })) }).length);
console.log('AIRS scoring passed: all 16 matrix cells, every maximum dimension, governed tie order, invalid/incomplete inputs, role mappings, anchors and malformed bands.');
