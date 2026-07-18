const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const UNSAFE_JWT_SECRETS = new Set([
  'dev-insecure-secret',
  'replace-with-at-least-32-random-characters',
  'change-me',
  'changeme',
]);

const UNSAFE_DEMO_PASSWORDS = new Set([
  'Admin@12345',
  'admin',
  'password',
  'Password123',
  'change-me',
  'changeme',
  'replace-with-local-demo-password',
]);

type RuntimeEnv = Record<string, string | undefined>;

export function isProductionLikeRuntime(env: RuntimeEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV ?? 'development';
  return !['development', 'test'].includes(nodeEnv) || TRUE_VALUES.has((env.DGOP_REQUIRE_STRICT_RUNTIME ?? '').toLowerCase());
}

export function configuredCorsOrigins(env: RuntimeEnv = process.env): string[] {
  const origins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (env.PUBLIC_ORIGIN?.trim()) origins.push(env.PUBLIC_ORIGIN.trim());
  return [...new Set(origins)];
}

export function isUnsafeJwtSecret(secret?: string | null): boolean {
  const value = secret?.trim();
  return !value || value.length < 32 || UNSAFE_JWT_SECRETS.has(value);
}

export function isUnsafeDemoPassword(password?: string | null): boolean {
  const value = password?.trim();
  return !value || value.length < 12 || UNSAFE_DEMO_PASSWORDS.has(value);
}

export function isUnsafeDefaultAdminCredential(
  email: string,
  password: string,
  env: RuntimeEnv = process.env,
): boolean {
  const configuredAdminEmail = (env.SEED_ADMIN_EMAIL ?? 'admin@dgop.local').toLowerCase();
  return email.toLowerCase() === configuredAdminEmail && UNSAFE_DEMO_PASSWORDS.has(password);
}

export function collectRuntimeSafetyIssues(env: RuntimeEnv = process.env): string[] {
  if (!isProductionLikeRuntime(env)) return [];

  const issues: string[] = [];
  const origins = configuredCorsOrigins(env);
  const webhookToken = env.DGOP_WEBHOOK_TOKEN?.trim();

  if (!env.DATABASE_URL?.trim()) {
    issues.push('DATABASE_URL must be configured');
  }
  if (isUnsafeJwtSecret(env.JWT_SECRET)) {
    issues.push('JWT_SECRET must be at least 32 characters and not use a known placeholder');
  }
  if (origins.length === 0) {
    issues.push('CORS_ORIGINS or PUBLIC_ORIGIN must be configured');
  }
  if (origins.some((origin) => origin === '*' || origin.toLowerCase() === 'true')) {
    issues.push('CORS_ORIGINS/PUBLIC_ORIGIN cannot be wildcard or permissive in strict runtime');
  }
  if (isUnsafeDemoPassword(env.SEED_ADMIN_PASSWORD)) {
    issues.push('SEED_ADMIN_PASSWORD must be configured with a rotated non-default password');
  }
  if (!webhookToken || webhookToken.length < 32 || webhookToken.startsWith('replace-with')) {
    issues.push('DGOP_WEBHOOK_TOKEN must be configured with at least 32 random characters');
  }

  return issues;
}

export function assertSafeRuntimeConfig(env: RuntimeEnv = process.env): void {
  const issues = collectRuntimeSafetyIssues(env);
  if (issues.length) {
    throw new Error(`Unsafe DGOP runtime configuration:\n- ${issues.join('\n- ')}`);
  }
}
