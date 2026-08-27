import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, '.env');
const localOnly = process.argv.includes('--local');

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

function parseState(text) {
  const lines = text.split(/\r?\n/);
  const values = new Map(Object.entries(parseEnv(text)));
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
  if (!value || value.length < 12 || unsafePasswords.has(value)) return true;
  const compact = value.replace(/[\s._-]+/g, '');
  return /^(?:admin(?:istrator)?|password|welcome|qwerty|letmein|dgop)(?:\d{4,}|[!@#$%^&*]+|\d+[!@#$%^&*]+)?$/i.test(compact)
    || /(?:012345|123456|234567|345678|456789|987654)/.test(compact);
}

const state = parseState(existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(join(root, '.env.example'), 'utf8'));
if (localOnly) {
  const nodeEnv = process.env.NODE_ENV ?? state.values.get('NODE_ENV') ?? 'development';
  const strict = process.env.DGOP_REQUIRE_STRICT_RUNTIME ?? state.values.get('DGOP_REQUIRE_STRICT_RUNTIME') ?? '';
  if (nodeEnv !== 'development' || ['true', '1', 'yes', 'on'].includes(strict.toLowerCase())) {
    throw new Error('local:prepare refuses to change a strict or non-development environment.');
  }
  setValue(state, 'NODE_ENV', 'development');
  setValue(state, 'DGOP_BIND_HOST', '127.0.0.1');
}
const rotated = [];

if (secretIsUnsafe(state.values.get('JWT_SECRET'))) {
  setValue(state, 'JWT_SECRET', randomSecret());
  rotated.push('JWT_SECRET');
}

if (
  secretIsUnsafe(state.values.get('DGOP_SEARCH_QUERY_KEY')) ||
  state.values.get('DGOP_SEARCH_QUERY_KEY') === state.values.get('JWT_SECRET')
) {
  setValue(state, 'DGOP_SEARCH_QUERY_KEY', randomSecret());
  rotated.push('DGOP_SEARCH_QUERY_KEY');
}

if (
  secretIsUnsafe(state.values.get('DGOP_BPMN_SIGNING_SECRET')) ||
  state.values.get('DGOP_BPMN_SIGNING_SECRET') === state.values.get('JWT_SECRET') ||
  state.values.get('DGOP_BPMN_SIGNING_SECRET') === state.values.get('DGOP_SEARCH_QUERY_KEY')
) {
  setValue(state, 'DGOP_BPMN_SIGNING_SECRET', randomSecret());
  rotated.push('DGOP_BPMN_SIGNING_SECRET');
}

function shouldGeneratePassword(value) {
  return localOnly ? !value || value.startsWith('replace-with') : passwordIsUnsafe(value);
}

if (shouldGeneratePassword(state.values.get('SEED_ADMIN_PASSWORD'))) {
  setValue(state, 'SEED_ADMIN_PASSWORD', randomPassword());
  rotated.push('SEED_ADMIN_PASSWORD');
}

if (shouldGeneratePassword(state.values.get('SEED_PERSON_PASSWORD'))) {
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

console.log(`${localOnly ? 'Local development' : 'Strict demo'} environment prepared in ignored .env.`);
console.log(`Rotated keys: ${rotated.length ? rotated.join(', ') : 'none'}.`);
console.log(localOnly
  ? 'Existing passwords are preserved. Configure DATABASE_URL, then run npm run local:setup. Login uses SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env.'
  : 'Demo preparation can change your login password. Use SEED_ADMIN_PASSWORD from .env and run npm run db:sync-demo-credentials. Do not use this command for ordinary local startup.');
