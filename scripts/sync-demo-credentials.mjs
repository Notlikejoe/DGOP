import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, '.env');
const require = createRequire(import.meta.url);
const { PrismaClient } = require(join(root, 'apps', 'api', 'node_modules', '@prisma', 'client'));
const bcrypt = require(join(root, 'apps', 'api', 'node_modules', 'bcryptjs'));

const PERSON_EMAILS = [
  'sara.alamri@dgop.local',
  'khalid.hassan@dgop.local',
  'mona.youssef@dgop.local',
  'omar.farouk@dgop.local',
  'layla.nasser@dgop.local',
];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function loadEnv() {
  if (!existsSync(envPath)) throw new Error('Missing ignored root .env. Run `npm run demo:prepare` first.');
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireSafePassword(name) {
  const value = process.env[name]?.trim();
  if (!value || value.length < 12 || ['Admin@12345', 'Admin12345@', 'change-me', 'password'].includes(value)) {
    throw new Error(`${name} must contain a non-default password of at least 12 characters.`);
  }
  return value;
}

loadEnv();
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (!LOOPBACK_HOSTS.has(databaseUrl.hostname.toLowerCase())) {
  throw new Error('Refusing demo credential synchronization because DATABASE_URL is not loopback-only.');
}

const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@dgop.local';
const adminPassword = requireSafePassword('SEED_ADMIN_PASSWORD');
const personPassword = requireSafePassword('SEED_PERSON_PASSWORD');
const prisma = new PrismaClient();

async function updatePasswordIfNeeded(email, password) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  if (!user) return { email, status: 'missing' };
  if (await bcrypt.compare(password, user.passwordHash)) return { email, status: 'unchanged' };
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
  return { email, status: 'updated' };
}

try {
  const results = [];
  results.push(await updatePasswordIfNeeded(adminEmail, adminPassword));
  for (const email of PERSON_EMAILS) results.push(await updatePasswordIfNeeded(email, personPassword));
  const updated = results.filter((result) => result.status === 'updated').length;
  const unchanged = results.filter((result) => result.status === 'unchanged').length;
  const missing = results.filter((result) => result.status === 'missing').map((result) => result.email);
  console.log(`Demo credentials synchronized: ${updated} updated, ${unchanged} already current.`);
  if (missing.length) console.warn(`Canonical demo users not present: ${missing.join(', ')}.`);
} finally {
  await prisma.$disconnect();
}
