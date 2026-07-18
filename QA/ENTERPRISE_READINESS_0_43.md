# DGOP Sprint 0-43 Enterprise Close-Out Gate

Target release: Sprint 0 through Sprint 43.

## Decision Boundary

Sprints 0-36 remain governed by `QA/ENTERPRISE_READINESS_0_36.md`. This close-out adds the v5 enterprise closure layer:

- Sprint 37: business operating model, councils, ceremonies, KPI formulas, and DGPO sizing.
- Sprint 38: universal case/workflow route readiness and workflow graph clarity.
- Sprint 39: NDI domain model traceability to evidence, records, workflows, and gaps.
- Sprint 40: platform service and enterprise engine readiness.
- Sprint 41: security, compliance, and control crosswalk.
- Sprint 42: procurement, environment, performance, DR, support, and acceptance package.
- Sprint 43: secure, bilingual, nontechnical error experience and observability hardening.

## Release Judgement

DGOP is suitable for local demo and UAT-style walkthrough when the verification gate below passes. Production deployment still requires environment-specific controls outside this local repository:

- production secret manager or vault binding
- mTLS/ingress/service mesh decision
- SIEM/log drain and retention policy
- database backup, restore, DR test, and RTO/RPO sign-off
- production load testing at the target data volumes

## Verification Gate

Run from the repo root unless a command says otherwise:

```powershell
npm --prefix apps/api run test
npm --prefix apps/api run build
npm --prefix apps/web run build
npm run build
Push-Location apps/api
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/dgop_dev?schema=public'
npm exec prisma validate -- --schema prisma/schema.prisma
Pop-Location
```

## Close-Out Evidence

| Sprint | Evidence in app | Enterprise status |
| --- | --- | --- |
| 37 | `/api/governance-operations/operating-model` and Governance Operations operating model panel | Complete |
| 38 | workflow route configuration, routed decisions, graph/inbox views, route tests | Complete |
| 39 | `/api/ndi/domain-traceability` and NDI hub traceability panel | Complete |
| 40 | `/api/governance-operations/platform-architecture` and platform services panel | Complete |
| 41 | `/api/governance-operations/control-crosswalk` and security/compliance crosswalk panel | Complete with accepted deployment deferrals |
| 42 | `/api/governance-operations/production-acceptance` and production readiness package panel | Complete for demo/UAT, production performance tests remain environment-specific |
| 43 | global API error envelope, Angular error interpreter, request/correlation IDs, and error readiness panel | Complete |

## Accepted Deferrals

The following are intentionally not hard-coded into the local app because they belong to target infrastructure:

- Vault/secret manager integration
- mTLS and service mesh
- SIEM forwarding and retention
- production DR infrastructure
- production-scale load testing against 1M assets, 10k imports, and 1,000 concurrent workflow cases

## Demo/UAT Smoke Path

1. Sign in with the documented local demo admin.
2. Open Dashboard and verify ownership, NDI, workflow, and system readiness cards load.
3. Open Governance Operations and verify operating model, platform services, control crosswalk, production acceptance, and error experience sections load.
4. Open Workflow and verify route graph plus inbox/cases load.
5. Open NDI and verify domain traceability cards load.
6. Open Data Quality and Security and verify queues/actions load with no console errors.
7. Trigger a harmless denied or invalid API action during QA and confirm the response includes `code`, `userMessage`, and `requestId`.

## Remaining Production Questions

- Which production hosting target will own vault, SIEM, mTLS, backups, and DR?
- Which real identity provider replaces local demo authentication?
- What target data volume should be used for formal performance testing?
- Which client acceptance signatories approve Sprint 41/42 deferrals?
