import { spawn, spawnSync } from "node:child_process";
import "./prepare-primeui-license.mjs";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, "apps", "web");
const cliPath = join(webDir, "node_modules", "@angular", "cli", "bin", "ng.js");

const commandMap = {
  build: ["build"],
  start: ["serve"],
  test: ["test"],
  watch: ["build", "--watch", "--configuration", "development"],
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
  return !!version && version.major === 24 && version.minor === 19;
}

function scanBundledNode() {
  const codexRuntime = join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "bin",
    process.platform === "win32" ? "node.exe" : "node",
  );
  if (existsSync(codexRuntime)) {
    const result = spawnSync(codexRuntime, ["-v"], { encoding: "utf8" });
    if (
      result.status === 0 &&
      satisfiesAngular(parseVersion(result.stdout.trim()))
    )
      return codexRuntime;
  }

  const rootDir = join(tmpdir(), "dgop-node-runtime");
  if (!existsSync(rootDir)) return null;
  const candidates = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("node-v"))
    .map((entry) =>
      join(
        rootDir,
        entry.name,
        process.platform === "win32" ? "node.exe" : "bin/node",
      ),
    )
    .filter((path) => existsSync(path));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-v"], { encoding: "utf8" });
    if (
      result.status === 0 &&
      satisfiesAngular(parseVersion(result.stdout.trim()))
    ) {
      return candidate;
    }
  }
  return null;
}

function resolveNode() {
  const envNode = process.env.DGOP_NODE_EXE;
  if (envNode && existsSync(envNode)) {
    const result=spawnSync(envNode,['-v'],{encoding:'utf8',windowsHide:true});
    if(result.status===0&&satisfiesAngular(parseVersion(result.stdout.trim())))return envNode;
    throw new Error('DGOP_NODE_EXE must identify the pinned Node 24.19 runtime.');
  }
  if (satisfiesAngular(parseVersion(process.version))) return process.execPath;
  return scanBundledNode();
}

const [command = "build", ...extraArgs] = process.argv.slice(2);
const ngArgs = commandMap[command];
if (!ngArgs) {
  console.error(
    `Unknown web command "${command}". Use build, start, test, or watch.`,
  );
  process.exit(1);
}

if (!existsSync(cliPath)) {
  console.error("Angular CLI is not installed. Run npm run install:all first.");
  process.exit(1);
}

const node = resolveNode();
if (!node) {
  console.error(
    "Use the repository-pinned Node.js 24.19 runtime. Set DGOP_NODE_EXE to that node.exe.",
  );
  process.exit(1);
}

if (command === "start") {
  const portArgument = extraArgs.find(value => value.startsWith("--port="));
  const portIndex = extraArgs.indexOf("--port");
  const bridgePort = portArgument?.slice(7) ?? (portIndex >= 0 ? extraArgs[portIndex + 1] : "4206");
  const proxy = spawn(
    node,
    [join(root, "scripts", "loopback-proxy.mjs"), bridgePort],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: false,
    },
  );
  const angular = spawn(node, [cliPath, ...ngArgs, ...extraArgs], {
    cwd: webDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  let stopping = false;
  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    if (!angular.killed) angular.kill();
    if (!proxy.killed) proxy.kill();
    process.exit(exitCode);
  }

  proxy.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  proxy.on("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
  angular.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  angular.on("exit", (code) => stop(code ?? 1));
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  process.on("exit", () => {
    if (!angular.killed) angular.kill();
    if (!proxy.killed) proxy.kill();
  });
} else {
  const result = spawnSync(node, [cliPath, ...ngArgs, ...extraArgs], {
    cwd: webDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
