import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export interface FileAvailability {
  fileAvailability: 'available' | 'unavailable';
  unavailableReason?: 'missing_file_reference' | 'original_file_unavailable' | 'unverifiable_file_metadata' | 'checksum_mismatch';
}
/** Derived metadata only: never repair a reference with substitute bytes. */
export function fileAvailability(path: string | null, checksum: string | null, sizeBytes: number | null): FileAvailability {
  if (!path) return {fileAvailability:'unavailable',unavailableReason:'missing_file_reference'};
  try {
    const stat=statSync(path);
    if (!stat.isFile()) return {fileAvailability:'unavailable',unavailableReason:'original_file_unavailable'};
    if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum) || sizeBytes == null) return {fileAvailability:'unavailable',unavailableReason:'unverifiable_file_metadata'};
    if (stat.size !== sizeBytes || createHash('sha256').update(readFileSync(path)).digest('hex') !== checksum.toLowerCase()) return {fileAvailability:'unavailable',unavailableReason:'checksum_mismatch'};
    return {fileAvailability:'available'};
  } catch { return {fileAvailability:'unavailable',unavailableReason:'original_file_unavailable'}; }
}
