import { Prisma } from '@prisma/client';

export type BusinessSequenceClient = Pick<Prisma.TransactionClient, 'businessSequence'>;

/** Atomically reserves the next value for a human-readable business identifier. */
export async function nextBusinessSequence(
  client: BusinessSequenceClient,
  key: string,
): Promise<bigint> {
  const sequence = await client.businessSequence.upsert({
    where: { key },
    create: { key, value: 1n },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return sequence.value;
}

export function formatBusinessSequence(value: bigint, minimumWidth: number): string {
  return value.toString().padStart(minimumWidth, '0');
}

export async function nextAvailableBusinessCode(
  client: BusinessSequenceClient,
  key: string,
  format: (value: bigint) => string,
  isAvailable: (code: string) => Promise<boolean>,
  maxAttempts = 10_000,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = format(await nextBusinessSequence(client, key));
    if (await isAvailable(code)) return code;
  }
  throw new Error(`Business sequence ${key} could not reserve an available code`);
}
