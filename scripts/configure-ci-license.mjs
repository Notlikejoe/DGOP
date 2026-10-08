import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The vendor key belongs in the CI secret store, never in source control.
const key = process.env.PRIMEUI_LICENSE?.trim();
if (!key) throw new Error('Configure the genuine PRIMEUI_LICENSE CI secret before running the licensed release gate.');
const target = fileURLToPath(new URL('../apps/web/src/app/core/primeui-license.local.ts', import.meta.url));
writeFileSync(target, `export const primeUiLicense = ${JSON.stringify(key)};\n`, { mode: 0o600 });
console.log('Local vendor license module configured from the CI secret.');
