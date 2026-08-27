# DGOP Database Handoff

This project uses PostgreSQL with Prisma as the schema and migration layer.
The application reads database configuration from the root `.env`; use
`.env.example` as the safe template and do not commit local credentials.

## New Developer Quick Start

Follow [the README local setup](../README.md#2-first-local-setup-after-cloning).
Install dependencies and PostgreSQL, create an empty `dgop_dev` database, run
`npm run local:prepare`, set your own `DATABASE_URL` in `.env`, then run:

```bash
npm run local:setup
npm run build
npm run start:local
```

Log in at `http://localhost:3005/login` with your `.env` values
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. These are generated per machine and
preserved on subsequent local setup/start commands. `npm run local:check` proves
database/migration readiness, account status, password match and HTTP session.
`npm run local:credentials` is an explicit, audited local admin password repair;
it does not reseed or re-enable disabled users. Keep passwords out of Git.

Pulls include schema, migrations and seed definitions, not a running PostgreSQL
server, local secrets or private database rows. Never rerun the full seed to fix
an existing login. `local:setup` only seeds a new schema or completely empty application tables.

## Current Local Database

Observed local development database:

```text
Engine: PostgreSQL 18
Host: 127.0.0.1
Port: 55436
Database: dgop_dev
User: postgres
Schema: public
Connection shape: postgresql://postgres:<local-password>@127.0.0.1:55436/dgop_dev?schema=public
```

The currently running local PostgreSQL process uses this machine-local data
directory:

```text
C:/Users/Youss/OneDrive/Documents/DGOP/storage/postgres-data
```

That path is useful for local troubleshooting only. For another developer, the
source of truth should be the Prisma schema, migrations, and seed script below.
The local cluster uses SCRAM-SHA-256 authentication and listens only on
`127.0.0.1:55436`.

Use the repository lifecycle commands instead of invoking `pg_ctl` directly:

```bash
npm run db:local:start
npm run db:local:status
npm run db:local:stop
```

## Source Of Truth

```text
Schema: apps/api/prisma/schema.prisma
Migrations: apps/api/prisma/migrations
Seed data: apps/api/prisma/seed.ts
Prisma config: apps/api/prisma.config.ts
Root env template: .env.example
```

The root npm scripts wrap Prisma so commands can be run from the repository
root:

```bash
npm run install:all
npm run db:generate
npm run local:prepare
npm run local:setup
npm run db:status
```

For production-like or shared environments, prefer:

```bash
npm run db:deploy
```

Do not run the destructive local demo seed on a shared/production database.
Provision production identities and data through the approved deployment process.

## Verified Local Snapshot

The local database was checked during handoff preparation and had:

```text
Public tables: 134
Applied Prisma migrations: 60
```

The `20260822153000_retain_access_governance_evidence` migration changes four
foreign keys from cascading deletion to `RESTRICT`. It preserves access-grant
versions, permission evidence, enforcement attempts, and asset-linked grants;
it does not delete or backfill rows. Deploy it before the matching API build.
On a busy shared database, schedule the deployment where brief foreign-key
constraint locks are acceptable. Rollback requires restoring the four foreign
keys to `ON DELETE CASCADE` only after confirming that evidence deletion is an
accepted governance policy.

The `20260823173000_workflow_integrity_hardening` migration must be deployed
before the matching API build. It adds the managed workflow-attachment storage
column, prevents audit-chain forks with a unique predecessor index, constrains
workflow/access lifecycle values, adds runtime-token lineage foreign keys, and
changes workflow/NDI evidence relations from cascading deletion to `RESTRICT`.
Preflight deployment should confirm there are no duplicate non-null audit
predecessors, orphan token lineage IDs, or lifecycle values outside the allowed
sets. Rollback can remove the new checks, lineage keys, and nullable storage
column, but restoring cascading deletion requires explicit records-retention
approval.

## Optional Data Dump

If the senior developer needs the actual local rows, create a dump outside git.
The repository ignores `storage/`, so it is a safe local place to write the file:

```powershell
New-Item -ItemType Directory -Force storage/db-handoff | Out-Null
& "C:/Program Files/PostgreSQL/18/bin/pg_dump.exe" `
  "postgresql://postgres@127.0.0.1:55436/dgop_dev" `
  -Fc `
  -f "storage/db-handoff/dgop_dev.dump"
```

Restore into a fresh local database:

```powershell
createdb -h 127.0.0.1 -p 55436 -U postgres dgop_dev_restore
& "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe" `
  --clean `
  --if-exists `
  --no-owner `
  -h 127.0.0.1 `
  -p 55436 `
  -U postgres `
  -d dgop_dev_restore `
  "storage/db-handoff/dgop_dev.dump"
```

Do not commit `.env`, raw PostgreSQL data directories, or database dump files.
If a dump is shared, send it through the team's approved secure file channel.

## Secrets Handoff

Secrets are intentionally not stored in git. The branch documents the required
keys, while the real values must be copied from the local `.env` and sent through
an approved secure channel such as the team's password manager or an encrypted
handoff file.

Required local/demo keys:

```text
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
PUBLIC_ORIGIN
CORS_ORIGINS
DGOP_TRUST_PROXY
SEED_ADMIN_EMAIL
SEED_ADMIN_PASSWORD
SEED_PERSON_PASSWORD
DGOP_WEBHOOK_TOKEN
DGOP_AUDIT_FAIL_CLOSED
DGOP_SEED_RISK_SCENARIO
EVIDENCE_STORAGE_DIR
EVIDENCE_MAX_BYTES
WORKFLOW_ATTACHMENT_STORAGE_DIR
WORKFLOW_ATTACHMENT_MAX_BYTES
```

PowerShell command to prepare a local-only secret handoff file outside git:

```powershell
New-Item -ItemType Directory -Force storage/db-handoff | Out-Null
Get-Content .env | Set-Content storage/db-handoff/dgop-env-handoff.txt
```

Before sharing that file, confirm it is going through the approved secure
channel. Do not attach it to a pull request, commit, ticket comment, chat thread,
or email unless your organization explicitly permits that channel for secrets.

## Demo Accounts

Demo seed users are managed by `apps/api/prisma/seed.ts`. The local admin email
is:

```text
admin@dgop.local
```

Passwords come from ignored `.env` values such as `SEED_ADMIN_PASSWORD` and
`SEED_PERSON_PASSWORD`. Rotate them before any shared demo and do not commit or
publish those values. For an existing loopback-only database, run
`npm run db:sync-demo-credentials`; this updates only canonical demo accounts and
does not recreate governance data. Use `npm run db:seed:local` only when a fresh
demo dataset is intended.
