// Read-only assertions through the actual local preview API. Credentials are never printed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureDefinition, demoConfig, readManifest, atomicJson, assertDemoFixtureWrite } from './demo-profile.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config=demoConfig(root);
const logins = JSON.parse(readFileSync(config.credentialsPath, 'utf8'));
const manifest = readManifest(config);
const definition=fixtureDefinition(root,manifest.fixtureVersion);
assert.equal(manifest.cases.length,definition.completedAiJourneys.length);
assertDemoFixtureWrite(config,process.argv[2]);
assert.equal(logins.previewUrl, config.publicUrl + '/');
assert.equal(manifest.demoOnly, true);
const base = config.base + '/api';
async function login(purpose) {
  const account = logins.accounts.find(a => a.purpose === purpose); assert.ok(account);
  const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json','x-dgop-csrf':'same-origin' },
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
assert.equal(history.total, manifest.cases.length); assert.equal(history.readOnly, true); assert.equal(history.demoMode, config.env.NODE_ENV === 'development');
assert.deepEqual(history.rows.map(c => c.id).sort(), manifest.cases.map(c => c.useCaseId).sort());
const first = await get('/ai/history?page=1&pageSize=1', cookie), second = await get('/ai/history?page=2&pageSize=1', cookie);
assert.equal(first.total, manifest.cases.length); assert.equal(first.rows.length, 1); assert.equal(second.rows.length, 1);
assert.notEqual(first.rows[0].id, second.rows[0].id);
assert.equal((await get(`/ai/history?page=${manifest.cases.length+1}&pageSize=1`, cookie)).rows.length, 0);
await get('/ai/history?page=0', cookie, 400); await get('/ai/history?pageSize=51', cookie, 400);
await get('/ai/history', undefined, 401);
for (const purpose of ['riskOwner', 'executive']) await get('/ai/history', await login(purpose), 403);
const summaries = [];
for (const fixture of manifest.cases) {
  const row = history.rows.find(c => c.id === fixture.useCaseId), risk = row.risks.find(r => r.id === fixture.riskId);
  assert.ok(row.asset?.id); assert.ok(row.useCaseRef); assert.ok(risk.riskRef);
  assert.equal(risk.actions.length, definition.actionsPerCompletedJourney); assert.ok(risk.actions.every(a => a.progress[0]?.completionPct === 100));
  const inherent = risk.assessments.filter(r => r.kind === 'inherent').at(-1);
  const residual = risk.assessments.filter(r => r.kind === 'residual').at(-1);
  assert.equal(inherent.result.score, 12); assert.ok([2, 4].includes(residual.result.score));
  assert.ok(residual.decisions.some(d => d.decision === 'accept'));
  assert.equal(risk.reviews.filter(r => r.completion && !r.cancellation).length, definition.completedReviewsPerJourney);
  assert.equal(risk.reviews.filter(r => !r.completion && !r.cancellation).length, definition.scheduledReviewsPerJourney);
  await get(`/ai/risks/${risk.id}/reviews`, cookie);
  summaries.push({ name: fixture.name, useCaseRef: row.useCaseRef, riskRef: risk.riskRef, assetCode: row.asset.code,
    classification: row.assessments[0]?.result.approvedTierCode, inherentScore: 12,
    residualScore: residual.result.score, residualBand: residual.result.bandCode, completedActions: definition.actionsPerCompletedJourney, completedReviews: definition.completedReviewsPerJourney, scheduledReviews: definition.scheduledReviewsPerJourney });
}
const own = await get('/ai/use-cases', cookie);
assert.ok(own.total >= manifest.cases.length + definition.pendingAiJourneys);
assert.ok(manifest.cases.every(fixture => own.data.some(row => row.id === fixture.useCaseId)));
const risks = await get('/ai/risks', cookie), demoRiskIds=new Set(manifest.cases.map(c=>c.riskId));
assert.equal(risks.data.filter(r=>demoRiskIds.has(r.id)).length, manifest.cases.length);
const reviewQueues = [
  ['triage', '/ai/use-cases/triage'], ['classification', '/ai/use-cases/classification/queue'],
  ['verification', '/ai/use-cases/classification/verification/queue'], ['specialist', '/ai/use-cases/classification/reviews/queue'],
  ['decision', '/ai/use-cases/decisions/queue'], ['registration', '/ai/use-cases/registration/queue'],
];
let reviewStage = null;
for (const [stage, path] of reviewQueues) {
  const queue = await get(path + '?pageSize=200', cookie);
  // Walk every matching page; completed fixtures and the pending example may sit beyond page one.
  const rows = [...queue.data];
  for (let page=2;page<=queue.totalPages;page++) rows.push(...(await get(path+'?pageSize=200&page='+page,cookie)).data);
  if (manifest.reviewExample && rows.some(row => row.id === manifest.reviewExample.useCaseId)) reviewStage = stage;
  assert.ok(manifest.cases.every(fixture => !rows.some(row => row.id === fixture.useCaseId)), 'Completed demo approvals must not appear as pending');
}
if (manifest.reviewExample) assert.ok(reviewStage, 'The fully populated review example must appear in one active review stage');
const report = await get('/ai/review-operations/report?filter=all', cookie);
assert.equal(report.periodic.total, manifest.cases.length * (definition.completedReviewsPerJourney + definition.scheduledReviewsPerJourney)); assert.equal(report.periodic.completed, manifest.cases.length * definition.completedReviewsPerJourney);
const dashboard = await get('/ai/dashboard', cookie); assert.equal(dashboard.reconciliation.total, manifest.cases.length);
assert.equal(dashboard.reconciliation.balanced, true);
await get('/ai/migration-previews/context', cookie);
const preview = await get(`/ai/migration-previews/${manifest.sourcePreviewId}`, cookie);
assert.equal(preview.id, manifest.sourcePreviewId);
const scoringCookie=await login('administrator');
const scoring=await get('/ndi/scoring/scenario-readiness',scoringCookie),operational=await get('/ndi/scoring/readiness',scoringCookie);
assert.equal(scoring.demoOnly,true);assert.equal(scoring.isComplianceClaim,false);assert.equal(scoring.fixtureVersion,manifest.fixtureVersion);assert.ok(Number.isFinite(Date.parse(scoring.evaluatedAt)));
assert.equal(scoring.operational.scoringBasis,'operational_evidence_only');assert.equal(scoring.scenario.scoringBasis,'demonstration_scenario');
assert.deepEqual(scoring.operational,operational);assert.equal(operational.overall.satisfiedCount,0,'Synthetic evidence cannot satisfy operational readiness');assert.ok(scoring.syntheticEvidenceCount>0);assert.ok(scoring.scenario.overall.satisfiedCount>0,'Reviewed current synthetic evidence belongs only to the scenario result');
const result = { verifiedAt: new Date().toISOString(), demoOnly: true, database: manifest.database,
  useCases: summaries, historyPaging: 'passed', unauthorizedAndAggregateHistory: 'denied',
  reviewQueue: manifest.reviewExample ? { stage: reviewStage, completeInput: true, useCaseId: manifest.reviewExample.useCaseId } : 'correctly empty after completion', calendar: { total:manifest.cases.length*(definition.completedReviewsPerJourney+definition.scheduledReviewsPerJourney),completed:manifest.cases.length*definition.completedReviewsPerJourney,scheduled:manifest.cases.length*definition.scheduledReviewsPerJourney },
  dashboard: { total: manifest.cases.length, balanced: true }, readinessSeparation:{operationalSatisfied:operational.overall.satisfiedCount,scenarioSatisfied:scoring.scenario.overall.satisfiedCount,syntheticEvidenceCount:scoring.syntheticEvidenceCount,operationalExportsRemainOperational:true}, migration: 'Synthetic source validation preview available; real pilot acceptance remains open' };
atomicJson(config.resultPath,result);
console.log(JSON.stringify(result, null, 2));
