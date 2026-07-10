# Sprint 16 - Release 2 Hardening And UAT

Goal: stabilize the Release 2 operational governance flow across awareness, data quality, security review, evidence readiness, dashboards, and catalog integration.

## Deliverables

- Release 2 security hardening for evidence access, JWT role refresh, production CORS, seed-password safety, and upload dependencies.
- UAT user stories and test cases covering the connected demo flow.
- Design-system consistency checks across dashboard, training, data quality, security, evidence, scoring, and integrations.

## Demo Scope

- Dashboard readiness and gap queue
- Training and awareness progress
- Data quality profiling, rules, SLA, RCA, and issue remediation
- Security governance access reviews, DLP incidents, classification requests, and role-data mapping
- NDI evidence upload, review, expiry, scoring, and gap impact
- Catalog CSV sync and integration health

## Test Accounts

- System administrator: `admin@dgop.local`
- DMO/admin-style users and steward users are seeded from `apps/api/prisma/seed.ts`.
- Use the local `.env` seed passwords only for local demo data. Do not use real personal or sensitive data.
