# DGOP database examples — Batch 1

Date: 9 October 2026, Asia/Dubai. Status: foundations complete; Batches 2–5 remain.

The 4208 preview now contains 13 additional non-admin specialist accounts, nine native AI roles, a Finance/HR-scoped support role and ten synthetic reference records: two systems, two capabilities, four subjects and two RACI templates. Native services/API calls created these records and their actual audit events. No UI examples were hardcoded.

All 14 pre-existing users and 26 roles were preserved, including passwords and scopes. The only approved existing membership change is dmo_admin on qa.admin. Other shared role grants remain unchanged pending the user decision; five older preview users would be affected by the requested additions.

The original app remains on 4206 with dgop_dev. The preview remains on 4208 with dgop_access_sync_qa_20261007. Application source, lockfiles, builds and dependencies are unchanged. Both health endpoints report their correct database. The preview scheduler and real external notifications are disabled for fixture installation.

## Checks and evidence

- Seven focused installer tests passed, covering database/profile/outbound guards, conflicting ownership, safe paths, inherited database settings, actual controller routes, complete 45-tool coverage and stale/failed receipt rejection.
- All 13 specialists signed in through the native API and were denied user administration. Those source-bound checks are retained separately from the final repeated-install receipt.
- A controlled interruption saved the first specialist account; the resumed run reused the same database ID.
- Repeated installation made zero fixture changes, preserved credentials and record IDs, and added only the genuine administrator login audit event.
- Current receipts validate source/locks/builds, installer identity, database/profile and nested timestamps.

Checkpoint: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/checkpoint.json
Final receipt: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/runs/2026-10-08T22-14-48-358Z-install/receipt.json
Coverage: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/runs/2026-10-08T22-14-48-358Z-install/coverage.json
Focused tests: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/runs/2026-10-08T22-14-39-441Z-tool-tests/receipt.json
Fresh specialist API checks: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/runs/2026-10-08T22-12-05-077Z-install/receipt.json

## Backup and retained limitations

Immutable backup: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/private/backups/2026-10-08T22-06-42-953Z

The PostgreSQL custom archive was created and its table-data inventory validated. The preview storage directories contained zero physical files. Ten older evidence rows and one older attachment row already reference unavailable files; these omissions are recorded and were not repaired or counted as useful proof. This backup cannot recreate files that were already absent. A fresh database-plus-files restore is not yet tested.

Failed setup receipts remain on disk: the empty RACI prerequisite was addressed by native template creation; the inherited DB_NAME override was corrected; uppercase canonical AI role creation uses the native role service because the public custom-role DTO is lowercase-only; reference routes are derived from installed controllers after the capability alias mismatch. The wrong preview startup was stopped before fixture writes; read-only original checks confirmed no demo users/systems, no new QA publishing role and no new calendar templates there.

AI operational examples, completed business workflows and full browser acceptance are not installed or accepted by this batch. Shared specialist AI grants await the user decision. PrimeUI remains unlicensed. Security review remains deferred.

## Commands and next step

Use the existing pinned Node 24.19.0 executable with:

```text
work/populate-dgop.cjs preflight --batch=1
work/populate-dgop.cjs install --batch=1
work/populate-dgop.cjs check --batch=1
```

The installer accepts Batch 1 only. It does not invoke broad seeds, builds, migrations, password resets or external integrations. Full logs and every failed/interrupted receipt stay in the population/runs directory.

Private specialist guide: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/population/private/specialist-logins.md

Next: Batch 2 only—connected assets, ownership, workflow, quality, extended domains and business value. Resume from the population checkpoint; do not restart the audit or repeat passing application suites.
