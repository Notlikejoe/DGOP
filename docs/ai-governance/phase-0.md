# AI governance phase zero integration baseline

Status: integration preparation completed. AIUC/AIRS business features are not implemented. User direction: use the existing DGOP stack and the same UX/UI as existing screens, with necessary additions permitted.

## Source baseline

- Upstream local checkout: `Notlikejoe/DGOP`, main at `f32c796` (Modernize access management UI and local stack). No remote update was requested or fetched.
- Development checkout: this repository, branch `codex/ai-governance-phase0`, cloned locally without hard links.
- Running source: the existing `dgop-src/DGOP-main` copy in the 4 September workspace. It remains untouched.
- Compared all 630 tracked paths. Found 60 content differences after ignoring CRLF/LF differences. All are preserved in baseline commit `d15743f`, together with the two active-only source stylesheets `admin-modern.scss` and `governance-modern.scss`.
- No API source or Prisma schema differences were found in that comparison. Active UI changes are inherited work, not AI implementation changes.
- Dependencies, runtime data and ignored local configuration were not copied from the running installation. Before launching this checkout, install its locked dependencies and provision isolated configuration/test data; do not point development migrations at the live database.
- Detailed comparison: `baseline-comparison.json`.

## Architecture record

Decision: implement an AiGovernanceModule inside the existing NestJS API, with Angular pages inside the current shell. Persist through PostgreSQL/Prisma. Keep existing workflow, asset, access, evidence, calendar, notification and audit services as the owners of shared behavior. The user's instruction supersedes the source technical document's different stack and literal prohibition on additive shared integration hooks.

Classification, risk scoring and cadence policy are deterministic TypeScript services using governed data. No model API is needed to implement these calculations. No new runtime, broker, UI framework or authentication provider is required for Phase 1.

Business permissions are mandatory even where system_admin has wildcard access. A permission grant alone must not bypass owner/assessor/approver separation, independent committee review, evidence requirements or the prohibition on accepting Critical residual risk. Existing role codes use lowercase values; retain the specification's uppercase codes as canonical documentation identifiers and provide one explicit mapping to implementation codes. Do not seed duplicate upper/lowercase role identities.

## Confirmed integration points and gaps

| Capability | Existing implementation | Required extension or check |
|---|---|---|
| API registration | `apps/api/src/app.module.ts` | Register AI module once; preserve global JWT, CSRF and permission guards. |
| Workflow creation | `workflow/workflow.service.ts`, public `openRoutedCase(input, client?)` | Reuse transaction-aware creation. Check transition callbacks and add a typed, allowlisted AI handler interface if required. |
| Case numbers | `nextCaseCodeForClient`, shared `common/business-sequence.ts` | WFC sequence exists. AIUC/AIRS need atomic per-type/year numbering. The preferred-code collision suffix is not a substitute for the specified format. |
| BPMN and automation | `workflow.bpmn.ts`, `workflow.automation.ts` | Parser supports gateways; current automation allowlist has invoke_connector, set_runtime_variables, record_control_event. New AI computations need a safe integration hook. Do not treat designer support as proof that every required runtime behavior works. |
| SLA dates | `dueDateForStage`; `governance-operations.logic.ts` | Generic stage function adds calendar days. Reuse isKsaBusinessDay/addKsaBusinessDays and configured holidays through an opt-in stage policy; preserve existing templates' semantics. |
| Assets | `assets/assets.service.ts`, AssetsModule | Add an exported narrow method/adapter for AI Data Product creation/linking, with transaction and access checks. Avoid duplicate asset-write logic. |
| Permissions and scope | AccessService, PermissionsGuard, ScopeService | Explicit decorators are required: the guard permits routes with no permission metadata. Scope AI queries by owning user/org/domain and classification; role wildcards do not replace SoD. |
| Reference data | MasterDataModule status values; ExtendedDomains reference version management | ReferenceDataVersion stores metadata/counts, not the complete governed L_*/R_* value model. Phase 1 must establish shared list/value persistence with immutable codes, bilingual labels, aliases, effective dates and approval/version history. Do not create private AI copies of organization data. |
| Audit | `audit/audit.service.ts` supports transaction writer and hash chain | Use the same transaction for governance change and audit where supported; capture actor, IP/context, before/after, justification/evidence. Verify fail-closed behavior in test config. |
| Reliable handoff | IntegrationEvent has retry/dead-letter state; Prisma transactions | Reuse existing event facilities if semantics fit. Same-database asset/case/obligation writes should be atomic; external notifications retry after commit. A durable AI handoff record is conditional, not presumed implemented. |
| Calendar | GovernanceOperationsService.generateCalendarOccurrences and KSA helpers | Add supported risk cadence and idempotent occurrence keys. Existing service needs a public integration boundary; no new scheduler by default. |
| UI | app.routes.ts, layout/navigation.ts, core/i18n.*, shared components | Add permission-aware AI routes and navigation when functional screens exist. Avoid exposing empty placeholder screens during foundation work. |

