import { loadEnvironment, applyEnvironment } from './runtime-env.mjs';
import { runtimeCommand } from './node-runtime.mjs';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function loadRootEnv() { return loadEnvironment(root); }

function start(label, args, env) {
  const selected = runtimeCommand(root, npmCmd, args, env);
  const child = spawn(selected.command, selected.args, {
    cwd: root,
    env: selected.env,
    stdio: 'inherit',
    shell: false,
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
console.log(`API  -> http://localhost:${env.PORT || 3006}/api/health`);
console.log(`Web  -> http://localhost:4206`);
const webEnv = { ...env };
delete webEnv.PORT;

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(1);
});

start('API', ['--prefix', 'apps/api', 'run', 'start:dev'], env);
start('Web', ['--prefix', 'apps/web', 'start', '--', '--port', '4206'], webEnv);
