import { createHash } from 'node:crypto';

export interface ZipEntry {
  path: string;
  body: Buffer | string;
}

export interface ManifestEvidenceEntry {
  id: string;
  specCode: string;
  originalName: string;
  sha256: string;
  status: string;
  expiryDate: string | null;
}

export interface AuditPackManifest {
  packCode: string;
  scope: string;
  generatedAt: string;
  frameworks: string[];
  files: { path: string; sha256: string; bytes: number }[];
  evidence: ManifestEvidenceEntry[];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function zipStore(entries: ZipEntry[], now = new Date()): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime(now);

  for (const entry of entries) {
    const name = Buffer.from(normalizePath(entry.path), 'utf8');
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body, 'utf8');
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function buildManifest(input: Omit<AuditPackManifest, 'files'>, files: ZipEntry[]): AuditPackManifest {
  return {
    ...input,
    files: files.map((file) => {
      const body = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, 'utf8');
      return { path: normalizePath(file.path), sha256: sha256(body), bytes: body.length };
    }),
  };
}

export function packReadiness(score: number, blockerCount: number): 'ready' | 'watch' | 'blocked' {
  if (blockerCount > 0 || score < 60) return 'blocked';
  if (score < 85) return 'watch';
  return 'ready';
}
