import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import {
  buildErrorExperience,
  prismaErrorExperience,
  statusToErrorCode,
} from '../src/common/error-experience.logic';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function filterResponse(exception: unknown, headers: Record<string, string> = {}) {
  const writes: Record<string, string> = {};
  let statusCode = 0;
  let body: any = null;
  const filter = new AllExceptionsFilter();
  filter.catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/example',
        headers,
      }),
      getResponse: () => ({
        setHeader: (key: string, value: string) => {
          writes[key] = value;
        },
        status: (status: number) => {
          statusCode = status;
          return {
            json: (payload: unknown) => {
              body = payload;
            },
          };
        },
      }),
    }),
  } as any);
  return { statusCode, body, headers: writes };
}

test('statusToErrorCode maps critical API failures to stable public codes', () => {
  assert.equal(statusToErrorCode(HttpStatus.BAD_REQUEST), 'VAL-400');
  assert.equal(statusToErrorCode(HttpStatus.UNAUTHORIZED), 'SES-401');
  assert.equal(statusToErrorCode(HttpStatus.FORBIDDEN), 'PER-403');
  assert.equal(statusToErrorCode(HttpStatus.NOT_FOUND), 'BUS-404');
  assert.equal(statusToErrorCode(HttpStatus.CONFLICT), 'BUS-409');
  assert.equal(statusToErrorCode(HttpStatus.TOO_MANY_REQUESTS), 'RATE-429');
  assert.equal(statusToErrorCode(HttpStatus.INTERNAL_SERVER_ERROR), 'SYS-500');
});

test('buildErrorExperience separates user-safe text from technical message', () => {
  const result = buildErrorExperience(HttpStatus.FORBIDDEN, 'Insufficient permissions');
  assert.equal(result.code, 'PER-403');
  assert.equal(result.message, 'Insufficient permissions');
  assert.match(result.userMessage, /access/i);
  assert.equal(result.retryable, false);
});

test('prisma known errors map to safe conflict and not-found responses', () => {
  const conflict = prismaErrorExperience(
    new Prisma.PrismaClientKnownRequestError('Unique failed', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  );
  assert.equal(conflict.status, HttpStatus.CONFLICT);
  assert.equal(conflict.code, 'BUS-409');

  const missing = prismaErrorExperience(
    new Prisma.PrismaClientKnownRequestError('Missing row', {
      code: 'P2025',
      clientVersion: 'test',
    }),
  );
  assert.equal(missing.status, HttpStatus.NOT_FOUND);
  assert.equal(missing.code, 'BUS-404');
});

test('exception filter emits request IDs, public codes, and no stack trace in response', () => {
  const result = filterResponse(new ForbiddenException('Insufficient permissions'), {
    'x-request-id': 'req-test-1',
  });
  assert.equal(result.statusCode, HttpStatus.FORBIDDEN);
  assert.equal(result.body.code, 'PER-403');
  assert.equal(result.body.requestId, 'req-test-1');
  assert.equal(result.headers['x-request-id'], 'req-test-1');
  assert.equal(result.body.path, '/api/example');
  assert.equal(result.body.method, 'POST');
  assert.equal('stack' in result.body, false);
});

test('validation exception preserves field messages while adding nontechnical guidance', () => {
  const result = filterResponse(
    new BadRequestException({
      message: ['name must not be empty', 'code must be unique'],
      error: 'Bad Request',
    }),
  );
  assert.equal(result.statusCode, HttpStatus.BAD_REQUEST);
  assert.equal(result.body.code, 'VAL-400');
  assert.deepEqual(result.body.message, ['name must not be empty', 'code must be unique']);
  assert.match(result.body.userMessage, /fields/i);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  OK ${t.name}`);
    } catch (err) {
      console.error(`  FAIL ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
