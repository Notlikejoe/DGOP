export const SYSTEM_ADMIN_ROLE = 'system_admin';

export function isSystemAdministrator(roles: readonly string[] | null | undefined): boolean {
  return !!roles?.includes(SYSTEM_ADMIN_ROLE);
}

export function mayActAsRole(roles: readonly string[], required: string | readonly string[]): boolean {
  if (isSystemAdministrator(roles)) return true;
  return typeof required === 'string'
    ? roles.includes(required)
    : required.some((role) => roles.includes(role));
}

export function mayActForUser(roles: readonly string[], actorId: string, assignedUserId: string | null | undefined): boolean {
  return isSystemAdministrator(roles) || !assignedUserId || actorId === assignedUserId;
}
