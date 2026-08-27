import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function localConfig(env) {
  if ((env.NODE_ENV ?? 'development') !== 'development'
    || ['true', '1', 'yes', 'on'].includes((env.DGOP_REQUIRE_STRICT_RUNTIME ?? '').toLowerCase())) {
    throw new Error('Local commands require development mode. Use start:demo for shared demos.');
  }
  let database;
  try { database = new URL(env.DATABASE_URL); } catch {
    throw new Error('Configure DATABASE_URL in the ignored root .env for your local PostgreSQL database.');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !loopback.has(database.hostname.toLowerCase())) {
    throw new Error('Local commands only support loopback PostgreSQL. Remote databases require a managed deployment.');
  }
  if (!database.pathname.slice(1) || ['postgres', 'template0', 'template1'].includes(database.pathname.slice(1))
    || (database.searchParams.get('schema') && database.searchParams.get('schema') !== 'public')) {
    throw new Error('Use a dedicated local DGOP database with the public schema, not a PostgreSQL maintenance database.');
  }
  if (decodeURIComponent(database.password) === 'change-me') {
    throw new Error('Replace the DATABASE_URL placeholder in .env with your local PostgreSQL connection.');
  }
  const port = Number(env.PORT || 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (env.DGOP_BIND_HOST && env.DGOP_BIND_HOST !== '127.0.0.1') {
    throw new Error('start:local uses DGOP_BIND_HOST=127.0.0.1. Set it in your development .env.');
  }
  const email = (env.SEED_ADMIN_EMAIL || 'admin@dgop.local').trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password || password.startsWith('replace-with')) throw new Error('Run npm run local:prepare to configure local credentials.');
  return { database, port, email, password, origin: `http://127.0.0.1:${port}` };
}

function runScript(name, args = []) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', name), ...args], {
    cwd: root, env: process.env, stdio: 'inherit', timeout: 300_000,
  });
  if (result.error || result.status !== 0) throw new Error(`${name} failed. Resolve the preceding error before continuing.`);
}

async function requireFreePort(port) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', () => reject(new Error(`Port ${port} is in use. Stop the existing app before setup/start; use local:check to check it.`)));
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}

async function connectDatabase(config) {
  const { PrismaClient } = require(join(root, 'apps/api/node_modules/@prisma/client'));
  let prisma = new PrismaClient();
  try {
    await prisma.$connect();
  } catch (error) {
    await prisma.$disconnect();
    const ownsCluster = config.database.hostname === '127.0.0.1' && config.database.port === '55436'
      && config.database.pathname === '/dgop_dev' && existsSync(join(root, 'storage/postgres-data/PG_VERSION'));
    if (error.code !== 'P1001' || !ownsCluster) {
      throw new Error(`PostgreSQL is unavailable (${error.code || 'connection error'}). Start your local database and check DATABASE_URL in .env.`);
    }
    runScript('local-postgres.mjs', ['start']);
    prisma = new PrismaClient();
    try { await prisma.$connect(); } catch {
      await prisma.$disconnect();
      throw new Error('PostgreSQL could not be reached after startup. Check DATABASE_URL and the database service.');
    }
  }
  return prisma;
}

export async function checkAdmin(prisma, config, compare) {
  const user = await prisma.user.findUnique({
    where: { email: config.email },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user) throw new Error('Configured local administrator is missing. Use local:setup for a fresh database; do not reseed existing data.');
  if (!user.isActive) throw new Error('Configured administrator is disabled. An authorized administrator must reactivate it.');
  if (!user.userRoles.some(({ role }) => role.code === 'system_admin' && role.isActive && !role.deletedAt)) {
    throw new Error('Configured administrator lacks an active system_admin role. Restore the intended assignment through an authorized administrator.');
  }
  if (!await compare(config.password, user.passwordHash)) {
    throw new Error('SEED_ADMIN_PASSWORD does not match the database. Correct .env or explicitly run npm run local:credentials; startup never resets passwords.');
  }
  return user;
}

export async function databaseIsEmpty(prisma, modelNames) {
  for (const name of modelNames) {
    const delegate = name.charAt(0).toLowerCase() + name.slice(1);
    if (await prisma[delegate].count() !== 0) return false;
  }
  return true;
}

export async function verifyHttpLogin(config, request = fetch) {
  const health = await request(`${config.origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
  const state = await health.json();
  if (!health.ok || state.service !== 'dgop-api' || state.database?.status !== 'up') {
    throw new Error('The API is not ready or its database is unavailable.');
  }
  const login = await request(`${config.origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }), signal: AbortSignal.timeout(15_000),
  });
  if (!login.ok) throw new Error(`Login failed (HTTP ${login.status}). Check runtime mode, .env credentials, rate limits and API logs.`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('dgop_session=')) throw new Error('Login did not issue a session cookie.');
  const session = await request(`${config.origin}/api/auth/me`, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000),
  });
  const user = await session.json();
  if (!session.ok || user.email !== config.email || !user.isActive
    || !user.roles?.some((role) => role.code === 'system_admin')) throw new Error('The login session could not be validated.');
}

