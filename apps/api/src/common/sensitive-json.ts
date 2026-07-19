export const REDACTED_VALUE = '[REDACTED]';

export const SENSITIVE_JSON_KEY_FRAGMENTS = [
  'password',
  'secret',
  'authorization',
  'apikey',
  'accesskey',
  'token',
  'jwt',
  'bearer',
  'cookie',
  'session',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return SENSITIVE_JSON_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function redactSensitiveJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return /^bearer\s+\S+/iu.test(value) ? REDACTED_VALUE : value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactSensitiveJson(item, seen));
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
      acc[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactSensitiveJson(item, seen);
      return acc;
    }, {});
  } finally {
    seen.delete(value);
  }
}
