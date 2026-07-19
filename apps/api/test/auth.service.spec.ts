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
import { authCookieOptions, readCookie } from '../src/auth/auth-cookie';
import { jwtDurationMs, jwtDurationSeconds } from '../src/auth/auth-duration';

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

test('login profile and token ignore inactive assigned roles', async () => {
  let signedPayload: JwtPayload | null = null;
  let permissionRoleCodes: string[] = [];
  const row = await userRow('Correct#123', 7);
  row.userRoles = [
    { role: { code: 'business_steward', nameEn: 'Business Steward', nameAr: 'Business Steward', isActive: true } as never },
    { role: { code: 'retired_role', nameEn: 'Retired Role', nameAr: 'Retired Role', isActive: false } as never },
  ];
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
    {
      permissionsForRoleCodes: async (roleCodes: string[]) => {
        permissionRoleCodes = roleCodes;
        return ['dashboard.view'];
      },
    } as never,
    { resolve: async () => ({ orgUnits: 'all', domains: 'all', maxClassRank: null }) } as never,
  );

  const result = await service.login(row.email, 'Correct#123', '127.0.0.1');

  assert.deepStrictEqual((signedPayload as JwtPayload | null)?.roles, ['business_steward']);
  assert.deepStrictEqual(permissionRoleCodes, ['business_steward']);
  assert.deepStrictEqual(result.user.roles.map((role: { code: string }) => role.code), ['business_steward']);
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

test('login fails closed when the success audit event cannot be recorded', async () => {
  const row = await userRow('Correct#123', 7);
  const deps = profileDeps();
  const service = new AuthService(
    {
      findByEmailWithRoles: async () => row,
      updateLastLogin: async () => row,
    } as never,
    {
      sign: () => 'signed-token',
    } as never,
    {
      log: async ({ action }: { action: string }) => {
        if (action === 'auth.login.success') throw new Error('audit unavailable');
      },
    } as never,
    deps.access as never,
    deps.scope as never,
  );
  (service as any).logger = { warn: () => undefined };

  await assert.rejects(() => service.login(row.email, 'Correct#123', '127.0.0.1'), /audit unavailable/);
});

test('strict login rejects known unsafe demo passwords for any account', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousStrict = process.env.DGOP_REQUIRE_STRICT_RUNTIME;
  process.env.NODE_ENV = 'production';
  delete process.env.DGOP_REQUIRE_STRICT_RUNTIME;

  try {
    const row = await userRow('Admin@12345', 7);
    row.email = 'steward@dgop.local';
    const deps = profileDeps();
    const auditEvents: { action: string; metadata?: { reason?: string } }[] = [];
    const service = new AuthService(
      {
        findByEmailWithRoles: async () => row,
        updateLastLogin: async () => row,
      } as never,
      {
        sign: () => 'signed-token',
      } as never,
      {
        log: async (event: { action: string; metadata?: { reason?: string } }) => {
          auditEvents.push(event);
        },
      } as never,
      deps.access as never,
      deps.scope as never,
    );
    (service as any).logger = { warn: () => undefined };

    await assert.rejects(() => service.login(row.email, 'Admin@12345', '127.0.0.1'), UnauthorizedException);
    assert.ok(
      auditEvents.some((event) => event.action === 'auth.login.failed' && event.metadata?.reason === 'unsafe_demo_credential'),
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousStrict === undefined) delete process.env.DGOP_REQUIRE_STRICT_RUNTIME;
    else process.env.DGOP_REQUIRE_STRICT_RUNTIME = previousStrict;
  }
});

test('malformed auth cookies are ignored instead of throwing', () => {
  assert.strictEqual(
    readCookie({ headers: { cookie: 'theme=dark; dgop_session=%E0%A4%A' } } as never, 'dgop_session'),
    undefined,
  );
  assert.strictEqual(
    readCookie({ headers: { cookie: 'theme=dark; dgop_session=signed-token' } } as never, 'dgop_session'),
    'signed-token',
  );
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

test('jwt duration parsing aligns signed token and cookie expiry', () => {
  assert.strictEqual(jwtDurationSeconds('3600'), 3600);
  assert.strictEqual(jwtDurationMs('3600'), 3_600_000);
  assert.strictEqual(jwtDurationSeconds('1h'), 3600);
  assert.strictEqual(jwtDurationMs('15m'), 900_000);
  assert.strictEqual(jwtDurationSeconds('500ms'), 1);

  const previous = process.env.JWT_EXPIRES_IN;
  process.env.JWT_EXPIRES_IN = '3600';
  try {
    const options = authCookieOptions({
      secure: false,
      get: (name: string) => (name.toLowerCase() === 'x-forwarded-proto' ? 'https' : undefined),
    } as never);

    assert.strictEqual(options.maxAge, 3_600_000);
    assert.strictEqual(options.secure, true);
  } finally {
    if (previous === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = previous;
  }
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
