import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'storage', 'postgres-data');
const logFile = join(root, 'storage', 'postgres.log');

function findPgCtl() {
  if (process.env.PG_CTL) return process.env.PG_CTL;
  if (process.platform !== 'win32') return 'pg_ctl';

  const postgresRoot = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL');
  if (!existsSync(postgresRoot)) return 'pg_ctl.exe';
  const versions = readdirSync(postgresRoot).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  for (const version of versions) {
    const candidate = join(postgresRoot, version, 'bin', 'pg_ctl.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'pg_ctl.exe';
}

function run(args, stdio = 'inherit') {
  const result = spawnSync(findPgCtl(), ['-D', dataDir, ...args], {
    cwd: root,
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
  });
  if (result.error) {
    console.error(`Unable to run PostgreSQL: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

if (!existsSync(join(dataDir, 'PG_VERSION'))) {
  console.error(`DGOP local PostgreSQL data directory is not initialized: ${dataDir}`);
  console.error('Configure DATABASE_URL for an external PostgreSQL server or initialize the local cluster first.');
  process.exit(1);
}

const command = process.argv[2] ?? 'status';
if (command === 'status') {
  process.exit(run(['status']).status ?? 1);
}

if (command === 'start') {
  const status = run(['status'], 'pipe');
  if (status.status === 0) {
    console.log('DGOP local PostgreSQL is already running.');
    process.exit(0);
  }
  process.exit(run(['-l', logFile, 'start']).status ?? 1);
}

if (command === 'stop') {
  const status = run(['status'], 'pipe');
  if (status.status !== 0) {
    console.log('DGOP local PostgreSQL is already stopped.');
    process.exit(0);
  }
  process.exit(run(['stop', '-m', 'fast']).status ?? 1);
}

console.error('usage: node scripts/local-postgres.mjs {start|stop|status}');
process.exit(1);
