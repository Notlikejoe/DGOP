// Explicitly opt-in integration harness. Creates fresh databases; never drops any.
import { readFileSync, readdirSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const require = createRequire(join(api, 'package.json'));
const dotenv = require('dotenv');
const supplied = process.env.DGOP_AI_TEST_DATABASE_URL ?? dotenv.parse(readFileSync(join(root, '.env.ai-test'))).DGOP_AI_TEST_DATABASE_URL;
const url = new URL(supplied);
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55438' || !/^\/dgop_ai_test_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error('Use the isolated loopback PostgreSQL test server on 55438 with a dgop_ai_test_ database');
}
const pg = process.env.DGOP_TEST_PG_BIN ?? 'C:/Program Files/PostgreSQL/16/bin';
const stamp = Date.now().toString();
const migration = '20260911160000_ai_reference_approval';
const baseline = join(root, 'storage/ai-test', stamp, 'prisma');
mkdirSync(join(baseline, 'migrations'), { recursive: true });
copyFileSync(join(api, 'prisma/schema.prisma'), join(baseline, 'schema.prisma'));
for (const entry of readdirSync(join(api, 'prisma/migrations'), { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name >= migration) continue;
  cpSync(join(api, 'prisma/migrations', entry.name), join(baseline, 'migrations', entry.name), { recursive: true });
}
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: api, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    // Redact credentials even if a dependency echoes a connection URL.
    const message = `${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    throw new Error(message.replaceAll(decodeURIComponent(url.password), '[REDACTED]').replaceAll(url.password, '[REDACTED]'));
  }
  return result.stdout;
}
for (const mode of ['clean', 'upgrade']) {
  const db = `dgop_ai_test_${mode}_${stamp}`;
  const connection = new URL(url); connection.pathname = `/${db}`;
  const env = { DATABASE_URL: connection.href, DGOP_AI_TEST_DATABASE_URL: connection.href };
  run(join(pg, 'createdb.exe'), ['-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username), db], { PGPASSWORD: decodeURIComponent(url.password) });
  const cli = join(api, 'node_modules/prisma/build/index.js');
  if (mode === 'upgrade') {
    run(process.execPath, [cli, 'migrate', 'deploy', '--schema', join(baseline, 'schema.prisma')], env);
    run(join(pg, 'psql.exe'), ['-h', url.hostname, '-p', url.port, '-U', decodeURIComponent(url.username), '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', `INSERT INTO users (id,email,"passwordHash","displayName","updatedAt") VALUES ('baseline-sentinel','baseline@example.test','test-only','Existing DGOP user',NOW())`], { PGPASSWORD: decodeURIComponent(url.password) });
  }
  run(process.execPath, [cli, 'migrate', 'deploy'], env);
  console.log(`${mode}: Prisma migration deploy passed`);
  console.log(run(process.execPath, [join(api, 'node_modules/ts-node/dist/bin.js'), 'test/ai-foundation.integration.ts', mode], env).trim());
}
