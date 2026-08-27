import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { localConfig, checkAdmin, databaseIsEmpty, verifyHttpLogin } from '../local.mjs';

const env = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://postgres:local-only@127.0.0.1:55436/dgop_dev', SEED_ADMIN_PASSWORD: 'test-only-password' };

test('local commands reject strict runtimes and nonlocal or maintenance databases', () => {
  for (const NODE_ENV of ['production', 'uat', 'test', 'staging']) assert.throws(() => localConfig({ ...env, NODE_ENV }), /development mode/);
  for (const flag of ['true', '1', 'yes', 'ON']) assert.throws(() => localConfig({ ...env, DGOP_REQUIRE_STRICT_RUNTIME: flag }), /development mode/);
  for (const url of ['postgresql://user:pass@db.example/dgop', 'https://localhost/dgop']) {
    assert.throws(() => localConfig({ ...env, DATABASE_URL: url }), /loopback PostgreSQL/);
  }
  assert.throws(() => localConfig({ ...env, DATABASE_URL: 'postgresql://localhost/postgres' }), /dedicated local/);
  assert.throws(() => localConfig({ ...env, DGOP_BIND_HOST: '0.0.0.0' }), /127.0.0.1/);
  assert.throws(() => localConfig({ ...env, PORT: 'NaN' }), /PORT/);
  assert.equal(localConfig({ ...env, SEED_ADMIN_EMAIL: ' ADMIN@DGOP.LOCAL ' }).email, 'admin@dgop.local');
});

test('local preparation is idempotent and preserves not-so-strong local passwords', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgop-local-config-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(new URL('../prepare-demo-env.mjs', import.meta.url), join(root, 'scripts/prepare-demo-env.mjs'));
  writeFileSync(join(root, '.env.example'), 'NODE_ENV=development\nSEED_ADMIN_PASSWORD=replace-with-local-demo-password\n');
  const prepare = (args = ['--local']) => spawnSync(process.execPath, [join(root, 'scripts/prepare-demo-env.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development', DGOP_REQUIRE_STRICT_RUNTIME: 'false' },
  });
  assert.equal(prepare().status, 0);
  const generated = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
  assert.ok(generated.SEED_ADMIN_PASSWORD.length >= 12);
  assert.notEqual(generated.JWT_SECRET, generated.DGOP_BPMN_SIGNING_SECRET);
  const original = readFileSync(join(root, '.env'), 'utf8');
  assert.equal(prepare().status, 0);
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), original);
  const withLocalPassword = original.replace(generated.SEED_ADMIN_PASSWORD, 'admin123456@');
  writeFileSync(join(root, '.env'), withLocalPassword);
  assert.equal(prepare().status, 0);
  assert.equal(parseEnv(readFileSync(join(root, '.env'), 'utf8')).SEED_ADMIN_PASSWORD, 'admin123456@');
  assert.equal(prepare([]).status, 0);
  assert.notEqual(parseEnv(readFileSync(join(root, '.env'), 'utf8')).SEED_ADMIN_PASSWORD, 'admin123456@');
});

test('account checks never write or silently enable users, repair roles, or reset passwords', async () => {
  const user = { isActive: true, passwordHash: 'hash', userRoles: [{ role: { code: 'system_admin', isActive: true, deletedAt: null } }] };
  const db = (row) => ({ user: { findUnique: async () => row } });
  const config = localConfig(env);
  assert.equal(await checkAdmin(db(user), config, async () => true), user);
  await assert.rejects(checkAdmin(db(null), config, async () => true), /missing/);
  await assert.rejects(checkAdmin(db({ ...user, isActive: false }), config, async () => true), /disabled/);
  await assert.rejects(checkAdmin(db({ ...user, userRoles: [] }), config, async () => true), /role/);
  await assert.rejects(checkAdmin(db(user), config, async () => false), /startup never resets/);
});

test('seed gate checks all application tables, not just users', async () => {
  const db = { user: { count: async () => 0 }, evidence: { count: async () => 1 } };
  assert.equal(await databaseIsEmpty(db, ['User', 'Evidence']), false);
  db.evidence.count = async () => 0;
  assert.equal(await databaseIsEmpty(db, ['User', 'Evidence']), true);
});

test('readiness requires both a login cookie and a working authenticated session', async () => {
  const config = localConfig(env);
  const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
  const healthy = () => response({ service: 'dgop-api', database: { status: 'up' } });
  const goodSession = () => response({ email: config.email, isActive: true, roles: [{ code: 'system_admin' }] });
  let calls = 0;
  await verifyHttpLogin(config, async (_url, options) => {
    calls++;
    if (calls === 1) return healthy();
    if (calls === 2) return response({}, 201, { 'set-cookie': 'dgop_session=test-token; HttpOnly' });
    assert.equal(options.headers.Cookie, 'dgop_session=test-token');
    return goodSession();
  });
  for (const status of [401, 429, 503]) {
    let step = 0;
    await assert.rejects(verifyHttpLogin(config, async () => ++step === 1 ? healthy() : response({}, status)), new RegExp(String(status)));
  }
  let step = 0;
  await assert.rejects(verifyHttpLogin(config, async () => ++step === 1 ? healthy() : response({}, 201)), /session cookie/);
});
