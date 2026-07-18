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

Client-demo mode uses production security posture, requires non-placeholder
`JWT_SECRET`, `SEED_ADMIN_PASSWORD`, and `DGOP_WEBHOOK_TOKEN` values, and redacts
detailed health metadata:

```bash
npm run demo:prepare
npm run db:seed
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
3. Start the API through `start:demo` so production demo safeguards are enforced.
4. Open a public tunnel and print a URL like `https://<random>.trycloudflare.com`.

Share that URL so anyone can access the app from anywhere. The URL changes every run
(quick tunnels are ephemeral). Stop with `Ctrl+C`.

> Security note: the tunnel exposes your local app to the internet. The script aborts
> unless strict runtime checks pass, including rotated admin seed password settings and
> a configured integration webhook token. Keep only synthetic/test data in `dgop_dev`
> while published. A persistent named tunnel / proper hosting comes with the production move.

## Project scripts

| Command | Description |
| --- | --- |
| `npm run install:all` | Install API + web dependencies |
| `npm run dev` | Run API + Angular dev server together |
| `npm run build` | Build web then api |
| `npm start` | Run the API (serves built UI) on `PORT` |
| `npm run demo:prepare` | Rotate ignored local `.env` demo secrets before shared demos |
| `npm run start:demo` | Run the built API/UI with production demo safeguards |
| `npm run db:status` | Check Prisma migration status using the root `.env` |
| `npm run db:migrate` | Apply Prisma migrations to `dgop_dev` |
| `npm run db:seed` | Seed lookup data |
| `npm run qa:web` | Run static web UX/i18n/route/theme/RTL checks |
| `npm run publish:external` | Build, run, and expose over HTTPS |

## QA deliverables

Sprint 0-36 enterprise readiness is consolidated in [`QA/ENTERPRISE_READINESS_0_36.md`](QA/ENTERPRISE_READINESS_0_36.md). It includes the completion matrix, mandatory verification gate, final UAT checklist, go-live checklist, handover notes, accepted Sprint 0-36 boundaries, and production caveats.

Sprint 0-43 enterprise close-out is consolidated in [`QA/ENTERPRISE_READINESS_0_43.md`](QA/ENTERPRISE_READINESS_0_43.md). It adds the v5 closure evidence for operating model, workflow, NDI traceability, platform services, security/control crosswalk, production acceptance, and enterprise error experience.

Detailed per-sprint QA packs are kept where deeper test stories were written:

- [`QA/Sprint-16/`](QA/Sprint-16/README.md) - Release 2 hardening & UAT: evidence access hardening, JWT role refresh, safe config defaults, upload dependency patching, and Release 2 UAT scenarios.
- [`QA/Sprint-17/`](QA/Sprint-17/README.md) - Open Data candidate registry: asset-linked candidates, ODIAO reviewer accountability, publication metadata, eligibility signals, lifecycle controls, and Asset 360 readiness surfacing.
- [`QA/Sprint-18/`](QA/Sprint-18/README.md) - Open Data assessment and approval workflow: readiness checklist, risk scoring, approval tasks, ODIAO workflow link, and publication gate.
- [`QA/Sprint-19/`](QA/Sprint-19/README.md) - Open Data publication, review, and usage monitoring: portal sync mock, review cadence, retirement/update decisions, and usage metrics.
- [`QA/Sprint-20/`](QA/Sprint-20/README.md) - FOI request registry and intake: channel-based intake, generated request numbers, SLA countdown, validation flags, and workflow case creation.
- [`QA/Sprint-21/`](QA/Sprint-21/README.md) - FOI review, decision, disclosure, and appeals: review evidence, exemptions, decision templates, disclosure trail, appeal workflow, and auditability.
- [`QA/Sprint-22/`](QA/Sprint-22/README.md) - PDP privacy operations: legal bases, RoPA, DPIA gates, DSR queue, breach notifications, consent/retention records, workflow creation, and privacy workspace.
- [`QA/Sprint-23/`](QA/Sprint-23/README.md) - data sharing governance: sharing requests, review decisions, agreements, renewal/usage monitoring, workflow creation, and exchange workspace.

Local admin email for demo data: `admin@dgop.local`. Run `npm run demo:prepare`
and `npm run db:seed`, then use the ignored local `.env` value
`SEED_ADMIN_PASSWORD` for login. Do not commit or share that password.
