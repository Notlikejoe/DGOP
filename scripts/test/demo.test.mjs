import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fixtureDefinition, demoConfig, isManagedDemoProfile, atomicJson, replaceCheckpoint, readManifest, sha256 } from '../demo-profile.mjs';
import { installSyntheticSources, syntheticFixtureManifest, syntheticWorkbook } from '../demo-sources.mjs';
import { directoryFingerprint, sameFingerprint } from '../demo-files.mjs';
import { assertSnapshotAttestation } from '../snapshot-attestation.mjs';
import { environmentFile, loadEnvironment } from '../runtime-env.mjs';
import { runtimeCommand } from '../node-runtime.mjs';
import { runDemoProcess } from '../demo-process.mjs';
import { demoFetch } from '../demo-http.mjs';
import { createServer } from 'node:http';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dgop-managed-demo-')), id = randomUUID();
  const profile = join(root, 'installation.json'), path = join(root, '.env.demo');
  const env = { DATABASE_URL: 'postgresql://demo:test-only@127.0.0.1:55438/dgop_ai_preview_20261003', NODE_ENV: 'development', DGOP_DEMO: 'true', DGOP_BIND_HOST: '127.0.0.1', PORT: '4207', DGOP_DEMO_ROOT: root, DGOP_DEMO_PROFILE_FILE: profile, DGOP_DEMO_INSTALLATION_ID: id, DGOP_DEMO_FIXTURE_VERSION: 'governance-demo-v1' };
  atomicJson(profile, { profileVersion: 1, demoOnly: true, database: 'dgop_ai_preview_20261003', installationId: id, installationRoot: root, bindHost: '127.0.0.1' });
  const save = values => writeFileSync(path, Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n'));
  save(env); return { root, path, profile, env, save };
}