async function synchronizeLocalAdmin(prisma, config, bcrypt) {
  const auditPath = join(root, 'apps/api/dist/audit/audit.service.js');
  if (!existsSync(auditPath)) throw new Error('Run npm run build:api before local:credentials.');
  // Use the application's locked audit chain in the same transaction as the credential update.
  const { AuditService } = require(auditPath);
  process.env.DGOP_AUDIT_FAIL_CLOSED = 'true';
  const audit = new AuditService(prisma);
  const user = await checkAdmin(prisma, config, async () => true);
  if (await bcrypt.compare(config.password, user.passwordHash)) {
    console.log('Administrator password is already current. Existing sessions are unchanged.');
    return;
  }
  const passwordHash = await bcrypt.hash(config.password, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id, tokenVersion: user.tokenVersion }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await audit.log({ actor: 'local:credentials', action: 'user.password.reset', entityType: 'user', entityId: user.id, metadata: { source: 'explicit_local_setup' } }, tx);
  });
  console.log('Local administrator password synchronized from .env. Previous sessions invalidated. No roles or governance data changed.');
}

async function startApp(config) {
  const api = join(root, 'apps/api/dist/main.js');
  if (!existsSync(api) || !existsSync(join(root, 'apps/web/dist/web/browser/index.html'))) {
    throw new Error('Built API/UI missing. Run npm run build before npm run start:local.');
  }
  const child = spawn(process.execPath, [api], { cwd: root, env: { ...process.env, DGOP_BIND_HOST: '127.0.0.1' }, stdio: 'inherit' });
  let exited = false;
  const completion = new Promise((done) => {
    child.once('error', () => { exited = true; done(1); });
    child.once('exit', (code) => { exited = true; done(code ?? 1); });
  });
  const stop = () => child.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !exited; attempt++) {
      try {
        const response = await fetch(`${config.origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
        const health = await response.json();
        if (response.ok && health.service === 'dgop-api' && health.database?.status === 'up') { ready = true; break; }
      } catch { /* The listener may not be ready during startup. */ }
      await delay(500);
    }
    if (!ready) throw new Error('API failed readiness checks. Inspect startup logs above.');
    await verifyHttpLogin(config);
    console.log(`\nDGOP ready: http://localhost:${config.port}/login\nAdmin: ${config.email}\nPassword: SEED_ADMIN_PASSWORD in your ignored .env (unchanged).`);
    process.exitCode = await completion;
  } catch (error) {
    child.kill();
    await completion;
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

async function main() {
  const command = process.argv[2];
  if (!['setup', 'check', 'credentials', 'start'].includes(command)) throw new Error('Use local:setup, local:check, local:credentials or start:local.');
  if (command === 'setup') runScript('prepare-demo-env.mjs', ['--local']);
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) throw new Error('Run npm run local:prepare, then configure DATABASE_URL in .env.');
  const env = { ...parseEnv(readFileSync(envPath, 'utf8')), ...process.env };
  const config = localConfig(env);
  Object.assign(process.env, env);
  if (command === 'setup' || command === 'start') await requireFreePort(config.port);
  if (command === 'setup') runScript('db.mjs', ['generate']);
  let prisma = await connectDatabase(config);
  const bcrypt = require(join(root, 'apps/api/node_modules/bcryptjs'));
  try {
    if (command === 'setup') {
      const [schema] = await prisma.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name <> '_prisma_migrations'
        ) AS present`;
      await prisma.$disconnect();
      runScript('db.mjs', ['deploy']);
      prisma = await connectDatabase(config);
      const { Prisma } = require(join(root, 'apps/api/node_modules/@prisma/client'));
      // Some migrations insert reference rows. A schema that was absent before
      // deployment still needs its initial seed; existing application data does not.
      const empty = !schema.present || await databaseIsEmpty(prisma, Prisma.dmmf.datamodel.models.map((model) => model.name));
      if (empty) {
        await prisma.$disconnect();
        console.log('New schema or empty application tables. Creating the initial local dataset.');
        runScript('seed-local.mjs');
        prisma = await connectDatabase(config);
      } else console.log('Existing application data detected. Seeding skipped; data and passwords preserved.');
    } else if (command !== 'credentials') runScript('db.mjs', ['status']);
    if (command === 'credentials') await synchronizeLocalAdmin(prisma, config, bcrypt);
    await checkAdmin(prisma, config, bcrypt.compare);
    console.log('Local database, administrator status, role and configured password verified.');
  } finally { await prisma.$disconnect(); }
  if (command === 'start') await startApp(config);
  if (command === 'check') {
    await verifyHttpLogin(config);
    console.log(`HTTP login and authenticated session verified at http://localhost:${config.port}.`);
  }
  if (command === 'setup') console.log('Setup complete. Run npm run build, then npm run start:local.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Prisma diagnostics may include connection information; report codes, not raw database errors.
    console.error(error?.code ? `Local operation failed (${error.code}). Check migrations and local database configuration.` : error.message);
    process.exitCode = 1;
  });
}
