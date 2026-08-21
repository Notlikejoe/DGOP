import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  console.error('Local seed requires the ignored root .env file. Run `npm run demo:prepare` first.');
  process.exit(1);
}

for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) continue;
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = value;
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL ?? '');
} catch {
  console.error('Local seed requires a valid DATABASE_URL.');
  process.exit(1);
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (!localHosts.has(databaseUrl.hostname.toLowerCase())) {
  console.error('Refusing local seed because DATABASE_URL does not target a loopback PostgreSQL host.');
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', 'db:seed'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DGOP_ALLOW_DESTRUCTIVE_SEED: 'true',
    DGOP_ALLOW_PRODUCTION_SEED: 'false',
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
