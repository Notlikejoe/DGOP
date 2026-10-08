import { Prisma } from '@prisma/client';
import { toPaged } from '../common/pagination';
import { AiReviewQueryDto, aiReviewParams } from './ai-review-query.dto';

/** Legacy snapshots have only member IDs. Verify retained lineage; never guess missing proof. */
export function snapshotMemberIds(value: Prisma.JsonValue): string[] | null {
  if (!Array.isArray(value) || value.some(m => !m || typeof m !== 'object' || Array.isArray(m)
      || typeof m['id'] !== 'string' || !m['id'])) return null;
  const ids = value.map(m => (m as { id: string }).id);
  return new Set(ids).size === ids.length ? ids : null;
}

/** Scope before counts/pages. Probe metadata in bounded chunks, then load only the selected payload. */
export async function scopedHistoryPage<T extends { id: string }>(query: AiReviewQueryDto,
  probe: (cursor?: string) => Promise<T[]>, visible: (rows: T[]) => Promise<T[]>, onVisible?: (row: T) => void) {
  const params = aiReviewParams(query), ids: string[] = [];
  let total = 0, cursor: string | undefined;
  for (;;) {
    const rows = await probe(cursor);
    for (const row of await visible(rows)) {
      onVisible?.(row);
      if (total >= params.skip && ids.length < params.take) ids.push(row.id);
      total++;
    }
    if (rows.length < 200) break;
    cursor = rows.at(-1)!.id;
  }
  return { ids, envelope: toPaged<T>([], total, params) };
}

export async function visibleSnapshots<T>(tx: Prisma.TransactionClient, where: Prisma.AiRiskWhereInput,
  rows: T[], members: (row: T) => Prisma.JsonValue) {
  const parsed = new Map(rows.map(row => [row, snapshotMemberIds(members(row))]));
  const ids = [...new Set([...parsed.values()].flatMap(value => value ?? []))];
  const visible = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const found = await tx.aiRisk.findMany({ where: { AND: [where, { id: { in: ids.slice(i, i + 200) } }] }, select: { id: true } });
    found.forEach(row => visible.add(row.id));
  }
  return rows.filter(row => { const ids = parsed.get(row); return ids !== null && ids !== undefined && ids.every(id => visible.has(id)); });
}
