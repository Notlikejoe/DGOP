import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(root, 'apps', 'api');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git';

function loadRootEnv() {
  const env = { ...process.env };
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return env;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
  return env;
}

function run(label, command, args, options = {}) {
  console.log(`\n[qa:release] ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with code ${result.status}`);
  }
}

function assertBuiltIndexIsCspCompatible() {
  const indexPath = join(root, 'apps', 'web', 'dist', 'web', 'browser', 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Built web index was not found at ${indexPath}`);
  }
  const html = readFileSync(indexPath, 'utf8');
  const findings = [];
  if (/\son[a-z]+\s*=/iu.test(html)) {
    findings.push('built index contains inline event handlers');
  }
  if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/iu.test(html)) {
    findings.push('built index references externally hosted Google fonts');
  }
  if (/@font-face[\s\S]{0,500}?https?:\/\//iu.test(html)) {
    findings.push('built index inlines externally hosted font-face URLs');
  }
  if (findings.length) {
    throw new Error(`Built web index is not CSP-compatible:\n- ${findings.join('\n- ')}`);
  }
}

function readHealth(port) {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: 'localhost',
        port,
        path: '/api/health',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function assertDemoApiIsStopped(env) {
  const port = Number(env.PORT ?? 3005);
  if (!Number.isFinite(port) || port <= 0) return;
  const health = await readHealth(port);
  if (health?.service !== 'dgop-api') return;
  throw new Error(
    `DGOP API is already running on :${port}. Stop it before npm run qa:release so Prisma client generation can replace the query engine safely.`,
  );
}

const env = loadRootEnv();

await assertDemoApiIsStopped(env);

run('static API and web QA', npmCmd, ['run', 'qa'], { env });
run('API business/auth/workflow tests', npmCmd, ['--prefix', 'apps/api', 'run', 'test'], { env });
run('web unit tests', npmCmd, ['--prefix', 'apps/web', 'run', 'test', '--', '--watch=false'], { env });
run('Prisma schema validation', npxCmd, ['--no-install', 'prisma', 'validate'], { cwd: apiDir, env });
run('Prisma migration status', npxCmd, ['--no-install', 'prisma', 'migrate', 'status'], { cwd: apiDir, env });
run('Prisma client generation', npmCmd, ['run', 'db:generate'], { env });
run('API high-severity dependency audit', npmCmd, ['--prefix', 'apps/api', 'audit', '--audit-level=high'], { env });
run('web high-severity dependency audit', npmCmd, ['--prefix', 'apps/web', 'audit', '--audit-level=high'], { env });
run('Git whitespace check', gitCmd, ['diff', '--check'], { env });
run('production build', npmCmd, ['run', 'build'], { env });
assertBuiltIndexIsCspCompatible();

console.log('\n[qa:release] all release gates passed');
