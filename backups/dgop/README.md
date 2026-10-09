# DGOP database snapshots

These encrypted PostgreSQL archives preserve all four application database versions captured on 9 October 2026:

| Snapshot | Purpose |
|---|---|
| `original-4206` | Original application database; this is the version whose AI and Business Value registers were empty. |
| `stability-candidate` | Existing engineering database used for the verified stability candidate start/check/stop cycles. Its licensed 4207 presentation database was never installed. |
| `ai-repair-candidate` | AI repair candidate's current governed acceptance database. |
| `populated-4208` | Populated preview with connected Finance/HR examples and AI journeys. Choose this snapshot to recover the demonstrated examples. |

Each directory includes the complete database schema/data archive, available evidence and workflow attachments, a checksum/count manifest, and a readable username/role CSV. The archives use AES-256-GCM authenticated encryption. The private decryption key is shared separately and is never committed. Password hashes and audit history remain intact inside encryption; running accounts and databases are unchanged. Runtime configuration, JWT signing keys, license keys and plaintext credential guides are excluded.

The username list for every database is in [USERNAMES.md](../../docs/database-snapshots/USERNAMES.md). The same username can have different access across database versions. Do not assume accounts have administrator rights.

## Restore into a fresh local database

Requirements: Node 24, PostgreSQL 18 client tools, a running local PostgreSQL server, local database credentials, and the separately shared private snapshot key. Set `PGHOST`, `PGPORT`, `PGUSER`, and `PGPASSWORD` in your local shell. Never commit those values. `PG_BIN` can point to your PostgreSQL client binary directory when the tools are not on PATH.

```powershell
$env:DGOP_SNAPSHOT_KEY_FILE = 'C:\private\dgop-snapshot-key.json'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '5432'
$env:PG_BIN = 'C:\Program Files\PostgreSQL\18\bin'
# Set PGUSER and PGPASSWORD privately for your local database server.
node tools/database-snapshots/restore.cjs backups/dgop/2026-10-09/populated-4208 dgop_restore_demo C:\DGOP-Restore\demo-files
```

The target name must start with `dgop_restore_`. Both the target database and storage destination must be new. The restore refuses remote hosts, existing databases, existing file destinations, incorrect keys, tampered archives and unsafe file paths. It verifies every table count and every restored file checksum. It does not replace 4206 or 4208, change their configuration, seed, run migrations, reset passwords, start the application or send external notifications. A failed restore may leave a new partial target for diagnosis; use a new target for the next attempt rather than overwriting it.

Configure the restored application's `DATABASE_URL` **and** `DB_NAME` consistently. Point `EVIDENCE_STORAGE_DIR` at the restored `evidence` directory and `WORKFLOW_ATTACHMENT_STORAGE_DIR` at `attachments`. Use fresh local JWT/configuration secrets. Keep external notifications/provisioning and background jobs disabled for demonstrations. Database login credentials are independent of the application usernames in the CSV.

Use the source version identified in the snapshot manifest. These snapshots represent distinct schemas, not interchangeable databases. Running the latest `main` against an older snapshot requires reviewing/applying its additive migrations first. The restore tool deliberately does not do that. Historical AI decisions without main's newer verified evidence links remain review-needed; a restore does not manufacture compliance proof or approvals.

Pulling this repository alone does not load PostgreSQL records. Restore the **populated-4208** archive to obtain those examples. A valid PrimeUI license remains a separate requirement for licensed presentation.

## Validation and limitations

All four archives are tested through decryption and fresh local PostgreSQL restores, with exact table-count, username/membership and file-checksum comparisons. These are backup/recovery checks, not a new full application release acceptance.

The manifests record evidence/attachment files that were already absent on the source workstation. Those records remain in the database, but no backup can reconstruct missing source files. Available files are preserved exactly. Database dumps use PostgreSQL's consistent transaction snapshot; files are captured separately and verified by checksum on restore. Concurrent file uploads are not included atomically with the database snapshot. Source workbooks used by the current populated demo are already versioned under `scripts/data/demo-sources-v5`.
