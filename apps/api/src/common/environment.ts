import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { config } from 'dotenv';

export function environmentFiles(root: string, env = process.env): string[] {
  const selected = env.DGOP_ENV_FILE;
  if (selected) {
    if (!isAbsolute(selected) || !existsSync(selected)) throw new Error('DGOP_ENV_FILE must identify an existing absolute environment file.');
    return [resolve(selected)];
  }
  return [join(root, '.env')];
}

export function loadRuntimeEnvironment(root: string): void {
  config({ path: environmentFiles(root)[0], override: false });
}
