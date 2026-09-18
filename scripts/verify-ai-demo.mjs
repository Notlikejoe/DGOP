// Read-only assertions through the actual local preview API. Credentials are never printed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logins = JSON.parse(readFileSync(resolve(root, '../../outputs/DGOP_AI_Demo_Logins.local.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'storage/ai-preview/demo-manifest.json'), 'utf8'));
assert.equal(process.argv[2], '--local-demo');
assert.equal(logins.previewUrl, 'http://localhost:4206/');
assert.equal(manifest.demoOnly, true);
const base = 'http://127.0.0.1:3006/api';
async function login(purpose) {
  const account = logins.accounts.find(a => a.purpose === purpose); assert.ok(account);
  const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.status, 201, 'Native demo login must succeed');
  return response.headers.get('set-cookie').split(';')[0];
}
async function get(path, cookie, expected = 200) {
  const response = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  assert.equal(response.status, expected, `${path}: expected HTTP ${expected}, got ${response.status}`);
  return response.json();
}
const cookie = await login('showcase');
const history = await get('/ai/history', cookie);
assert.equal(history.total, 2); assert.equal(history.readOnly, true); assert.equal(history.demoMode, true);
assert.deepEqual(history.rows.map(c => c.id).sort(), manifest.cases.map(c => c.useCaseId).sort());
const first = await get('/ai/history?page=1&pageSize=1', cookie), second = await get('/ai/history?page=2&pageSize=1', cookie);
assert.equal(first.total, 2); assert.equal(first.rows.length, 1); assert.equal(second.rows.length, 1);
assert.notEqual(first.rows[0].id, second.rows[0].id);
assert.equal((await get('/ai/history?page=3&pageSize=1', cookie)).rows.length, 0);
await get('/ai/history?page=0', cookie, 400); await get('/ai/history?pageSize=51', cookie, 400);
await get('/ai/history', undefined, 401);
for (const purpose of ['riskOwner', 'executive']) await get('/ai/history', await login(purpose), 403);
const summaries = [];
for (const fixture of manifest.cases) {
  const row = history.rows.find(c => c.id === fixture.useCaseId), risk = row.risks.find(r => r.id === fixture.riskId);
  assert.ok(row.asset?.id); assert.ok(row.useCaseRef); assert.ok(risk.riskRef);
  assert.equal(risk.actions.length, 2); assert.ok(risk.actions.every(a => a.progress[0]?.completionPct === 100));
  const inherent = risk.assessments.filter(r => r.kind === 'inherent').at(-1);
  const residual = risk.assessments.filter(r => r.kind === 'residual').at(-1);
  assert.equal(inherent.result.score, 12); assert.ok([2, 4].includes(residual.result.score));
  assert.ok(residual.decisions.some(d => d.decision === 'accept'));
  assert.equal(risk.reviews.filter(r => r.completion && !r.cancellation).length, 1);
  assert.equal(risk.reviews.filter(r => !r.completion && !r.cancellation).length, 1);
  await get(`/ai/risks/${risk.id}/reviews`, cookie);
  summaries.push({ name: fixture.name, useCaseRef: row.useCaseRef, riskRef: risk.riskRef, assetCode: row.asset.code,
    classification: row.assessments[0]?.result.approvedTierCode, inherentScore: 12,
    residualScore: residual.result.score, residualBand: residual.result.bandCode, completedActions: 2, completedReviews: 1, scheduledReviews: 1 });
}
const own = await get('/ai/use-cases', cookie);
assert.ok(own.length >= 2 + (manifest.reviewExample ? 1 : 0));
assert.ok(manifest.cases.every(fixture => own.some(row => row.id === fixture.useCaseId)));
const risks = await get('/ai/risks', cookie), demoRiskIds=new Set(manifest.cases.map(c=>c.riskId));
assert.equal(risks.filter(r=>demoRiskIds.has(r.id)).length, 2);
assert.ok(risks.some(r=>r.riskRef===null), 'The preserved user-created AIRS draft must remain visible and unnumbered');
const reviewQueues = [
  ['triage', '/ai/use-cases/triage'], ['classification', '/ai/use-cases/classification/queue'],
  ['verification', '/ai/use-cases/classification/verification/queue'], ['specialist', '/ai/use-cases/classification/reviews/queue'],
  ['decision', '/ai/use-cases/decisions/queue'], ['registration', '/ai/use-cases/registration/queue'],
];
let reviewStage = null;
for (const [stage, path] of reviewQueues) {
  const queue = await get(path, cookie);
  if (manifest.reviewExample && queue.some(row => row.id === manifest.reviewExample.useCaseId)) reviewStage = stage;
  assert.ok(manifest.cases.every(fixture => !queue.some(row => row.id === fixture.useCaseId)), 'Completed demo approvals must not appear as pending');
}
if (manifest.reviewExample) assert.ok(reviewStage, 'The fully populated review example must appear in one active review stage');
const report = await get('/ai/review-operations/report?filter=all', cookie);
assert.equal(report.periodic.total, 4); assert.equal(report.periodic.completed, 2);
const dashboard = await get('/ai/dashboard', cookie); assert.equal(dashboard.reconciliation.total, 2);
assert.equal(dashboard.reconciliation.balanced, true);
await get('/ai/migration-previews/context', cookie);
const preview = await get(`/ai/migration-previews/${manifest.sourcePreviewId}`, cookie);
assert.equal(preview.id, manifest.sourcePreviewId);
const result = { verifiedAt: new Date().toISOString(), demoOnly: true, database: manifest.database,
  useCases: summaries, historyPaging: 'passed', unauthorizedAndAggregateHistory: 'denied',
  reviewQueue: manifest.reviewExample ? { stage: reviewStage, completeInput: true, useCaseId: manifest.reviewExample.useCaseId } : 'correctly empty after completion', calendar: { total: 4, completed: 2, scheduled: 2 },
  dashboard: { total: 2, balanced: true }, migration: 'source validation preview available; real pilot acceptance remains open' };
writeFileSync(resolve(root, '../../outputs/DGOP_AI_Demo_Verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
