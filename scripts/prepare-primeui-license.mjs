import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Keep genuine keys outside Git. An empty value retains the vendor's license warning.
const target = fileURLToPath(new URL('../apps/web/src/app/core/primeui-license.local.ts', import.meta.url));
if (!existsSync(target)) {
  writeFileSync(target, `export const primeUiLicense = ${JSON.stringify(process.env.PRIMEUI_LICENSE_KEY ?? '')};\n`, { mode: 0o600 });
}
