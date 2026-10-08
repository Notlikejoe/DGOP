import { BadRequestException, ConflictException } from '@nestjs/common';

/** Treat a failed snapshot claim as a stale business decision, never as a 500. */
export async function claimGovernanceWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (['P2025', 'P2034'].includes((error as { code?: string })?.code ?? '')) {
      throw new ConflictException('The record changed. Reload it and review the current state before deciding.');
    }
    throw error;
  }
}

export function requireTransition(current: string, next: string, transitions: Record<string, readonly string[]>): void {
  if (!(transitions[current] ?? []).includes(next)) {
    throw new BadRequestException(`Cannot change ${current} to ${next}; complete the required preceding review.`);
  }
}
