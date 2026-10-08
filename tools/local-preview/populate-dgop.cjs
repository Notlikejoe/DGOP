'use strict';
const c = require('./populate-dgop-common.cjs');
const { spawn, spawnSync } = require('node:child_process');
const { acquireVerificationLease } = require('./verification-lease.cjs');
const { binding } = require('./verification-binding.cjs');
const { fs, path, assert, state, root, folder, definition, hash, digest, atomic } = c;
const command = process.argv[2];
assert(['preflight', 'install', 'check'].includes(command), 'Use preflight, install or check; only Batch 1 is implemented');
assert(!process.argv.slice(3).some(arg => arg !== '--batch=1'), 'Only --batch=1 is supported');
const lease = acquireVerificationLease({ purpose: '4208 persistent examples Batch 1 ' + command });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = folder + '/runs/' + stamp + '-' + command;
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(folder + '/private', { recursive: true });
fs.writeFileSync(folder + '/private/.gitignore', '*\n');
const receipt = { fixtureVersion: definition.fixtureVersion, batch: 1, command, startedAt: new Date().toISOString(), status: 'running', toolIdentity: c.toolIdentity(), checks: [], changes: [] };
const manifestFile = folder + '/manifest.json';
let config, db, manifest, adminCookie;
const mark = (name, detail = {}) => { receipt.checks.push({ name, passed: true, at: new Date().toISOString(), detail }); console.log('PASS ' + name); };
const save = () => atomic(manifestFile, manifest);
const health = async port => {
  const response = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(5000) });
  assert(response.ok, 'Runtime is unhealthy on port ' + port);
  return response.json();
};
function runtimeProcess() {
  const saved = JSON.parse(fs.readFileSync(state + '/preview.runtime.json', 'utf8'));
  assert.equal(saved.root.replaceAll('\\', '/'), root);
  assert.equal(saved.port, 4208);
  assert.equal(saved.database, config.url.pathname.slice(1));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(saved.pid)}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`],
  { encoding: 'utf8', windowsHide: true, timeout: 12000 });
  assert.equal(result.status, 0, 'Cannot verify runtime process ownership');
  assert(result.stdout.trim(), 'Saved runtime process is missing');
  const actual = JSON.parse(result.stdout);
  const normalize = value => value.replaceAll('\\', '/').toLowerCase();
  assert.equal(normalize(actual.ExecutablePath), normalize(process.execPath));
  assert(normalize(actual.CommandLine).includes(normalize(root + '/apps/api/dist/main.js')), 'Refusing to stop an unrelated process');
  return saved;
}
async function startPreview() {
  const essentials = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA)$/i.test(key)));
  const env = c.runtimeEnvironment(config.env, config.url, essentials);
  env.PATH = path.dirname(process.execPath) + path.delimiter + (essentials.PATH ?? essentials.Path ?? '');
  const log = fs.openSync(state + '/preview.runtime.log', 'a');
  let child;
  try { child = spawn(process.execPath, [root + '/apps/api/dist/main.js'], { cwd: root, env, stdio: ['ignore', log, log], detached: true, windowsHide: true }); child.unref(); }
  finally { fs.closeSync(log); }
  const record = { pid: child.pid, node: process.execPath, root, port: 4208, database: config.url.pathname.slice(1), startedAt: new Date().toISOString(), scheduler: 'disabled for synthetic fixture installation', externalDelivery: false };
  const temporary = state + '/preview.runtime.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2)); fs.renameSync(temporary, state + '/preview.runtime.json');
  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    let ready;
    try { ready = await health(4208); }
    catch (error) { if (attempt === 44) throw error; continue; }
    assert.equal(ready.database.name, record.database, 'Restarted preview targets an unexpected database'); return record;
  }
}
function pg(name, args, logFile) {
  const env = { ...process.env, PGHOST: config.url.hostname, PGPORT: config.url.port, PGUSER: decodeURIComponent(config.url.username), PGPASSWORD: decodeURIComponent(config.url.password) };
  const result = spawnSync('C:/Program Files/PostgreSQL/18/bin/' + name + '.exe', args, { env, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(logFile, (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
  assert.equal(result.status, 0, name + ' failed; inspect its private backup log');
  return result.stdout;
}
function fileList(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), 'Storage contains a link; inspect before backup');
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push({ path: path.relative(directory, absolute).replaceAll('\\', '/'), bytes: fs.statSync(absolute).size, sha256: hash(fs.readFileSync(absolute)) });
    }
  }
  walk(directory); return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function backup() {
  if (manifest.backup) { validateBackup(manifest.backup); mark('Existing immutable backup verified', { files: manifest.backup.fileCount }); return; }
  const directory = folder + '/private/backups/' + stamp;
  fs.mkdirSync(directory, { recursive: true });
  const owned = runtimeProcess();
  receipt.changes.push({ operation: 'stop-owned-preview-for-consistent-backup', pid: owned.pid, port: 4208 });
  process.kill(owned.pid);
  let restarted = false;
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      let alive = false;
      try { process.kill(owned.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (!alive) break;
      assert(attempt < 29, 'Owned preview did not stop');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const dump = directory + '/database.dump';
    pg('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file=' + dump, '--dbname=' + config.url.pathname.slice(1)], directory + '/pg_dump.log');
    const toc = pg('pg_restore', ['--list', dump], directory + '/pg_restore-list.log');
    assert(toc.includes('TABLE DATA'), 'Database dump lacks table data');
    const storage = [];
    for (const [label, source] of [['source-storage', root + '/storage'], ['runtime-storage', state + '/storage']]) {
      const destination = directory + '/' + label, files = fileList(source);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of files) { const target = c.inside(destination, destination + '/' + file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source + '/' + file.path, target); }
      assert.deepEqual(fileList(destination), files, 'Backup file checksums differ');
      storage.push({ label, original: source, backup: destination, existed: fs.existsSync(source), files });
    }
    fs.copyFileSync(state + '/private/runtime.env', directory + '/runtime.env');
    fs.copyFileSync(state + '/private/database.json', directory + '/database.json');
    manifest.backup = { directory, database: config.url.pathname.slice(1), dump, dumpSha256: hash(fs.readFileSync(dump)), archiveReadable: true,
      fileCount: storage.reduce((sum, item) => sum + item.files.length, 0), storage, configuration: ['runtime.env', 'database.json'].map(file => ({ file, sha256: hash(fs.readFileSync(directory + '/' + file)) })), createdAt: new Date().toISOString() };
    validateBackup(manifest.backup); save();
    atomic(directory + '/receipt.json', manifest.backup);
    mark('Database and uploaded-files backup verified', { fileCount: manifest.backup.fileCount, archiveReadable: true, freshRestoreTested: false });
  } finally {
    const record = await startPreview(); restarted = true;
    receipt.changes.push({ operation: 'restart-preview', pid: record.pid, port: 4208, externalDelivery: false, scheduler: false });
    mark('4208 restarted without builds, migrations or seeds', { database: record.database });
  }
  assert(restarted);
}
function validateBackup(saved) {
  assert.equal(saved.database, config.url.pathname.slice(1));
  c.inside(folder + '/private/backups', saved.directory);
  c.inside(saved.directory, saved.dump);
  assert.equal(hash(fs.readFileSync(saved.dump)), saved.dumpSha256, 'Backup dump changed');
  for (const storage of saved.storage) { c.inside(saved.directory, storage.backup); assert.deepEqual(fileList(storage.backup), storage.files); }
  for (const item of saved.configuration) assert.equal(hash(fs.readFileSync(saved.directory + '/' + item.file)), item.sha256);
}
async function accountState() {
  const users = await db.user.findMany({ include: { userRoles: { include: { role: true } } }, orderBy: { id: 'asc' } });
  const roles = await db.role.findMany({ include: { permissions: { include: { permission: true } }, dataScopes: true }, orderBy: { id: 'asc' } });
  return {
    users: users.map(user => ({ id: user.id, email: user.email, fingerprint: digest({ email: user.email, displayName: user.displayName, isActive: user.isActive, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion, deletedAt: user.deletedAt }), roles: user.userRoles.map(item => item.role.code).sort() })),
    roles: roles.map(role => ({ id: role.id, code: role.code, fingerprint: digest({ code: role.code, nameEn: role.nameEn, nameAr: role.nameAr, description: role.description, isActive: role.isActive, isSystem: role.isSystem, maxClassificationRank: role.maxClassificationRank, deletedAt: role.deletedAt, scopes: role.dataScopes.map(item => ({ scopeType: item.scopeType, refId: item.refId, includeDescendants: item.includeDescendants })).sort((a, b) => digest(a).localeCompare(digest(b))) }), permissions: role.permissions.map(item => item.permission.resource + '.' + item.permission.action).sort() }))
  };
}
async function modelCounts() {
  const models = config.req('@prisma/client').Prisma.dmmf.datamodel.models;
  const quote = value => { assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)); return '"' + value + '"'; };
  const sql = models.map(model => { const deleted = model.fields.find(field => field.name === 'deletedAt'); return "SELECT '" + model.name + "' AS model, count(*)::int AS stored, " + (deleted ? 'count(*) FILTER (WHERE ' + quote(deleted.dbName ?? deleted.name) + ' IS NULL)' : 'count(*)') + '::int AS live FROM ' + quote(model.dbName ?? model.name); }).join(' UNION ALL ');
  return db.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return tx.$queryRawUnsafe(sql); }, { timeout: 30000 });
}
async function call(method, route, body, cookie = adminCookie) {
  assert(route.startsWith('/') && !route.includes('://'));
  const response = await fetch('http://localhost:4208/api' + route, { method, headers: { Origin: 'http://localhost:4208', 'x-dgop-csrf': 'same-origin', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) { receipt.failureResponse = { method, route, status: response.status, message: data.message }; throw Error(method + ' ' + route + ' returned ' + response.status); }
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
async function login(account) { const result = await call('POST', '/auth/login', { email: account.email, password: account.password }, ''); assert.equal(result.data.user.email, account.email); assert(result.cookie); return result.cookie; }
function note(key, model, row, expected) {
  manifest.items[key] = { id: row.id, model, expected, completedAt: new Date().toISOString() }; delete manifest.intents[key]; save();
  if (process.env.DGOP_DEMO_STOP_AFTER === key) { const error = Error('Controlled interruption after ' + key); error.code = 'DEMO_INTERRUPTED'; throw error; }
  return row;
}
async function ensure(key, model, where, route, body, expected, nativeCreate) {
  const item = manifest.items[key];
  let row = await db[model].findFirst({ where });
  if (row) { c.assertOwned(key, row, item, expected); return item ? row : note(key, model, row, expected); }
  assert(!item, 'Managed record disappeared: ' + key);
  manifest.intents[key] = { model, where, expected, requestDigest: digest(body), at: new Date().toISOString() }; save();
  row = nativeCreate ? await nativeCreate(body) : (await call('POST', route, body)).data;
  assert(row.id, 'Native create returned no ID: ' + key);
  const stored = await db[model].findUniqueOrThrow({ where: { id: row.id } }); c.assertOwned(key, stored, null, expected);
  receipt.changes.push({ operation: 'native-create', key, id: row.id, model });
  return note(key, model, stored, expected);
}
async function setOwnedRolePermissions(role, desired, justification) {
  const key = 'permissions.' + role.code;
  const current = await db.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
  const codes = current.map(item => item.permission.resource + '.' + item.permission.action).sort(); desired = [...new Set(desired)].sort();
  if (digest(codes) === digest(desired)) { manifest.permissionSteps[key] ??= { roleId: role.id, before: codes, after: desired, complete: true }; save(); return; }
  const step = manifest.permissionSteps[key];
  if (step) { assert(!step.complete, 'Managed role was manually changed: ' + role.code); assert.deepEqual(codes, step.before, 'Role grants changed during pending step'); assert.deepEqual(desired, step.after); }
  else { manifest.permissionSteps[key] = { roleId: role.id, before: codes, after: desired, complete: false }; save(); }
  await call('PUT', '/roles/' + role.id + '/permissions', { permissions: desired, justification });
  manifest.permissionSteps[key].complete = true; save(); receipt.changes.push({ operation: 'native-role-permissions', role: role.code });
}
async function foundations() {
  const ai = config.req(root + '/apps/api/dist/ai-governance/ai-permissions.js');
  const justification = 'SYNTHETIC DEMO ONLY: ' + manifest.installationId + '; user-approved persistent Finance/HR examples in isolated 4208; no operational compliance proof.';
  const { AuditService } = config.req(root + '/apps/api/dist/audit/audit.service.js'), audit = new AuditService(db);
  const { ScopeService } = config.req(root + '/apps/api/dist/access/scope.service.js');
  const { RolesService } = config.req(root + '/apps/api/dist/roles/roles.service.js');
  const roleService = new RolesService(db, audit, new ScopeService(db));
  // Technical permission catalog registration is additive and uses the required audit transaction.
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1832705421)`;
    for (const code of ai.AI_PERMISSIONS) {
      const data = ai.splitAiPermission(code);
      if (!await tx.permission.findUnique({ where: { resource_action: data } })) {
        const row = await tx.permission.create({ data: { ...data, descriptionEn: code } });
        await audit.logRequired({ actor: 'qa.admin@dgop.local', action: 'ai.permission.registered', entityType: 'permission', entityId: row.id, metadata: { code, installationId: manifest.installationId, demoOnly: true, justification } }, tx);
        receipt.changes.push({ operation: 'permission-catalog-add', code });
      }
    }
  }, { timeout: 20000 });
  const supportCode = 'dgop_demo_support_v1';
  const common = await ensure('role.support', 'role', { code: supportCode }, '/roles', { code: supportCode, nameEn: 'DEMO — Specialist navigation support', nameAr: 'عرض تجريبي — دعم تنقل الأخصائيين', description: manifest.marker }, { code: supportCode, description: manifest.marker });
  await setOwnedRolePermissions(common, definition.commonPermissions, justification);
  const scopes = ['finance', 'hr'].flatMap(area => [
    { scopeType: 'org_unit', refId: manifest.references['org.' + area], includeDescendants: false },
    { scopeType: 'data_domain', refId: manifest.references['domain.' + area], includeDescendants: false }
  ]);
  const normScopes = rows => rows.map(row => ({ scopeType: row.scopeType, refId: row.refId, includeDescendants: row.includeDescendants })).sort((a, b) => digest(a).localeCompare(digest(b)));
  const currentScopes = await db.roleDataScope.findMany({ where: { roleId: common.id } });
  if (digest(normScopes(currentScopes)) !== digest(normScopes(scopes))) {
    assert.equal(currentScopes.length, 0, 'Support role scopes were changed manually'); assert(!manifest.supportScopesComplete, 'Support scopes were removed manually');
    await call('PUT', '/roles/' + common.id + '/scopes', { scopes }); receipt.changes.push({ operation: 'native-scope-set', role: supportCode });
  }
  manifest.supportScopesComplete = true; save();
  const catalogCodes = new Set((await db.permission.findMany()).map(permission => permission.resource + '.' + permission.action));
  for (const specialist of definition.specialists) {
    if (!ai.AI_NEW_ROLES.some(row => row[0] === specialist.role)) continue;
    const native = ai.AI_NEW_ROLES.find(row => row[0] === specialist.role);
    // The public custom-role DTO deliberately allows lowercase codes only. Register
    // these exact installed AI catalog identities through the existing native service,
    // without relaxing that public DTO or running a broad role/catalog synchronizer.
    const role = await ensure('role.' + specialist.key, 'role', { code: specialist.role }, '/roles', { code: specialist.role, nameEn: native[1], nameAr: native[2], description: manifest.marker }, { code: specialist.role, description: manifest.marker }, body => roleService.create(body, 'qa.admin@dgop.local'));
    const required = ai.AI_PERMISSIONS.filter(code => ai.aiRoleMayHold(specialist.role, code));
    assert(required.every(code => catalogCodes.has(code)));
    await setOwnedRolePermissions(role, required, justification);
  }
  const baselineAdmin = manifest.baseline.accounts.users.find(user => user.email === 'qa.admin@dgop.local');
  const admin = await db.user.findUniqueOrThrow({ where: { id: baselineAdmin.id }, include: { userRoles: { include: { role: true } } } });
  const adminRoles = admin.userRoles.map(item => item.role.code).sort(), desired = [...new Set([...baselineAdmin.roles, 'dmo_admin'])].sort();
  assert(digest(adminRoles) === digest(baselineAdmin.roles) || digest(adminRoles) === digest(desired), 'Administrator roles changed outside approved addition');
  if (digest(adminRoles) !== digest(desired)) { await call('PUT', '/users/' + admin.id + '/roles', { roleCodes: desired, justification: justification + ' Approved native DMO publishing role on existing QA administrator only.' }); receipt.changes.push({ operation: 'approved-admin-publisher-role', user: admin.email }); }
  manifest.adminPublisher = { userId: admin.id, addedRole: 'dmo_admin', baselineRoles: baselineAdmin.roles }; save();
  const credentialFile = folder + '/private/specialist-credentials.json';
  let credentials = fs.existsSync(credentialFile) ? JSON.parse(fs.readFileSync(credentialFile, 'utf8')) : { fixtureVersion: definition.fixtureVersion, installationId: manifest.installationId, base: 'http://localhost:4208', accounts: definition.specialists.map(specialist => ({ key: specialist.key, email: 'demo.' + specialist.key + '@dgop.local', password: 'Dm8!' + c.crypto.randomBytes(18).toString('base64url') })) };
  assert.equal(credentials.installationId, manifest.installationId); assert.equal(credentials.accounts.length, definition.specialists.length); atomic(credentialFile, credentials);
  manifest.credentialRef = credentialFile; save();
  for (const specialist of definition.specialists) {
    const account = credentials.accounts.find(item => item.key === specialist.key); assert(account);
    const roleCodes = [specialist.role, supportCode].sort();
    const expected = { email: account.email, displayName: 'DEMO — ' + specialist.en };
    const user = await ensure('user.' + specialist.key, 'user', { email: account.email }, '/users', { ...expected, password: account.password, roleCodes, justification }, expected);
    assert(await config.req('bcryptjs').compare(account.password, user.passwordHash), 'Credential conflict; never reset an existing account');
    const actualRoles = (await db.userRole.findMany({ where: { userId: user.id }, include: { role: true } })).map(item => item.role.code).sort();
    assert.deepEqual(actualRoles, roleCodes, 'Specialist membership changed; preserve and investigate');
    assert(!actualRoles.some(code => ['system_admin', 'dmo_admin', 'security_admin'].includes(code)), 'Specialist has administrator rights');
    await ensure('person.' + specialist.key, 'person', { userId: user.id }, '/people', { fullNameEn: expected.displayName, fullNameAr: 'عرض تجريبي — ' + specialist.ar, email: account.email, userId: user.id, organization: manifest.marker, jobTitle: specialist.en }, { userId: user.id, email: account.email, organization: manifest.marker });
  }
  for (const reference of definition.references) {
    const body = { ...reference.body, description: reference.body.description + ' ' + manifest.marker };
    if (reference.scope) body.ownerOrgUnitId = manifest.references['org.' + reference.scope];
    const expected = { ...body };
    if (reference.roleItems) {
      body.items = [];
      for (const item of reference.roleItems) {
        const role = await db.roleType.findUniqueOrThrow({ where: { code: item.code } }); assert(role.isActive && !role.deletedAt);
        body.items.push({ roleTypeId: role.id, responsibility: item.responsibility });
      }
    }
    const row = await ensure(reference.key, reference.model, { code: body.code }, c.referenceRoute(config.req, reference.model), body, expected);
    if (body.items) {
      const items = await db.raciTemplateItem.findMany({ where: { templateId: row.id }, select: { roleTypeId: true, responsibility: true } });
      assert.deepEqual(items.sort((a, b) => a.roleTypeId.localeCompare(b.roleTypeId)), body.items.sort((a, b) => a.roleTypeId.localeCompare(b.roleTypeId)), 'RACI responsibilities were manually changed');
    }
  }
  mark('Native foundations installed', { specialists: definition.specialists.length, referenceRecords: definition.references.length, newNativeAiRoles: definition.specialists.filter(item => ai.AI_NEW_ROLES.some(row => row[0] === item.role)).length });
}
async function preserveBaseline() {
  const after = await accountState(), before = manifest.baseline.accounts;
  for (const user of before.users) {
    const actual = after.users.find(item => item.id === user.id); assert(actual, 'Existing user disappeared'); assert.equal(actual.fingerprint, user.fingerprint, 'Existing identity/password/status changed: ' + user.email);
    const desired = user.email === 'qa.admin@dgop.local' && manifest.adminPublisher ? [...new Set([...user.roles, 'dmo_admin'])].sort() : user.roles;
    assert.deepEqual(actual.roles, desired, 'Existing membership changed: ' + user.email);
  }
  for (const role of before.roles) {
    const actual = after.roles.find(item => item.id === role.id); assert(actual); assert.equal(actual.fingerprint, role.fingerprint, 'Existing role/scope changed: ' + role.code);
    const allowed = manifest.approvedSharedGrants?.[role.code] ?? [];
    assert.deepEqual(actual.permissions, [...new Set([...role.permissions, ...allowed])].sort(), 'Unapproved shared grants changed: ' + role.code);
  }
  mark('Existing accounts, passwords, roles and scopes preserved', { existingUsers: before.users.length, existingRoles: before.roles.length, approvedException: manifest.adminPublisher ? 'qa.admin receives dmo_admin' : null });
}
async function checkFoundations(signIn) {
  for (const [key, item] of Object.entries(manifest.items)) {
    const row = await db[item.model].findUnique({ where: { id: item.id } }); c.assertOwned(key, row, item, item.expected);
    const events = await db.auditLog.count({ where: { entityId: item.id } }); assert(events > 0, 'Native setup audit missing: ' + key);
  }
  for (const step of Object.values(manifest.permissionSteps)) {
    assert(step.complete, 'Permission setup step is incomplete');
    const grants = await db.rolePermission.findMany({ where: { roleId: step.roleId }, include: { permission: true } });
    assert.deepEqual(grants.map(grant => grant.permission.resource + '.' + grant.permission.action).sort(), step.after, 'Managed role permissions changed');
  }
  const scopes = await db.roleDataScope.findMany({ where: { roleId: manifest.items['role.support'].id } });
  const expectedScopes = ['finance', 'hr'].flatMap(area => ['org', 'domain'].map(type => ({ scopeType: type === 'org' ? 'org_unit' : 'data_domain', refId: manifest.references[type + '.' + area], includeDescendants: false })));
  const scopeKeys = rows => rows.map(row => row.scopeType + ':' + row.refId + ':' + row.includeDescendants).sort();
  assert.deepEqual(scopeKeys(scopes), scopeKeys(expectedScopes));
  const credentials = JSON.parse(fs.readFileSync(manifest.credentialRef, 'utf8'));
  for (const specialist of definition.specialists) {
    const account = credentials.accounts.find(item => item.key === specialist.key), item = manifest.items['user.' + specialist.key]; assert(item);
    const user = await db.user.findUniqueOrThrow({ where: { id: item.id }, include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    assert(await config.req('bcryptjs').compare(account.password, user.passwordHash));
    assert.deepEqual(user.userRoles.map(item => item.role.code).sort(), [specialist.role, 'dgop_demo_support_v1'].sort());
    const effective = user.userRoles.flatMap(item => item.role.permissions.map(grant => grant.permission.resource + '.' + grant.permission.action));
    assert(!effective.some(code => /^(?:users|roles)\.(?:create|edit|delete)$/.test(code)), 'Specialist has user/role administration rights');
    if (signIn) {
      const cookie = await login(account), session = (await call('GET', '/auth/me', null, cookie)).data;
      assert.equal(session.email, account.email); assert(!session.roles.includes('system_admin')); assert(!session.roles.includes('dmo_admin'));
      const denied = await fetch('http://localhost:4208/api/users', { method: 'POST', headers: { cookie, Origin: 'http://localhost:4208', 'x-dgop-csrf': 'same-origin', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) }); assert.equal(denied.status, 403, 'Non-admin user creation was not denied');
    }
  }
  mark('Specialist credentials and non-admin boundaries verified', { accounts: credentials.accounts.length, freshLoginChecked: signIn, userCreationDenied: signIn });
  validateBackup(manifest.backup); await preserveBaseline();
  const ai = config.req(root + '/apps/api/dist/ai-governance/ai-permissions.js');
  manifest.blockers = [];
  for (const [roleCode, needed] of Object.entries(definition.sharedRoleAiRequirements)) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: { include: { permission: true } }, userRoles: true } });
    const grants = role.permissions.map(item => item.permission.resource + '.' + item.permission.action), missing = needed.filter(code => !grants.includes(code));
    assert(needed.every(code => ai.aiRoleMayHold(roleCode, code)));
    if (missing.length) manifest.blockers.push({ batch: 4, role: roleCode, missing, existingMemberships: role.userRoles.length, reason: 'Awaiting explicit decision on additive AI grants to a pre-existing shared role; no silent expansion.' });
  }
  const counts = await modelCounts(), byModel = new Map(counts.map(item => [item.model, item.live]));
  manifest.coverage = c.navigation(config.req).map(tool => { const spec = definition.tools[tool.route]; return { ...tool, ...spec, minimumPerRegister: spec.reference || spec.informational || spec.derived ? null : definition.minimumPerRegister, counts: Object.fromEntries(spec.models.map(model => { assert(byModel.has(model), 'Unknown coverage model: ' + model); return [model, byModel.get(model)]; })), status: spec.informational ? 'informational' : spec.batch === 1 ? 'foundation-ready' : 'pending-batch-' + spec.batch }; });
  atomic(runDir + '/coverage.json', { at: new Date().toISOString(), fixtureVersion: definition.fixtureVersion, source: receipt.binding, tools: manifest.coverage });
  mark('Complete navigation coverage mapped to database models', { tools: manifest.coverage.length, aiTools: manifest.coverage.filter(tool => tool.section === 'aiGovernance').length, businessExamplesInstalled: false });
  manifest.lastCounts = counts; save();
}
async function preflight() {
  config = c.loadConfig();
  receipt.binding = binding(root); assert.deepEqual(receipt.binding, config.checkpoint.candidateIdentity, 'Verified candidate changed');
  assert.deepEqual(binding(config.checkpoint.original), config.checkpoint.baseline, 'Original app source/build changed');
  const { PrismaClient } = config.req('@prisma/client'); db = new PrismaClient({ datasources: { db: { url: config.url.href } } });
  const identity = await db.$queryRaw`SELECT current_database() AS name, inet_server_port() AS port`; assert.equal(identity[0].name, config.url.pathname.slice(1)); assert.equal(identity[0].port, 55436);
  const preview = await health(4208), original = await health(4206); assert.equal(preview.database.name, identity[0].name); assert.equal(original.database.name, 'dgop_dev'); runtimeProcess();
  const baseline = JSON.parse(fs.readFileSync('C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007/checkpoint.json', 'utf8'));
  assert.equal(baseline.profiles.length, 8);
  const tools = c.navigation(config.req), aiRoles = config.req(root + '/apps/api/dist/ai-governance/ai-permissions.js').AI_NEW_ROLES;
  const models = new Set(config.req('@prisma/client').Prisma.dmmf.datamodel.models.map(model => model.name));
  for (const spec of Object.values(definition.tools)) for (const model of spec.models) assert(models.has(model), 'Unknown manifest model: ' + model);
  const permissions = new Set((await db.permission.findMany()).map(permission => permission.resource + '.' + permission.action));
  assert(definition.commonPermissions.every(code => permissions.has(code)));
  for (const reference of definition.references) {
    c.referenceRoute(config.req, reference.model);
    const row = await db[reference.model].findUnique({ where: { code: reference.body.code } });
    if (row && !fs.existsSync(manifestFile)) throw Error('Existing fixture code is not owned: ' + reference.body.code);
  }
  const references = {};
  for (const area of ['finance', 'hr']) for (const type of ['org', 'domain']) {
    const key = type + '.' + area, model = type === 'org' ? 'organizationUnit' : 'dataDomain';
    const row = await db[model].findUniqueOrThrow({ where: { id: baseline.items[key] } }); assert(row.isActive && !row.deletedAt); references[key] = row.id;
  }
  for (const model of ['classification', 'roleType', 'statusValue']) assert(await db[model].count({ where: { isActive: true, deletedAt: null } }) > 0, 'Installed reference set missing: ' + model);
  for (const code of ['data_owner', 'business_steward']) {
    const role = await db.roleType.findUniqueOrThrow({ where: { code } }); assert(role.isActive && !role.deletedAt, 'RACI role type unavailable');
  }
  const licenseFile = root + '/apps/web/src/app/core/primeui-license.local.ts';
  const licenseConfigured = fs.existsSync(licenseFile) && /['"][A-Za-z0-9+/=_-]{20,}['"]/.test(fs.readFileSync(licenseFile, 'utf8'));
  receipt.environment = { profile: config.config.profile, database: { name: identity[0].name, host: config.url.hostname, port: identity[0].port }, ports: { original: 4206, preview: 4208 }, node: process.versions.node, fixtureVersion: definition.fixtureVersion, licenseConfigured, realOutboundDelivery: false };
  mark('Exact preview, database, runtime and existing references verified', { tools: tools.length, licenseConfigured });
  if (fs.existsSync(manifestFile)) {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.fixtureVersion, definition.fixtureVersion); assert.equal(manifest.database, identity[0].name); assert.equal(manifest.profile, config.config.profile); assert.equal(manifest.definitionSha256, hash(fs.readFileSync(path.join(__dirname, 'populate-dgop-definition.json'))));
    assert.deepEqual(manifest.sourceIdentity, receipt.binding);
  } else if (command === 'install') {
    const installationId = 'finance-hr-' + c.crypto.randomUUID();
    manifest = { manifestVersion: 1, fixtureVersion: definition.fixtureVersion, definitionSha256: hash(fs.readFileSync(path.join(__dirname, 'populate-dgop-definition.json'))), installationId, marker: 'Synthetic DGOP demo ' + installationId,
      demoOnly: true, isComplianceProof: false, database: identity[0].name, profile: config.config.profile, root, base: 'http://localhost:4208', createdAt: new Date().toISOString(), sourceIdentity: receipt.binding,
      baseline: { accounts: await accountState(), counts: await modelCounts() }, baselineCredentialRef: config.checkpoint.credentialRef, references, items: {}, intents: {}, permissionSteps: {}, completedBatches: [], remainingBatches: [1, 2, 3, 4, 5], blockers: [], aiRoleCount: aiRoles.length };
    save();
  }
}
async function main() {
  try {
    await preflight();
    if (command === 'install') {
      const previouslyComplete = manifest.completedBatches.includes(1);
      const beforeRepeat = previouslyComplete ? { counts: await modelCounts(), items: digest(manifest.items), credentials: hash(fs.readFileSync(manifest.credentialRef)) } : null;
      await backup();
      const credentials = JSON.parse(fs.readFileSync(config.checkpoint.credentialRef, 'utf8'));
      adminCookie = await login(credentials.accounts.find(account => account.key === 'admin'));
      await foundations(); await checkFoundations(!previouslyComplete);
      if (beforeRepeat) {
        const afterCounts = manifest.lastCounts;
        const differences = beforeRepeat.counts.flatMap(before => { const after = afterCounts.find(row => row.model === before.model); return before.stored === after.stored && before.live === after.live ? [] : [{ model: before.model, before: before.stored, after: after.stored }]; });
        assert(differences.every(item => item.model === 'AuditLog'), 'Repeated install changed database record counts beyond actual login audit events');
        assert.equal(digest(manifest.items), beforeRepeat.items, 'Repeated install changed managed record identities');
        assert.equal(hash(fs.readFileSync(manifest.credentialRef)), beforeRepeat.credentials, 'Repeated install changed credentials');
        assert.equal(receipt.changes.length, 0, 'Repeated install performed fixture mutations');
        receipt.idempotency = { managedRecords: Object.keys(manifest.items).length, fixtureMutations: 0, identitiesUnchanged: true, credentialsUnchanged: true, countDifferences: differences };
        mark('Repeated installation creates no duplicate records or credential/membership changes', receipt.idempotency);
      }
      manifest.completedBatches = [...new Set([...manifest.completedBatches, 1])]; manifest.remainingBatches = [2, 3, 4, 5]; manifest.status = 'batch-1-complete'; manifest.nextAction = 'Batch 2: connected assets, ownership, workflows, quality, extended domains and business value.';
      save();
    } else if (command === 'check') { assert(manifest?.completedBatches.includes(1), 'Batch 1 is not complete'); await checkFoundations(false); }
    assert.deepEqual(binding(root), receipt.binding, 'Application source or build changed during population');
    assert.deepEqual(binding(config.checkpoint.original), config.checkpoint.baseline, 'Original application changed');
    const endHealth = await health(4208); assert.equal(endHealth.database.name, config.url.pathname.slice(1)); assert.equal((await health(4206)).database.name, 'dgop_dev');
    receipt.status = 'passed'; receipt.manifestRef = manifest ? manifestFile : null; receipt.blockers = manifest?.blockers ?? [];
    if (manifest) { manifest.lastRun = { command, receipt: runDir + '/receipt.json', at: new Date().toISOString(), status: 'passed' }; save(); }
  } catch (error) {
    receipt.status = error.code === 'DEMO_INTERRUPTED' ? 'interrupted' : 'failed'; receipt.error = error.message; process.exitCode = error.code === 'DEMO_INTERRUPTED' ? 75 : 1;
    if (manifest) { manifest.lastFailure = { receipt: runDir + '/receipt.json', at: new Date().toISOString(), status: receipt.status, message: error.message }; save(); }
    console.error(error.message);
  } finally {
    await db?.$disconnect(); receipt.finishedAt = new Date().toISOString();
    if (receipt.status === 'passed') c.validateReceipt(receipt, config.checkpoint.candidateIdentity, c.toolIdentity());
    atomic(runDir + '/receipt.json', receipt); lease.release();
    console.log(JSON.stringify({ status: receipt.status, receipt: runDir + '/receipt.json', checks: receipt.checks.length, changes: receipt.changes.length, remainingBatches: manifest?.remainingBatches, pendingDecisions: manifest?.blockers }));
  }
}
main();
