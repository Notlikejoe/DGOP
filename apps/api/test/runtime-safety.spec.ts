/**
 * Runtime safety tests for production-like demo and publish startup.
 * Run with: ts-node test/runtime-safety.spec.ts
 */
import assert from 'node:assert';
import {
  collectRuntimeSafetyIssues,
  configuredCorsOrigins,
  isProductionLikeRuntime,
  isUnsafeDefaultAdminCredential,
} from '../src/common/runtime-safety';

const tests: { name: string; fn: () => void }[] = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('development runtime does not require external publish safeguards', () => {
  assert.deepStrictEqual(collectRuntimeSafetyIssues({ NODE_ENV: 'development' }), []);
  assert.strictEqual(isProductionLikeRuntime({ NODE_ENV: 'development' }), false);
});

test('strict runtime is enabled by production or explicit publish flag', () => {
  assert.strictEqual(isProductionLikeRuntime({ NODE_ENV: 'production' }), true);
  assert.strictEqual(
    isProductionLikeRuntime({ NODE_ENV: 'development', DGOP_REQUIRE_STRICT_RUNTIME: 'true' }),
    true,
  );
});

test('strict runtime rejects unsafe secrets, wildcard origins, and missing webhook token', () => {
  const issues = collectRuntimeSafetyIssues({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/dgop',
    JWT_SECRET: 'replace-with-at-least-32-random-characters',
    CORS_ORIGINS: '*',
    SEED_ADMIN_PASSWORD: 'Admin@12345',
    DGOP_AUDIT_FAIL_CLOSED: 'false',
  });

  assert.ok(issues.some((issue) => issue.includes('JWT_SECRET')));
  assert.ok(issues.some((issue) => issue.includes('wildcard')));
  assert.ok(issues.some((issue) => issue.includes('SEED_ADMIN_PASSWORD')));
  assert.ok(issues.some((issue) => issue.includes('DGOP_WEBHOOK_TOKEN')));
  assert.ok(issues.some((issue) => issue.includes('DGOP_AUDIT_FAIL_CLOSED')));
});

test('strict runtime accepts rotated demo settings', () => {
  const issues = collectRuntimeSafetyIssues({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/dgop',
    JWT_SECRET: 'safe-jwt-secret-with-more-than-32-chars',
    CORS_ORIGINS: 'https://demo.example.com',
    SEED_ADMIN_PASSWORD: 'rotated-admin-password-2026',
    DGOP_WEBHOOK_TOKEN: 'safe-webhook-token-with-more-than-32-chars',
  });

  assert.deepStrictEqual(issues, []);
});

test('configuredCorsOrigins deduplicates CORS and public origin values', () => {
  assert.deepStrictEqual(
    configuredCorsOrigins({
      CORS_ORIGINS: 'https://demo.example.com, https://demo.example.com',
      PUBLIC_ORIGIN: 'https://app.example.com',
    }),
    ['https://demo.example.com', 'https://app.example.com'],
  );
});

test('unsafe default admin credential is recognized for strict login blocking', () => {
  assert.strictEqual(
    isUnsafeDefaultAdminCredential('admin@dgop.local', 'Admin@12345', {}),
    true,
  );
  assert.strictEqual(
    isUnsafeDefaultAdminCredential('admin@dgop.local', 'rotated-admin-password-2026', {}),
    false,
  );
});

(() => {
  let failed = 0;
  for (const t of tests) {
    try {
      t.fn();
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  \u2717 ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
