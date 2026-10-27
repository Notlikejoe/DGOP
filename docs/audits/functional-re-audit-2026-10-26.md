# DGOP functional re-audit — 26 October 2026

**NO-GO for complete functional sign-off: three P1 findings remain.** The five previously repaired findings pass their current regressions. This fresh review confirms related transaction and reporting gaps elsewhere in the application. The 4212 preview remains running. This assessment made no application repair, dependency change, migration, grant change, credential reset or Git push.

## Confirmed findings

### A26-02 — P1: Four other commands retain business rows after an audit-save failure

Real PostgreSQL audit-insert failures were injected into these native commands in the guarded test clone:

| Command | Business rows before → after | Audit count before → after | Result |
|---|---|---|---|
| training_course.create | 0 → 1 | 2 → 2 | Native exception 500; row persists |
| governance_operations.calendar_template.create | 0 → 1 | 2 → 2 | Native exception 500; row persists |
| governance_operations.notification.create | 0 → 1 | 2 → 2 | Native exception 500; row persists |
| foi_exemption.create | 0 → 1 | 0 → 0 | Native exception 500; row persists |

The affected operations are course creation, calendar-template creation, notification creation and FOI exemption recording. Their inserts commit before the audit write. This is the same failure pattern corrected earlier in valuation, Extended Domains and sharing, now independently reproduced in other service families.

**Impact:** A save can fail while leaving an unaudited record. Retrying can create duplicate calendar items or exemptions, or conflict with a notification that the user was told did not save. A valid audit hash chain does not prove every business change has a corresponding event.

**Smallest repair:** Put the business write and audit.logRequired(entry, tx) in the same transaction, including dependent records and aggregates. Review the remaining mutation methods in these service families for the same pattern, then guard the required contract with syntax-based checks.

**Acceptance:** Database-backed fault injection leaves no inserted/updated business state, no derived change and no misleading audit; an explicit retry creates exactly the intended result and event.

