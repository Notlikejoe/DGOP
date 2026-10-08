// Explicit local credential display requested by the operator; credentials never enter Git or reports.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {demoConfig,readManifest} from './demo-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),config=demoConfig(root),manifest=readManifest(config);
if(config.env.NODE_ENV!=='development'||!manifest.checkpoints?.setup)throw new Error('Install the licensed managed demonstration first. Engineering accounts are not presentation credentials.');
const credentials=JSON.parse(readFileSync(config.credentialsPath,'utf8'));
if(credentials.installationId!==manifest.installationId||!credentials.accounts.length)throw new Error('Credential installation identity differs. Preserve the file and inspect setup.');
console.log('Local synthetic demonstration credentials — keep this display private.');
for(const account of credentials.accounts)console.log(`${account.purpose}\n  ${account.email}\n  ${account.password}\n`);
