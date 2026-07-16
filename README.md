# DGOP - Data Governance Operations Platform

Monorepo for the DGOP application.

- **apps/web** - Angular 22 frontend (standalone components, signals, design system, light/dark + EN/AR RTL).
- **apps/api** - Node.js (NestJS 11) backend, REST under `/api`, security headers, rate limiting; also serves the built UI.
- **PostgreSQL** - local database `dgop_dev` (managed with Prisma).

## Prerequisites

- Node.js 22.22.3+, 24.15.0+, or 26+ for Angular 22 (tested on Node 24)
- PostgreSQL running locally (this machine: PostgreSQL 18 at `/Library/PostgreSQL/18`)
- All configuration comes from the root **`.env`** (see `.env.example`)

## 1. Install

```bash
npm run install:all
```

## 2. Database (already done for Sprint 0)

The `dgop_dev` database, schema, and seed data are created with:

```bash
npm run db:generate   # generate Prisma client
npm run db:migrate    # create/apply migrations on dgop_dev
npm run db:seed       # seed roles, classifications, statuses, NDI domains
```

## 3. Run locally

Development (API on :3005, Angular dev server on :4205 with /api proxy):

```bash
npm run dev
# open http://localhost:4205
```

Production-style (API serves the built UI on a single port :3005):

```bash
npm run build
npm start
# open http://localhost:3005
```

Client-demo mode uses production security posture, requires a non-placeholder
`JWT_SECRET`, and redacts detailed health metadata:

```bash
npm run build
npm run start:demo
# open http://localhost:3005
```

Health check: `GET http://localhost:3005/api/health`

## 4. Publish externally (simplest, temporary)

We expose the local server over HTTPS with a **Cloudflare quick tunnel** (no account, no DNS).
This is intentionally temporary until we move to production hosting.

```bash
npm run publish:external
```

The script will:

1. Download `cloudflared` into `tools/` (first run only).
2. Build the web + api if needed.
3. Start the API (which serves the UI) on `PORT`.
4. Open a public tunnel and print a URL like `https://<random>.trycloudflare.com`.

Share that URL so anyone can access the app from anywhere. The URL changes every run
(quick tunnels are ephemeral). Stop with `Ctrl+C`.

> Security note: the tunnel exposes your local app to the internet. Keep only synthetic/test
> data in `dgop_dev` while published. Application authentication (Sprint 1) gates real access.
> A persistent named tunnel / proper hosting comes with the production move.

## Project scripts

| Command | Description |
| --- | --- |
| `npm run install:all` | Install API + web dependencies |
| `npm run dev` | Run API + Angular dev server together |
| `npm run build` | Build web then api |
| `npm start` | Run the API (serves built UI) on `PORT` |
| `npm run start:demo` | Run the built API/UI with production demo safeguards |
| `npm run db:migrate` | Apply Prisma migrations to `dgop_dev` |
| `npm run db:seed` | Seed lookup data |
| `npm run publish:external` | Build, run, and expose over HTTPS |

## QA deliverables

Per-sprint user stories and test cases live under `QA/Sprint-XX/`.

- [`QA/Sprint-00/`](QA/Sprint-00/README.md) - foundation, design system, external publishing.
- [`QA/Sprint-01/`](QA/Sprint-01/README.md) - authentication, roles/RBAC, role-aware shell, admin users.
- [`QA/Sprint-02/`](QA/Sprint-02/README.md) - master data: data domains, data subjects, business capabilities.
- [`QA/Sprint-03/`](QA/Sprint-03/README.md) - master data: org units, systems, classifications, role types, RACI templates.
- [`QA/Sprint-A/`](QA/Sprint-A/README.md) - access management: DB-backed RBAC, permission matrix, data scoping, user management.
- [`QA/Sprint-04/`](QA/Sprint-04/README.md) - data asset governance hub: assets, subjects/relationships, Asset 360, CSV import, scope-enforced queries.
- [`QA/Sprint-05/`](QA/Sprint-05/README.md) - ownership registry: people directory, stewardship assignments, assignment rules, recommendations, conflicts, exception queue.
- [`QA/Sprint-06/`](QA/Sprint-06/README.md) - workflow engine: cases, tasks, decisions, SLA, timeline, assignment approval lifecycle, person-user linking, data-scope and integrity guards.
- [`QA/Sprint-07/`](QA/Sprint-07/README.md) - NDI specification registry & compliance hub (domains, types, maturity, acceptance criteria, CSV import); workflow hardening: automated tests, segregation of duties, Asset 360 approval surfacing, inbox indicator.
- [`QA/Sprint-08/`](QA/Sprint-08/README.md) - Release 1 hardening & UAT: global error envelope, shared CSV parser, pruned permission catalog, dashboard governance tiles, audit log viewer, list pagination, NDI deep-link, NDI service unit tests.
- [`QA/Sprint-09/`](QA/Sprint-09/README.md) - NDI evidence repository: file upload with SHA-256, submit/review lifecycle with separation of duties, expiry tracking, audited downloads, NDI specification owner, configurable storage, evidence unit tests.
- [`QA/Sprint-10/`](QA/Sprint-10/README.md) - NDI scoring & gap analysis: readiness by domain and overall, maturity bands, weighted spec scoring, gap queue (missing/expired/rejected/unassigned/stuck), shared evidence effective-status helper, domain short codes, scoring unit tests.
- [`QA/Sprint-11/`](QA/Sprint-11/README.md) - dashboards MVP: adaptive role-aware dashboard (My work / Governance / NDI readiness / Reference), permission-gated `/dashboard/summary`, scoring-engine reuse, ownership & stewardship coverage, shared KPI/progress/mini-chart components, dashboard unit tests.
- [`QA/Sprint-16/`](QA/Sprint-16/README.md) - Release 2 hardening & UAT: evidence access hardening, JWT role refresh, safe config defaults, upload dependency patching, and Release 2 UAT scenarios.
- [`QA/Sprint-17/`](QA/Sprint-17/README.md) - Open Data candidate registry: asset-linked candidates, ODIAO reviewer accountability, publication metadata, eligibility signals, lifecycle controls, and Asset 360 readiness surfacing.
- [`QA/Sprint-18/`](QA/Sprint-18/README.md) - Open Data assessment and approval workflow: readiness checklist, risk scoring, approval tasks, ODIAO workflow link, and publication gate.
- [`QA/Sprint-19/`](QA/Sprint-19/README.md) - Open Data publication, review, and usage monitoring: portal sync mock, review cadence, retirement/update decisions, and usage metrics.
- [`QA/Sprint-20/`](QA/Sprint-20/README.md) - FOI request registry and intake: channel-based intake, generated request numbers, SLA countdown, validation flags, and workflow case creation.
- [`QA/Sprint-21/`](QA/Sprint-21/README.md) - FOI review, decision, disclosure, and appeals: review evidence, exemptions, decision templates, disclosure trail, appeal workflow, and auditability.
- [`QA/Sprint-22/`](QA/Sprint-22/README.md) - PDP privacy operations: legal bases, RoPA, DPIA gates, DSR queue, breach notifications, consent/retention records, workflow creation, and privacy workspace.
- [`QA/Sprint-23/`](QA/Sprint-23/README.md) - data sharing governance: sharing requests, review decisions, agreements, renewal/usage monitoring, workflow creation, and exchange workspace.

Default local admin for local demo data only: `admin@dgop.local` / `Admin@12345`.
