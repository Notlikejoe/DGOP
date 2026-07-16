import { createHash } from 'node:crypto';

export interface AuditHashInput {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
  createdAt: Date | string;
  previousHash?: string | null;
  chainVersion?: number | null;
}

export interface AuditChainRow extends AuditHashInput {
  id: string;
  entryHash?: string | null;
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value ?? null;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function auditPayloadForHash(input: AuditHashInput) {
  return {
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: stableValue(input.metadata ?? null),
    createdAt: input.createdAt instanceof Date ? input.createdAt.toISOString() : new Date(input.createdAt).toISOString(),
    previousHash: input.previousHash ?? null,
    chainVersion: input.chainVersion ?? 1,
  };
}

export function hashAuditEntry(input: AuditHashInput): string {
  return createHash('sha256').update(stableJson(auditPayloadForHash(input))).digest('hex');
}

export function verifyAuditHashChain(rows: AuditChainRow[]) {
  let previousHash: string | null = null;
  let checked = 0;
  let legacyRows = 0;
  for (const row of rows) {
    if (!row.entryHash) {
      legacyRows++;
      previousHash = row.entryHash ?? previousHash;
      continue;
    }
    const expected = hashAuditEntry({
      actor: row.actor,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
      previousHash: row.previousHash ?? null,
      chainVersion: row.chainVersion ?? 1,
    });
    checked++;
    if (expected !== row.entryHash || (row.previousHash ?? null) !== previousHash) {
      return {
        valid: false,
        checked,
        legacyRows,
        brokenAt: row.id,
        expectedHash: expected,
        actualHash: row.entryHash,
        expectedPreviousHash: previousHash,
        actualPreviousHash: row.previousHash ?? null,
      };
    }
    previousHash = row.entryHash;
  }
  return {
    valid: true,
    checked,
    legacyRows,
    brokenAt: null,
    expectedHash: null,
    actualHash: null,
    expectedPreviousHash: null,
    actualPreviousHash: null,
  };
}
