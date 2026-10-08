import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';

export function assertSnapshotAttestation(root, path) {
 const attestation=JSON.parse(readFileSync(path,'utf8'));
 if(attestation.manifestVersion!==1||attestation.kind!=='dgop-source-snapshot'||resolve(attestation.snapshotRoot)!==resolve(root)||!/^[a-f0-9]{40}$/.test(attestation.sourceCommit)||!Array.isArray(attestation.files)||!attestation.files.length)throw new Error('Invalid DGOP source snapshot attestation.');
 const seen=new Set();
 const privateEnvironment=name=>/(?:^|\/)\.env(?:\.|$)/.test(name)&&!/(?:^|\/)\.env\.example$/.test(name);
 for(const entry of attestation.files){const candidate=resolve(root,entry.path),inside=relative(root,candidate);if(!inside||inside==='..'||inside.startsWith('..'+sep)||seen.has(entry.path)||/^(?:\.git|node_modules|storage|dist|tmp)(?:[\\/]|$)/.test(entry.path)||privateEnvironment(entry.path)||!existsSync(candidate)||lstatSync(candidate).isSymbolicLink())throw new Error('Unsafe or missing source snapshot entry.');seen.add(entry.path);if(createHash('sha256').update(readFileSync(candidate)).digest('hex')!==entry.sha256)throw new Error('Source snapshot changed after it was attested: '+entry.path);}
 const walk=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){if(['node_modules','dist','.git','.angular','storage','tmp','coverage'].includes(entry.name))continue;const candidate=resolve(directory,entry.name),name=relative(root,candidate).replaceAll('\\','/');if(entry.isSymbolicLink())throw new Error('Snapshot source may not contain symbolic links.');if(entry.isDirectory())walk(candidate);else if(!privateEnvironment(name)&&!/primeui-license\.local\.ts$|tsconfig\.tsbuildinfo$/.test(name)&&candidate!==resolve(path)&&!seen.has(name))throw new Error('Unattested file in source snapshot: '+name);}};
 walk(root);return {sourceCommit:attestation.sourceCommit,files:attestation.files.length,fingerprint:createHash('sha256').update(JSON.stringify(attestation.files)).digest('hex')};
}
