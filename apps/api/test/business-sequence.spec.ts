import assert from 'node:assert/strict';
import {
  formatBusinessSequence,
  nextAvailableBusinessCode,
  nextBusinessSequence,
} from '../src/common/business-sequence';

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn) => tests.push({ name, fn });

function sequenceClient(initial = 0n) {
  let value = initial;
  return {
    businessSequence: {
      upsert: async () => ({ value: ++value }),
    },
  };
}

test('atomic sequence reservations remain distinct across concurrent callers', async () => {
  const client = sequenceClient();
  const values = await Promise.all(
    Array.from({ length: 50 }, () => nextBusinessSequence(client as never, 'concurrency-test')),
  );
  assert.equal(new Set(values.map(String)).size, 50);
  assert.equal(values[0], 1n);
  assert.equal(values[49], 50n);
});

test('available-code reservation skips identifiers already present in legacy data', async () => {
  const client = sequenceClient();
  const code = await nextAvailableBusinessCode(
    client as never,
    'legacy-test',
    (value) => `CODE-${formatBusinessSequence(value, 4)}`,
    async (candidate) => candidate !== 'CODE-0001',
  );
  assert.equal(code, 'CODE-0002');
});

(async () => {
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`  OK ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${entry.name}`);
      console.error(error);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
