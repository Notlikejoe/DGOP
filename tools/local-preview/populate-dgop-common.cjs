'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { createRequire } = require('node:module');
const state = 'C:/Users/Youss/Documents/Codex/work/dgop-access-sync';
const root = state + '/source';
const folder = state + '/population';
const definition = JSON.parse(fs.readFileSync(path.join(__dirname, 'populate-dgop-definition.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' && !(value instanceof Date)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)])) : value;
const digest = value => hash(JSON.stringify(ordered(value)));
function inside(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Path escapes managed folder');
  return path.resolve(target);
}
function atomic(file, value) {
  inside(folder, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  // Keep the previous checkpoint if Windows holds the destination; never delete it.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temporary, file); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}
function guardConfig(config, env, checkpoint) {
  const url = new URL(config.url);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55436');
  assert.equal(url.pathname, '/dgop_access_sync_qa_20261007');
  assert.equal(config.profile, 'access-sync-test');
  assert.equal(checkpoint.profile, config.profile);
  assert.equal(checkpoint.root.replaceAll('\\', '/'), root);
  assert.equal(env.DATABASE_URL, config.url, 'Explicit environment database differs');
  assert.equal(env.DGOP_PROFILE, config.profile);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.PORT, '4208');
  assert.equal(env.DGOP_BIND_HOST, '127.0.0.1');
  assert.notEqual(env.DGOP_NOTIFICATION_EXTERNAL_DELIVERY, 'true');
  assert(!fs.existsSync(root + '/.env'), 'Unexpected source .env; never allow implicit loading');
  return url;
}
function loadConfig() {
  assert.equal(process.versions.node, '24.19.0', 'Use the pinned Node runtime');
  const checkpoint = JSON.parse(fs.readFileSync(state + '/checkpoint.json', 'utf8'));
  assert.equal(checkpoint.status, 'batch-3-complete', 'Start from the verified access-sync candidate');
  const config = JSON.parse(fs.readFileSync(state + '/private/database.json', 'utf8'));
  assert.equal(path.resolve(checkpoint.configRef), path.resolve(state + '/private/runtime.env'));
  const env = parseEnv(fs.readFileSync(checkpoint.configRef, 'utf8'));
  const url = guardConfig(config, env, checkpoint);
  const req = createRequire(root + '/apps/api/package.json');
  return { checkpoint, config, env, url, req };
}
function runtimeEnvironment(env, url, essentials) {
  return { ...essentials, ...env, DATABASE_URL: url.href, DB_NAME: url.pathname.slice(1),
    GOVERNANCE_OPERATIONS_SCHEDULER: 'false', DGOP_NOTIFICATION_EXTERNAL_DELIVERY: 'false',
    PORT: '4208', HOST: '127.0.0.1', DGOP_BIND_HOST: '127.0.0.1' };
}
function assertOwned(key, row, item, expected) {
  assert(row && !row.deletedAt && row.isActive !== false, 'Missing/inactive managed record: ' + key);
  if (item) assert.equal(row.id, item.id, 'Checkpoint ownership differs: ' + key);
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(row[field], value, 'Unowned or manually changed record: ' + key + '.' + field);
}
function navigation(req) {
  const ts = req('typescript');
  const source = fs.readFileSync(root + '/apps/web/src/app/layout/navigation.ts', 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', output)(exports);
  const tools = exports.NAV_SECTIONS.flatMap(section => section.items.map(item => ({ section: section.id, route: item.link, labelKey: item.labelKey, permission: item.permission ?? null })));
  assert.equal(new Set(tools.map(tool => tool.route)).size, tools.length);
  assert.deepEqual(tools.map(tool => tool.route).sort(), Object.keys(definition.tools).sort(), 'Coverage definition differs from current navigation');
  return tools;
}
function referenceRoute(req, model) {
  const controllers = {
    systemPlatform: ['systems', 'SystemsController'], businessCapability: ['business-capabilities', 'BusinessCapabilitiesController'],
    dataSubject: ['data-subjects', 'DataSubjectsController'], raciTemplate: ['raci-templates', 'RaciTemplatesController']
  };
  const selected = controllers[model]; assert(selected, 'Unsupported foundation reference model');
  req('reflect-metadata');
  const controller = req(root + '/apps/api/dist/master-data/' + selected[0] + '.controller.js')[selected[1]];
  const route = Reflect.getMetadata('path', controller);
  assert.equal(Reflect.getMetadata('method', controller.prototype.create), 1, 'Native creation endpoint must be POST');
  assert(typeof route === 'string' && /^[a-z-]+$/.test(route)); return '/' + route;
}
function toolIdentity() {
  const files = ['populate-dgop.cjs', 'populate-dgop-common.cjs', 'populate-dgop-definition.json', 'populate-dgop.test.cjs'].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(__dirname, file))) }));
  return { sha256: digest(files), files };
}
function validateReceipt(receipt, candidate, tools) {
  assert.equal(receipt.status, 'passed', 'A failed/interrupted run cannot count as acceptance');
  assert.equal(receipt.fixtureVersion, definition.fixtureVersion); assert.equal(receipt.batch, 1);
  assert.deepEqual(receipt.binding, candidate); assert.deepEqual(receipt.toolIdentity, tools);
  assert.equal(receipt.environment.database.name, 'dgop_access_sync_qa_20261007'); assert.equal(receipt.environment.profile, 'access-sync-test');
  const start = Date.parse(receipt.startedAt), end = Date.parse(receipt.finishedAt);
  assert(Number.isFinite(start) && Number.isFinite(end) && end >= start);
  assert(receipt.checks.length > 0 && receipt.checks.every(check => check.passed === true && Date.parse(check.at) >= start && Date.parse(check.at) <= end), 'Invalid nested check time/result');
  assert(!receipt.error && !receipt.failureResponse, 'Receipt includes a failure');
}
module.exports = { fs, path, assert, crypto, state, root, folder, definition, hash, digest, inside, atomic, guardConfig, loadConfig, runtimeEnvironment, assertOwned, navigation, referenceRoute, toolIdentity, validateReceipt };
