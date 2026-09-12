# Phase 3H — Governed periodic review cycle

Implemented locally on 2026-09-12 together with Phase 3I, following checkpoint 90c4915. Uses DGOP's existing NestJS, Prisma/PostgreSQL, workflow and recurring compliance calendar, Angular forms, bilingual dictionary, shared cards/status chips and toast services. No dependency or scheduler added.

## Executable behavior

- A scoped Working Group member or Responsible AI Officer with the explicit `airs.cadence.manage` grant registers monitoring after the current terminal residual decision. Low requires actual-owner acceptance, Medium the completed countersignature, High Executive acceptance, and Critical Steering restriction/stop. Critical remains unaccepted and its suspended/archived use-case state is preserved.
- Registration completes the pending monitoring-preparation task, moves the AIRS case from Decision Made to Implemented, and creates one native calendar template, occurrence and protected review task for the active actual Risk Owner. The case stays open.
- `R_LEVEL_DAYS` must have exactly one effective published version, four values LOW/MEDIUM/HIGH/CRITICAL, and numeric positive integer `metadata.intervalDays` (maximum 3660). Each value must declare boolean `metadata.firstReviewImmediate`, true only for Critical. Missing/generic/invalid configuration blocks writes without a fallback. Tests use synthetic 365/180/90/30-day metadata; nothing was imported or published into production.
- The first date uses the immutable residual decision timestamp. Normal deadlines are the end of the Saudi calendar date plus the governed interval; Critical's first review is immediately due. Subsequent dates use the server-recorded completion timestamp plus the interval. Client dates, band, actor, role and cadence are not DTO fields.
- Completion requires the actual active assigned Risk Owner, explicit assessment permission, live risk scope, the original pending task/deadline, written justification and 1–20 existing evidence identifiers. A missing current cadence version prevents completion atomically, retaining the outstanding review. Completion creates an immutable record, completes the native task/occurrence and opens exactly one next occurrence/task. New approved interval versions apply to that next occurrence; existing snapshots remain unchanged.
- The review panel follows existing DGOP UX/UI and displays Saudi dates, scheduled/due-soon (within seven days)/overdue/completed status, cadence pins, justification/evidence history and the user's available actions. Auditors remain read-only.

## Storage and protection

Migration `20260912230000_ai_periodic_review` adds the immutable review basis, completion and signal ledgers and `ai_risk_review` calendar type. Foreign keys retain the source decision, governed version, native task/calendar occurrence and escalation identities. Parent guards check band authority, cadence, actual ownership, source/task/calendar relationships and deterministic dates. Deferred native task/calendar guards prevent date, assignment, completion or cadence bypasses while allowing the atomic completion/next-instance transaction. Required audits and workflow events share the business transaction; optimistic locking and unique keys prevent duplicate registration/rounds.

Generic calendar creation/editing rejects this type; its monthly occurrence generator excludes it. Generic workflow mutation/maintenance cannot advance AIRS reviews. Managed AIRS revision is `airs-lifecycle-phase3hi-1`; its graph is illustrative, and its closure edge cannot execute an unimplemented AI closure path.

## Boundaries and next work

Review completion records evidence and schedules the next review; it does not calculate a new assessment, renew risk acceptance, reopen a suspended/archived use case or close the case. PRC-05 off-cycle triggers/new-assessment rebasing (RM-29), annual comprehensive reviews (RM-30), authoritative `R_CADENCE` display mapping, complete register/status/KPI reporting and production reference publication remain open. The functional text says the first Critical review is within 30 days while the technical engine says immediate; this packet explicitly requires the approved immediate-first metadata contract. Production policy/reference reconciliation remains a release gate, not a hidden interval default.

## Verification

Final API and Angular builds and clean/upgrade isolated PostgreSQL/HTTP integration tests pass. Checks cover all four bands, Saudi date rollover, required publication, immutable pins/future versions, actual-owner/activity/scope/grant/Auditor controls, stale writes, concurrent exactly-once registration, required-audit rollback, protected native dates/status, evidence and unknown HTTP fields. Native governance tests pass 30/30; workflow tests pass 89/89; focused AI security/graph contracts pass. Browser visual acceptance is not claimed.

No active-app AI synchronization, live database change, external message, source workbook edit, production import/publication, push or deployment. Continue with phase-3i.md for the second packet and the latest checkpoint for resumption.
