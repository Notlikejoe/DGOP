import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const toolsDir = join(root, 'tools');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isDryRun = process.argv.includes('--dry-run');

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

function cloudflaredPath() {
  return join(toolsDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

function normalizedArch() {
  const value = arch();
  if (value === 'x64') return 'amd64';
  if (value === 'ia32') return '386';
  return value;
}

function assetMatcher() {
  const os = platform();
  const cpu = normalizedArch();
  if (os === 'win32') return new RegExp(`cloudflared-windows-${cpu}\\.exe$`, 'u');
  if (os === 'darwin') return new RegExp(`cloudflared-darwin-${cpu}\\.tgz$`, 'u');
  if (os === 'linux') return new RegExp(`cloudflared-linux-${cpu}$`, 'u');
  throw new Error(`Unsupported platform for automatic cloudflared download: ${os}/${cpu}`);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'dgop-release-publisher' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        requestJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'dgop-release-publisher' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, destination).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        return;
      }
      const stream = createWriteStream(destination);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close(resolve);
      });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureCloudflared() {
  const binary = cloudflaredPath();
  if (existsSync(binary)) return binary;
  if (isDryRun) {
    console.log(`[dry-run] would download cloudflared for ${platform()}/${normalizedArch()} to ${binary}`);
    return binary;
  }

  mkdirSync(toolsDir, { recursive: true });
  const release = await requestJson('https://api.github.com/repos/cloudflare/cloudflared/releases/latest');
  const matcher = assetMatcher();
  const asset = release.assets?.find((candidate) => matcher.test(candidate.name));
  if (!asset?.browser_download_url) {
    throw new Error(`Could not find a cloudflared release asset matching ${matcher}.`);
  }

  console.log(`Downloading ${asset.name}...`);
  if (asset.name.endsWith('.tgz')) {
    const archive = join(toolsDir, asset.name);
    await download(asset.browser_download_url, archive);
    const result = spawnSync('tar', ['-xzf', archive, '-C', toolsDir], { stdio: 'inherit', shell: process.platform === 'win32' });
    rmSync(archive, { force: true });
    if (result.status !== 0) throw new Error('Failed to extract cloudflared archive.');
  } else {
    await download(asset.browser_download_url, binary);
  }
  if (process.platform !== 'win32' && existsSync(binary)) chmodSync(binary, 0o755);
  return binary;
}

function run(command, args, env) {
  if (isDryRun) {
    console.log(`[dry-run] ${command} ${args.join(' ')}`);
    return;
  }
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
}

async function waitForHealth(port) {
  const url = `http://localhost:${port}/api/health`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting for the API process to finish booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API did not pass health check at ${url}`);
}

async function main() {
  const env = loadRootEnv();
  env.NODE_ENV = 'production';
  env.DGOP_REQUIRE_STRICT_RUNTIME = 'true';
  env.HEALTH_INCLUDE_DETAILS = 'false';
  const port = env.PORT || '3005';

  run(npmCmd, ['run', 'qa:release'], env);
  const cf = await ensureCloudflared();

  if (isDryRun) {
    console.log(`[dry-run] would start demo API on :${port}`);
    console.log(`[dry-run] would run UI smoke against http://localhost:${port}`);
    console.log(`[dry-run] would open Cloudflare tunnel with ${cf}`);
    return;
  }

  console.log(`Starting API on :${port} with production demo safeguards...`);
  const api = spawn(npmCmd, ['run', 'start:demo'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const stopApi = () => {
    if (!api.killed) api.kill();
  };
  process.on('exit', stopApi);
  process.on('SIGINT', () => {
    stopApi();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopApi();
    process.exit(0);
  });

  await waitForHealth(port);
  run(npmCmd, ['run', 'qa:ui'], { ...env, DGOP_UI_BASE_URL: `http://localhost:${port}` });

  console.log('Opening public HTTPS tunnel...');
  const tunnel = spawn(cf, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  });
  tunnel.on('exit', (code, signal) => {
    stopApi();
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
