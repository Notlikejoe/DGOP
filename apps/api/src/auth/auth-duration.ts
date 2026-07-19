const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;

export function jwtDurationSeconds(value?: string | null): number {
  if (!value) return DEFAULT_SESSION_SECONDS;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/iu);
  if (!match) return DEFAULT_SESSION_SECONDS;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_SESSION_SECONDS;

  const unit = (match[2] ?? 's').toLowerCase();
  if (unit === 'd') return amount * 24 * 60 * 60;
  if (unit === 'h') return amount * 60 * 60;
  if (unit === 'm') return amount * 60;
  if (unit === 'ms') return Math.max(1, Math.ceil(amount / 1000));
  return amount;
}

export function jwtDurationMs(value?: string | null): number {
  return jwtDurationSeconds(value) * 1000;
}
