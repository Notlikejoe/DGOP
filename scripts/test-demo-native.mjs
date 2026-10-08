// Explicit engineering rehearsal. It never installs or certifies the licensed localhost:4207 demo.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { fixtureDefinition, atomicJson, demoConfig, applyDemoEnvironment, readManifest } from './demo-profile.mjs';
import { installSyntheticSources } from './demo-sources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.match(process.versions.node, /^24\.19\./, 'Use the repository-supported Node runtime');
const supplied = process.env.DGOP_AI_TEST_DATABASE_URL ?? (existsSync(join(root, '.env.ai-test')) ? parseEnv(readFileSync(join(root, '.env.ai-test'), 'utf8')).DGOP_AI_TEST_DATABASE_URL : undefined);
const url = new URL(supplied ?? '');
assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438'); assert.match(url.pathname, /^\/dgop_ai_test_[a-z0-9_]+$/);
const require = createRequire(join(root, 'apps/api/package.json')), { PrismaClient } = require('@prisma/client');
assert.ok(existsSync(join(root, 'apps/api/dist/main.js')), 'Build the isolated candidate API first');
const resumeIndex=process.argv.indexOf('--resume');
const resumeFile=resumeIndex<0?null:resolve(process.argv[resumeIndex+1]??'');
const resumed=resumeFile?demoConfig(root,{...process.env,DGOP_ENV_FILE:resumeFile}):null;
if(resumed){assert.equal(resumed.env.NODE_ENV,'test');assert.equal(resumed.env.DGOP_DEMO_QA,'true');assert.equal(readManifest(resumed).qaOnly,true);assert.match(resumed.database,/^dgop_ai_test_governance_\d+$/);}
const database = resumed?.database??('dgop_ai_test_governance_' + Date.now()), installationId = resumed?.env.DGOP_DEMO_INSTALLATION_ID??randomUUID();
const directory = resumed?.installationRoot??join(root, 'storage/qa-native', database), profile = join(directory, 'installation.json'), envFile = resumeFile??join(directory, '.env.qa');
if(!resumed){mkdirSync(directory, { recursive: true }); for (const name of ['evidence', 'attachments', 'sources', 'logs']) mkdirSync(join(directory, name));}
const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); let port = server.address().port; await new Promise(done => server.close(done));
if(resumed)port=resumed.port;
const connection = new URL(url); connection.pathname = '/' + database;
const secret = () => randomBytes(32).toString('hex');
const env = { NODE_ENV: 'test', PORT: String(port), DATABASE_URL: connection.href, DGOP_AI_TEST_DATABASE_URL: connection.href, DGOP_DEMO_DATABASE_PORT: '55438', DGOP_DEMO_QA: 'true', DGOP_BIND_HOST: '127.0.0.1', DGOP_REQUIRE_STRICT_RUNTIME: 'true', DGOP_TRUST_PROXY: 'false', PUBLIC_ORIGIN: 'http://127.0.0.1:' + port, CORS_ORIGINS: 'http://127.0.0.1:' + port, JWT_SECRET: secret(), DGOP_SEARCH_QUERY_KEY: secret(), DGOP_BPMN_SIGNING_SECRET: secret(), DGOP_WEBHOOK_TOKEN: secret(), JWT_EXPIRES_IN: '8h', HEALTH_INCLUDE_DETAILS: 'false', DGOP_AUDIT_FAIL_CLOSED: 'true', SEED_ADMIN_EMAIL: 'demo.administrator@dgop.local', SEED_ADMIN_PASSWORD: secret() + '!', SEED_PERSON_PASSWORD: secret() + '!', DGOP_DEMO: 'true', DGOP_AI_DEMO_MODE: 'true', DGOP_DEMO_FIXTURE_VERSION: 'governance-demo-v1', DGOP_DEMO_INSTALLATION_ID: installationId, DGOP_DEMO_ROOT: directory, DGOP_DEMO_PROFILE_FILE: profile, DGOP_DEMO_MANIFEST: join(directory, 'manifest.json'), DGOP_DEMO_CREDENTIALS: join(directory, 'credentials.local.json'), DGOP_DEMO_RESULT: join(directory, 'verification.json'), EVIDENCE_STORAGE_DIR: join(directory, 'evidence'), WORKFLOW_ATTACHMENT_STORAGE_DIR: join(directory, 'attachments'), AI_MIGRATION_SOURCE_DIR: join(directory, 'sources'), AI_MIGRATION_SOURCE_MANIFEST: join(directory, 'sources/manifest.json'), WORKFLOW_EXECUTION_SCHEDULER: 'false', GOVERNANCE_OPERATIONS_SCHEDULER: 'false', DGOP_WORKFLOW_STARTUP_MAINTENANCE: 'false', DGOP_DEMO_ADAPTERS: 'true', DGOP_ALLOW_DESTRUCTIVE_SEED: 'false', DGOP_ALLOW_PRODUCTION_SEED: 'false' };
if(!resumed){
atomicJson(profile, { profileVersion: 1, demoOnly: true, qaOnly: true, database, installationId, installationRoot: directory, bindHost: '127.0.0.1' });
writeFileSync(envFile, Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { mode: 0o600 });
installSyntheticSources(env.AI_MIGRATION_SOURCE_DIR);
atomicJson(env.DGOP_DEMO_MANIFEST, { manifestVersion: 1, fixtureVersion: 'governance-demo-v1', demoOnly: true, qaOnly: true, database, installationId, actors: {}, cases: [], references: {}, checkpoints: {}, createdAt: new Date().toISOString() });
atomicJson(env.DGOP_DEMO_CREDENTIALS, { demoOnly: true, qaOnly: true, installationId, previewUrl: 'http://localhost:' + port + '/', accounts: [] });
}
const config = demoConfig(root, { ...process.env, DGOP_ENV_FILE: envFile }); applyDemoEnvironment(config);
const childEnv = { ...config.env, DGOP_NODE_EXE: process.execPath, DGOP_DEMO_ADAPTER_SCHEDULER: 'false', PATH: dirname(process.execPath) + ';' + (config.env.PATH ?? '') };
const run = (script, args = []) => { const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true }); if (result.error || result.status !== 0) throw new Error('Engineering fixture step failed: ' + script); };
const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.href } } });
try { if(!resumed)await admin.$executeRawUnsafe('CREATE DATABASE "' + database + '"'); } finally { await admin.$disconnect(); }
const deployed = spawnSync(process.execPath, [join(root, 'apps/api/node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: join(root, 'apps/api'), env: childEnv, stdio: 'inherit', windowsHide: true });
assert.equal(deployed.status, 0, 'Engineering database migrations must deploy');
const db = new PrismaClient({ datasources: { db: { url: connection.href } } });
async function businessIdentity() {
  const result = {};
  for (const model of ['user', 'dataAsset', 'stewardshipAssignment', 'ndiEvidence', 'dataQualityIssue', 'privacyDsrRequest', 'privacyBreach', 'accessGrant', 'accessEnforcementAttempt', 'workflowCase', 'workflowTaskAttachment', 'aiUseCase', 'aiRisk', 'aiAssessmentRound', 'aiTreatmentAction']) result[model] = (await db[model].findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(row => row.id);
  return result;
}
async function pendingReview(verify = false) {
  const child = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], { cwd: root, env: childEnv, stdio: 'ignore', windowsHide: true });
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) { if (child.exitCode !== null) throw new Error('Engineering API stopped early'); try { const response = await fetch(config.base + '/api/health', { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).database?.status === 'up') { ready = true; break; } } catch {} await delay(500); }
    assert.equal(ready, true, 'Engineering API must become ready'); run('seed-ai-review-example.mjs', ['--qa-fixture']);
    if (verify) run('verify-ai-demo.mjs', ['--qa-fixture']);
  } finally { const closed = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([closed, delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
try {
  const beforeResume=resumed?await businessIdentity():null;
  const beforeCredentials=JSON.parse(readFileSync(config.credentialsPath,'utf8')).accounts.map(({email,password})=>({email,password}));
  run('demo-bootstrap.mjs'); run('seed-ai-demo.mjs', ['--qa-fixture']); await pendingReview(); run('demo-core-fixtures.mjs'); run('demo-privacy-access-fixtures.mjs'); run('verify-demo-governance.mjs'); await pendingReview(true);
  if(beforeResume){const recovered=await businessIdentity();for(const [model,ids]of Object.entries(beforeResume))assert.ok(ids.every(id=>recovered[model].includes(id)),'Interrupted installation must preserve every committed '+model+' identity');}
  const afterCredentials=JSON.parse(readFileSync(config.credentialsPath,'utf8')).accounts;
  assert.ok(beforeCredentials.every(before=>afterCredentials.some(after=>after.email===before.email&&after.password===before.password)),'Recovery preserves every existing credential');
  const original = await businessIdentity();
  run('demo-bootstrap.mjs'); run('seed-ai-demo.mjs', ['--qa-fixture']); await pendingReview(); run('demo-core-fixtures.mjs'); run('demo-privacy-access-fixtures.mjs'); run('verify-demo-governance.mjs'); await pendingReview(true);
  assert.deepEqual(await businessIdentity(), original, 'Replaying completed setup must preserve every native fixture identity');
  const manifest = readManifest(config); assert.equal(manifest.cases.length, fixtureDefinition(root,manifest.fixtureVersion).completedAiJourneys.length); assert.ok(manifest.cases.every(row => row.complete)); assert.ok(manifest.reviewExample?.completeInput); assert.equal(manifest.core.assignmentIds.length, 2); assert.ok(manifest.core.stewardshipCaseId);
  atomicJson(join(directory, 'engineering-verification.json'), { qaOnly: true, demoOnly: true, isLicensedDemoAcceptance: false, completedAt: new Date().toISOString(), database, nativeFixturesPassed: true, interruptedInstallationResumed:!!resumed,existingCredentialsPreserved:true, completedSetupReplayPreservedIdentities: true, sourceVersion: 'synthetic-sources-v1', realLicenseRequiredForDemoAcceptance: true });
  console.log('Engineering governance fixtures and setup replay passed. This does not certify the licensed demo, browser journeys, original retained workbooks or the 60-minute soak.');
} finally { await db.$disconnect(); }