[training.service.ts:215](../../apps/api/src/training/training.service.ts#L215); [governance-operations.service.ts:1777](../../apps/api/src/governance-operations/governance-operations.service.ts#L1777); [governance-operations.service.ts:1953](../../apps/api/src/governance-operations/governance-operations.service.ts#L1953); [foi.service.ts:464](../../apps/api/src/foi/foi.service.ts#L464). PostgreSQL evidence (private receipt; SHA-256 `c5d90d2d95460249f4b0faee1f7e8a71b7478faae198a88ad9629ed58d0c19ce`).

### A26-03 — P1: Operations lists stop at 80 and their totals undercount the population

The Operations workspace applies take:80 to tasks, notifications, escalations and calendar occurrences, then derives several summary totals from those returned arrays. In the test clone, the exact scoped open-task predicate matches **100** tasks, while the workspace reports **80**. Creating **81** native, locally targeted unread notifications yields only **80** matching rows and an unread total of **80**. The response has no paging envelope or complete total.

**Impact:** Work and notifications disappear from this screen as workload grows; leadership totals and operational sizing derived from this workspace can understate demand. The repaired Extended Domains and Business Value registers do not repair this separate workspace. The live preview also returns 80 open tasks, but the independently established 100-task comparison above belongs to the test clone.

**Smallest repair:** Apply scope before independent counts and pagination, return the existing data/total/page/pageSize/totalPages contract, add stable sorting and bounded server search, and update each Operations panel and summary together. Review the separate 300-item notification digest cap as a related source-confirmed limit.

**Acceptance:** At 81 and 201 records, every authorized item remains discoverable and actionable; complete totals reconcile independently; Finance/HR scope remains enforced.

[governance-operations.service.ts:480](../../apps/api/src/governance-operations/governance-operations.service.ts#L480). Boundary evidence (private receipt; SHA-256 `c5d90d2d95460249f4b0faee1f7e8a71b7478faae198a88ad9629ed58d0c19ce`).

### A26-01 — P1: Hub metrics and task messages are fixed fixtures rather than live facts

The Data Governance hub renders Governance health 91%, Open alerts 7, Privacy risk 1 and Audit ready 84%. Access Management renders Access coverage 98% and Audit trail 100%; Administration renders Directory coverage 92% and Audit trail 100%. Their values are literal strings in SectionHubPage, with fixed hints and queue messages such as “due today”; no corresponding record calculation or task binding supplies them. Tool counts are dynamic and are not part of this finding. The AI Governance hub does not render these fixed metric cards.

The real Command Center currently reports 47% ownership coverage, 16 unowned assets, 53 attention items and 0/14 controls with operational evidence. These measures have different definitions, so the audit does not treat their percentages as interchangeable. The defect is the unsupported fixed health/readiness claims and task text, which remain unchanged regardless of underlying records.

**Impact:** A polished presentation can claim stability, readiness or complete audit coverage that the stored governance data does not substantiate. This affects both demonstrations and later operational use.

**Smallest repair:** Connect each displayed metric to an explicitly defined, scoped server calculation, or hide unsupported indicators until a valid calculation exists. Derive task messages and due dates from actual records. Keep scenario results separate from operational compliance credit.

**Acceptance:** Independent database/API reconciliation agrees with the cards; changing a relevant record changes the metric; missing inputs show unavailable instead of a fixed green result.

[section-hub.ts:94](../../apps/web/src/app/pages/section-hub/section-hub.ts#L94). Actual displayed metrics (private receipt; SHA-256 `a9f1f9de3771503eea1ca4ff41f5d9de939b6dee9d355c27e76bacca8606abb3`); Live reporting comparison (private receipt; SHA-256 `82bdb9219729b0f65f3812c7aa64eac874810ad364bd0ae37714d118196eae0d`); Screenshot (private receipt; SHA-256 `6cd5ca383389d338e2f223ac5aa7d018f7d8fc48c85bdce5507b555a5ee03d40`).

## Verification and repaired findings

| Check | Result |
|---|---|
| Registered API inventory | 57 files passed against the current frozen source. |
| Complete frontend suite | 97 tests in 22 files passed. |
| Previously repaired behavior | 34 native PostgreSQL groups passed: 11 original integrity groups plus 23 transaction, version, register and workflow groups. |
| Independent probes | Four audit-rollback defects and the 81-notification/100-task boundary defect confirmed in the isolated clone. No fault trigger or diagnostic record was installed in 4212. |
| Actual tool screens | 45 routes and all 25 visible data tabs loaded; no application browser errors or document overflow at the audited desktop viewport. Three AI pages were accepted only after their data-ready states appeared. |
| Eight QA profiles | Fresh login/session, direct API, department scope and exact current frontend menu/route-contract checks passed. Only qa.admin has system_admin; AI-free profiles remain excluded. |
| Prior profile UI evidence | 70 browser assertions retained with a source-manifest comparison. Auth/navigation/business-page inputs are unchanged; only the root banner and governance hub template/style differ, covered by current route/tab and recent responsive checks. This is not claimed as a new 70-check DOM run. |
| Departmental specialists | All 30 retain explicit bounded non-admin roles and rank-2 classification ceilings; real Finance/HR reviewers read their own case and are denied the opposite department. |
| Schema/evidence | 98 migrations accounted for; zero unexpected drift; all constraints validated. 8 available original files match checksum/length; 10 inherited originals remain unavailable. |
| AI proofs and examples | All 233 stored proof digests verify; three completed and six pending examples retain their native relationships. |
| Audit and preservation | All 3176 live audit rows verify without truncation. 205 tables stayed unchanged; users/audit changed only through ordinary sign-ins/audit appends. All 59 credential, token-version, membership, grant and scope fingerprints match the recorded baseline. |

Passing suites establish their tested contracts; they do not negate independent database counterexamples. Fresh browser coverage proves navigation and data loading, not every possible business mutation or concurrency combination. The mutation evidence is native service/PostgreSQL evidence, not HTTP penetration testing.

The native regression harness initially assumed a final review would be on the first unfiltered workspace page. Its original failure is retained. A work-only, type-checked adapter searches the two review codes through the new paginated register and preserves both assurance assertions. The frozen test/application files were not edited. The test itself should be updated when repairs are authorized so this diagnostic adapter is unnecessary. Browser automation also required explicit data-ready checks for three asynchronous AI screens; initial loading-only observations were preserved rather than accepted as data coverage.

## Evidence, preservation and limits

Existing builds were reused after exact source, lock and artifact verification. Clean/upgrade installation evidence from the 98-migration repair remains applicable because schema/migration inputs are unchanged; status, SQL contents and drift were checked fresh. No install, rebuild, release matrix, capacity soak, restore or real delivery/provisioning test ran. Dedicated security and dependency-vulnerability auditing remain deferred.

The missing genuine PrimeUI key still blocks licensed presentation. Ten legacy originals remain unavailable and excluded from operational credit; unsupported historical decisions remain review needed. Synthetic evidence is not operational compliance proof. The recently removed global presentation banner does not change that provenance or the scoring rules.

The original main checkout remains unchanged at b8055ba484208a5c20e171892ae7f137f6ee7249 with its existing untracked tmp/enterprise-ui/. Other preview ports were unavailable during observation and were not restarted or modified. 4212 stayed healthy.

## Candidate identity and receipt attestations

- Source: 691bf09fafe2b2e2d438d8994f36a711d11f6d5ddd1345d46e7aab5ab438710c
- API build: 05f764d85d5f282256e405aa4599aad98fec3c900917dcee6d3e3ba6c70b68b0
- Web build: fe0695d3bbee26baaedbb4636f690dbec1b274c5562ec7a78103af5865b59e49
- API lock: b679427639d3012166bfc2e4df94c12815937867130e318445daf1bc63e0e5d2
- Web lock: 67f444365e94b6fd55d4c42a116fcaf054d7b7af964b220a1d6e956971f8c535
- Node 24.19.0; isolated loopback PostgreSQL preview.
- Audit ledger with receipt hashes (private receipt; SHA-256 `91fcb7f7c03a623457e38149305c0e9be5ad79416940ecc223e39274f41b3d28`)
- Complete tool-to-database coverage (private receipt; SHA-256 `3dc91f244459977e85e5328c561f17c3e8dadf33622f9ed781ec1dba5d13ddbc`)
- 45-route/25-tab browser receipt (private receipt; SHA-256 `a9f1f9de3771503eea1ca4ff41f5d9de939b6dee9d355c27e76bacca8606abb3`)
- Eight-profile contract receipt (private receipt; SHA-256 `f1bdb8fa50cee73ce3564d997598760b894b03a451189ded1460f69798f03bc9`)
- Final preservation and audit-chain receipt (private receipt; SHA-256 `66854c24f01df882d1413b843170113244feaf0e6e6b7fd4151c56f2e6a8bd3d`)
- Current native regressions (private receipt; SHA-256 `3db4af0c354b5d2edbde4a447a6382ae128b2e8b9ab9ef42cbe2c8b219f87b68`)

Repair order: remaining atomic audit transactions, complete Operations discovery/counts, then honest data-backed hub metrics. Use focused reproduction → repair → regression → affected checks; rerun broader gates only when changed inputs invalidate their evidence. This audit reports the defects and does not implement them.

Skills: skill-organizer and quota-saver; DGOP backend, workflow engine, Prisma/data-model, governance-domain and end-to-end QA. No additional agent team was used.

Publication note: This is a portable copy of the local audit. Private runtime receipts, database connection details, credentials and account guides are intentionally kept outside Git. Receipt hashes identify the retained originals; they do not provide independently runnable acceptance by themselves. See [4212 publication status](../candidate-publication/RELIABILITY-4212-20261026.md).
