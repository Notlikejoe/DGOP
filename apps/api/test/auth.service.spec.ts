/**
 * Unit tests for local JWT token-version invalidation.
 * Run with: ts-node test/auth.service.spec.ts
 */
import assert from 'node:assert';
import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, CsrfGuard } from '../src/auth/csrf.guard';
import { JwtPayload } from '../src/auth/auth.types';

const tests: { name: string; fn: () => Promise<void> | void }[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

const userRow = async (password = 'Correct#123', tokenVersion = 3) => ({
  id: 'user-1',
  email: 'admin@dgop.local',
  displayName: 'Admin',
  isActive: true,
  tokenVersion,
  lastLoginAt: null,
  passwordHash: await bcrypt.hash(password, 4),
  userRoles: [{ role: { code: 'system_admin', nameEn: 'System Administrator', nameAr: 'System Administrator' } }],
});

const profileDeps = () => ({
  access: { permissionsForRoleCodes: async () => ['dashboard.view'] },
  scope: { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) },
});

test('login signs the current token version into the JWT payload', async () => {
  let signedPayload: JwtPayload | null = null;
  const row = await userRow('Correct#123', 7);
  const deps = profileDeps();
  const service = new AuthService(
    {
      findByEmailWithRoles: async () => row,
      updateLastLogin: async () => row,
    } as never,
    {
      sign: (payload: JwtPayload) => {
        signedPayload = payload;
        return 'signed-token';
      },
    } as never,
    { log: async () => undefined } as never,
    deps.access as never,
    deps.scope as never,
  );

  const result = await service.login(row.email, 'Correct#123', '127.0.0.1');

  assert.strictEqual(result.accessToken, 'signed-token');
  assert.strictEqual((signedPayload as JwtPayload | null)?.tokenVersion, 7);
});

test('sessionFromToken rejects a token after the user token version changes', async () => {
  const row = await userRow('Correct#123', 2);
  const deps = profileDeps();
  const service = new AuthService(
    { findByIdWithRoles: async () => row } as never,
    {
      verify: () => ({
        sub: row.id,
        email: row.email,
        roles: ['system_admin'],
        tokenVersion: 1,
      }),
    } as never,
    { log: async () => undefined } as never,
    deps.access as never,
    deps.scope as never,
  );

  assert.strictEqual(await service.sessionFromToken('old-token'), null);
});

test('logout increments the user token version and writes an audit event', async () => {
  let bumpedUserId: string | null = null;
  let auditAction: string | null = null;
  const deps = profileDeps();
  const service = new AuthService(
    { bumpTokenVersion: async (id: string) => { bumpedUserId = id; } } as never,
    {} as never,
    { log: async ({ action }: { action: string }) => { auditAction = action; } } as never,
    deps.access as never,
    deps.scope as never,
  );

  await service.logout({ id: 'user-1', email: 'admin@dgop.local', roles: ['system_admin'] });

  assert.strictEqual(bumpedUserId, 'user-1');
  assert.strictEqual(auditAction, 'auth.logout');
});

test('jwt guard rejects a token whose version no longer matches the user row', async () => {
  const guard = new JwtAuthGuard(
    { getAllAndOverride: () => false } as never,
    {
      verify: () => ({
        sub: 'user-1',
        email: 'admin@dgop.local',
        roles: ['system_admin'],
        tokenVersion: 1,
      }),
    } as never,
    {
      user: {
        findUnique: async () => ({
          id: 'user-1',
          email: 'admin@dgop.local',
          isActive: true,
          tokenVersion: 2,
          userRoles: [{ role: { code: 'system_admin' } }],
        }),
      },
    } as never,
  );
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer old-token' } }),
    }),
  };

  await assert.rejects(() => guard.canActivate(context as never), UnauthorizedException);
});

test('csrf guard requires the DGOP same-origin header for cookie-backed writes', () => {
  const guard = new CsrfGuard({ getAllAndOverride: () => false } as never);
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        headers: { cookie: 'dgop_session=session-token' },
      }),
    }),
  };

  assert.throws(() => guard.canActivate(context as never), /Missing anti-CSRF header/);
});

test('csrf guard allows same-origin header and bearer-token writes', () => {
  const guard = new CsrfGuard({ getAllAndOverride: () => false } as never);
  const sameOriginContext = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'PATCH',
        headers: {
          cookie: 'dgop_session=session-token',
          [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
        },
      }),
    }),
  };
  const bearerContext = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        headers: { authorization: 'Bearer api-token' },
      }),
    }),
  };

  assert.strictEqual(guard.canActivate(sameOriginContext as never), true);
  assert.strictEqual(guard.canActivate(bearerContext as never), true);
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
