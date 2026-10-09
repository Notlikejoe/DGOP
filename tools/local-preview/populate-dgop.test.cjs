'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./populate-dgop-common.cjs');
const valid = () => ({ config: { url: 'postgresql://test:unused@127.0.0.1:55436/dgop_access_sync_qa_20261007', profile: 'access-sync-test' }, env: { DATABASE_URL: 'postgresql://test:unused@127.0.0.1:55436/dgop_access_sync_qa_20261007', DGOP_PROFILE: 'access-sync-test', NODE_ENV: 'development', PORT: '4208', DGOP_BIND_HOST: '127.0.0.1' }, checkpoint: { profile: 'access-sync-test', root: c.root } });
test('Installer rejects original, remote, mismatched and outbound-enabled configurations', () => {
  const cases = [
    value => { value.config.url = value.env.DATABASE_URL = 'postgresql://test:unused@127.0.0.1:55436/dgop_dev'; },
    value => { value.config.url = value.env.DATABASE_URL = 'postgresql://test:unused@example.org:55436/dgop_access_sync_qa_20261007'; },
    value => { value.env.DATABASE_URL = 'postgresql://test:unused@127.0.0.1:55436/dgop_dev'; },
    value => { value.env.PORT = '4206'; },
    value => { value.env.DGOP_PROFILE = 'production'; },
    value => { value.env.DGOP_NOTIFICATION_EXTERNAL_DELIVERY = 'true'; },
    value => { value.checkpoint.root = 'C:/Users/Youss/OneDrive/Documents/DGOP'; }
  ];
  for (const change of cases) { const value = valid(); change(value); assert.throws(() => c.guardConfig(value.config, value.env, value.checkpoint)); }
  const value = valid(); assert.equal(c.guardConfig(value.config, value.env, value.checkpoint).pathname, '/dgop_access_sync_qa_20261007');
});
test('Conflicting fixture ownership and manually changed content are rejected', () => {
  const row = { id: 'owned', code: 'DEMO', description: 'installation-A', isActive: true };
  assert.throws(() => c.assertOwned('example', row, { id: 'other' }, { description: 'installation-A' }));
  assert.throws(() => c.assertOwned('example', row, null, { description: 'installation-B' }));
  assert.throws(() => c.assertOwned('example', { ...row, deletedAt: new Date() }, { id: row.id }, { description: 'installation-A' }));
  c.assertOwned('example', row, { id: row.id }, { description: 'installation-A' });
});
test('Launcher pins both database settings and disables real delivery despite inherited defaults', () => {
  const value = valid(); value.env.DB_NAME = 'dgop_dev'; value.env.PORT = '4206';
  const env = c.runtimeEnvironment(value.env, new URL(value.config.url), { PATH: 'pinned-node', DB_NAME: 'postgres', DGOP_NOTIFICATION_EXTERNAL_DELIVERY: 'true' });
  assert.equal(env.DB_NAME, 'dgop_access_sync_qa_20261007'); assert.equal(env.DATABASE_URL, value.config.url);
  assert.equal(env.PORT, '4208'); assert.equal(env.DGOP_NOTIFICATION_EXTERNAL_DELIVERY, 'false'); assert.equal(env.GOVERNANCE_OPERATIONS_SCHEDULER, 'false');
});
test('Backup paths cannot escape the managed installation', () => {
  assert.throws(() => c.inside(c.folder, c.folder + '/../source/private.txt'));
  assert.throws(() => c.inside(c.folder, c.folder));
  assert.throws(() => c.inside(c.folder, 'C:/Users/Youss/OneDrive/Documents/DGOP/storage'));
  assert(c.inside(c.folder, c.folder + '/private/backup/database.dump').endsWith('database.dump'));
});
test('Definition covers every current navigation tool and only real database models', () => {
  const config = c.loadConfig(), tools = c.navigation(config.req);
  assert.equal(tools.filter(tool => tool.section === 'aiGovernance').length, 6);
  const models = new Set(config.req('@prisma/client').Prisma.dmmf.datamodel.models.map(model => model.name));
  for (const tool of tools) {
    const spec = c.definition.tools[tool.route]; assert(spec.scenario.length > 20); assert(spec.batch >= 1 && spec.batch <= 5);
    for (const model of spec.models) assert(models.has(model), model);
  }
  assert.equal(c.definition.completedAiJourneys.length, 3); assert.equal(c.definition.pendingAiStages.length, 6);
  assert(!c.definition.specialists.some(person => ['system_admin', 'dmo_admin', 'security_admin'].includes(person.role)));
});
test('Foundation create routes come from the installed controllers rather than navigation aliases', () => {
  const config = c.loadConfig();
  assert.equal(c.referenceRoute(config.req, 'businessCapability'), '/business-capabilities');
  for (const reference of c.definition.references) assert(c.referenceRoute(config.req, reference.model).startsWith('/'));
  assert.throws(() => c.referenceRoute(config.req, 'user'));
});
test('Failed, stale and mismatched receipts cannot inherit a passing result', () => {
  const candidate = { source: 'candidate' }, tools = { sha256: 'tools' };
  const value = { status: 'passed', fixtureVersion: c.definition.fixtureVersion, batch: 1, binding: candidate, toolIdentity: tools,
    environment: { database: { name: 'dgop_access_sync_qa_20261007' }, profile: 'access-sync-test' },
    startedAt: '2026-10-09T00:00:00Z', finishedAt: '2026-10-09T00:00:02Z', checks: [{ passed: true, at: '2026-10-09T00:00:01Z' }] };
  c.validateReceipt(value, candidate, tools);
  for (const change of [row => { row.status = 'failed'; }, row => { row.binding = { source: 'old' }; }, row => { row.toolIdentity = { sha256: 'old' }; }, row => { row.checks[0].at = '2026-10-08T23:59:00Z'; }, row => { row.error = 'failed nested check'; }]) {
    const copy = structuredClone(value); change(copy); assert.throws(() => c.validateReceipt(copy, candidate, tools));
  }
});
