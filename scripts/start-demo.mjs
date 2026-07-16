import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function loadRootEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name, validate = (value) => !!value) {
  const value = process.env[name];
  if (!validate(value)) {
    console.error(`start:demo requires ${name} to be configured safely in .env`);
    process.exit(1);
  }
}

loadRootEnv();
process.env.NODE_ENV = 'production';
process.env.HEALTH_INCLUDE_DETAILS ??= 'false';

requireEnv('DATABASE_URL');
requireEnv('JWT_SECRET', (value) =>
  !!value &&
  value.length >= 32 &&
  value !== 'replace-with-at-least-32-random-characters' &&
  value !== 'dev-insecure-secret',
);
requireEnv('CORS_ORIGINS', (value) => !!value || !!process.env.PUBLIC_ORIGIN);

const apiEntry = join(root, 'apps', 'api', 'dist', 'main.js');
if (!existsSync(apiEntry)) {
  console.error('API build not found. Run npm run build before npm run start:demo.');
  process.exit(1);
}

const child = spawn(process.execPath, [apiEntry], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
