import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { sha256 } from './demo-profile.mjs';

/** Stable byte proof; symbolic links cannot escape a managed storage boundary. */
export function directoryFingerprint(directory) {
  const root = resolve(directory), result = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new Error('Managed demo storage must not contain symbolic links.');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) { const bytes = readFileSync(path); result.push({ path: relative(root, path).replaceAll('\\', '/'), size: bytes.length, sha256: sha256(bytes) }); }
      else throw new Error('Unexpected file type in managed demonstration storage.');
    }
  };
  walk(root); return result.sort((a, b) => a.path.localeCompare(b.path));
}
export const sameFingerprint = (a, b) => JSON.stringify(a) === JSON.stringify(b);
