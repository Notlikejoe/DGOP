import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { localConfig, verifyHttpLogin } from '../local.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const env = { ...parseEnv(readFileSync(join(root, '.env'), 'utf8')), ...process.env };
const source = localConfig(env);
const databaseName = `dgop_login_test_${randomBytes(6).toString('hex')}`;
assert.match(databaseName, /^dgop_login_test_[a-f0-9]{12}$/);
const url = new URL(source.database);
url.pathname = `/${databaseName}`;
const listener = createServer();
await new Promise((done) => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const testEnv = { ...env, DATABASE_URL: url.toString(), PORT: String(port), SEED_ADMIN_EMAIL: 'admin@dgop.local', SEED_ADMIN_PASSWORD: `Local-${randomBytes(16).toString('hex')}`, DGOP_BIND_HOST: '127.0.0.1' };
// Short-lived probes release the Windows Prisma DLL before setup regenerates it.
function query(databaseUrl, body) {
  const code = `const {PrismaClient, Prisma}=require(${JSON.stringify(join(root, 'apps/api/node_modules/@prisma/client'))});
    const db=new PrismaClient();
    (async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.code||'database probe failed');process.exitCode=1}).finally(()=>db.$disconnect());`;
  const result = spawnSync(process.execPath, ['-e', code], { cwd: root, env: { ...testEnv, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`Database probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}
const run = (command, overrides = {}) => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/local.mjs'), command], {
    cwd: root, env: { ...testEnv, ...overrides }, encoding: 'utf8', timeout: 300_000,
  });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stdout}\n${result.stderr}`);
};
const snapshot = () => query(url.toString(), `
  const counts={};
  for(const model of Prisma.dmmf.datamodel.models) {
    counts[model.name]=await db[model.name.charAt(0).toLowerCase()+model.name.slice(1)].count();
  }
  return { counts, user: await db.user.findUniqueOrThrow({where:{email:process.env.SEED_ADMIN_EMAIL}}) };`);

let created = false;
let api;
let apiDone;
try {
  query(source.database.toString(), `return await db.$executeRawUnsafe('CREATE DATABASE "${databaseName}"');`);
  created = true;
  console.log('Created a disposable local database; existing DGOP records are not touched.');
  run('setup');
  const { user: initialUser, counts: initialCounts } = snapshot();
  assert.ok(initialCounts.User > 0 && initialCounts.Role > 0);
  console.log('PASS fresh migrations, seed, administrator password and active role');
  run('setup');
  const { user: unchanged, counts: afterSetup } = snapshot();
  assert.deepEqual(afterSetup, initialCounts);
  assert.equal(unchanged.passwordHash, initialUser.passwordHash);
  assert.equal(unchanged.tokenVersion, initialUser.tokenVersion);
  console.log('PASS repeat setup preserves every model count, password hash and session version');
  run('credentials');
  assert.equal(snapshot().user.tokenVersion, initialUser.tokenVersion);
  const password = `Changed-${randomBytes(16).toString('hex')}`;
  run('credentials', { SEED_ADMIN_PASSWORD: password });
  const changed = snapshot().user;
  assert.equal(changed.tokenVersion, initialUser.tokenVersion + 1);
  assert.equal(query(url.toString(), `return await db.auditLog.count({where:{action:'user.password.reset',actor:'local:credentials'}});`), 1);
  console.log('PASS explicit password repair is idempotent, audited, and invalidates old sessions');
  api = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], { cwd: root, env: testEnv, stdio: 'ignore' });
  apiDone = new Promise((done, reject) => { api.once('exit', done); api.once('error', reject); });
  const config = localConfig({ ...testEnv, SEED_ADMIN_PASSWORD: password });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${config.origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Await the test API listener. */ }
    if (api.exitCode !== null) break;
    await delay(250);
  }
  assert.ok(ready, 'test API must become healthy');
  await verifyHttpLogin(config);
  const bad = await fetch(`${config.origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: config.email, password: testEnv.SEED_ADMIN_PASSWORD }), signal: AbortSignal.timeout(10_000) });
  assert.equal(bad.status, 401);
  console.log('PASS fresh-database HTTP login, session cookie and old-password rejection');
} finally {
  if (api && api.exitCode === null) { api.kill(); await apiDone; }
  if (created) {
    query(source.database.toString(), `return await db.$executeRawUnsafe('DROP DATABASE "${databaseName}" WITH (FORCE)');`);
    console.log('Removed only the disposable database created by this test.');
  }
}
