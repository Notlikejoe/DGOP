# Phase 1B — authorization and reference publication

Implemented 11 September 2026 on `codex/ai-governance-phase1b`, based on the About UI checkpoint `dc9fdda` and AI foundation `e16daf6`.

Status: backend security/publication packet implemented and tested. Production seed data remains pending reconciliation; this is not a deployed AI workflow release.

## Delivered

- Exact ten new AI role codes and 25-permission catalog. Existing design roles map to installed DGOP codes: DATA_OWNER → data_owner, BUSINESS_STEWARD → business_steward, PRIVACY_STEWARD → privacy_officer, SECURITY_STEWARD → security_reviewer, TECHNICAL_STEWARD → technical_steward, AUDITOR → auditor, EXECUTIVE → executive and DMO_ADMIN → dmo_admin. New role codes retain the specified uppercase identifiers; existing roles are not duplicated or renamed.
- Explicit, transactional catalog installer. It registers missing AI system roles, grants the catalog permissions through role records, revokes grants outside the catalog role matrix, and audits each change. Re-running it is idempotent. It never assigns roles to users or runs during application startup. Newly created custom roles require explicit catalog synchronization for requester permissions; roleless users receive no implicit grant.
- Live database authorization rather than JWT role claims or the system-admin wildcard. AUDITOR remains read-only even when combined with an operational role. EXECUTIVE alone remains dashboard-only. Broad authenticated-requester wording does not override those restrictions.
- Server-side SoD contracts for creator/owner adoption approval, risk-owner self-acceptance, treatment approval/execution conflicts, ethics recusal, auditor task exclusion, residual-band authority and High/Critical justification/evidence requirements. Denied SoD operations emit a required audit event. Facts must be derived from stored cases/decisions, never accepted as request-body claims.
- Shared reference proposal, review, committee approval and publication endpoints, with DTO validation and explicit permissions. Regulatory lists are determined from the catalog, not client input. Approval binds to a SHA-256 digest of the exact proposal content. Changed content needs reapproval. Publication checks current committee eligibility, uses an independent DMO custodian, and atomically retires the preceding version. Duplicate/concurrent publication cannot create two active versions.
- Added `AuditService.logRequired` for commands that must fail if their audit cannot be recorded. Existing optional audit behavior is unchanged. AI role-permission changes, existing-user role-membership changes and initial AI memberships on user creation now require justification and write old/new AI access data atomically with the change. The existing user and role dialogs include bilingual justification fields using their current controls.
- Forty source registrations with four canonical aliases (36 concepts). `L_FUNCTIONS` resolves only to explicitly marked adoption-subset values; it fails closed when that mapping is absent. Source extraction preserves exact cell values, formulas, addresses and file hashes.

## API and operation

All paths use the existing `/api` prefix:

| Method | Path | Gate |
|---|---|---|
| POST | /ai/reference-data/:code/proposals | refdata.propose.ai; canonical list code |
| GET | /ai/reference-data/proposals/:id | Eligible proposer, reviewer or publisher role plus a live grant |
| POST | /ai/reference-data/proposals/:id/approve | refdata.approve.ai; independent committee member |
| POST | /ai/reference-data/proposals/:id/publish | refdata.publish; independent DMO custodian |

The proposal contains bilingual labels, source SHA-256 and locator, justification and bounded values. No edit-in-place or delete endpoint exists; a new proposal receives a new version. Publication is immediate; arbitrary future/backdated replacement scheduling is not exposed. Proposal review returns values and provenance for the approver to inspect.

Migration `20260911160000_ai_reference_approval` adds only the approval digest column/check to the foundation reference-version table.

For an explicitly selected database, run `npm run seed:ai-security` in apps/api with DATABASE_URL, DGOP_AI_CATALOG_APPLY=true, DGOP_AI_CATALOG_ACTOR and DGOP_AI_CATALOG_JUSTIFICATION provided through the environment. The installer deliberately does not load root .env implicitly. This task ran catalog installation only inside isolated test databases.

## Verification

Passed: API build; exact-catalog/SoD unit checks; existing role-service, bounded-list/user validation and audit-service regression tests; API static checks (418 route blocks).

The isolated PostgreSQL harness passed clean installation and upgrade from the Phase 1A migration history, preserving the baseline DGOP user. Integration tests cover catalog idempotency, explicit grants, admin/auditor/executive denials, grant and membership revocation, persisted SoD denial audit, content-change invalidation of approval, atomic replacement, concurrent publication and audit-failure rollback. The actual Nest HTTP layer was exercised for 401 unauthenticated access, authorized proposal review, denied admin access, and rejection of unexpected request fields. Full Nest application initialization passed.

The changed administration forms were compiled with the existing installed web dependencies; no browser sweep was repeated. No new dependency, remote push, live database migration or running-app backend deployment occurred. The existing About UI changes remain in branch history.

## Source reconciliation — do not silently seed

`scripts/ai-reference-inventory.py` reads both preserved workbooks and verifies their receipt hashes. Output is the task's `work/ai-reference-reconciliation.json`, deliberately marked `staged-not-publishable`. It is not a production import payload and contains no fabricated English value codes or go-live dates.

| List | Design count | Actual nonempty named-range count |
|---|---:|---:|
| R_DEPT | 19 | 15 |
| R_YN | 2 | 3 |
| L_FUNCTIONS | 11 | 9 |
| L_PROGRAMS | 19 | 17 |

The adoption Yes/No list includes `غير معروف`, which does not match the risk-tool labels exactly. All nine adoption function labels need explicit mapping to the risk departments; the design's assumed subset cannot be inferred safely by exact comparison. R_CATMAP has no matching named range and requires explicit source-matrix mapping. English value-code conventions, translations and effective date remain to be reviewed. No source row was discarded or normalized to hide these differences.

## Remaining release gates / next packet

1. Reconcile the named source differences and department subset, verify the category matrix, and produce reviewed canonical seed values. Publish only through the proposal/approval/custodian path.
2. Review the administration justification fields visually during the release UI check. They compile and use existing controls; this packet does not claim browser-based visual acceptance. Changes to user activation and other pre-existing administration operations continue to use DGOP baseline auditing; complete GEN-116 certification remains part of integration acceptance.
3. Bind SoD to the actual AI task-assignment/completion endpoints as those workflows are introduced. Medium residual acceptance still requires two distinct stored signatures; this packet supplies per-actor checks, not a completed acceptance workflow. Likewise, tier-dependent approval/override, reversal authority and evidence ownership validation remain business-workflow work. No completed workflow coverage is claimed on the basis of pure policy functions.
4. Implement Phase 2 intake with the preserved existing UX/UI patterns. Keep AI publication/admin changes isolated from the running app until its release gates are met.

The requirement ledger remains conservative: catalog and reference-control foundations are delivered, but complete cross-cutting requirements are not marked satisfied while source data and workflow wiring remain outstanding.

Final verification: web production build passed after supplying the existing ignored local PrimeUI configuration. The isolated PostgreSQL test server was stopped. No source credentials or local license file are tracked.
