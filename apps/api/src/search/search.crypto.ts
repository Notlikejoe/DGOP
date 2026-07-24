import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export interface ProtectedQuery {
  queryHash: string;
  queryCiphertextJson: Record<string, string | number>;
  protectedQueryMarker: string;
}

interface CipherEnvelope {
  v: number;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const QUERY_MARKER_PREFIX = '[protected-query]';

export function protectSearchQuery(query: string): ProtectedQuery {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(query, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const queryHash = createHmac('sha256', key).update(query).digest('hex');
  return {
    queryHash,
    protectedQueryMarker: `${QUERY_MARKER_PREFIX}:${queryHash.slice(0, 16)}`,
    queryCiphertextJson: {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };
}

export function revealSearchQuery(envelope: unknown, fallback: string): string {
  if (!envelope || typeof envelope !== 'object') return fallback;
  const cipher = envelope as Partial<CipherEnvelope>;
  if (
    cipher.v !== 1 ||
    cipher.alg !== 'aes-256-gcm' ||
    typeof cipher.iv !== 'string' ||
    typeof cipher.tag !== 'string' ||
    typeof cipher.ciphertext !== 'string'
  ) {
    return fallback;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(cipher.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(cipher.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipher.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return fallback;
  }
}

function deriveKey(): Buffer {
  const material =
    process.env.DGOP_SEARCH_QUERY_KEY ||
    process.env.JWT_SECRET ||
    'dgop-local-search-query-key-change-before-shared-demo';
  return createHash('sha256').update(material).digest();
}
