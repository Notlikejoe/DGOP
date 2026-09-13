# Phase 4D — Governed schedules and operation history

Implemented locally, 2026-09-13, from checkpoint 87083db, as part of the ten-packet 3X–4G batch.

Governance operators configure append-only policy versions with expected round, justification and existing evidence; the configuring actor supplies live permissions on each run. Flags default disabled. Runs are append-only, success is atomic with capture/audit, failures expose safe error codes only, retry is at least five minutes apart and capped at three per policy/slot. Disabled/replaced versions stop future attempts while old history remains visible to eligible governance/Auditor viewers.

Stack: existing Nest/Prisma/PostgreSQL, DGOP worker/audit/access/native cases and bilingual Angular/PrimeNG screen patterns. No new dependency, private authentication system, role wildcard bypass, live database operation, production publication, provider dispatch, push or deployment. About DGOP and byte-preserved workbooks remain unchanged.

Verification: see the final checkpoint for complete clean-install/baseline-upgrade PostgreSQL/Nest/HTTP results in ai-reporting-library.integration.ts, API/Angular builds, focused AI security and native governance checks. Browser visual/load/production certification is not claimed.

Definition boundary: saved KPI captures are observed current projections. Historical month-end cohorts and source-library/control-area import reconciliation remain separate; reference approval/release gates are retained.
