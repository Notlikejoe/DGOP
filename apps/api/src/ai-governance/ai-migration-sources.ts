import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { isSyntheticPopulationProfile } from '../common/synthetic-population-profile';
import { AI_MIGRATION_SOURCES } from './ai-migration-workbook';
export const AI_DEMO_MIGRATION_SOURCES = [
 {source:'risk',file:'demo-risk-v1.xlsx',sha256:'2d1f1ad4b7e496b501cc852cdc60cbcc86fdd22707412bece6969fc87ed53c8e'},
 {source:'adoption',file:'demo-adoption-v1.xlsx',sha256:'0a177a2bf9072e8eb66137e421670acd0209bbe9d1d40d0ae40340f88f44534b'},
];
export const AI_ENGINEERING_MIGRATION_SOURCES = [
 {source:'risk',file:'demo-risk-v2.xlsx',sha256:'fb546f90d30413a48c4eb14695c6736db94f5ed1f27050583cba436835b81d25'},
 {source:'adoption',file:'demo-adoption-v2.xlsx',sha256:'db905bf387afcbc286d34233bcabfd663600e95b4edac54fef30c7a7c7a7f0e5'},
];
export const AI_COMPLETE_ENGINEERING_MIGRATION_SOURCES = [
 {source:'risk',file:'demo-risk-v3.xlsx',sha256:'deb97cb6366876b697926945f1e413106e3f862a566088aad5744a5691babfd3'},
 {source:'adoption',file:'demo-adoption-v3.xlsx',sha256:'db905bf387afcbc286d34233bcabfd663600e95b4edac54fef30c7a7c7a7f0e5'},
];
export function migrationSources() {
 if(!process.env.AI_MIGRATION_SOURCE_MANIFEST)return {sourceMode:'retained_source',sources:[...AI_MIGRATION_SOURCES]};
 if(!isSyntheticPopulationProfile())throw new Error('Synthetic source selection requires a trusted isolated demo/test profile.');
 const root=resolve(process.env.AI_MIGRATION_SOURCE_DIR??''),path=resolve(process.env.AI_MIGRATION_SOURCE_MANIFEST),inside=relative(root,path);
 if(!inside||inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))throw new Error('Synthetic source manifest must stay in its configured source directory.');
 const manifest=JSON.parse(readFileSync(path,'utf8'));
 const pinned=manifest.fixtureVersion==='synthetic-sources-v1'?AI_DEMO_MIGRATION_SOURCES:manifest.fixtureVersion==='synthetic-sources-v2'?AI_ENGINEERING_MIGRATION_SOURCES:manifest.fixtureVersion==='synthetic-sources-v3'?AI_COMPLETE_ENGINEERING_MIGRATION_SOURCES:null;
 if(manifest.manifestVersion!==1||!pinned||manifest.demoOnly!==true||manifest.sourceMode!=='synthetic_demo'||manifest.productionReady!==false||!Array.isArray(manifest.sources)||manifest.sources.length!==2)throw new Error('Invalid synthetic source manifest.');
 if(new Set(manifest.sources.map(s=>s.source)).size!==2||manifest.sources.some(s=>!['risk','adoption'].includes(s.source)||!/^demo-(risk|adoption)-v[123]\.xlsx$/.test(s.file)||!/^[a-f0-9]{64}$/.test(s.sha256)))throw new Error('Unsupported synthetic source fixture.');
 for(const expected of pinned){const actual=manifest.sources.find(source=>source.source===expected.source);if(actual?.file!==expected.file||actual?.sha256!==expected.sha256)throw new Error('Synthetic source manifest differs from the packaged immutable fixture version.');}
 return {sourceMode:'synthetic_demo',sources:[...pinned]};
}
