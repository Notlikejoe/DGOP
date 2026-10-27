# Database snapshot verification

All four encrypted archives passed a fresh PostgreSQL 18 restore on 9 October 2026. Every public table count, captured username/role membership and restored file checksum matched. Authentication hashes are preserved inside encryption; no passwords or restore keys are published.

| Snapshot | Tables | Rows | Users | Available files restored | Missing source files |
|---|---:|---:|---:|---:|---:|
| original-4206 | 201 | 3818 | 14 | 1 | 10 |
| stability-candidate | 201 | 3989 | 22 | 8 | 0 |
| ai-repair-candidate | 207 | 3831 | 22 | 8 | 0 |
| populated-4208 | 201 | 6880 | 29 | 8 | 11 |

The ten missing evidence files are pre-existing seed documents. The populated preview also references one missing historical PDF attachment. These gaps are listed individually in the snapshot manifests; the backup does not invent replacements.

The stability snapshot uses the engineering database identified in the saved three-cycle verification receipt. Its configured 4207 presentation database was never installed. AI repair uses its saved Batch 7 acceptance profile. No running application database was modified. This check does not rerun app tests, build acceptance, licensing or soak gates.

See [restore instructions](../../backups/dgop/README.md), [all usernames](USERNAMES.md) and [bound recovery receipts](restore-verification.json). Pulling Git alone does not populate a database. Restore `populated-4208` to recover the Finance/HR examples.

## Latest repaired-4212 snapshot — 27 October 2026

[Setup](../../backups/dgop/2026-10-27/repaired-4212/SETUP.md) · [Recovery receipt](repaired-4212-verification.json)

207 tables, 9,797 rows and 59 users restored. All row contents, constraints, triggers and file checksums match. The 23 archived files comprise 10 uploaded originals/attachments, 11 population/source files, one managed profile and one encrypted application-key file. Eleven inherited file references remain unavailable. Application hashes are retained only inside encryption; the private decryption key is excluded from Git. The separate configuration helper preserves managed synthetic provenance and disables external delivery.

This recovery check does not replace the functional audit or licensed presentation acceptance. See the receipt for verification scope and the retained Windows SQL-transport failure.