test('transient Windows checkpoint locks retry atomically and persistent errors preserve recovery files', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgop-checkpoint-lock-')), destination = join(root, 'checkpoint.json'), temporary = join(root, 'replacement.tmp');
  writeFileSync(destination, 'previous'); writeFileSync(temporary, 'next');
  let attempts = 0; const waits = [];
  replaceCheckpoint(temporary, destination, (from, to) => { if (++attempts < 3) throw Object.assign(new Error('sharing violation'), {code:'EPERM'}); renameSync(from,to); }, milliseconds => waits.push(milliseconds));
  assert.equal(readFileSync(destination,'utf8'),'next'); assert.deepEqual(waits,[50,100]); assert.equal(existsSync(temporary),false);
  writeFileSync(temporary,'later'); attempts=0;
  assert.throws(() => replaceCheckpoint(temporary,destination,()=>{attempts++;throw Object.assign(new Error('locked'),{code:'EACCES'});},()=>{}), /locked/);
  assert.equal(attempts,6); assert.equal(readFileSync(destination,'utf8'),'next'); assert.equal(readFileSync(temporary,'utf8'),'later');
  attempts=0; assert.throws(()=>replaceCheckpoint(temporary,destination,()=>{attempts++;throw Object.assign(new Error('invalid target'),{code:'ENOENT'});},()=>{}), /invalid target/); assert.equal(attempts,1);
});
test('managed profiles reject remote/developer databases, missing identity and client-style toggles', () => {
  const f = fixture(); assert.equal(isManagedDemoProfile(f.env), true);
  for (const DATABASE_URL of ['postgresql://demo@db.example/dgop_ai_preview_20261003', 'postgresql://demo@localhost/dgop_dev', 'https://localhost/dgop_ai_preview_20261003']) assert.equal(isManagedDemoProfile({ ...f.env, DATABASE_URL }), false);
  for (const changes of [{ DGOP_DEMO: '1' }, { DGOP_DEMO_PROFILE_FILE: '' }, { DGOP_DEMO_INSTALLATION_ID: 'different-id' }, { DGOP_DEMO_ROOT: '.' }]) assert.equal(isManagedDemoProfile({ ...f.env, ...changes }), false);
  const testUrl = 'postgresql://demo@127.0.0.1:55438/dgop_ai_test_contract';
  atomicJson(f.profile, { profileVersion: 1, demoOnly: true, database: 'dgop_ai_test_contract', installationId: f.env.DGOP_DEMO_INSTALLATION_ID, installationRoot: f.root, bindHost: '127.0.0.1' });
  assert.equal(isManagedDemoProfile({ ...f.env, DATABASE_URL: testUrl, DGOP_AI_TEST_DATABASE_URL: testUrl }), false);
  assert.equal(isManagedDemoProfile({ ...f.env, NODE_ENV: 'test', DATABASE_URL: testUrl, DGOP_AI_TEST_DATABASE_URL: testUrl }), true);
});
test('explicit demo configuration ignores inherited developer URLs, secrets and Node preload paths', () => {
  const f = fixture(), config = demoConfig(f.root, { DGOP_ENV_FILE: f.path, DATABASE_URL: 'postgresql://localhost/dgop_dev', JWT_SECRET: 'older-secret', NODE_PATH: 'older-dependencies', NODE_OPTIONS: '--require older-code', PATH: 'os-path' });
  assert.equal(config.env.DATABASE_URL, f.env.DATABASE_URL); assert.equal(config.env.JWT_SECRET, undefined); assert.equal(config.env.NODE_PATH, undefined); assert.equal(config.env.NODE_OPTIONS, undefined); assert.equal(config.env.PATH, 'os-path');
  assert.throws(() => demoConfig(f.root, { DGOP_ENV_FILE: f.path.replace(f.root, '.') }), /absolute path/);
  f.save({ ...f.env, EVIDENCE_STORAGE_DIR: resolve(f.root, '..', 'outside-demo') }); assert.throws(() => demoConfig(f.root, { DGOP_ENV_FILE: f.path }), /inside/);
});
test('fixture manifest identity and version must match the selected installation', () => {
  const f = fixture(), config = demoConfig(f.root, { DGOP_ENV_FILE: f.path });
  const manifest = { manifestVersion: 1, fixtureVersion: 'governance-demo-v1', demoOnly: true, database: config.database, installationId: f.env.DGOP_DEMO_INSTALLATION_ID };
  atomicJson(config.manifestPath, manifest); assert.equal(readManifest(config).installationId, manifest.installationId);
  atomicJson(config.manifestPath, { ...manifest, installationId: randomUUID() }); assert.throws(() => readManifest(config), /identity differs/);
  atomicJson(config.manifestPath, { ...manifest, fixtureVersion: 'governance-demo-v2' }); assert.throws(() => readManifest(config), /version/);
});
test('every synthetic XLSX version is packaged, reproducible, pinned and preserves unexpected installed files', () => {
  for (const version of ['v1', 'v2', 'v3']) {
  const directory = mkdtempSync(join(tmpdir(), 'dgop-synthetic-sources-')), pinned = syntheticFixtureManifest(version);
  for (const source of pinned.sources) assert.equal(sha256(syntheticWorkbook(source.source,version)), source.sha256);
  assert.throws(() => syntheticWorkbook('unknown'), /Unknown/);
  assert.deepEqual(installSyntheticSources(directory,version), pinned); const before = directoryFingerprint(directory);
  installSyntheticSources(directory,version); assert.ok(sameFingerprint(before, directoryFingerprint(directory)));
  writeFileSync(join(directory, pinned.sources[0].file), 'preserve this unexpected file'); assert.throws(() => installSyntheticSources(directory,version), /preserve/); assert.equal(readFileSync(join(directory, pinned.sources[0].file), 'utf8'), 'preserve this unexpected file');
  }
});
test('the versioned governance definition supplies complete journey totals and rejects unknown versions', () => {
  const root = resolve(fileURLToPath(new URL('../..',import.meta.url))), definition = fixtureDefinition(root);
  assert.equal(definition.completedAiJourneys.length,3); assert.equal(definition.pendingAiJourneys,1);
  assert.equal(definition.isComplianceProof,false); assert.equal(definition.core.assignments,2);
  assert.throws(() => fixtureDefinition(root,'unknown'),/Unsupported/);
});
test('database recovery file proof detects altered bytes and preserves nested paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dgop-recovery-files-')); mkdirSync(join(directory, 'nested')); writeFileSync(join(directory, 'nested/proof.txt'), 'synthetic evidence');
  const original = directoryFingerprint(directory); assert.equal(original[0].path, 'nested/proof.txt'); assert.ok(sameFingerprint(original, directoryFingerprint(directory)));
  writeFileSync(join(directory, 'nested/proof.txt'), 'altered evidence'); assert.equal(sameFingerprint(original, directoryFingerprint(directory)), false);
});
test('attested snapshot rejects changed, unlisted and escaping source files', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgop-attestation-')), file = join(root, 'source.ts'), proof = join(root, 'attestation.json'); writeFileSync(file, 'export const synthetic = true;\n');
  const manifest = { manifestVersion: 1, kind: 'dgop-source-snapshot', sourceCommit: 'a'.repeat(40), snapshotRoot: root, files: [{ path: 'source.ts', sha256: sha256(readFileSync(file)) }] }; atomicJson(proof, manifest);
  assert.equal(assertSnapshotAttestation(root, proof).files, 1); writeFileSync(file, 'changed'); assert.throws(() => assertSnapshotAttestation(root, proof), /changed/); writeFileSync(file, 'export const synthetic = true;\n');
  writeFileSync(join(root, 'unknown.ts'), 'unattested'); assert.throws(() => assertSnapshotAttestation(root, proof), /Unattested/); atomicJson(proof, { ...manifest, files: [{ path: '../escape', sha256: 'b'.repeat(64) }] }); assert.throws(() => assertSnapshotAttestation(root, proof), /Unsafe/);
});
test('ordinary environment loading keeps explicit process precedence and fails missing explicit files', () => {
  const f = fixture(); assert.equal(environmentFile(f.root, { DGOP_ENV_FILE: f.path }), f.path); assert.equal(loadEnvironment(f.root, { DGOP_ENV_FILE: f.path, PORT: '4210' }).PORT, '4210'); assert.throws(() => environmentFile(f.root, { DGOP_ENV_FILE: join(f.root, 'missing') }), /missing/);
});
test('npm and npx children use the same executable and sanitize inherited module loading', () => {
  const root = mkdtempSync(join(tmpdir(), 'dgop-node-contract-')), npm = join(root, 'npm'), cli = join(npm, 'bin/npm-cli.js'); mkdirSync(join(npm, 'bin'), { recursive: true }); writeFileSync(cli, ''); writeFileSync(join(npm, 'bin/npx-cli.js'), ''); atomicJson(join(npm, 'package.json'), { version: '11.13.0' });
  const selected = runtimeCommand(root, 'npm.cmd', ['--version'], { DGOP_NPM_CLI: cli, NODE_PATH: 'older-dependencies', NODE_OPTIONS: '--require older-code', PATH: 'os-path' });
  assert.equal(selected.command, process.execPath); assert.deepEqual(selected.args, [cli, '--version']); assert.equal(selected.env.NODE_PATH, undefined); assert.equal(selected.env.NODE_OPTIONS, undefined); assert.ok(selected.env.PATH.includes(join(root, 'tmp/node-runtime'))); assert.ok(readFileSync(join(root, 'tmp/node-runtime/npm.cmd'), 'utf8').includes(process.execPath));
});
test('genuine license preflight blocks setup before any database access', () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), 'dgop-license-gate-'));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'apps/web/src/app/core'), { recursive: true });
  for (const file of ['demo.mjs', 'demo-files.mjs', 'demo-profile.mjs', 'runtime-env.mjs', 'demo-sources.mjs', 'snapshot-attestation.mjs', 'demo-process.mjs', 'demo-http.mjs']) copyFileSync(new URL('../' + file, import.meta.url), join(root, 'scripts', file));
  writeFileSync(join(root, 'apps/web/src/app/core/primeui-license.local.ts'), "export const primeUiLicense = '';\n");
  const result = spawnSync(process.execPath, [join(root, 'scripts/demo.mjs'), 'preflight', '--profile', f.path], { encoding: 'utf8', env: { ...process.env, DGOP_ENV_FILE: undefined } });
  assert.equal(result.status, 1); assert.match(result.stderr, /genuine PrimeUI license/); assert.equal(readFileSync(f.profile, 'utf8').includes('dgop_ai_preview_20261003'), true);
});

