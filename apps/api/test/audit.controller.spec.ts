import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSIONS_KEY, ROLES_KEY } from '../src/auth/decorators';
import { AuditController } from '../src/audit/audit.controller';

test('AuditController protects legacy baseline acceptance with an explicit write permission', () => {
  const handler = AuditController.prototype.acceptLegacyBaseline;
  const permissions = Reflect.getMetadata(PERMISSIONS_KEY, handler);
  const roles = Reflect.getMetadata(ROLES_KEY, handler);

  assert.deepEqual(permissions, ['audit.baseline_accept']);
  assert.deepEqual(roles, ['system_admin', 'dmo_admin']);
});