## UX and UI contract

The running application's current UI, including the preserved modern styles, is the visual authority. No redesign, separate navigation shell, new color palette or alternate component framework.

| New AI surface | Existing screen/component to follow |
|---|---|
| AI governance register and risk queue | `pages/governance/privacy/privacy.html` and its component: page header, actions, tabs, filters, queue/detail workspace and loading/error states. Use the `page` and `governance-modern` wrapper. |
| Case decisions and history | `pages/governance/workflow/case-detail.html`, case-detail.ts and workflow.scss: case code/title, back navigation, status chip, linked asset, tasks, evidence and decision modal. |
| AI asset links | Existing assets detail/link conventions. Do not create a second asset workspace. |
| Forms | Existing input/select styling and validated form behavior, Modal for short edits, shared confirmation/toast services. The nine-section intake uses the existing page/card structure rather than crowding all fields into a small modal. |
| Status and lists | Shared StatusChip, Pager, AppIcon and existing table/filter conventions. |
| KPI views | Existing dashboard/KpiCard patterns and shared theme tokens. |

Use I18nService and i18n.dictionary.ts for all interface strings; follow existing RTL and ThemeService behavior. Preserve keyboard access, focus restoration, labelled validation errors, disabled/saving states and permission-driven actions. No dashboard may display fabricated totals to fill space.

When screens are implemented, acceptance includes side-by-side checks against the reference screens at the same viewport, English/Arabic, light/dark, narrow layouts, populated/empty/loading/error states and restricted users. Phase 0 inspected source templates/styles; it does not claim a new AI screen was visually tested.

## Working resolutions of specification ambiguities

- AIRS cardinality: one submitted AIRS case per identified risk. AIUC approval creates an identification draft linked to the adopted use case, without inventing a risk or allocating AIR-### before valid submission. Additional risks get separate AIRS cases. Record this mapping in the entity/API contracts in Phase 1.
- KPI freshness: use stored, timestamped snapshots and the governed recompute operation. The two repaired counts must reconcile within the same snapshot. Document the FD live-refresh wording as a deviation; business confirmation is required before production dashboard acceptance if live counts are mandatory.
- Critical first review: use an immediate review/decision task on entering Critical handling and separately schedule the 30-day follow-up. Critical is never an acceptance outcome. Keep the distinction explicit in calendar configuration and tests.
- P0 cadence: persist the review basis and acceptance event. Full recurring monitoring is Phase 8; no claim that P0 replaces operational monitoring.
- Permissions: detailed FD permission and SoD tables govern; AUDITOR and dashboard-only EXECUTIVE cannot gain writes from the broad “authenticated users” wording.
- Unconfirmed business configuration: non-triage SLAs, Limited-tier provisional cadence, committee memberships, grade mapping and reference seeds remain visible configuration decisions. Missing mandatory assignments block route readiness rather than silently assigning administrators.

These are documented implementation defaults, not fabricated source values or assertions of business-owner sign-off. They can be revised through the normal design record before affected release gates.

## Source data dependency

Searched the supplied design directory and `C:\My Documents\DevoTeam\My NDI App` for Excel files. Only `NDI Specs - NDI App.xlsx` was found. The adoption/classification and AI risk workbooks remain unavailable; their location was requested. This blocks exact production seeds/library content and migration validation, but not schema, rule-contract or UI foundation work. Synthetic engineering fixtures must be labelled and excluded from production KPIs.

## Baseline verification

- Existing API static quality check initially failed on two formatting-sensitive predicates: single-versus-double quotes for access_grant and LF-only matching for the login route. The corresponding runtime controls are present.
- Updated those two predicates to accept quote/whitespace formatting without removing the checked requirements. No runtime behavior changed.
- API static check now passes: 414 controller route blocks inspected.
- Web static check passes: 2,606 static translation references, 3,820 dictionary keys; route/theme/RTL/accessibility/error wiring checks pass.
- `git diff --check` passes. These are static checks, not an executed end-to-end application or production-security certification.
- Full build and database tests in the new checkout are deferred to its dependency/test-environment setup in Phase 1. No migrations, seed jobs, production data operations or remote pushes occurred.

## Next coding packet

Phase 1A: create the internal AI module, additive Prisma model contracts and rule/version interfaces; implement repeatable schema verification in an isolated test database. Establish governed list/value persistence in the shared ownership boundary. Register no user-visible navigation until a working screen is available.

Acceptance: API starts with the module; migrations apply to a clean test database and upgrade a baseline test database; existing tables/data are preserved; identifiers and unique relationships behave correctly; no production credentials or source workbook content is invented.

Phase 1B: add role mapping and 25 permissions, authorization/SoD contracts, reference publishing/seeding integration and audit hooks. Both packets must use the UX/UI contract above for any UI touched.

The requirement ledger lists 194 referenced FD IDs with proposed phase/test coverage, all marked Not implemented. It is a starting ledger; exact executable test IDs and TD mappings are added per packet. No requirement is considered passed solely because it appears in the ledger.
