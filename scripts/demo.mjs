import { existsSync, readFileSync, mkdirSync, writeFileSync, openSync, closeSync, unlinkSync, copyFileSync, cpSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureDefinition, demoConfig, atomicJson, readManifest, sha256 } from './demo-profile.mjs';
import { installSyntheticSources } from './demo-sources.mjs';
import { assertSnapshotAttestation } from './snapshot-attestation.mjs';
import { directoryFingerprint, sameFingerprint } from './demo-files.mjs';
import { runDemoProcess } from './demo-process.mjs';
import { demoFetch as fetch } from './demo-http.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), command = args[0];
const flag = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (flag('--profile')) process.env.DGOP_ENV_FILE = resolve(flag('--profile'));
if (!/^24\.19\./.test(process.versions.node)) throw new Error('Use the supported Node 24.19 runtime for this isolated demonstration.');
function childEnv(env) {
  const safe = { ...env, DGOP_NODE_EXE: process.execPath };
  delete safe.NODE_PATH; delete safe.NODE_OPTIONS;
  safe.PATH = dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (safe.PATH ?? '');
  return safe;
}
function run(script, extra = [], env = process.env) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...extra], { cwd: root, env: childEnv(env), stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${script} stopped. Resolve its diagnostic before continuing.`);
}
function prepare() {
  const connection = new URL(process.env.DGOP_DEMO_DATABASE_URL ?? '');
  const databasePort = process.env.DGOP_DEMO_DATABASE_PORT ?? '55438';
  if (connection.protocol !== 'postgresql:' || connection.hostname !== '127.0.0.1' || connection.port !== databasePort || !/^\/dgop_ai_preview_\d+$/.test(connection.pathname) || !/^\d+$/.test(databasePort) || Number(databasePort) < 1024) throw new Error('Provide DGOP_DEMO_DATABASE_URL for a fresh managed preview database on the isolated loopback database port (default 55438).');
  const installationId = randomUUID();
  const directory = resolve(flag('--installation-root') ?? join(root, 'storage/demo', installationId));
  const envPath = resolve(flag('--profile') ?? join(directory, '.env.demo'));
  if (existsSync(envPath) || existsSync(join(directory, 'installation.json'))) throw new Error('This installation already exists. Use setup/check to resume; preparation never overwrites it.');
  mkdirSync(directory, { recursive: true });
  for (const name of ['evidence', 'attachments', 'sources', 'logs', 'backups']) mkdirSync(join(directory, name), { recursive: true });
  const profilePath = join(directory, 'installation.json');
  atomicJson(profilePath, { profileVersion: 1, demoOnly: true, database: connection.pathname.slice(1), databasePort, installationId, installationRoot: directory, bindHost: '127.0.0.1' });
  const secret = () => randomBytes(32).toString('hex'), password = () => randomBytes(24).toString('base64url') + '!';
  const env = { NODE_ENV: 'development', PORT: '4207', DATABASE_URL: connection.href, DGOP_DEMO_DATABASE_PORT: databasePort, DGOP_BIND_HOST: '127.0.0.1', DGOP_REQUIRE_STRICT_RUNTIME: 'true', DGOP_TRUST_PROXY: 'false', PUBLIC_ORIGIN: 'http://localhost:4207', CORS_ORIGINS: 'http://localhost:4207,http://127.0.0.1:4207', JWT_SECRET: secret(), DGOP_SEARCH_QUERY_KEY: secret(), DGOP_BPMN_SIGNING_SECRET: secret(), DGOP_WEBHOOK_TOKEN: secret(), JWT_EXPIRES_IN: '8h', HEALTH_INCLUDE_DETAILS: 'false', DGOP_AUDIT_FAIL_CLOSED: 'true', SEED_ADMIN_EMAIL: 'demo.administrator@dgop.local', SEED_ADMIN_PASSWORD: password(), SEED_PERSON_PASSWORD: password(), DGOP_DEMO: 'true', DGOP_AI_DEMO_MODE: 'true', DGOP_DEMO_FIXTURE_VERSION: 'governance-demo-v1', DGOP_DEMO_INSTALLATION_ID: installationId, DGOP_DEMO_ROOT: directory, DGOP_DEMO_PROFILE_FILE: profilePath, DGOP_DEMO_MANIFEST: join(directory, 'manifest.json'), DGOP_DEMO_CREDENTIALS: join(directory, 'credentials.local.json'), DGOP_DEMO_RESULT: join(directory, 'verification.json'), EVIDENCE_STORAGE_DIR: join(directory, 'evidence'), WORKFLOW_ATTACHMENT_STORAGE_DIR: join(directory, 'attachments'), AI_MIGRATION_SOURCE_DIR: join(directory, 'sources'), AI_MIGRATION_SOURCE_MANIFEST: join(directory, 'sources/manifest.json'), WORKFLOW_EXECUTION_SCHEDULER: 'false', GOVERNANCE_OPERATIONS_SCHEDULER: 'false', DGOP_WORKFLOW_STARTUP_MAINTENANCE: 'false', DGOP_DEMO_ADAPTERS: 'true', DGOP_ALLOW_DESTRUCTIVE_SEED: 'false', DGOP_ALLOW_PRODUCTION_SEED: 'false' };
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, Object.entries(env).map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`).join('\n') + '\n', { mode: 0o600 });
  installSyntheticSources(env.AI_MIGRATION_SOURCE_DIR);
  atomicJson(env.DGOP_DEMO_MANIFEST, { manifestVersion: 1, fixtureVersion: 'governance-demo-v1', demoOnly: true, database: connection.pathname.slice(1), installationId, actors: {}, cases: [], references: {}, checkpoints: {}, createdAt: new Date().toISOString() });
  atomicJson(env.DGOP_DEMO_CREDENTIALS, { demoOnly: true, installationId, previewUrl: 'http://localhost:4207/', accounts: [] });
  console.log('Demonstration configuration prepared. No database or developer account was changed.\nEnvironment: ' + envPath);
}
function preflight(config) {
  const license = join(root, 'apps/web/src/app/core/primeui-license.local.ts');
  if (!existsSync(license) || /primeUiLicense\s*=\s*(['"])\s*\1/.test(readFileSync(license, 'utf8'))) throw new Error('Provide your genuine PrimeUI license in apps/web/src/app/core/primeui-license.local.ts. Demo setup is blocked until it is supplied.');
  if (!existsSync(join(root, 'apps/api/dist/main.js')) || !existsSync(join(root, 'apps/web/dist/web/browser/index.html'))) throw new Error('Build the isolated API and web application before demo setup/start.');
  if (config.env.DGOP_SNAPSHOT_ATTESTATION) assertSnapshotAttestation(root, config.env.DGOP_SNAPSHOT_ATTESTATION);
  const require = createRequire(join(root, 'apps/api/package.json'));
  const { collectRuntimeSafetyIssues } = require(join(root, 'apps/api/dist/common/runtime-safety.js'));
  const issues = collectRuntimeSafetyIssues(config.env);
  if (issues.length) throw new Error('Demo configuration needs attention: ' + issues.join('; '));
  const { DEFAULT_WORKFLOW_TEMPLATES } = require(join(root, 'apps/api/dist/workflow/workflow.logic.js'));
  const { roles, permissionCatalog, ndiSpecifications } = require(join(root, 'apps/api/dist/common/governance-catalog.js'));
  const { AI_NEW_ROLES } = require(join(root, 'apps/api/dist/ai-governance/ai-permissions.js'));
  const knownRoles = new Set([...roles.map(row => row.code), ...AI_NEW_ROLES.map(row => row[0])]);
  if (new Set(permissionCatalog.map(row => row.resource + '.' + row.action)).size !== permissionCatalog.length || !ndiSpecifications.length) throw new Error('Canonical permission/specification definitions are incomplete.');
  for (const template of DEFAULT_WORKFLOW_TEMPLATES) if (!template.stages.length || new Set(template.stages.map(stage => stage.code)).size !== template.stages.length || template.stages.some(stage => stage.assigneeRoleCode && !knownRoles.has(stage.assigneeRoleCode))) throw new Error('Workflow definitions refer to a missing or duplicate stage/role: ' + template.code);
  const source = JSON.parse(readFileSync(config.env.AI_MIGRATION_SOURCE_MANIFEST, 'utf8'));
  const { parseMigrationWorkbook } = require(join(root, 'apps/api/dist/ai-governance/ai-migration-workbook.js'));
  for (const item of source.sources) parseMigrationWorkbook(readFileSync(join(config.sourcePath, item.file)), item.source, item.sha256);
  readManifest(config);
  console.log('Isolated environment, source checksums, canonical roles/templates and license configuration passed preflight. Browser verification must also confirm the licensed UI.');
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid recorded demonstration process.');
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function withLock(config, work) {
  const file = join(config.installationRoot, 'installer.lock');
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.installationId !== config.env.DGOP_DEMO_INSTALLATION_ID || processAlive(saved.pid)) throw new Error('Another live or unrelated installer owns this demonstration. Its lock was preserved.');
    unlinkSync(file);
  }
  let fd;
  try { fd = openSync(file, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid, installationId: config.env.DGOP_DEMO_INSTALLATION_ID })); return await work(); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another installer acquired this demonstration lock.'); throw error; }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(file); } }
}
async function freePort(port) {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  await new Promise(done => server.close(done));
}
async function prisma(config) {
  const require = createRequire(join(root, 'apps/api/package.json')), { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: config.env.DATABASE_URL } } });
}
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(done => child.once('exit', done));
  child.kill(); await Promise.race([ended, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([ended, delay(5000)]); }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Owned demonstration process did not stop. Preserve its runtime marker.');
}
async function waitHealthy(config, child, seconds = 90) {
  for (let count = 0; count < seconds * 2; count++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('The demonstration process exited during startup. Review its runtime log.');
    try { const result = await fetch(config.base + '/api/health', { signal: AbortSignal.timeout(1000) }), health = await result.json(); if (result.ok && health.service === 'dgop-api' && health.database?.status === 'up') return; } catch {}
    await delay(500);
  }
  throw new Error('The isolated demonstration did not become ready within its startup budget. Review its runtime log.');
}
async function setup(config) {
  preflight(config);
  await withLock(config, async () => {
    await freePort(config.port);
    const require = createRequire(join(root, 'apps/api/package.json')), { PrismaClient } = require('@prisma/client');
    const adminUrl = new URL(config.env.DATABASE_URL); adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.href } } });
    try { const found = await admin.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1', config.database); if (!found.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${config.database}"`); } finally { await admin.$disconnect(); }
    const deploy = spawnSync(process.execPath, [join(root, 'apps/api/node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: join(root, 'apps/api'), env: childEnv(config.env), stdio: 'inherit', windowsHide: true });
    if (deploy.error || deploy.status !== 0) throw new Error('Committed migrations did not deploy to the isolated demo.');
    const installerEnv={...config.env,DGOP_DEMO_ADAPTER_SCHEDULER:'false'};
    run('demo-bootstrap.mjs', [], installerEnv); run('seed-ai-demo.mjs', ['--local-demo'], installerEnv);
    const temporary = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], { cwd: root, env: childEnv(installerEnv), stdio: 'ignore', windowsHide: true });
    try { await waitHealthy(config, temporary, 30); run('seed-ai-review-example.mjs', ['--local-demo'], installerEnv); } finally { await stopChild(temporary); }
    run('demo-core-fixtures.mjs', [], installerEnv); run('demo-privacy-access-fixtures.mjs', [], installerEnv);
    const manifest = readManifest(config);
    if (manifest.cases.length !== fixtureDefinition(root,manifest.fixtureVersion).completedAiJourneys.length || manifest.cases.some(row => row.complete !== true) || !manifest.core?.complete || !manifest.privacyAccess?.complete) throw new Error('Every native governance fixture must complete before the installation checkpoint.');
    manifest.checkpoints.setup = true; atomicJson(config.manifestPath, manifest);
    console.log('Synthetic governance fixtures installed. Use start to run localhost:4207.');
  });
}
async function check(config) {
  const result = await fetch(config.base + '/api/health', { signal: AbortSignal.timeout(10000) }), health = await result.json();
  if (!result.ok || health.service !== 'dgop-api' || health.database?.status !== 'up') throw new Error('Demo API/database readiness failed.');
  const manifest=readManifest(config),credentials=JSON.parse(readFileSync(config.credentialsPath,'utf8'));
  if(credentials.installationId!==manifest.installationId||credentials.accounts.length!==Object.keys(manifest.actors).length)throw new Error('Preserved persona credentials differ from the installation manifest.');
  for(const account of credentials.accounts){
    const login=await fetch(config.base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-dgop-csrf':'same-origin'},body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(15000)});
    if(login.status!==201)throw new Error('Installed persona '+account.purpose+' cannot log in ('+login.status+'). Credentials were preserved.');
    const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const session=await fetch(config.base+'/api/auth/me',{headers:{cookie},signal:AbortSignal.timeout(10000)});
    const actor=session.ok?await session.json():null;
    if(!actor?.isActive||actor.id!==manifest.actors[account.purpose]||actor.email!==account.email)throw new Error('Installed persona '+account.purpose+' session identity differs from its manifest.');
  }
  await runDemoProcess([join(root, 'scripts/verify-ai-demo.mjs'), config.env.NODE_ENV === 'test' ? '--qa-fixture' : '--local-demo'], { cwd: root, env: childEnv(config.env), stdio: 'inherit' });
  await runDemoProcess([join(root, 'scripts/verify-demo-governance.mjs')], { cwd: root, env: childEnv(config.env), stdio: 'inherit' });
}
function inspectRuntime(pid) {
  const shell = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ExecutablePath,CommandLine,@{Name='Created';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Could not verify the recorded demonstration process. It was preserved.');
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
function ownedRuntime(config, saved) {
  if (saved.installationId !== config.env.DGOP_DEMO_INSTALLATION_ID || saved.entry !== join(root, 'apps/api/dist/main.js') || saved.runtime !== process.execPath) throw new Error('Runtime marker belongs to another installation. Its process was preserved.');
  if (!processAlive(saved.pid)) return null;
  const actual = inspectRuntime(saved.pid);
  if (!actual || !actual.ExecutablePath || resolve(actual.ExecutablePath).toLowerCase() !== resolve(saved.runtime).toLowerCase() || !actual.CommandLine?.includes(saved.entry) || actual.Created !== saved.created) throw new Error('Recorded PID was reused or its identity could not be verified. Its process was preserved.');
  return actual;
}
async function stop(config, quiet = false) {
  const marker = join(config.installationRoot, 'runtime.json');
  if (!existsSync(marker)) { if (!quiet) console.log('This installation has no recorded runtime.'); return; }
  const saved = JSON.parse(readFileSync(marker, 'utf8'));
  if (ownedRuntime(config, saved)) { process.kill(saved.pid); for (let count = 0; count < 100 && processAlive(saved.pid); count++) await delay(100); if (processAlive(saved.pid)) throw new Error('Owned runtime did not stop. Its marker was preserved.'); }
  unlinkSync(marker);
  if (!quiet) console.log('The isolated demonstration stopped. Other applications and databases were preserved.');
}
async function start(config) {
  preflight(config);
  if (!readManifest(config).checkpoints.setup) throw new Error('Complete the isolated demo setup first.');
  await withLock(config, async () => {
    const marker = join(config.installationRoot, 'runtime.json');
    if (existsSync(marker)) { const saved = JSON.parse(readFileSync(marker, 'utf8')); if (ownedRuntime(config, saved)) { await check(config); console.log('Demo already ready: ' + config.publicUrl + '/login'); return; } unlinkSync(marker); }
    await freePort(config.port);
    const entry = join(root, 'apps/api/dist/main.js'), log = openSync(join(config.installationRoot, 'logs/runtime.log'), 'a');
    const child = spawn(process.execPath, [entry], { cwd: root, env: childEnv(config.env), detached: true, stdio: ['ignore', log, log], windowsHide: true }); closeSync(log);
    try {
      let identity;
      for (let count = 0; count < 20 && !identity; count++) { identity = inspectRuntime(child.pid); if (!identity) await delay(250); }
      if (!identity) throw new Error('Runtime identity could not be recorded safely.');
      atomicJson(marker, { pid: child.pid, installationId: config.env.DGOP_DEMO_INSTALLATION_ID, entry, runtime: process.execPath, created: identity.Created, startedAt: new Date().toISOString() });
      await waitHealthy(config, child); await check(config); child.unref(); console.log('Demo ready: ' + config.publicUrl + '/login');
    } catch (error) { await stopChild(child); if (existsSync(marker)) unlinkSync(marker); throw error; }
  });
}
async function backup(config, restore = false) {
  await withLock(config, async () => {
    const runtime = join(config.installationRoot, 'runtime.json');
    if (existsSync(runtime) && ownedRuntime(config, JSON.parse(readFileSync(runtime, 'utf8')))) throw new Error('Stop this isolated demonstration before its backup so fixture writers cannot change the recovery proof.');
    await freePort(config.port);
    const require = createRequire(join(root, 'apps/api/package.json')), { PrismaClient } = require('@prisma/client'), { AuditService } = require(join(root, 'apps/api/dist/audit/audit.service.js'));
    const url = new URL(config.env.DATABASE_URL), pg = config.env.DGOP_TEST_PG_BIN ?? 'C:/Program Files/PostgreSQL/16/bin';
    const folder = join(config.installationRoot, 'backups', String(Date.now())); mkdirSync(folder, { recursive: true });
    const database = await prisma(config), tables = await database.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const fingerprint = async db => { const result = {}; for (const { tablename } of tables) { if (!/^[a-z0-9_]+$/.test(tablename)) throw new Error('Unexpected table identifier'); const rows = await db.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM "' + tablename + '" t'); result[tablename] = { rows: rows.length, sha256: sha256(rows.map(row => JSON.stringify(row.row)).sort()) }; } return result; };
    const connection = ['-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username)], env = { ...childEnv(config.env), PGPASSWORD: decodeURIComponent(url.password) }, dump = join(folder, 'database.dump');
    const pgRun = (name, parameters) => { const result = spawnSync(join(pg, name + '.exe'), parameters, { env, encoding: 'utf8', windowsHide: true }); if (result.error || result.status !== 0) throw new Error('Database backup/recovery command failed. Check isolated database availability and permissions.'); };
    try {
      const before = await fingerprint(database), originalChain = await new AuditService(database).verifyChain();
      if (!originalChain.valid || originalChain.legacyRows || originalChain.truncated) throw new Error('Demo audit chain must be completely valid before its backup.');
      const fileSets = {};
      for (const [source, name] of [[config.evidencePath, 'evidence'], [config.attachmentPath, 'attachments'], [config.sourcePath, 'sources']]) { fileSets[name] = directoryFingerprint(source); cpSync(source, join(folder, name), { recursive: true, errorOnExist: true }); if (!sameFingerprint(fileSets[name], directoryFingerprint(join(folder, name)))) throw new Error('Copied demo files did not match their original hashes.'); }
      copyFileSync(config.manifestPath, join(folder, 'manifest.json')); const manifestHash = sha256(readFileSync(config.manifestPath));
      // These private recovery inputs stay inside ignored installation storage.
      // They are never included in source delivery or public verification reports.
      copyFileSync(config.credentialsPath,join(folder,'credentials.local.json'));
      copyFileSync(config.env.DGOP_ENV_FILE,join(folder,'.env.original'));
      const privateRecoveryFiles={credentialsSha256:sha256(readFileSync(config.credentialsPath)),environmentSha256:sha256(readFileSync(config.env.DGOP_ENV_FILE))};
      pgRun('pg_dump', [...connection, '-d', config.database, '-Fc', '--serializable-deferrable', '--file', dump]);
      if (JSON.stringify(before) !== JSON.stringify(await fingerprint(database)) || manifestHash !== sha256(readFileSync(config.manifestPath))) throw new Error('Demo data changed during backup. Preserve it and repeat with writers paused.');
      for (const [source, name] of [[config.evidencePath, 'evidence'], [config.attachmentPath, 'attachments'], [config.sourcePath, 'sources']]) if (!sameFingerprint(fileSets[name], directoryFingerprint(source))) throw new Error('Demo files changed during backup. Preserve the backup and repeat with writers paused.');
      const proof = { demoOnly: true, database: config.database, createdAt: new Date().toISOString(), fingerprints: before, fileSets, manifestSha256: manifestHash, dumpSha256: sha256(readFileSync(dump)), privateRecoveryFiles,audit: originalChain };
      if (restore) {
        const target = 'dgop_ai_test_restore_' + Date.now(); pgRun('createdb', [...connection, target]); pgRun('pg_restore', [...connection, '-d', target, '--no-owner', '--no-privileges', '--exit-on-error', dump]);
        const restoredUrl = new URL(url); restoredUrl.pathname = '/' + target;
        const restored = new PrismaClient({ datasources: { db: { url: restoredUrl.href } } });
        try {
          if (JSON.stringify(before) !== JSON.stringify(await fingerprint(restored))) throw new Error('Fresh restored database fingerprints differ.');
          const restoredChain = await new AuditService(restored).verifyChain(); if (!restoredChain.valid || JSON.stringify(originalChain) !== JSON.stringify(restoredChain)) throw new Error('Restored audit chain differs.');
          const restoredFiles = join(folder, 'restored-files'); mkdirSync(restoredFiles);
          for (const name of Object.keys(fileSets)) { cpSync(join(folder, name), join(restoredFiles, name), { recursive: true, errorOnExist: true }); if (!sameFingerprint(fileSets[name], directoryFingerprint(join(restoredFiles, name)))) throw new Error('Fresh restored file hashes differ.'); }
          copyFileSync(join(folder, 'manifest.json'), join(restoredFiles, 'manifest.json')); if (sha256(readFileSync(join(restoredFiles, 'manifest.json'))) !== manifestHash) throw new Error('Restored fixture manifest differs.');
          for (const row of await restored.ndiEvidence.findMany({ where: { deletedAt: null }, select: { fileName: true, sha256: true } })) if (fileSets.evidence.find(file => file.path === row.fileName)?.sha256 !== row.sha256) throw new Error('Restored evidence bytes do not match their native database hash.');
          proof.restoredDatabase = target; proof.restoredFiles = restoredFiles; proof.restoreVerified = true; proof.recoveryScope = 'Exact database, complete audit chain, evidence and attachment bytes, synthetic sources and fixture manifest. Application smoke is a separate gate.';
        } finally { await restored.$disconnect(); }
      }
      atomicJson(join(folder, 'verification.json'), proof); console.log(restore ? 'Backup and fresh database/file restore verified. Developer data was untouched.' : 'Isolated demo backup created with database, audit and file hashes.');
    } finally { await database.$disconnect(); }
  });
}
async function soak(config) {
  const minutes = Number(flag('--minutes') ?? 60);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) throw new Error('Use a soak duration from 1 to 60 minutes. The release gate requires the full 60 minutes.');
  const account=JSON.parse(readFileSync(config.credentialsPath,'utf8')).accounts.find(row=>row.purpose==='administrator');
  if(!account)throw new Error('Managed demonstration administrator credentials are missing.');
  const login=await fetch(config.base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-dgop-csrf':'same-origin'},body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(10000)});
  if(!login.ok)throw new Error('Soak authentication failed ('+login.status+').');
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  if(!cookie)throw new Error('Soak authentication did not establish an HTTP-only session.');
  const reads=['/api/assets?page=1&pageSize=20','/api/ndi/specifications?page=1&pageSize=20'];
  for(const path of reads){const warm=await fetch(config.base+path,{headers:{cookie},signal:AbortSignal.timeout(10000)});if(!warm.ok)throw new Error('Authenticated soak warm-up failed: '+path+' ('+warm.status+').');await warm.arrayBuffer();}
  const startedAt = new Date().toISOString(), deadline = Date.now() + minutes * 60000, samples = [], readSamples = [], failures = [];
  let repeats = 0, nextVerification = Date.now();
  while (Date.now() < deadline) {
    const began = performance.now();
    try { const result = await fetch(config.base + '/api/health', { signal: AbortSignal.timeout(5000) }), health = await result.json(); if (!result.ok || health.database?.status !== 'up') throw new Error('API/database health failed'); samples.push(performance.now() - began); } catch (error) { failures.push({ at: new Date().toISOString(), message: error.message }); }
    for(const path of reads){const beganRead=performance.now();try{const response=await fetch(config.base+path,{headers:{cookie},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Authenticated read failed: '+path+' ('+response.status+').');await response.arrayBuffer();readSamples.push({path,ms:performance.now()-beganRead});}catch(error){failures.push({at:new Date().toISOString(),message:error.message});}}
    if (Date.now() >= nextVerification && repeats < 10) { try { await check(config); } catch (error) { failures.push({ at: new Date().toISOString(), message: error.message }); } repeats++; nextVerification += minutes * 60000 / 10; }
    atomicJson(join(config.installationRoot,'soak-progress.json'),{demoOnly:true,startedAt,updatedAt:new Date().toISOString(),elapsedMinutes:(Date.now()-Date.parse(startedAt))/60000,healthSamples:samples.length,authenticatedReadSamples:readSamples.length,repetitions:repeats,failures:failures.length,recentFailures:failures.slice(-5)});
    await delay(Math.min(30000, Math.max(0, deadline - Date.now())));
  }
  const percentile=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??null;};
  const p95=percentile(samples),readP95=percentile(readSamples.map(sample=>sample.ms));
  const report = { demoOnly: true, startedAt, finishedAt: new Date().toISOString(), minutes, repetitions: repeats, readOnlyFixtureAssertions: true, nativeJourneyMutationCoverage: false, healthSamples: samples.length, healthP95Ms: p95, authenticatedReadSamples:readSamples.length,authenticatedReadP95Ms:readP95,authenticatedReadP95ByPath:Object.fromEntries(reads.map(path=>[path,percentile(readSamples.filter(sample=>sample.path===path).map(sample=>sample.ms))])), localReferenceBudgetMs: 2000, failures, availabilitySoakPassed: minutes === 60 && repeats === 10 && failures.length === 0 && readP95 !== null && readP95 <= 2000, releaseSoakPassed:false,note: 'Availability and authenticated-read reference budget, not a production SLA or completed release gate. Native journey repetition and browser navigation timing require independent QA receipts.' };
  atomicJson(join(config.installationRoot, 'soak.json'), report);
  if (failures.length || readP95 === null || readP95 > 2000) throw new Error('The isolated soak found an availability or authenticated read latency failure. Review soak.json.');
  console.log(report.availabilitySoakPassed ? 'The 60-minute availability/authenticated-read soak and ten fixture assertion repeats passed. Native journey and browser gates remain separate.' : 'Short diagnostic soak passed; the full availability soak remains outstanding.');
}
try {
  if (command === 'prepare') prepare();
  else {
    const config = demoConfig(root);
    for (const key of Object.keys(process.env)) if (/^(?:DGOP_|DATABASE_URL$|NODE_|JWT_|SEED_|CORS_|PUBLIC_ORIGIN$|EVIDENCE_STORAGE_DIR$|WORKFLOW_|GOVERNANCE_|AI_MIGRATION_)/.test(key)) delete process.env[key];
    Object.assign(process.env, childEnv(config.env));
    if (command === 'preflight') preflight(config);
    else if (command === 'setup') await setup(config);
    else if (command === 'start') await start(config);
    else if (command === 'stop') await withLock(config, () => stop(config));
    else if (command === 'recover') { preflight(config); await withLock(config, () => stop(config)); await start(config); }
    else if (command === 'check' || command === 'verify') await check(config);
    else if (command === 'backup' || command === 'restore') await backup(config, command === 'restore');
    else if (command === 'soak') await soak(config);
    else throw new Error('Use prepare, preflight, setup, start, stop, recover, check, verify, backup, restore or soak.');
  }
} catch (error) { console.error(error.code ? 'Demonstration command failed (' + error.code + '). See its installation log.' : error.message); process.exitCode = 1; }
