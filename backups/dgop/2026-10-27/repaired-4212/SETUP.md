# Restore the populated 4212 application

This is the current **27 October 2026** snapshot, matching application source commit `24f5a95bf00800153102126537b504b499427c42` and its migration/lockfile hashes in manifest.json. It contains 207 tables, 9,797 rows and 59 accounts; existing approvals, grants, classification references, role bindings, audit history and passwords' authentication hashes are retained inside the encrypted database. No account is reset or promoted by restoration.

The file archive contains 8 evidence originals, 2 attachments, 11 source/population files, the managed profile and the two application keys needed to read protected search history and retain BPMN signatures. The source workbooks are synthetic. Eleven unavailable historical references are recorded in manifest.json; their missing bytes cannot be restored. Synthetic evidence never earns operational compliance credit.

## Prerequisites

- Node 24.19.x, npm and PostgreSQL 18 client/server tools.
- This repository's source and both dependency lockfiles; all 98 applied migrations are already in the database archive.
- The separately delivered private snapshot-key.json. It is not stored in Git. The older October 9 snapshots use their own earlier key.
- Local PostgreSQL credentials supplied privately through PGUSER and PGPASSWORD. Existing application passwords come from the private account guide; users.csv lists usernames and roles without passwords.

Use a new dedicated folder such as C:\DGOP4212, with the checkout at C:\DGOP4212\source. The sibling population, profiles and private folders must not already exist. Use a fresh database/server destination; never restore over the existing preview. A Git pull does not automatically load PostgreSQL.

## Restore and configure

From the new source checkout, in PowerShell:

```powershell
$env:PG_BIN = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '5432'
$env:DGOP_SNAPSHOT_KEY_FILE = 'C:\private\snapshot-key.json'
# Set PGUSER and PGPASSWORD privately for your local PostgreSQL server.

node tools/database-snapshots/restore.cjs backups/dgop/2026-10-27/repaired-4212 dgop_restore_4212 C:\DGOP4212\restored-files
# Continue only after a successful restore. Both database names must be new.
& "$env:PG_BIN\psql.exe" -X --set=ON_ERROR_STOP=1 -d postgres -c 'ALTER DATABASE dgop_restore_4212 RENAME TO dgop_ai_preview_202610270001;'
node tools/database-snapshots/configure-4212.cjs C:\DGOP4212\source C:\DGOP4212\restored-files dgop_ai_preview_202610270001
```

The rename puts the fresh restored database into the application's existing managed-preview namespace. It must not be replaced with a rename/drop/reset of any existing preview. Choose another fresh numeric suffix if the example target already exists. restore.cjs refuses existing target databases and storage folders. configure-4212.cjs refuses existing state configuration, rebinds the synthetic/managed metadata to the new checkout and database, preserves the archived application keys and creates a fresh JWT secret. It never changes users, passwords, role memberships or database records. External notification delivery, automatic adapters, schedulers and startup maintenance remain disabled.

The helper prints the new private environment file's path, not its contents. Keep that file and decrypted storage outside Git.

## Install, build and run

```powershell
$env:DGOP_ENV_FILE = 'C:\DGOP4212\private\runtime.env'
npm --prefix apps/api ci
npm --prefix apps/web ci
npm run db:generate
npm run db:status
npm run build
node apps/api/dist/main.js
```

Keep that API terminal open. In another terminal at the same checkout:

```powershell
$env:DGOP_WEB_PORT = '4212'
$env:DGOP_API_PORT = '3012'
node scripts/serve-built-web.mjs
```

Open http://localhost:4212 and use an existing account from users.csv with its separately supplied password. Stop the API and web terminals with Ctrl+C. Do not run any seed, credential-sync or migration-reset command. No migration deployment is required for this matching source/snapshot; review additive migrations if using a later source version.

These example ports assume a different workstation. On the original workstation, preserve running 4212: choose a free API/web pair and update PORT, PUBLIC_ORIGIN and CORS_ORIGINS in the new private environment plus DGOP_API_PORT/DGOP_WEB_PORT. No existing app was stopped for this backup.

## Verification and limits

The archive was decrypted and restored into a fresh local database. All table counts, complete row-content comparisons, constraints, trigger definitions, usernames/roles and file checksums matched. A Prisma read/write probe rolled back cleanly. The configuration helper was checked against the native managed/synthetic guards and source manifest. These are recovery and configuration checks; the full application install/build/browser sequence above is documented, not rerun as part of this backup. No dependency versions or application source were changed.

The initial deep comparison encountered Windows' command-line length limit. The preserved restore was verified after changing the psql helper to stream large SQL through stdin; its regression and the other archive/configuration tests passed. Original failure evidence remains private.

The [latest functional audit](../../../../docs/audits/functional-re-audit-2026-10-26.md) still records three P1 findings. A genuine PrimeUI license is still required for licensed presentation. This snapshot does not change those findings or confer operational compliance approval.
