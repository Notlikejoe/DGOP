# DGOP Backend Audit - 2026-08-28

## Verdict

The local app is running and usable at http://localhost:3005. Admin login and authenticated profile retrieval succeed. PostgreSQL is connected, all 62 migrations are applied, and the live database matches the Prisma schema.

This scope found **no confirmed critical findings, 3 high findings, and 3 medium findings**. Do not treat the passing test suite as production approval: the isolated audit reproductions confirm business-state failures outside the existing regression coverage.

This was an audit, not a repair turn. No application source, account credentials, or business records were modified. Login, access-denial, and read requests can append ordinary audit events. Only this report and an in-memory reproduction helper were added; the API build output was refreshed. The existing development server was left running.

## High Findings

### H01 - A successful provisioning result can be recorded as successful revocation

- Source: `apps/api/src/access/access-grants.service.ts:1626` and `:1631`.
- Endpoint: `POST /api/access/enforcement/attempts/:attemptId/complete`.
- The handler checks the submitted version against the current grant version, but does not bind completion to the dispatch version stored in the attempt. It decides whether success means revocation using the current grant state as well as the originally dispatched operation.
- Reproduction: an attempt originally dispatched as `grant` at version 1 remains queued; the current grant is version 3 and `pending_revocation`. Recording success with the current version changes the grant to `revoked` / `revoked`, even though the provider result was for granting access.
- Impact: DGOP can show access as removed while the external provider has just enabled it. The resulting audit event is also misleading.
- Fix direction: bind callbacks to immutable operation/snapshot identity, supersede obsolete attempts on lifecycle changes, and never reinterpret a provisioning outcome as a revoke outcome because the grant status changed.
- Verification required: grant dispatch -> revoke request -> late grant success; dispatch -> permission edit -> late success; duplicate callbacks; valid revoke success; concurrent callback/revoke ordering.
- Evidence: reproduced against the current service implementation with in-memory persistence boundaries, without changing the live database.

### H02 - The normal revoke-then-enforce path rejects revocation completion

- Sources: `apps/api/src/access/access-grants.service.ts:1417`, `:1541`, and `:1132`.
- Endpoints: `POST /api/access/grants/:id/enforcement/dispatch` and `/enforcement/manual-complete`.
- `revokeGrant()` moves a grant into `pending_revocation`. Both provider dispatch and manual completion then require `status === 'active'`, rejecting that grant. Expired, suspended, and failed-revocation grants are rejected too.
- Reproduction: both methods returned HTTP-equivalent 400 exceptions for each of `pending_revocation`, `revocation_failed`, `expired`, and `suspended` in isolated service calls.
- Impact: the normal revocation workflow cannot send/record external deprovisioning through its provider/manual evidence paths. Direct revoke dispatch from an active grant and local DGOP policy-rule removal are separate paths; do not establish that external access was removed after the normal revoke action.
- Fix direction: validate state by requested operation; allow deprovisioning and its evidence from revocation-relevant states. Record a distinct manual-revocation operation. Keep provisioning blocked for inactive grants.
- Verification required: approve -> enforce -> revoke -> provider/manual completion; expiry and suspension deprovisioning; retry after revoke failure; duplicate revoke completion.

### H03 - Development credentials are not confined to localhost

- Sources: `apps/api/src/main.ts:124`; `apps/api/src/auth/auth.service.ts:43`.
- Live evidence: the server reports `environment: development`, the configured predictable local administrator password is accepted, and `Get-NetTCPConnection` reports the listener as `0.0.0.0:3005`.
- Impact: the password exception intended for local use is exposed on every IPv4 interface if host/network firewall rules allow inbound traffic. This audit did not test access from another machine or claim Internet exposure.
- Fix direction: default development listening to loopback. Require explicit opt-in and strict credentials/security posture for network binding. Preserve the production password guard.
- Verification required: local login remains usable; default listener is loopback-only; non-loopback startup rejects weak credentials and insecure runtime settings.

## Medium Findings

### M01 - Shortening expiry creates a lifecycle state that authorization and reconciliation skip

- Sources: `apps/api/src/security-governance/security-governance.service.ts:863`, `:996`; `apps/api/src/access/access-grants.service.ts:1382`.
- The review action writes `status: 'expiring'` for a still-valid grant. ABAC reads only `active` grants. The lifecycle reconciler only expires `requested`, `scheduled`, and `active` grants.
- Impact: approved access can stop being recognized before the newly agreed end date, and the grant is later omitted from expiry reconciliation. External deprovisioning is not established by this state change.
- Evidence: the isolated review action wrote `expiring`; all three reconciler status filters exclude it. The live database currently contains no `expiring` grants, so the audit did not claim existing records were affected.
- Fix direction: keep lifecycle status active until expiry and calculate an expiring-soon display state, or support `expiring` consistently across authorization, reporting, enforcement, and reconciliation. Preserve review grant-version checks too.
- Verification required: access remains valid before shortened expiry; access expires at the boundary; reconciliation queues deprovisioning; concurrent review cannot overwrite a newer lifecycle decision.

### M02 - Audit packs and domain traceability still treat seeded proof as approved evidence

