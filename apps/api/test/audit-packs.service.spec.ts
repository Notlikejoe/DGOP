import assert from 'node:assert/strict';
import { buildManifest, packReadiness, sha256, zipStore } from '../src/audit-packs/audit-packs.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('ZIP export creates a valid local-file archive envelope', () => {
  const zip = zipStore([{ path: 'summary.json', body: '{"ok":true}' }], new Date('2026-07-14T00:00:00Z'));
  assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(zip.includes(Buffer.from('summary.json')));
});

test('manifest records file hashes and evidence hash entries', () => {
  const files = [{ path: 'specifications.json', body: '[{"code":"NDI-1"}]' }];
  const manifest = buildManifest(
    {
      packCode: 'NDI-PACK-1',
      scope: 'full',
      generatedAt: '2026-07-14T00:00:00Z',
      frameworks: ['SDAIA NDI'],
      evidence: [
        {
          id: 'ev1',
          specCode: 'NDI-1',
          originalName: 'policy.pdf',
          sha256: 'abc',
          status: 'approved',
          expiryDate: null,
        },
      ],
    },
    files,
  );
  assert.equal(manifest.files[0].sha256, sha256(files[0].body));
  assert.equal(manifest.evidence[0].originalName, 'policy.pdf');
});

test('readiness status blocks weak or blocked packs', () => {
  assert.equal(packReadiness(90, 0), 'ready');
  assert.equal(packReadiness(75, 0), 'watch');
  assert.equal(packReadiness(90, 1), 'blocked');
  assert.equal(packReadiness(40, 0), 'blocked');
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
