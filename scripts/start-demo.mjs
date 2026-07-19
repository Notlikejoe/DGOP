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

function isSafeSecret(value) {
  return (
    !!value &&
    value.length >= 32 &&
    value !== 'replace-with-at-least-32-random-characters' &&
    value !== 'dev-insecure-secret' &&
    value !== 'change-me'
  );
}

function isSafePassword(value) {
  return (
    !!value &&
    value.length >= 12 &&
    value !== 'Admin@12345' &&
    value !== 'replace-with-local-demo-password' &&
    value !== 'change-me'
  );
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function originIsSafe(origin) {
  if (!origin || origin === '*' || origin.toLowerCase() === 'true') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function originsAreSafe(value) {
  if (!value && !process.env.PUBLIC_ORIGIN) return false;
  const origins = `${value ?? ''},${process.env.PUBLIC_ORIGIN ?? ''}`
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 && origins.every(originIsSafe);
}

loadRootEnv();
process.env.NODE_ENV = 'production';
process.env.DGOP_REQUIRE_STRICT_RUNTIME = 'true';
process.env.HEALTH_INCLUDE_DETAILS ??= 'false';

requireEnv('DATABASE_URL');
requireEnv('JWT_SECRET', isSafeSecret);
requireEnv('CORS_ORIGINS', originsAreSafe);
requireEnv('SEED_ADMIN_PASSWORD', isSafePassword);
requireEnv('SEED_PERSON_PASSWORD', isSafePassword);
requireEnv('DGOP_WEBHOOK_TOKEN', isSafeSecret);

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
