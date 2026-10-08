'use strict';
// Finalize Batch 1 documents only. This script performs no database writes.
const c = require('./populate-dgop-common.cjs');
const { fs, path, assert, folder, state, definition, atomic } = c;
const { acquireVerificationLease } = require('./verification-lease.cjs');
const lease = acquireVerificationLease({ purpose: 'Persistent examples Batch 1 evidence/checkpoint finalization' });
async function main() {
  const config = c.loadConfig();
  const manifestFile = folder + '/manifest.json', manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.status, 'batch-1-complete');
  const receiptPath = manifest.lastRun.receipt, receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  c.validateReceipt(receipt, config.checkpoint.candidateIdentity, c.toolIdentity());
  assert.equal(receipt.idempotency.fixtureMutations, 0);
  const runs = fs.readdirSync(folder + '/runs', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => folder + '/runs/' + entry.name + '/receipt.json').filter(file => fs.existsSync(file)).map(file => ({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  const tests = runs.filter(item => item.file.includes('-tool-tests/')).sort((a, b) => a.file.localeCompare(b.file)).at(-1);
  assert(tests); assert.equal(tests.data.status, 'passed'); assert.deepEqual(tests.data.toolIdentity, c.toolIdentity());
  const testLog = fs.readFileSync(tests.data.log, 'utf8'); assert(/(?:pass|# pass) 7\b/.test(testLog));
  const auth = runs.find(item => item.data.status === 'passed' && item.data.checks?.some(check => check.detail?.freshLoginChecked === true));
  assert(auth); assert.deepEqual(auth.data.binding, receipt.binding); assert.equal(auth.data.environment.database.name, receipt.environment.database.name);
  const authCheck = auth.data.checks.find(check => check.detail?.freshLoginChecked === true); assert.equal(authCheck.detail.accounts, 13); assert(authCheck.detail.userCreationDenied);
  const interrupted = runs.find(item => item.data.status === 'interrupted' && item.data.changes.some(change => change.key === 'user.working'));
  assert(interrupted); assert.equal(interrupted.data.changes.find(change => change.key === 'user.working').id, manifest.items['user.working'].id);
  const preservationPath = folder + '/runs/original-preservation-20261009.json', preservation = JSON.parse(fs.readFileSync(preservationPath, 'utf8'));
  assert.equal(preservation.status, 'passed'); assert(preservation.readOnly && preservation.demoUsersAbsent && preservation.demoSystemsAbsent && preservation.adminPublishingRoleAbsent);
  const storagePath = folder + '/runs/storage-inventory-20261009.json', storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const health = {};
  for (const port of [4206, 4208]) {
    const response = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(5000) }); assert(response.ok);
    health[port] = await response.json(); assert.equal(health[port].database.name, port === 4206 ? 'dgop_dev' : 'dgop_access_sync_qa_20261007');
  }
  const failureEvidence = runs.filter(item => ['failed', 'interrupted'].includes(item.data.status)).map(item => ({ receipt: item.file, status: item.data.status, error: item.data.error }));
  const checkpoint = {
    task: 'DGOP persistent Finance/HR examples', batch: 1, status: 'batch-1-complete', completedAt: new Date().toISOString(), fixtureVersion: definition.fixtureVersion,
    completedBatches: [1], remainingBatches: [2, 3, 4, 5], candidateIdentity: receipt.binding, toolIdentity: receipt.toolIdentity, environment: { ...receipt.environment, health },
    completed: ['guarded-resumable-installer', '45-tool-database-coverage-manifest', 'pre-install-database-and-present-files-backup', '13-non-admin-specialist-accounts', '9-native-AI-roles-and-scoped-support-role', '10-linked-reference-records', 'approved-qa-admin-DMO-publishing-role', 'native-audit-checks', 'interrupted-install-recovery', 'zero-mutation-repeat-install'],
    changedApplicationFiles: [], changedToolFiles: ['work/populate-dgop.cjs', 'work/populate-dgop-common.cjs', 'work/populate-dgop-definition.json', 'work/populate-dgop.test.cjs', 'work/populate-dgop-checkpoint.cjs'],
    manifestRef: manifestFile, credentialRefs: [manifest.baselineCredentialRef, manifest.credentialRef], backupRef: manifest.backup.directory + '/receipt.json',
    evidence: { finalInstall: receiptPath, focusedToolTests: tests.file, freshSpecialistApiChecks: auth.file, interruptedRecovery: interrupted.file, originalPreservation: preservationPath, storageInventory: storagePath, coverage: path.dirname(receiptPath) + '/coverage.json' },
    checks: { toolTests: 7, specialistsWithSuccessfulNativeLogin: 13, specialistsDeniedUserAdministration: 13, originalUsersPreserved: manifest.baseline.accounts.users.length, originalRolesPreserved: manifest.baseline.accounts.roles.length, managedRecords: Object.keys(manifest.items).length, repeatedInstallFixtureMutations: 0 },
    knownBlockers: [...manifest.blockers, { batch: 5, reason: 'Genuine PrimeUI license remains unconfigured; licensed presentation is unavailable.' }],
    backlog: [{ reason: 'Pre-existing cloned records reference unavailable files. They are not suitable proof and will not count toward new demonstration coverage.', evidence: storagePath, evidenceFiles: storage.missingEvidenceFiles.length, attachmentFiles: storage.missingAttachmentFiles.length }],
    failureEvidence, nextAction: 'Batch 2 only: native connected assets, ownership, workflow, quality, extended-domain and business-value examples; retain current checkpoints and do not rerun Batch 1 unnecessarily.'
  };
  atomic(folder + '/checkpoint.json', checkpoint);
  manifest.storageBaseline = { evidence: storagePath, filesPhysicallyBackedUp: manifest.backup.fileCount, unavailableEvidenceReferences: storage.missingEvidenceFiles.length, unavailableAttachmentReferences: storage.missingAttachmentFiles.length };
  manifest.checkpointRef = folder + '/checkpoint.json'; atomic(manifestFile, manifest);
  const credentials = JSON.parse(fs.readFileSync(manifest.credentialRef, 'utf8'));
  const guide = ['# Private 4208 specialist accounts', '', 'Synthetic demonstration only. Existing eight account passwords are unchanged.', '', 'Preview: http://localhost:4208', '',
    '| Purpose | Username | Password | Native role |', '|---|---|---|---|', ...definition.specialists.map(specialist => { const account = credentials.accounts.find(item => item.key === specialist.key); return `| ${specialist.en} | ${account.email} | ${account.password} | ${specialist.role} |`; }), '',
    'Each specialist also has the scoped demonstration navigation role. No specialist has system_admin, dmo_admin, user administration or role administration.', '',
    'The existing qa.admin account received dmo_admin for native source publication. Business review accounts are separate.', '',
    'The four shared specialist roles still await the user decision about required AI grants. Their AI business actions are not yet enabled.', '',
    'Existing eight-account guide: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/private/manual-accounts-4208.md', '', 'Do not commit this file or include it in public reports.', ''].join('\n');
  fs.writeFileSync(folder + '/private/specialist-logins.md', guide, { mode: 0o600 });
  const ledgerPath = state + '/evidence-ledger.json', ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const preservedLedger = state + '/evidence-ledger-access-sync-before-population.json';
  if (!fs.existsSync(preservedLedger)) fs.copyFileSync(ledgerPath, preservedLedger);
  ledger.accessSyncAcceptanceStatus ??= ledger.status;
  ledger.status = 'population-in-progress; prior access-sync evidence retained';
  ledger.population = { fixtureVersion: definition.fixtureVersion, status: checkpoint.status, completedAt: checkpoint.completedAt, checkpointRef: folder + '/checkpoint.json', manifestRef: manifestFile, evidence: checkpoint.evidence, candidateIdentity: receipt.binding, toolIdentity: receipt.toolIdentity, remainingBatches: [2, 3, 4, 5], priorAccessSyncLedger: preservedLedger,
    reuseLimits: 'Prior access-sync receipts concern the earlier account/data baseline. Application source and builds are unchanged. The approved administrator role and new data are covered by these foundation checks; full populated-demo browser acceptance remains Batch 5.' };
  const ledgerTemp = ledgerPath + '.' + process.pid + '.tmp'; fs.writeFileSync(ledgerTemp, JSON.stringify(ledger, null, 2) + '\n'); fs.renameSync(ledgerTemp, ledgerPath);
  const report = [
    '# DGOP database examples — Batch 1', '', 'Date: 9 October 2026, Asia/Dubai. Status: foundations complete; Batches 2–5 remain.', '',
    'The 4208 preview now contains 13 additional non-admin specialist accounts, nine native AI roles, a Finance/HR-scoped support role and ten synthetic reference records: two systems, two capabilities, four subjects and two RACI templates. Native services/API calls created these records and their actual audit events. No UI examples were hardcoded.', '',
    'All 14 pre-existing users and 26 roles were preserved, including passwords and scopes. The only approved existing membership change is dmo_admin on qa.admin. Other shared role grants remain unchanged pending the user decision; five older preview users would be affected by the requested additions.', '',
    'The original app remains on 4206 with dgop_dev. The preview remains on 4208 with dgop_access_sync_qa_20261007. Application source, lockfiles, builds and dependencies are unchanged. Both health endpoints report their correct database. The preview scheduler and real external notifications are disabled for fixture installation.', '',
    '## Checks and evidence', '',
    '- Seven focused installer tests passed, covering database/profile/outbound guards, conflicting ownership, safe paths, inherited database settings, actual controller routes, complete 45-tool coverage and stale/failed receipt rejection.',
    '- All 13 specialists signed in through the native API and were denied user administration. Those source-bound checks are retained separately from the final repeated-install receipt.',
    '- A controlled interruption saved the first specialist account; the resumed run reused the same database ID.',
    '- Repeated installation made zero fixture changes, preserved credentials and record IDs, and added only the genuine administrator login audit event.',
    '- Current receipts validate source/locks/builds, installer identity, database/profile and nested timestamps.', '',
    `Checkpoint: ${folder}/checkpoint.json`, `Final receipt: ${receiptPath}`, `Coverage: ${path.dirname(receiptPath)}/coverage.json`, `Focused tests: ${tests.file}`, `Fresh specialist API checks: ${auth.file}`, '',
    '## Backup and retained limitations', '',
    `Immutable backup: ${manifest.backup.directory}`, '',
    'The PostgreSQL custom archive was created and its table-data inventory validated. The preview storage directories contained zero physical files. Ten older evidence rows and one older attachment row already reference unavailable files; these omissions are recorded and were not repaired or counted as useful proof. This backup cannot recreate files that were already absent. A fresh database-plus-files restore is not yet tested.', '',
    'Failed setup receipts remain on disk: the empty RACI prerequisite was addressed by native template creation; the inherited DB_NAME override was corrected; uppercase canonical AI role creation uses the native role service because the public custom-role DTO is lowercase-only; reference routes are derived from installed controllers after the capability alias mismatch. The wrong preview startup was stopped before fixture writes; read-only original checks confirmed no demo users/systems, no new QA publishing role and no new calendar templates there.', '',
    'AI operational examples, completed business workflows and full browser acceptance are not installed or accepted by this batch. Shared specialist AI grants await the user decision. PrimeUI remains unlicensed. Security review remains deferred.', '',
    '## Commands and next step', '',
    'Use the existing pinned Node 24.19.0 executable with:', '',
    '```text', 'work/populate-dgop.cjs preflight --batch=1', 'work/populate-dgop.cjs install --batch=1', 'work/populate-dgop.cjs check --batch=1', '```', '',
    'The installer accepts Batch 1 only. It does not invoke broad seeds, builds, migrations, password resets or external integrations. Full logs and every failed/interrupted receipt stay in the population/runs directory.', '',
    `Private specialist guide: ${folder}/private/specialist-logins.md`, '',
    'Next: Batch 2 only—connected assets, ownership, workflow, quality, extended domains and business value. Resume from the population checkpoint; do not restart the audit or repeat passing application suites.', ''
  ].join('\n');
  const reportPath = path.resolve(__dirname, '../outputs/DGOP-population-batch-1-2026-10-09.md');
  fs.writeFileSync(reportPath, report);
  console.log(JSON.stringify({ status: checkpoint.status, specialists: 13, referenceRecords: 10, toolCoverage: 45, checkpoint: folder + '/checkpoint.json', report: reportPath, preview: 'http://localhost:4208', remainingBatches: [2, 3, 4, 5], missingHistoricalFiles: 11, pendingSharedGrantDecision: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => lease.release());
