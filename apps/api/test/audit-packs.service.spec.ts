import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { AuditPacksService } from '../src/audit-packs/audit-packs.service';
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

test('ZIP export rejects unsafe archive entry paths', () => {
  assert.throws(() => zipStore([{ path: '../evidence.pdf', body: 'x' }]), /unsafe audit pack file path/);
  assert.throws(() => zipStore([{ path: 'C:/temp/evidence.pdf', body: 'x' }]), /unsafe audit pack file path/);
  assert.throws(() => zipStore([{ path: 'safe/../evidence.pdf', body: 'x' }]), /unsafe audit pack file path/);
  assert.throws(() => buildManifest(
    {
      packCode: 'NDI-PACK-1',
      scope: 'full',
      generatedAt: '2026-07-14T00:00:00Z',
      frameworks: ['SDAIA NDI'],
      evidence: [],
    },
    [{ path: 'bad:name.json', body: '{}' }],
  ), /unsafe audit pack file path/);
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

test('audit pack readiness scopes scoring, specifications, evidence, and workflow decisions', async () => {
  const actor = { id: 'u1', email: 'owner@dgop.local', roles: ['enterprise_data_steward'] };
  const scoringActors: unknown[] = [];
  let specWhere: unknown;
  let evidenceWhere: unknown;
  let workflowWhere: unknown;
  const service = new AuditPacksService(
    {
      person: { findFirst: async () => ({ id: 'person-1' }) },
      ndiSpecification: {
        findMany: async (args: any) => {
          specWhere = args.where;
          evidenceWhere = args.select.evidence.where;
          return [
            {
              id: 'spec-1',
              code: 'NDI-1',
              nameEn: 'Owned spec',
              type: 'control',
              maturityLevel: 'level_2',
              domain: { code: 'data_quality', shortCode: 'DQ', nameEn: 'Data Quality' },
              owner: { fullNameEn: 'Owner', email: actor.email },
              evidence: [
                {
                  id: 'ev-1',
                  title: 'Approved proof',
                  originalName: 'proof.pdf',
                  sha256: 'abc',
                  status: 'approved',
                  reviewedAt: new Date('2026-07-01T00:00:00Z'),
                  expiryDate: null,
                },
              ],
            },
          ];
        },
      },
      workflowTask: {
        findMany: async (args: any) => {
          workflowWhere = args.where;
          return [];
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {
      readiness: async (inputActor: unknown) => {
        scoringActors.push(inputActor);
        return {
          overall: { score: 90, specCount: 1 },
        };
      },
      gaps: async (inputActor: unknown) => {
        scoringActors.push(inputActor);
        return [];
      },
    } as never,
  );

  const preview = await service.readiness(actor, undefined);
  const specWhereText = JSON.stringify(specWhere);
  const evidenceWhereText = JSON.stringify(evidenceWhere);
  const workflowWhereText = JSON.stringify(workflowWhere);

  assert.equal(preview.summary.specCount, 1);
  assert.equal(preview.summary.approvedEvidenceCount, 1);
  assert.deepEqual(scoringActors, [actor, actor]);
  assert.ok(specWhereText.includes('ownerPersonId'));
  assert.ok(specWhereText.includes('submittedBy'));
  assert.ok(evidenceWhereText.includes(actor.email));
  assert.ok(evidenceWhereText.includes('ownerPersonId'));
  assert.ok(workflowWhereText.includes('assigneeUserId'));
  assert.ok(workflowWhereText.includes('events'));
});

test('audit pack list and export hide other users packs from restricted roles', async () => {
  const actor = { id: 'u1', email: 'owner@dgop.local', roles: ['enterprise_data_steward'] };
  let listWhere: unknown;
  let exportWhere: unknown;
  const service = new AuditPacksService(
    {
      ndiAuditPack: {
        findMany: async (args: any) => {
          listWhere = args.where;
          return [];
        },
        findFirst: async (args: any) => {
          exportWhere = args.where;
          return null;
        },
      },
    } as never,
    { log: async () => undefined } as never,
    {} as never,
  );

  await service.list(actor);
  await assert.rejects(() => service.exportZip('pack-1', actor), NotFoundException);
  assert.deepEqual(listWhere, { requestedBy: actor.email });
  assert.deepEqual(exportWhere, { id: 'pack-1', requestedBy: actor.email });
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
