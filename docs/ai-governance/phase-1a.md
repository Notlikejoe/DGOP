# Phase 1A — database and module foundation

Implemented 2026-09-11 on `codex/ai-governance-phase1a`, following the Phase 0 checkpoint. This is an internal foundation, not an end-user AI workflow release.

## Changes and ownership

- Registered `AiGovernanceModule` in the existing NestJS application. No controllers, navigation items or background workers are added.
- Added six AI tables: use cases, intake revisions, risks, assessment rounds, treatment actions and approval obligations. Existing User, Person, OrganizationUnit, DataAsset, WorkflowCase and WorkflowTask identities are referenced through foreign keys. Existing workflow status and task ownership remain in the workflow engine.
- Added three shared governed-reference tables, owned through MasterDataModule: lists, versions and values. The existing reference-version metadata table is preserved. The new store holds the actual values, bilingual labels, effective dates and source provenance that metadata alone cannot provide.
- Added transaction-scoped AI/AIR/ACT and annual AIUC/AIRS numbering using DGOP's existing atomic business sequences. Allocation belongs in the same transaction as the future domain write. An allocated identity cannot be reassigned.
- Defined the 28-field intake draft contract, decimal-string KPI values and six/eight-dimension assessment input contracts. These reject unknown/computed input fields and invalid score ranges. They are internal contracts; endpoint completeness, lookup eligibility, evidence authorization and calculation execution remain future work.
- Added append-only intake/calculation history, explicit reference-version pins, immutable published reference values, retirement rules, unique classification rounds, same-use-case risk constraints, archival protection and version-increment guards.

No packages or technologies were added. Prisma remains at the existing locked version, 6.19.3. Existing Angular/PrimeNG screens and shared styles are unchanged.

## Migration and verification

Migration: `apps/api/prisma/migrations/20260911090000_ai_governance_foundation/migration.sql`. Prisma manages the table definitions, foreign keys and ordinary indexes; custom SQL manages partial indexes, checks and triggers. Review both on subsequent migrations: Prisma schema diff alone does not capture the trigger contracts.

`node scripts/test-ai-foundation.mjs` creates two uniquely named databases on an explicitly isolated PostgreSQL server (127.0.0.1:55438). The harness rejects other hosts/ports and non-test database names, never drops a database, and reads credentials from `DGOP_AI_TEST_DATABASE_URL` or ignored `.env.ai-test`. PostgreSQL binaries can be selected with `DGOP_TEST_PG_BIN`.

For the clean path it runs the complete Prisma migration history. For the upgrade path it applies all preceding migrations, inserts a baseline DGOP user, applies the new migration, and verifies that user remains unchanged. Both paths run the same integration tests and start/close the full Nest application context with the AI and shared reference services resolved. Test credentials and databases remain under ignored local test storage; no live database migration was executed.

Executed successfully: Prisma validation and generation, API build, clean/upgrade migration deployment, concurrent/collision/rollback numbering, parent integrity, revision and assessment immutability, reference lifecycle and historical reads. Each database run rejects 19 invalid writes/reads. These fixtures are synthetic and do not represent approved regulatory scoring parameters.

## Source workbook checkpoint

Both original workbooks remain byte-identical in the task's `work/ai-governance-sources` directory, with original paths and SHA-256 hashes in `manifest.json`. Read-only inventory is in the task's `work/ai-workbook-inventory.json`.

The risk tool has 13 sheets and the adoption tool has four. The risk register/use-case source widths are 38/29 columns, and the intake contract remains 28 business fields. The actual risk workbook uses `L_*` defined names (including L_LEVEL, L_TIER and L_SCORE), whereas design identifiers use `R_*` for some corresponding concepts. Later import/seeding must explicitly map the verified sheet labels and ranges rather than assume the design aliases exist. No workbook rows or formulas have been imported, modified, or treated as instructions.

## Release boundary and next packet

Phase 1B adds the agreed role mapping and permission catalog, segregation of duties (including system-admin bypass prevention), audited governed-reference publication and validated source seed mapping. Publication remains unavailable to users until that layer exists. Effective-date and parameter compatibility checks must be enforced at calculation time. Phase 2 adds complete intake services/endpoints and screens following the saved existing-UI contract.

The models contain core identities and history, not every register projection or full business rule. Classification/risk engines, AI-specific workflow templates, routing, SLA calendars, lifecycle decisions, attachments/imports and dashboards remain later phases. A source document requirement is not complete merely because a supporting table exists.

Deployment of this branch requires all repository migrations, generated Prisma client and the API build. This packet was not pushed or deployed to the running application.

Final verification: full apps/api npm test suite passed (exit 0), including AI contract tests. API static check: 414 route blocks. Web static check: 2,606 translation references and 3,820 dictionary keys. Source workbook SHA-256 hashes rechecked unchanged. git diff --check passed.