test('native check children leave the parent HTTP event loop responsive', async () => {
  const server = createServer((_request, response) => response.end('healthy'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let completed = false, servedWhileChildRunning = false;
  const reading = new Promise((done, reject) => setTimeout(async () => {
    try {
      const response = await demoFetch('http://127.0.0.1:' + server.address().port + '/api/health');
      assert.equal(await response.text(), 'healthy');
      servedWhileChildRunning = !completed; done();
    } catch (error) { reject(error); }
  }, 50));
  try {
    await runDemoProcess(['-e', 'setTimeout(()=>{},1000)'], { stdio: 'ignore' });
    completed = true; await reading;
    assert.equal(servedWhileChildRunning, true);
    await assert.rejects(() => runDemoProcess(['-e', 'process.exit(7)'], { stdio: 'ignore' }), /stopped \(7\)/);
  } finally { await new Promise(done => server.close(done)); }
});

test('transport diagnostics identify the path and cause without retries or private query values', async () => {
  let attempts = 0;
  await assert.rejects(() => demoFetch('http://127.0.0.1:4207/api/health?private=SYNTHETIC_QUERY_SECRET', {}, async () => {
    attempts++; throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
  }), error => {
    assert.match(error.message, /GET \/api\/health failed \(UND_ERR_SOCKET\)/);
    assert.ok(!error.message.includes('SYNTHETIC_QUERY_SECRET')); return true;
  });
  assert.equal(attempts, 1);
});
