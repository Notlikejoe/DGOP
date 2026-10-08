import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Server installation identity, never selected by an HTTP body, query or header. */
export function isManagedDemoProfile(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DGOP_DEMO !== 'true' || !env.DGOP_DEMO_PROFILE_FILE || !env.DGOP_DEMO_ROOT || !env.DATABASE_URL) return false;
  try {
    const url = new URL(env.DATABASE_URL);
    const database = decodeURIComponent(url.pathname.slice(1));
    const preview = /^dgop_ai_preview_\d+$/.test(database);
    const test = /^dgop_ai_test_[a-z0-9_]+$/.test(database) && env.NODE_ENV === 'test' && env.DGOP_AI_TEST_DATABASE_URL === env.DATABASE_URL;
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase()) || (!preview && !test)) return false;
    if (!isAbsolute(env.DGOP_DEMO_ROOT) || !isAbsolute(env.DGOP_DEMO_PROFILE_FILE) || !existsSync(env.DGOP_DEMO_PROFILE_FILE)) return false;
    const root = realpathSync(env.DGOP_DEMO_ROOT), file = realpathSync(env.DGOP_DEMO_PROFILE_FILE), inside = relative(root, file);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return false;
    const profile = JSON.parse(readFileSync(file, 'utf8'));
    return profile.profileVersion === 1 && profile.demoOnly === true && profile.database === database
      && profile.installationId === env.DGOP_DEMO_INSTALLATION_ID && /^[a-zA-Z0-9_-]{8,100}$/.test(profile.installationId)
      && resolve(profile.installationRoot) === resolve(root) && profile.bindHost === '127.0.0.1';
  } catch { return false; }
}
