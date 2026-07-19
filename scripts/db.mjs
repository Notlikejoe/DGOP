import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(root, 'apps', 'api');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadRootEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
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
    if (!process.env[key]) process.env[key] = value;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: apiDir,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

function runGenerate() {
  const result = spawnSync(npxCmd, ['--no-install', 'prisma', 'generate'], {
    cwd: apiDir,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (
    result.status !== 0 &&
    process.platform === 'win32' &&
    (output.includes('query_engine-windows.dll.node') || output.includes('EPERM'))
  ) {
    console.error(
      '\nPrisma client generation could not replace the Windows query engine because a running API process is using it.',
    );
    console.error('Stop the DGOP backend process, rerun `npm run db:generate`, then start the backend again.');
  }
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

loadRootEnv();

const [command, migrationName = 'update'] = process.argv.slice(2);
switch (command) {
  case 'generate':
    runGenerate();
    break;
  case 'status':
    run(npxCmd, ['--no-install', 'prisma', 'migrate', 'status']);
    break;
  case 'migrate':
    run(npxCmd, ['--no-install', 'prisma', 'migrate', 'dev', '--name', migrationName]);
    break;
  case 'deploy':
    run(npxCmd, ['--no-install', 'prisma', 'migrate', 'deploy']);
    break;
  case 'seed':
    run(npmCmd, ['run', 'seed']);
    break;
  default:
    console.error('usage: node scripts/db.mjs {generate|status|migrate [name]|deploy|seed}');
    process.exit(1);
}
