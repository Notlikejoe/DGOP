export type EnforcementOperation = 'grant' | 'update' | 'revoke' | 'verify';
export const REMOVAL_STATES = new Set(['pending_revocation', 'revocation_failed', 'expired', 'suspended']);

/** Decide from the dispatched operation, never from a later mutable grant state. */
export function enforcementOperationAllowed(
  operation: EnforcementOperation,
  grant: { status: string; ownerDecision: string; startsAt: Date; expiresAt?: Date | null },
  now = new Date(),
): boolean {
  if (operation === 'revoke') return REMOVAL_STATES.has(grant.status);
  if (operation === 'verify') return grant.status === 'active' || REMOVAL_STATES.has(grant.status) || grant.status === 'revoked';
  return grant.status === 'active' && grant.ownerDecision === 'approved'
    && grant.startsAt <= now && (!grant.expiresAt || grant.expiresAt > now);
}

export function enforcementGrantOutcome(operation: EnforcementOperation, succeeded: boolean, actor: string, now: Date) {
  if (operation === 'verify') return {};
  if (operation === 'revoke') return succeeded
    ? { status: 'revoked', enforcementStatus: 'revoked', revokedAt: now, revokedBy: actor }
    : { status: 'revocation_failed', enforcementStatus: 'failed' };
  return { enforcementStatus: succeeded ? 'enforced' : 'failed' };
}
