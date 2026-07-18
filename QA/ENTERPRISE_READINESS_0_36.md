# DGOP Sprint 0-36 Enterprise Readiness Gate

Status: complete for controlled enterprise demo, UAT handoff, and production-style local validation. The release gate has no blocked checks after readiness remediation; historical audit rows created before hash-chain enforcement are handled through a verified legacy-baseline acceptance audit event.

Target release: Sprint 0 through Sprint 36.

Last reviewed: 2026-07-16.

## Readiness Decision

DGOP Sprints 0-36 are treated as enterprise-ready for the current release boundary when the verification gate below passes. This means the platform has working application modules, backend services, database models, permission gates, audit trails, workflow paths, and release evidence for the Sprint 0-36 scope.

This sign-off does not claim that later v5 enterprise extensions are complete. Service mesh, external OPA/Vault/mTLS deployment, permanent production hosting, DR infrastructure, and live third-party system adapters remain future or environment-specific work outside the Sprint 0-36 release boundary.

## Mandatory Verification Gate

Run these commands from the repository root before client demo, UAT handoff, or production-style local release:

```powershell
& ".\apps\api\node_modules\.bin\prisma.cmd" validate --schema ".\apps\api\prisma\schema.prisma"
npm run db:status
npm run db:generate
npm --prefix apps/api run test
npm --prefix apps/api run build
npm --prefix apps/web run build
npm run build
npm --prefix apps/api audit --audit-level=high
npm --prefix apps/web audit --audit-level=high
```

Production-style smoke gate:

```powershell
npm run build
npm run start:demo
```

Then verify:

- `GET http://localhost:3005/api/health` returns `status: ok`.
- Login works with the intended local demo account.
- `/dashboard` loads after login.
- `/governance/workflow` opens and shows workflow routes, cases, tasks, and decisions.
- `/governance/ndi`, `/governance/data-quality`, `/governance/security`, `/governance/open-data`, `/governance/foi`, `/governance/privacy`, and `/governance/data-sharing` load for a permitted user.
- `/admin/audit`, `/admin/users`, `/admin/roles`, `/admin/integrations`, and master-data pages are permission-gated.

## Sprint Completion Matrix

| Sprint | Area | Enterprise readiness status | Required evidence |
| --- | --- | --- | --- |
| 0 | Project setup and delivery foundation | Complete | Root scripts, environment template, Prisma setup, build scripts, demo/publish scripts, and repository documentation exist. |
| 1 | Authentication, users, roles, and app shell | Complete | JWT auth, global guards, users, roles, permissions, role-aware shell, login, and unauthorized page are implemented. |
| 2 | Administration master data part 1 | Complete | Data domains, data subjects, and business capabilities are backed by Prisma, API services, permission-gated UI, and hierarchy views. |
| 3 | Administration master data part 2 | Complete | Organization units, systems, classifications, role types, RACI templates, and status values are implemented and permission-gated. |
| 4 | Data asset governance hub MVP | Complete | Asset registry, subjects, relationships, Asset 360 behavior, CSV import, ownership signals, and scoped access are implemented. |
| 5 | Ownership registry and assignment rules MVP | Complete | People directory, assignments, rules, recommendations, conflict handling, exception queue, feedback audit, and scoped writes are implemented. |
| 6 | Workflow engine MVP | Complete | Cases, tasks, routed templates, stage transitions, task decisions, assignment approval, SLA badges, case detail, and workflow graph are implemented. |
| 7 | NDI specification registry MVP | Complete | NDI domains/specifications, CSV import, maturity/type metadata, owner linkage, and registry UI are implemented. |
| 8 | Release 1 hardening and UAT | Complete | Error envelope, permission catalog pruning, audit viewer, dashboard tiles, pagination, NDI deep links, and service tests are covered. |
| 9 | Evidence repository MVP | Complete | Evidence upload metadata, SHA-256 hashing, submit/review lifecycle, SoD, expiry, scoped access, and audit events are implemented. |
| 10 | NDI scoring and gap analysis | Complete | Weighted readiness, maturity bands, domain details, gap queue, evidence status handling, and scoring tests are implemented. |
| 11 | Dashboards MVP | Complete | Role-aware dashboard, My Work, governance, NDI, workflow, training, data quality, and reference metrics are implemented. |
| 12 | Training and awareness module | Complete | Courses, requirements, assignments, certification tracks, attempts, CE, mentorship, awareness scoring, and dashboard integration are implemented. |
| 13 | Data quality operations MVP | Complete | Issues, evidence, rules, rule versions, profiling, RCA, SLA breaches, CSV import, scoped reads/writes, workflow closure, and tests are implemented. |
| 14 | Classification, DLP, and access review MVP | Complete | Masking policies, role-data access maps, access reviews, DLP incidents, classification requests, ABAC decision logs, workflow links, and scope guards are implemented. |
| 15 | Catalog integration MVP | Complete | Catalog CSV sync, mapping preview, external references, writeback payload, import errors, and connector health are implemented. |
| 16 | Release 2 hardening and UAT | Complete | Evidence access hardening, JWT/config safety, production CORS guardrails, upload dependency posture, and UAT notes are documented. |
| 17 | Open data candidate registry | Complete | Asset-linked candidates, ODIAO ownership, publication metadata, eligibility signals, lifecycle controls, and scoped registration are implemented. |
| 18 | Open data assessment and approval workflow | Complete | Assessment checklist, risk scoring, approval tasks, workflow case link, and approval gate are implemented. |
| 19 | Open data publication, review, and usage monitoring | Complete | Publication records, portal sync simulation, review cadence, retirement/update decisions, and usage metrics are implemented. |
| 20 | FOI request registry and intake | Complete | FOI intake, request numbering, SLA countdown, validation flags, workflow case creation, and request queue are implemented. |
| 21 | FOI review, decision, disclosure, and appeals | Complete | Reviews, exemptions, decisions, disclosures, appeal workflow, audit trail, and decision lifecycle are implemented. |
| 22 | PDP privacy operations MVP | Complete | Legal bases, RoPA, DPIA gates, DSR, breach, consent, retention, privacy workflow creation, and scoped privacy workspace are implemented. |
| 23 | Data sharing and integration governance MVP | Complete | Sharing requests, reviews, agreements, renewal signals, usage monitoring, workflow creation, risk scoring, and scoped exchange workspace are implemented. |
| 24 | ODIAO cockpit and Release 3 UAT | Complete | Transparency cockpit, risk queue, readiness sections, underlying permission checks, and release readiness signals are implemented. |
| 25 | Reporting and export framework | Complete | Report catalog, permission-gated report execution, CSV export, PDF export buffer, and operational transparency report are implemented. |
| 26 | NDI audit pack generation | Complete | Audit pack generation, ZIP envelope, manifest, evidence hashes, readiness status, and audit-pack route are implemented. |
| 27 | Extended domains part 1: MCM, RMD, DAM | Complete | MDM match candidates, reference data versions, metadata certification, architecture review, scope guards, and tests are implemented. |
| 28 | Extended domains part 2: DCM, BIA, DVR | Complete | Business glossary, lineage, asset valuation, lifecycle decisions, BIAs, value KPIs, user surveys, and tests are implemented. |
| 29 | Notifications, escalations, and KSA business days | Complete | KSA business-day logic, compliance calendars, notifications, escalations, SLA recalculation, and escalation graph are implemented. |
| 30 | Integration hub hardening | Complete for Sprint 0-36 | Connector registry, event intake, retries, reconciliation, writeback logs, and simulated adapters are implemented. Live vendor adapters remain environment-specific. |
| 31 | Security and audit hardening | Complete | Global guards, permission guard, data scope, audit hash chain, CORS/JWT production safeguards, helmet, rate limits, and security governance scope tests are implemented. |
| 32 | Performance, search, and production readiness | Complete | Unified search, scoped search, production-readiness endpoint, health checks, production-style build/start path, and route lazy loading are implemented. |
| 33 | Owner recommendation improvements | Complete | Explainable owner recommendation confidence, feedback capture, certification/workload/conflict signals, and recommendation tests are implemented. |
| 34 | Predictive SLA and Arabic FOI classification prototype | Complete for prototype scope | SLA risk helpers, Arabic/English FOI workflow labels, FOI lifecycle tests, and prototype classification signals are implemented. |
| 35 | Final UAT, security review, and documentation | Complete with this gate | Build/test/security/config checks, sprint completion evidence, release caveats, and handover checklist are documented. |
| 36 | Go-live, stabilization, and handover | Complete with this gate | Production-style runbook, smoke checks, rollback notes, support triage, and handover ownership are documented below. |

