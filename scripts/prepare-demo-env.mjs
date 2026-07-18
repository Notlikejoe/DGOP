import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, '.env');

const unsafeSecrets = new Set([
  '',
  'dev-insecure-secret',
  'replace-with-at-least-32-random-characters',
  'change-me',
  'changeme',
]);

const unsafePasswords = new Set([
  '',
  'Admin@12345',
  'admin',
  'password',
  'Password123',
  'change-me',
  'changeme',
  'replace-with-local-demo-password',
]);

function randomSecret() {
  return randomBytes(32).toString('hex');
}

function randomPassword() {
  return `DGOP-${randomBytes(12).toString('base64url')}-2026!`;
}

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const values = new Map();
  for (const rawLine of lines) {
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
    values.set(key, value);
  }
  return { lines, values };
}

function setValue(state, key, value) {
  const lineIndex = state.lines.findIndex((line) => line.trim().startsWith(`${key}=`));
  if (lineIndex >= 0) {
    state.lines[lineIndex] = `${key}=${value}`;
  } else {
    if (state.lines.length && state.lines[state.lines.length - 1] !== '') state.lines.push('');
    state.lines.push(`${key}=${value}`);
  }
  state.values.set(key, value);
}

function secretIsUnsafe(value) {
  return !value || value.length < 32 || unsafeSecrets.has(value) || value.startsWith('replace-with');
}

function passwordIsUnsafe(value) {
  return !value || value.length < 12 || unsafePasswords.has(value);
}

const state = parseEnv(existsSync(envPath) ? readFileSync(envPath, 'utf8') : '');
const rotated = [];

if (secretIsUnsafe(state.values.get('JWT_SECRET'))) {
  setValue(state, 'JWT_SECRET', randomSecret());
  rotated.push('JWT_SECRET');
}

if (passwordIsUnsafe(state.values.get('SEED_ADMIN_PASSWORD'))) {
  setValue(state, 'SEED_ADMIN_PASSWORD', randomPassword());
  rotated.push('SEED_ADMIN_PASSWORD');
}

if (passwordIsUnsafe(state.values.get('SEED_PERSON_PASSWORD'))) {
  setValue(state, 'SEED_PERSON_PASSWORD', randomPassword());
  rotated.push('SEED_PERSON_PASSWORD');
}

if (secretIsUnsafe(state.values.get('DGOP_WEBHOOK_TOKEN'))) {
  setValue(state, 'DGOP_WEBHOOK_TOKEN', randomSecret());
  rotated.push('DGOP_WEBHOOK_TOKEN');
}

if (!state.values.get('SEED_ADMIN_EMAIL')) setValue(state, 'SEED_ADMIN_EMAIL', 'admin@dgop.local');
if (!state.values.get('PUBLIC_ORIGIN')) setValue(state, 'PUBLIC_ORIGIN', 'http://localhost:4205');
if (!state.values.get('CORS_ORIGINS')) setValue(state, 'CORS_ORIGINS', 'http://localhost:4205');
if (!state.values.get('JWT_EXPIRES_IN')) setValue(state, 'JWT_EXPIRES_IN', '8h');
if (!state.values.get('DGOP_AUDIT_FAIL_CLOSED')) setValue(state, 'DGOP_AUDIT_FAIL_CLOSED', 'true');
if (!state.values.get('DGOP_SEED_RISK_SCENARIO')) setValue(state, 'DGOP_SEED_RISK_SCENARIO', 'false');

writeFileSync(envPath, `${state.lines.join('\n').replace(/\n+$/u, '')}\n`);

console.log('Local demo environment prepared in ignored .env.');
console.log(`Rotated keys: ${rotated.length ? rotated.join(', ') : 'none'}.`);
console.log('Run `npm run db:seed` to apply a rotated SEED_ADMIN_PASSWORD to the local admin account.');
