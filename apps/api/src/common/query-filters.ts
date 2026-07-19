import { BadRequestException } from '@nestjs/common';

export function parseQueryEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  label: string,
  normalize: (value: string) => string = (value) => value,
): T | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const value = normalize(trimmed);
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`Invalid ${label}: ${trimmed}`);
}