- Sources: `apps/api/src/audit-packs/audit-packs.service.ts:255`, `:258`; `apps/api/src/ndi/ndi.service.ts:98`.
- Scoring now filters to operational evidence, but the audit-pack evidence query and domain-traceability query do not apply that provenance filter. Pack evidence projection also omits the provenance field. The pack query does not exclude approved rows whose expiry date has passed.
- Live evidence: the database contains 10 non-deleted approved evidence rows, all `seeded_uat`; zero operational evidence rows. Readiness correctly reports 0 satisfied controls and a 0 score. The audit-pack preview nevertheless reports `approvedEvidenceCount: 10` and includes 10 manifest evidence entries. Domain traceability reports 7 approved evidence items across its model mapping.
- Impact: a reviewer receives conflicting representations of what counts as operational proof. The pack was still blocked with readiness 0, so this audit does not claim the overall readiness gate was bypassed.
- Fix direction: share one authoritative evidence eligibility predicate, including provenance and effective expiry. If demo evidence is included for illustration, segregate and explicitly label it in summaries and manifests.
- Verification required: seeded-only, expired-approved, revoked, and mixed operational/demo fixtures yield consistent scoring, traceability, pack counts, and export labels.

### M03 - Legacy enforcement patch bypasses the evidence/attempt path

- Sources: `apps/api/src/access/access-grants.service.ts:1091`; `apps/api/src/access/access.controller.ts:129`; `apps/api/src/access/access.dto.ts:79`.
- The legacy `PATCH /api/access/grants/:id/enforcement` accepts an enforcement status and optional comment, then updates the grant directly. Unlike the newer provider/manual/policy-store paths, it creates no enforcement-attempt record and requires no provider reference or manual evidence.
- Impact: a caller with `access_grants.edit` can mark owner-approved access as enforced, or pending removal as revoked, without the traceable proof required by the newer completion paths. This is a lifecycle/audit integrity gap, not an unauthenticated access bypass.
- Evidence: the isolated service reproduction changed enforcement to `enforced` without an evidence reference or any attempt creation. The global permission guard remains in place.
- Fix direction: remove the legacy terminal-status setter or delegate it to the same evidence-backed operation service. Keep a dedicated, audited correction path if administrative reconciliation is genuinely necessary.
- Verification required: every transition into enforced/revoked has an appropriate matching attempt and proof; direct terminal status patches cannot bypass that invariant.

## Checks Completed

| Check | Result |
| --- | --- |
| Existing local application | HTTP 200; left running |
| API health | `ok`; PostgreSQL `up` |
| Admin login and authenticated `/api/auth/me` | Login HTTP 201; correct active account |
| Complete API test command | Passed all 35 test scripts, including 86 workflow checks |
| `npm run build:api` | Passed |
| `npm run qa:api` | Passed; 414 controller route blocks inspected |
| `prisma validate` | Valid schema |
| `npm run db:status` | 62 migrations applied; up to date |
| Live datasource-to-schema `prisma migrate diff --exit-code` | No difference; exit 0 |
| `npm audit --omit=dev --json` in `apps/api` | Zero known vulnerabilities reported for production dependencies |
| `git diff --check` | Passed; line-ending notices only |
| Unauthenticated protected read | HTTP 401 |
| Cookie-backed write without CSRF header | HTTP 403 |
| Invalid grant creation body with CSRF header | HTTP 400; no grant created |
| Isolated defect reproduction helper | Confirmed 11 cases across H01, H02, M01, and M03 |

The npm advisory request initially failed within the restricted execution environment. The read-only query was repeated with approved external registry access and succeeded. No packages were updated.

### Authenticated Runtime Reads

All 12 endpoints below returned HTTP 200:

- `/api/dashboard/summary`
- `/api/workflow/templates`
- `/api/workflow/tasks/mine`
- `/api/workflow/reports/operations`
- `/api/access/grants`
- `/api/access/grants/matrix`
- `/api/access/effective-access`
- `/api/security-governance/summary`
- `/api/security-governance/access-reviews`
- `/api/training/summary`
- `/api/ndi/domain-traceability`
- `/api/ndi/scoring/readiness`

`POST /api/ndi/audit-packs/readiness` was also checked. Its implementation builds a preview and does not persist an audit pack. No pack was generated or business grant modified.

## Reproduction and Limits

Run the isolated helper from the repository root:

```powershell
node tmp/audits/2026-08-28/backend-regressions.cjs
```

The helper imports the current TypeScript service implementations and substitutes in-memory persistence and already-authorized context. It confirms the state transitions and rejected states described above; it is not a substitute for a disposable-database integration test or a real provider round trip. Its assertions demonstrate the current defects and should be inverted/replaced by regression tests when fixes are made.

No production database, external connector, browser automation, network penetration test, load test, backup restore, or real concurrent database mutation was exercised. Live cross-role testing was not performed beyond unauthenticated/CSRF/validation checks; the existing API suites cover additional role and scope cases. The background application was already running before the audit; building the current API confirms compile health, not a fresh process restart. Existing user changes were preserved.

Recommended order: contain the development listener; bind enforcement callbacks to their original operation; repair revoke completion; normalize expiry lifecycle; close the legacy terminal-status path; align evidence provenance across all audit surfaces.
