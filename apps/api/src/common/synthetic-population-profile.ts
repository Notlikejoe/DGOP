import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Operator-only guard for the isolated local examples, never a client option. */
export function isSyntheticPopulationProfile(): boolean {
  const file = process.env.DGOP_SYNTHETIC_POPULATION_MANIFEST;
  if (!file) return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const state = resolve(process.cwd(), '..');
    if (process.env.NODE_ENV !== 'development' || process.env.DGOP_PROFILE !== 'access-sync-test'
      || url.hostname !== '127.0.0.1' || url.port !== '55436'
      || url.pathname !== '/dgop_access_sync_qa_20261007'
      || process.env.DB_NAME !== url.pathname.slice(1)
      || resolve(file) !== resolve(state, 'population/manifest.json')) return false;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    return manifest.fixtureVersion === 'dgop-finance-hr-demo-v1'
      && manifest.demoOnly === true && manifest.isComplianceProof === false
      && manifest.database === url.pathname.slice(1)
      && manifest.profile === process.env.DGOP_PROFILE
      && resolve(manifest.root) === resolve(process.cwd());
  } catch { return false; }
}
