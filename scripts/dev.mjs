import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function loadRootEnv() {
  const env = { ...process.env };
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return env;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
  return env;
}

function start(label, args, env) {
  const child = spawn(npmCmd, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    console.log(`${label} exited with code ${code ?? 0}`);
    shutdown(code ?? 0);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

const env = loadRootEnv();
console.log(`API  -> http://localhost:${env.PORT || 3005}/api/health`);
console.log(`Web  -> http://localhost:4205`);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(1);
});

start('API', ['--prefix', 'apps/api', 'run', 'start:dev'], env);
start('Web', ['--prefix', 'apps/web', 'start'], env);
