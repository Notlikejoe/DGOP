import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { DataSubjectsService } from '../src/master-data/data-subjects.service';
import { DataDomainsService } from '../src/master-data/data-domains.service';
import { SystemsService } from '../src/master-data/systems.service';
import { RaciTemplatesService } from '../src/master-data/raci-templates.service';
import { PeopleService } from '../src/ownership/people.service';
import {
  assertUniqueRoleResponsibility,
  trimRecord,
  validateMasterText,
} from '../src/master-data/master-data.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

const audit = { log: async () => undefined };

test('master-data text validation trims and rejects weak codes', () => {
  assert.deepEqual(trimRecord({ code: '  FIN.DATA ', description: '   ' }), {
    code: 'FIN.DATA',
    description: null,
  });
  assert.deepEqual(
    validateMasterText({ code: 'bad code', nameEn: 'Finance', nameAr: 'Finance' }),
    ['Record code must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens'],
  );
  assert.deepEqual(
    assertUniqueRoleResponsibility([
      { roleTypeId: 'role-1', responsibility: 'R' },
      { roleTypeId: 'role-1', responsibility: 'A' },
    ]),
    ['Each role type can appear only once in a RACI template'],
  );
});

test('base CRUD blocks duplicate active codes before create', async () => {
  const service = new DataSubjectsService(
    {
      dataSubject: {
        findFirst: async (args: any) => (args.where.code === 'PERSON' ? { id: 'existing' } : null),
        create: async () => {
          throw new Error('create should not run');
        },
      },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () => service.create({ code: 'PERSON', nameEn: 'Person', nameAr: 'Person' }, 'admin@dgop.local'),
    BadRequestException,
  );
});

test('base CRUD keeps master-data codes immutable on update', async () => {
  const service = new DataSubjectsService(
    {
      dataSubject: {
        findFirst: async (args: any) =>
          args.where.id === 'subject-1'
            ? { id: 'subject-1', code: 'PERSON', nameEn: 'Person', nameAr: 'Person' }
            : null,
        update: async () => {
          throw new Error('update should not run');
        },
      },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () => service.update('subject-1', { code: 'CUSTOMER' }, 'admin@dgop.local'),
    /code is immutable/,
  );
});

test('base CRUD blocks delete when active dependencies still point at the record', async () => {
  const service = new DataSubjectsService(
    {
      dataSubject: {
        findFirst: async () => ({ id: 'subject-1', code: 'PERSON', nameEn: 'Person', nameAr: 'Person' }),
        update: async () => {
          throw new Error('delete update should not run');
        },
      },
      assetSubject: { count: async () => 2 },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () => service.remove('subject-1', 'admin@dgop.local'),
    /asset subject links/,
  );
});

test('hierarchy CRUD blocks cycles and inactive parents', async () => {
  const service = new DataDomainsService(
    {
      dataDomain: {
        findFirst: async (args: any) => {
          if (args.where.id === 'root' && !args.where.isActive) {
            return { id: 'root', code: 'ROOT', nameEn: 'Root', nameAr: 'Root', parentId: null };
          }
          if (args.where.id === 'inactive-parent') return null;
          if (args.where.id === 'child') return { id: 'child' };
          return null;
        },
        findMany: async () => [
          { id: 'root', parentId: null },
          { id: 'child', parentId: 'root' },
        ],
        update: async () => {
          throw new Error('cycle update should not run');
        },
        create: async () => {
          throw new Error('inactive parent create should not run');
        },
      },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () => service.update('root', { parentId: 'root' }, 'admin@dgop.local'),
    /own parent/,
  );
  await assert.rejects(
    () => service.update('root', { parentId: 'child' }, 'admin@dgop.local'),
    /descendants/,
  );
  await assert.rejects(
    () =>
      service.create(
        { code: 'NEW', nameEn: 'New', nameAr: 'New', parentId: 'inactive-parent' },
        'admin@dgop.local',
      ),
    /Parent must be an active record/,
  );
});

test('systems require an active owner organization unit', async () => {
  const service = new SystemsService(
    {
      systemPlatform: {
        findFirst: async () => null,
        create: async () => {
          throw new Error('create should not run');
        },
      },
      organizationUnit: { findFirst: async () => null },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () =>
      service.create(
        {
          code: 'SYS-FIN',
          nameEn: 'Finance System',
          nameAr: 'Finance System',
          ownerOrgUnitId: 'missing-org',
        },
        'admin@dgop.local',
      ),
    /Owner organization unit must be active/,
  );
});

test('RACI templates validate active role references before replacing items', async () => {
  const service = new RaciTemplatesService(
    {
      raciTemplate: {
        findFirst: async () => null,
        create: async () => {
          throw new Error('create should not run');
        },
      },
      roleType: { findMany: async () => [] },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () =>
      service.create(
        {
          code: 'OWNERSHIP',
          nameEn: 'Ownership',
          nameAr: 'Ownership',
          items: [{ roleTypeId: '00000000-0000-0000-0000-000000000001', responsibility: 'R' }],
        },
        'admin@dgop.local',
      ),
    /Unknown or inactive role types/,
  );
});

test('people validation blocks duplicate emails and referenced deletes', async () => {
  const service = new PeopleService(
    {
      person: {
        findFirst: async (args: any) => {
          if (args.where.email === 'admin@dgop.local') return { id: 'other-person' };
          if (args.where.id === 'person-1') return { id: 'person-1', fullNameEn: 'A', fullNameAr: 'A' };
          return null;
        },
        create: async () => {
          throw new Error('create should not run');
        },
        update: async () => {
          throw new Error('delete update should not run');
        },
      },
      user: { findFirst: async () => ({ id: 'user-1', isActive: true }) },
      stewardshipAssignment: { count: async () => 1 },
      assignmentRule: { count: async () => 0 },
      certificationAttempt: { count: async () => 0 },
      trainingAssignment: { count: async () => 0 },
    } as never,
    audit as never,
  );

  await assert.rejects(
    () =>
      service.create(
        {
          fullNameEn: 'Admin',
          fullNameAr: 'Admin',
          email: 'ADMIN@DGOP.LOCAL',
        },
        'admin@dgop.local',
      ),
    /email is already used/,
  );

  await assert.rejects(
    () => service.remove('person-1', 'admin@dgop.local'),
    /ownership assignments/,
  );
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  OK ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}`);
      console.error(err);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
