import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DemoAccessConnectorService } from '../src/access/demo-access-connector.service';

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
const actor = { id: 'simulation-administrator', email: 'demo.administrator@dgop.local', roles: ['system_admin'] };
const keys = ['DGOP_DEMO', 'DGOP_DEMO_ADAPTERS', 'DGOP_DEMO_ROOT', 'DGOP_DEMO_PROFILE_FILE', 'DGOP_DEMO_INSTALLATION_ID', 'DGOP_DEMO_CONNECTOR_FAILURES', 'DGOP_AI_TEST_DATABASE_URL', 'DATABASE_URL', 'NODE_ENV'] as const;
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), 'dgop-access-worker-test-')));
const profileFile = join(temporaryRoot, 'profile.json');
writeFileSync(profileFile, JSON.stringify({ profileVersion: 1, demoOnly: true, database: 'dgop_ai_test_worker', installationId: 'unit-worker-20261003', installationRoot: temporaryRoot, bindHost: '127.0.0.1' }));

function managed(failures: number) {
  const url = 'postgresql://dgop_stability@127.0.0.1:55438/dgop_ai_test_worker';
  Object.assign(process.env, { DGOP_DEMO: 'true', DGOP_DEMO_ADAPTERS: 'true', DGOP_DEMO_ROOT: temporaryRoot, DGOP_DEMO_PROFILE_FILE: profileFile, DGOP_DEMO_INSTALLATION_ID: 'unit-worker-20261003', DATABASE_URL: url, DGOP_AI_TEST_DATABASE_URL: url, NODE_ENV: 'test', DGOP_DEMO_CONNECTOR_FAILURES: String(failures) });
}

function fixture(failCompletionOnce = false, stale = false) {
  let state: any = { id: 'attempt-worker', grantId: 'grant-worker', operation: 'revoke', connectorCode: 'demo_simulator', completionVersion: 7, attemptCount: 0, status: 'queued', nextAttemptAt: new Date(0), createdAt: new Date(0), errorCode: null };
  const audits: any[] = [], completions: any[] = [];
  let queries = 0, remainingCompletionFailures = failCompletionOnce ? 1 : 0;
  const rows = {
    findMany: async () => { queries++; return state.nextAttemptAt <= new Date() && ['queued', 'running', 'retrying'].includes(state.status) && (state.attemptCount < 3 || state.status === 'running' && state.attemptCount === 3) ? [structuredClone(state)] : []; },
    updateMany: async (args: any) => {
      if (state.attemptCount !== args.where.attemptCount || !args.where.status.in.includes(state.status)) return { count: 0 };
      Object.assign(state, args.data); return { count: 1 };
    },
  };
  const db: any = { user: { findFirst: async () => ({ ...actor, userRoles: [{ role: { code: 'system_admin' } }] }) }, accessEnforcementAttempt: rows,
    $transaction: async (fn: any) => { const original = structuredClone(state); try { return await fn(db); } catch (error) { state = original; throw error; } } };
  const grants: any = {
    dispatchEnforcement: async (_id: string, dto: any) => { assert.equal(dto.connectorCode, 'demo_simulator'); return { attempt: state }; },
    completeEnforcementAttempt: async (id: string, dto: any) => {
      assert.equal(id, state.id); assert.equal(dto.expectedVersion, 7, 'Worker must bind to the immutable dispatch version');
      completions.push(dto);
      if (remainingCompletionFailures-- > 0) throw new Error('Required completion audit is temporarily unavailable');
      state.status = dto.status; state.errorCode = dto.errorCode ?? null;
      return { requiresReconciliation: stale, appliedToGrant: !stale };
    },
  };
  const audit: any = { logRequired: async (entry: any) => audits.push(entry) };
  const worker = new DemoAccessConnectorService(db, grants, audit);
  return { worker, state: () => state, audits, completions, queries: () => queries, due: () => { state.nextAttemptAt = new Date(0); } };
}

test('simulation refuses developer databases and performs no worker reads or writes', async () => {
  managed(0); process.env.DATABASE_URL = 'postgresql://local@127.0.0.1:55438/dgop_dev';
  const f = fixture(); await assert.rejects(f.worker.dispatch('grant-worker', 6, 'revoke', actor), /disabled/);
  await f.worker.tick(); assert.equal(f.queries(), 0); assert.equal(f.audits.length, 0);
});

test('two simulated failures retry then succeed on the third bounded attempt', async () => {
  managed(2); const f = fixture();
  for (let i = 0; i < 3; i++) { f.due(); await f.worker.tick(); }
  assert.equal(f.state().attemptCount, 3); assert.equal(f.state().status, 'succeeded');
  assert.equal(f.completions.length, 1); assert.equal(f.audits.length, 3);
  for (const row of f.audits) { assert.equal(row.metadata.simulated, true); assert.equal(row.metadata.externalDelivery, false); }
  f.due(); await f.worker.tick(); assert.equal(f.completions.length, 1);
});

test('three simulated failures record exhausted failure and cannot claim a fourth attempt', async () => {
  managed(3); const f = fixture();
  for (let i = 0; i < 4; i++) { f.due(); await f.worker.tick(); }
  assert.equal(f.state().attemptCount, 3); assert.equal(f.state().status, 'failed');
  assert.equal(f.state().errorCode, 'demo_retries_exhausted'); assert.equal(f.audits.length, 3);
  assert.equal(f.audits[2].metadata.exhausted, true); assert.equal(f.completions.length, 1);
});

test('completion audit failure resumes the third immutable observation without a fourth provider attempt', async () => {
  managed(3); const f = fixture(true);
  for (let i = 0; i < 3; i++) { f.due(); await f.worker.tick(); }
  assert.equal(f.state().attemptCount, 3); assert.equal(f.state().status, 'running');
  f.due(); await f.worker.tick();
  assert.equal(f.state().status, 'failed'); assert.equal(f.state().attemptCount, 3);
  assert.equal(f.audits.length, 3); assert.equal(f.completions.length, 2);
  assert.deepEqual(f.completions[0], f.completions[1]);
});

test('concurrent ticks claim once and stale observations retain their dispatch binding', async () => {
  managed(0); const f = fixture(false, true);
  await Promise.all([f.worker.tick(), f.worker.tick()]);
  assert.equal(f.state().attemptCount, 1); assert.equal(f.completions.length, 1);
  assert.equal(f.completions[0].expectedVersion, 7); assert.equal(f.audits.length, 1);
});

void (async () => {
  let passed = 0;
  try {
    for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); passed++; } catch (error) { console.error('FAIL ' + name, error); process.exitCode = 1; } }
    console.log(passed + '/' + tests.length + ' managed access worker scenarios passed');
  } finally {
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    const child = relative(realpathSync(tmpdir()), temporaryRoot);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child), 'Only the generated test directory can be removed');
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
})();
