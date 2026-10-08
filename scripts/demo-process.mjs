import { spawn } from 'node:child_process';

/** Keep HTTP socket events and request deadlines live while a check child runs. */
export function runDemoProcess(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { ...options, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`The verification child stopped (${signal ?? code}). Preserve its diagnostic before continuing.`));
    });
  });
}
