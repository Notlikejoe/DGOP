import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AI_MIGRATION_SOURCES, parseMigrationWorkbook } from '../src/ai-governance/ai-migration-workbook';
import { migrationSources } from '../src/ai-governance/ai-migration-sources';

/** Explicit engineering profile. It does not run the licensed demo installer or claim acceptance. */
export function initializeManagedSourceFixture() {
  const url = new URL(process.env.DGOP_AI_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55438'); assert.match(url.pathname, /^\/dgop_ai_test_[a-z0-9_]+$/);
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(process.env.DATABASE_URL, url.href);
  const root = resolve(__dirname, '../../../storage/ai-test/source-fixtures', url.pathname.slice(1));
  mkdirSync(root, { recursive: true }); const file = join(root, 'installation.json');
  const id = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).installationId : randomUUID();
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ profileVersion: 1, demoOnly: true, database: url.pathname.slice(1), installationId: id, installationRoot: root, bindHost: '127.0.0.1' }));
  Object.assign(process.env, { DGOP_DEMO: 'true', DGOP_DEMO_ROOT: root, DGOP_DEMO_PROFILE_FILE: file, DGOP_DEMO_INSTALLATION_ID: id, DGOP_DEMO_FIXTURE_VERSION: 'governance-demo-v1', DGOP_BIND_HOST: '127.0.0.1', DGOP_DEMO_ADAPTERS: 'false', DGOP_WORKFLOW_STARTUP_MAINTENANCE: 'false' });
  const retained = resolve(__dirname, '../../../storage/ai-sources');
  if (AI_MIGRATION_SOURCES.every(source => existsSync(join(retained, source.file)))) {
    for (const source of AI_MIGRATION_SOURCES) parseMigrationWorkbook(readFileSync(join(retained, source.file)), source.source, source.sha256);
    process.env.AI_MIGRATION_SOURCE_DIR = retained; delete process.env.AI_MIGRATION_SOURCE_MANIFEST;
    return { sourceMode: 'retained_source' };
  }
  const packaged = resolve(__dirname, '../../../scripts/data/demo-sources-v3'), sources = join(root, 'sources'); mkdirSync(sources, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(packaged, 'manifest.json'), 'utf8'));
  for (const source of manifest.sources) {
    const bytes = readFileSync(join(packaged, source.file)); assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    const target = join(sources, source.file); if (existsSync(target)) assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'), source.sha256); else copyFileSync(join(packaged, source.file), target);
  }
  const path = join(sources, 'manifest.json'), body = JSON.stringify(manifest, null, 2) + '\n'; if (existsSync(path)) assert.equal(readFileSync(path, 'utf8'), body); else writeFileSync(path, body);
  process.env.AI_MIGRATION_SOURCE_DIR = sources; process.env.AI_MIGRATION_SOURCE_MANIFEST = path;
  assert.equal(migrationSources().sourceMode, 'synthetic_demo');
  return { sourceMode: 'synthetic_demo', originalRetainedAcceptanceOutstanding: true };
}

export function verifiedSourceFixture() {
  const directory = process.env.AI_MIGRATION_SOURCE_DIR ?? resolve(__dirname, '../../../storage/ai-sources');
  return migrationSources().sources.map(source => parseMigrationWorkbook(readFileSync(join(directory, source.file)), source.source, source.sha256));
}
