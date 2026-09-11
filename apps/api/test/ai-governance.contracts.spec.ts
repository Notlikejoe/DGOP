import assert from 'node:assert/strict';
import { AI_INTAKE_FIELDS, assertIntakeDraftV1, assertCalculationInputV1 } from '../src/ai-governance/ai-governance.contracts';

assert.equal(new Set(AI_INTAKE_FIELDS).size, 28);
assertIntakeDraftV1({}); // incomplete drafts are supported
assertIntakeDraftV1({ usecase_name: 'حالة اختبار', kpi_target: '12345678901234567890.125',
  simpler_alternatives: { answer: false, justification: '' }, attachments: [] });
assert.throws(() => assertIntakeDraftV1({ tier_approved: 'HIGH' }), /Unknown/);
assert.throws(() => assertIntakeDraftV1({ kpi_target: 1.5 }), /string/);
assert.throws(() => assertIntakeDraftV1({ kpi_target: 'NaN' }), /decimal/);
assert.throws(() => assertIntakeDraftV1({ simpler_alternatives: true }), /answer/);
assert.throws(() => assertIntakeDraftV1({ constraints_dependencies: { text: '', none: false, tier: 'HIGH' } }));
for (const kind of ['classification', 'inherent', 'residual'] as const) {
  const input = { kind, scores: Array.from({ length: kind === 'classification' ? 6 : 8 },
    () => ({ value: 1, justification: 'سبب موثق' })), ...(kind !== 'classification' ? { likelihood: 4 } : {}) };
  assertCalculationInputV1(input);
  assert.throws(() => assertCalculationInputV1({ ...input, scores: input.scores.slice(1) }));
  assert.throws(() => assertCalculationInputV1({ ...input, score: 16 }));
  assert.throws(() => assertCalculationInputV1({ ...input, scores: input.scores.map(s => ({ ...s, value: 0 })) }));
  assert.throws(() => assertCalculationInputV1({ ...input, scores: input.scores.map(s => ({ ...s, justification: ' ' })) }));
  assert.throws(() => assertCalculationInputV1({ ...input, scores: input.scores.map(s => ({ ...s, value: kind === 'classification' ? 6 : 5 })) }));
}
assert.throws(() => assertCalculationInputV1({ kind: 'residual', scores: Array(8).fill({ value: 2, justification: 'x' }) }));
console.log('AI foundation contracts passed: draft shape, precision, assessment dimensions, ranges and computed-input rejection.');
