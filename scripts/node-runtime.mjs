import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Keep nested npm/node scripts on the same supported executable on Windows. */
export function runtimeEnvironment(root, env = process.env) {
  if(!/^24\.19\./.test(process.versions.node))throw new Error('Use the repository-pinned Node 24.19 runtime.');
  const directory = join(root, 'tmp', 'node-runtime');
  const candidates = [env.DGOP_NPM_CLI, join(root, '../runtime/node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(dirname(process.execPath)), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  const npm = candidates.find(path => existsSync(path));
  if (!npm) throw new Error('The selected Node runtime has no npm CLI. Configure DGOP_NPM_CLI to the installed npm 11 CLI.');
  if (JSON.parse(readFileSync(join(dirname(dirname(npm)), 'package.json'), 'utf8')).version !== '11.13.0') throw new Error('Use the repository-pinned npm 11.13.0 CLI.');
  mkdirSync(directory, { recursive: true });
  for (const [name, cli] of [['npm', npm], ['npx', join(dirname(npm), 'npx-cli.js')]]) {
    if (!existsSync(cli)) throw new Error('The selected Node runtime has no ' + name + ' CLI.');
    const path = join(directory, name + '.cmd'), body = `@"${process.execPath}" "${resolve(cli)}" %*\r\n`;
    if (!existsSync(path) || readFileSync(path, 'utf8') !== body) writeFileSync(path, body);
  }
  const safe = { ...env, DGOP_NODE_EXE: process.execPath, DGOP_NPM_CLI: resolve(npm), npm_node_execpath: process.execPath, npm_execpath: resolve(npm) };
  delete safe.NODE_PATH; delete safe.NODE_OPTIONS;
  safe.PATH = [directory, dirname(process.execPath), safe.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':');
  return safe;
}
export function runtimeCommand(root, command, args, env = process.env) {
  const safe = runtimeEnvironment(root, env);
  if (/^(?:npm|npx)(?:\.cmd)?$/.test(command)) return { command: process.execPath, args: [command.startsWith('npx') ? join(dirname(safe.DGOP_NPM_CLI), 'npx-cli.js') : safe.DGOP_NPM_CLI, ...args], env: safe };
  return { command, args, env: safe };
}
