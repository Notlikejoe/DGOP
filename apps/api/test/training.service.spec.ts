/**
 * Sprint 12 awareness operations rule tests.
 * Run with: ts-node test/training.service.spec.ts
 */
import assert from 'node:assert';
import { TrainingService } from '../src/training/training.service';
import { assignmentEffectiveStatus, awarenessReadinessScore, certificationState, pct } from '../src/training/training.logic';

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });

test('pct handles empty totals without division noise', () => {
  assert.strictEqual(pct(0, 0), 0);
  assert.strictEqual(pct(3, 4), 75);
});

test('awareness readiness blends training, certification, CE, and mentorship signals', () => {
  const score = awarenessReadinessScore({
    assignments: 10,
    completed: 7,
    expired: 1,
    overdue: 2,
    certifications: 3,
    certified: 2,
    ceHours: 10,
    mentorships: 1,
  });
  assert.strictEqual(score, 71);
});

test('awareness readiness stays bounded when CE hours exceed the annual target', () => {
  const score = awarenessReadinessScore({
    assignments: 4,
    completed: 4,
    expired: 0,
    overdue: 0,
    certifications: 1,
    certified: 1,
    ceHours: 40,
    mentorships: 2,
  });
  assert.strictEqual(score, 100);
});

test('certification state detects current, renewal due, expired, and non-passed attempts', () => {
  const now = new Date('2026-07-05T00:00:00.000Z');
  assert.strictEqual(certificationState('in_progress', null, now), 'in_progress');
  assert.strictEqual(certificationState('passed', null, now), 'current');
  assert.strictEqual(certificationState('passed', '2026-12-01T00:00:00.000Z', now), 'current');
  assert.strictEqual(certificationState('passed', '2026-08-01T00:00:00.000Z', now), 'renewal_due');
  assert.strictEqual(certificationState('passed', '2026-07-01T00:00:00.000Z', now), 'expired');
});

test('assignment effective status treats expired completions as expired without mutating reads', () => {
  const now = new Date('2026-07-05T00:00:00.000Z');
  assert.strictEqual(assignmentEffectiveStatus('assigned', null, now), 'assigned');
  assert.strictEqual(assignmentEffectiveStatus('completed', null, now), 'completed');
  assert.strictEqual(assignmentEffectiveStatus('completed', '2026-07-01T00:00:00.000Z', now), 'expired');
  assert.strictEqual(assignmentEffectiveStatus('completed', '2026-08-01T00:00:00.000Z', now), 'completed');
});

test('course prerequisite validation rejects self-references and missing courses', async () => {
  const service = new TrainingService(
    { trainingCourse: { findFirst: async () => null } } as never,
    { log: async () => undefined } as never,
  );
  const validator = service as unknown as {
    assertPrerequisiteCourse: (id: string, courseId: string) => Promise<string>;
  };
  await assert.rejects(() => validator.assertPrerequisiteCourse('course-1', 'course-1'), /cannot require itself/);
  await assert.rejects(() => validator.assertPrerequisiteCourse('missing', 'course-1'), /not found/);
});

test('course prerequisite validation rejects cycles through an existing chain', async () => {
  const courses = new Map([
    ['course-2', { id: 'course-2', prerequisiteCourseId: 'course-1' }],
  ]);
  const service = new TrainingService(
    {
      trainingCourse: {
        findFirst: async ({ where }: { where: { id: string } }) => courses.get(where.id) ?? null,
      },
    } as never,
    { log: async () => undefined } as never,
  );
  const validator = service as unknown as {
    assertPrerequisiteCourse: (id: string, courseId: string) => Promise<string>;
  };
  await assert.rejects(() => validator.assertPrerequisiteCourse('course-2', 'course-1'), /cycle/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
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
