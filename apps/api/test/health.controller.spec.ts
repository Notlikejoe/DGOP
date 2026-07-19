import assert from 'node:assert/strict';
import { HealthController } from '../src/health/health.controller';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function makeController(options: { dbThrows?: boolean; env?: Record<string, string | undefined> } = {}) {
  const prisma = {
    $queryRaw: async () => {
      if (options.dbThrows) throw new Error('database unavailable');
      return [{ '?column?': 1 }];
    },
  };
  const config = {
    get: (key: string) => options.env?.[key],
  };
  return new HealthController(prisma as never, config as never);
}

test('production health exposes database status without database name', async () => {
  const res = await makeController({ env: { NODE_ENV: 'production', DB_NAME: 'dgop_prod' } }).check();
  assert.equal(res.status, 'ok');
  assert.equal((res.database as Record<string, unknown>).status, 'up');
  assert.equal((res.database as Record<string, unknown>).name, undefined);
  assert.equal(res.environment, undefined);
});

test('health reports degraded when database connectivity fails', async () => {
  const res = await makeController({ dbThrows: true, env: { NODE_ENV: 'production' } }).check();
  assert.equal(res.status, 'degraded');
  assert.equal((res.database as Record<string, unknown>).status, 'down');
});

test('detail mode includes environment, uptime, and database name', async () => {
  const res = await makeController({
    env: { NODE_ENV: 'production', HEALTH_INCLUDE_DETAILS: 'true', DB_NAME: 'dgop_uat' },
  }).check();
  assert.equal(res.environment, 'production');
  assert.equal(typeof res.uptimeSeconds, 'number');
  assert.equal((res.database as Record<string, unknown>).name, 'dgop_uat');
});

(async () => {
  for (const t of tests) {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
  }
  console.log(`\n${tests.length}/${tests.length} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
