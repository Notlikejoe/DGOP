# Phase 2A — AIUC intake API and immutable drafts

Status: implemented and verified on 2026-09-11. This packet adds the AIUC intake backend. The Phase 2B screen, triage task, return-for-completion path and SLA configuration remain next.

## Delivered

- Added authenticated `POST /api/ai/use-cases`, `GET /api/ai/use-cases`, `GET /api/ai/use-cases/:id`, `PATCH /api/ai/use-cases/:id/intake`, and `POST /api/ai/use-cases/:id/submit` operations.
- Enforced the exact 28-field version-1 contract and the 26 submission-required fields from FD §4.2. Drafts may remain partial; unknown fields, invalid composites, excessive field lengths, invalid dates, duplicate selections and non-DGOP attachment identifiers are rejected.
- Defaulted the requester and request date on draft creation. Requester identity is server-bound to the authenticated user. Proposed owner, data owner and executive sponsor resolve through the existing active organization directory; the proposed owner must hold `AI_USECASE_OWNER`, while a missing `DATA_OWNER` role remains the specified reviewer warning.
- Resolved all nine list-backed intake fields through current published governed-reference versions. Missing publication or an unknown value blocks the write. This preserves the Phase 1B source-reconciliation gate: the preserved workbooks are not silently converted into production seeds.
- Saved every draft edit as a new append-only `AiIntakeRevision`; optimistic `expectedVersion` checks prevent lost updates. Submission writes a final immutable revision and rejects later edits.
- Created the existing DGOP `WorkflowCase` record atomically on submission with status `submitted`, type `AIUC`, and the exact `AIUC-YYYY-NNNNNN` annual number. `AI-###` remains null because FD UC-24 allocates it only when triage accepts the request.
- Added required audit entries for draft creation, revision and submission. Audit metadata includes the governed reference version identifiers, derived personal/sensitive-data conditions and reviewer warning codes.
- Returned duplicate-name, simpler-alternative, existing-solution, unknown-classification and data-owner-role warnings without turning the document's warning rules into invented submission blockers.

## Verification

The focused 28-field contract checks and API production build pass. The isolated PostgreSQL harness passes for both clean installation and upgrade from the Phase 1B migration baseline. Real transaction tests cover append-only revisions, live explicit AI grants, active governed lists, directory eligibility, stale-write rejection, atomic case numbering, failed-submission rollback, post-submission immutability, own-scope reads, HTTP authentication and unknown DTO-field rejection.

The isolated database contains synthetic list values for testing only. Those values are not source seeds and are never published outside the disposable test databases.

## Release boundary and next packet

No live database, active API source, or production reference data was changed. Phase 2B must build the nine-section Angular/PrimeNG screen with the saved DGOP UI patterns, add the `AIUC_APPROVAL_V1` route/template, create the five-KSA-business-day triage task and implement Accept / Return for Completion / Reject. Triage Accept must allocate `AI-###` in the same transaction; Return must open a new requester-edit revision path without modifying submitted history.
