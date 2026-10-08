import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export function environmentFile(root, env = process.env) {
  if (env.DGOP_ENV_FILE) {
    if (!isAbsolute(env.DGOP_ENV_FILE)) throw new Error('DGOP_ENV_FILE must be an absolute path.');
    if (!existsSync(env.DGOP_ENV_FILE)) throw new Error('The selected DGOP environment file is missing.');
    return resolve(env.DGOP_ENV_FILE);
  }
  return join(root, '.env');
}

export function loadEnvironment(root, env = process.env, required = false) {
  const path = environmentFile(root, env);
  if (!existsSync(path)) {
    if (required) throw new Error('Configure the selected DGOP environment before continuing.');
    return { ...env };
  }
  return { ...parseEnv(readFileSync(path, 'utf8')), ...env };
}

export function applyEnvironment(root, required = false) {
  const env = loadEnvironment(root, process.env, required);
  Object.assign(process.env, env);
  return env;
}
