import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, 'apps', 'web');
const cliPath = join(webDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

const commandMap = {
  build: ['build'],
  start: ['serve'],
  test: ['test'],
  watch: ['build', '--watch', '--configuration', 'development'],
};

function parseVersion(value) {
  const match = String(value).match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function satisfiesAngular(version) {
  if (!version) return false;
  if (version.major >= 26) return true;
  if (version.major === 24) return version.minor > 15 || (version.minor === 15 && version.patch >= 0);
  if (version.major === 22) return version.minor > 22 || (version.minor === 22 && version.patch >= 3);
  return false;
}

function scanBundledNode() {
  const rootDir = join(tmpdir(), 'dgop-node-runtime');
  if (!existsSync(rootDir)) return null;
  const candidates = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('node-v'))
    .map((entry) => join(rootDir, entry.name, process.platform === 'win32' ? 'node.exe' : 'bin/node'))
    .filter((path) => existsSync(path));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (result.status === 0 && satisfiesAngular(parseVersion(result.stdout.trim()))) {
      return candidate;
    }
  }
  return null;
}

function resolveNode() {
  const envNode = process.env.DGOP_NODE_EXE;
  if (envNode && existsSync(envNode)) return envNode;
  if (satisfiesAngular(parseVersion(process.version))) return process.execPath;
  return scanBundledNode();
}

const [command = 'build', ...extraArgs] = process.argv.slice(2);
const ngArgs = commandMap[command];
if (!ngArgs) {
  console.error(`Unknown web command "${command}". Use build, start, test, or watch.`);
  process.exit(1);
}

if (!existsSync(cliPath)) {
  console.error('Angular CLI is not installed. Run npm run install:all first.');
  process.exit(1);
}

const node = resolveNode();
if (!node) {
  console.error(
    'Angular 22 requires Node.js 22.22.3+, 24.15.0+, or 26+. Set DGOP_NODE_EXE to a compatible node.exe or upgrade Node.js.',
  );
  process.exit(1);
}

const result = spawnSync(node, [cliPath, ...ngArgs, ...extraArgs], {
  cwd: webDir,
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
