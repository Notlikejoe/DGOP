import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvironment } from './runtime-env.mjs';

export function isManagedDemoProfile(env = process.env) {
  try {
    if (env.DGOP_DEMO !== 'true' || !env.DGOP_DEMO_ROOT || !env.DGOP_DEMO_PROFILE_FILE || !env.DATABASE_URL) return false;
    const url = new URL(env.DATABASE_URL), database = decodeURIComponent(url.pathname.slice(1));
    const test = /^dgop_ai_test_[a-z0-9_]+$/.test(database) && env.NODE_ENV === 'test' && env.DGOP_AI_TEST_DATABASE_URL === env.DATABASE_URL;
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase()) || !(/^dgop_ai_preview_\d+$/.test(database) || test)) return false;
    if (!isAbsolute(env.DGOP_DEMO_ROOT) || !isAbsolute(env.DGOP_DEMO_PROFILE_FILE) || !existsSync(env.DGOP_DEMO_PROFILE_FILE)) return false;
    const root = realpathSync(env.DGOP_DEMO_ROOT), file = realpathSync(env.DGOP_DEMO_PROFILE_FILE), inside = relative(root, file);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return false;
    const p = JSON.parse(readFileSync(file, 'utf8'));
    return p.profileVersion === 1 && p.demoOnly === true && p.database === database && p.installationId === env.DGOP_DEMO_INSTALLATION_ID
      && /^[a-zA-Z0-9_-]{8,100}$/.test(p.installationId) && resolve(p.installationRoot) === resolve(root) && p.bindHost === '127.0.0.1';
  } catch { return false; }
}

export function demoConfig(root, supplied = process.env) {
  // The explicit installation file owns application settings. Inherit only OS essentials,
  // never an older DGOP database, cookie secret, module path or Node preload option.
  const operatingSystem = {};
  for (const [key, value] of Object.entries(supplied)) if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)) operatingSystem[key] = value;
  const env = { ...operatingSystem, ...loadEnvironment(root, { DGOP_ENV_FILE: supplied.DGOP_ENV_FILE }, true) };
  if (!env.DGOP_ENV_FILE || !isManagedDemoProfile(env)) throw new Error('Select an explicit managed demonstration environment. Developer and remote databases are prohibited.');
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || env.DGOP_BIND_HOST !== '127.0.0.1') throw new Error('The demonstration requires a valid loopback port.');
  const installationRoot = realpathSync(env.DGOP_DEMO_ROOT);
  const managedPath = (key, leaf) => {
    const candidate = resolve(env[key] || join(installationRoot, leaf)), inside = relative(installationRoot, candidate);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error(`${key} must stay inside this demonstration installation.`);
    let ancestor = candidate;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const actual = relative(installationRoot, realpathSync(ancestor));
    if (actual === '..' || actual.startsWith('..' + sep) || isAbsolute(actual)) throw new Error(`${key} resolves outside this demonstration installation.`);
    return candidate;
  };
  return { env, port, base: `http://127.0.0.1:${port}`, publicUrl: `http://localhost:${port}`, installationRoot,
    database: new URL(env.DATABASE_URL).pathname.slice(1), manifestPath: managedPath('DGOP_DEMO_MANIFEST', 'manifest.json'),
    credentialsPath: managedPath('DGOP_DEMO_CREDENTIALS', 'credentials.local.json'), resultPath: managedPath('DGOP_DEMO_RESULT', 'verification.json'),
    evidencePath: managedPath('EVIDENCE_STORAGE_DIR', 'evidence'), attachmentPath: managedPath('WORKFLOW_ATTACHMENT_STORAGE_DIR', 'attachments'),
    sourcePath: managedPath('AI_MIGRATION_SOURCE_DIR', 'sources') };
}

export function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  replaceCheckpoint(temporary, path);
}

// Windows scanners can briefly hold the destination. Never remove the previous
// checkpoint to work around that lock: retain both files if retries are exhausted.
export function replaceCheckpoint(temporary, path, rename = renameSync, wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)) {
  for (let attempt = 0; ; attempt++) {
    try { rename(temporary, path); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 5) throw error;
      wait(50 * (attempt + 1));
    }
  }
}

export function applyDemoEnvironment(config) {
  for (const key of Object.keys(process.env)) if (/^(?:DGOP_|DATABASE_URL$|NODE_|JWT_|SEED_|CORS_|PUBLIC_ORIGIN$|EVIDENCE_STORAGE_DIR$|WORKFLOW_|GOVERNANCE_|AI_MIGRATION_)/.test(key)) delete process.env[key];
  Object.assign(process.env, config.env);
}

export function assertDemoFixtureWrite(config, mode) {
  const url = new URL(config.env.DATABASE_URL);
  const preview = mode === '--local-demo' && config.env.NODE_ENV === 'development' && /^dgop_ai_preview_\d+$/.test(config.database);
  const profile = JSON.parse(readFileSync(config.env.DGOP_DEMO_PROFILE_FILE, 'utf8'));
  const engineering = mode === '--qa-fixture' && config.env.NODE_ENV === 'test' && config.env.DGOP_DEMO_QA === 'true' && profile.qaOnly === true && readManifest(config).qaOnly === true && /^dgop_ai_test_[a-z0-9_]+$/.test(config.database) && config.env.DGOP_AI_TEST_DATABASE_URL === config.env.DATABASE_URL;
  if ((!preview && !engineering) || url.hostname !== '127.0.0.1' || url.port !== (config.env.DGOP_DEMO_DATABASE_PORT ?? '55438')) throw new Error('Explicit managed preview or separately approved engineering test profile required. Developer and remote databases are prohibited.');
}

export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

export function fixtureDefinition(root,version='governance-demo-v1'){
  if(version!=='governance-demo-v1')throw new Error('Unsupported versioned demonstration definition');
  const fixture=JSON.parse(readFileSync(join(root,'scripts/data/governance-demo-v1.json'),'utf8'));
  if(fixture.fixtureVersion!==version||fixture.demoOnly!==true||fixture.isComplianceProof!==false||!Array.isArray(fixture.completedAiJourneys)||!fixture.completedAiJourneys.length||new Set(fixture.completedAiJourneys.map(row=>row.name)).size!==fixture.completedAiJourneys.length)throw new Error('Demonstration fixture definition is incomplete');
  return fixture;
}

export function readManifest(config) {
  const manifest = JSON.parse(readFileSync(config.manifestPath, 'utf8'));
  if (manifest.manifestVersion !== 1 || manifest.fixtureVersion !== 'governance-demo-v1' || manifest.demoOnly !== true || manifest.database !== config.database
    || manifest.fixtureVersion !== config.env.DGOP_DEMO_FIXTURE_VERSION || manifest.installationId !== config.env.DGOP_DEMO_INSTALLATION_ID) throw new Error('Demonstration manifest version or installation identity differs. Preserve it and prepare a new installation.');
  return manifest;
}