## Sprint 35 Final UAT Checklist

Before marking Sprint 35 signed off, confirm:

- All mandatory verification commands pass.
- No high-severity dependency audit finding remains without a documented exception.
- Test data is synthetic and suitable for demo/UAT.
- Admin credentials are rotated for any shared demo.
- `JWT_SECRET`, `PUBLIC_ORIGIN`, and `CORS_ORIGINS` are set for non-development runs.
- No real personal, sensitive, or client-confidential records are loaded into the demo database.
- Key user journeys pass manually: login, dashboard, asset review, owner assignment, workflow decision, NDI evidence review, DQ issue closure, security review, open data approval, FOI decision, privacy DPIA, data sharing approval, audit log, report export.

## Sprint 36 Go-Live and Handover Checklist

Production-style local handover requires:

- Build artifact created with `npm run build`.
- API/UI served from `npm run start:demo` or production-equivalent process manager.
- Health endpoint verified after startup.
- Database migration status checked and captured.
- Seed/default demo credentials are rotated or disabled for shared environments.
- Rollback path documented: restore previous Git commit, redeploy previous build, restore database backup if migrations were applied.
- Support triage documented:
  - Authentication/access issues: check user roles, role permissions, and data scopes.
  - Missing records: check data scope, soft-delete status, and active flags.
  - Workflow stuck: inspect workflow case tasks, stage transitions, due dates, and audit timeline.
  - Evidence mismatch: check evidence status, hash, expiry, ownership, and spec linkage.
  - Integration event failure: check import batch, event status, retry history, and reconciliation report.

## Accepted Sprint 0-36 Boundaries

- Mock/simulated connectors are acceptable for Sprint 30 because the release proves the integration governance engine, not live vendor contracts.
- Simulated connectors should be visibly marked through source trust, but should not count as unhealthy unless they have an actual failed run, warning run, or recorded error.
- Historical audit rows created before hash-chain enforcement are acceptable only when `/api/audit/chain/verify` reports a valid chain and `/api/audit/chain/accept-legacy-baseline` has recorded a system-admin or DMO-admin acceptance event.
- Cloudflare quick tunnel remains a temporary demo path. Permanent hosting, DNS, DR, monitoring, and SIEM forwarding are production environment tasks.
- The health endpoint redacts details in production-style runs unless explicitly configured.
- Later v5 additions remain outside this gate unless they are already implemented by the current codebase.

## Enterprise Release Notes

The platform should be described to stakeholders as:

- Ready for controlled client demo and UAT using synthetic data.
- Ready for production-style local validation.
- Not yet ready for real production client data without environment hardening, backup/DR, monitoring, live adapter credentials, and formal security approval.
