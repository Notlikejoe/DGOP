# Local demonstration and native journey history — 2026-09-14

The user explicitly requested two complete AI use cases, generic organization branding and continuation of the combined AI implementation cycle. This authorizes synthetic local demonstration data in the isolated AI preview, superseding earlier no-demo instructions for this environment only. It does not authorize changing the original installation, accepting an actual-source migration pilot or deploying to production.

## Installed demonstration

Preview: http://localhost:4206/, API 3006, copied PostgreSQL database `dgop_ai_preview_1789317143275` on 55436, 81 migrations. Original http://localhost:4205/, API 3005 and `dgop_dev` remain separate and unchanged.

| Use case | Native identifiers | Classification | Inherent → residual | Treatment and monitoring |
| --- | --- | --- | --- | --- |
| Document Classification Assistant | AI-001 / AIR-001 / AST-AI-001 | LIMITED, maximum 3 | 12 HIGH → 2 LOW | Two evidenced actions at 100%; actual owner acceptance; one completed early review and one future review |
| Service Request Routing Assistant | AI-002 / AIR-002 / AST-AI-002 | HIGH, maximum 4 | 12 HIGH → 4 MEDIUM | Two evidenced actions at 100%; actual owner acceptance and independent officer countersign; one completed early review and one future review |

Both cases contain all required intake fields, six classification scores, specialist reviews, independent final approval, native asset handoff, submitted risk intake, eight competent-role inherent scores and eight fresh residual scores. The installer uses existing DGOP services and native tasks/decisions for these workflows. Governed reference configuration and synthetic evidence are explicitly marked as local demonstrations. Fifteen new fictional actors support the different workflow responsibilities; the existing administrator and existing memberships/passwords remain unchanged. The showcase account requested both cases and can inspect all six AI tools; other actor logins exercise native assignment and separation of duties.

Operational demonstration records participate in normal native calculations inside this isolated database. They are not original source samples, live organization approvals or accepted pilot records. Original workbook sample markers are preserved and still excluded from actual pilot acceptance.

Install/replay: `node scripts/seed-ai-demo.mjs --local-demo` from the checkout root. Requires the explicit flag, development mode, loopback PostgreSQL 55436 and the isolated preview database naming convention. The persisted manifest must match the database; existing accounts/publications outside that manifest are rejected. Completed-case replay skips tasks/decisions; annual registration uses its native already-registered gate. The installer retries only rolled-back serialization or audit-head collisions; this is not a general API concurrency fix. Preserve the ignored manifest and private login file with the copied database. An interrupted intermediate workflow may still require examining its native stage before retry; do not reset or delete existing records.

Private logins are in workspace `outputs/DGOP_AI_Demo_Logins.local.json`. Start with `demo.showcase@dgop.local`. Do not commit credentials, expose them in logs or reset an existing account. Ignored `storage/ai-preview/demo-manifest.json` retains case/risk/evidence/source-preview/report identifiers.

## Subsequent phase implementation

Added scoped read-only `GET /api/ai/history`, using live eligible AIUC grants and existing AIRS/report scope. Aggregate-only executive authority cannot disclose individual histories. Parent cases and their nested risks both follow scope; original sample-marked rows remain excluded. Paging uses an accurate scoped total, stable ordering and a maximum of 50 rows per page.

AI Governance Review now shows registered use cases, approved assets, immutable assessment rounds and authority decisions, treatment progress and monitoring history with the existing PrimeNG table and DGOP theme. Completed approvals correctly do not reappear in pending queues. All six AI screens show an explicit local-demo banner with both native case references only when server configuration and isolated development database identity enable it. The review calendar defaults to full history so the two completed and two future reviews are immediately visible; narrower existing filters remain available. Completed AIUC/AIRS states have English and Arabic labels. The history table wraps within the available content area; the existing queue layout stacks at narrower desktop widths.

Replaced company-specific HRDF/fund wording in active English/Arabic intake labels, server validation and fixtures with organization/entity wording. Active application/scripts searches find no HRDF/Jadarat/Taqat branding; preview organization display names contain no HRDF/fund entity names. Original design documents/workbooks and About DGOP are preserved.

## Verification and continuation boundary

API and final Angular builds passed. `node scripts/verify-ai-demo.mjs --local-demo` passed through native login/HTTP: two native cases/assets/risks; four completed actions; residual acceptance; two completed plus two scheduled reviews; correct empty completed-review queues; scoped dashboard total/reconciliation; source validation preview; pagination, invalid bounds, unauthenticated and aggregate/owner history denial. A rendered-browser check confirmed both examples across all six screens, expanded native authority/treatment/review history and the four-row calendar. Arabic demonstration/review labels rendered; no warnings/errors were captured during those checks.

Targeted isolated native history tests passed for live grants, classification and organization scope, sample exclusion and forged-token role denial. Tests use a dedicated single-role reader, valid classification limits and required native version advancement. Final clean-install and baseline-upgrade regression suites passed with all existing AI contracts; focused AI security/intake contracts passed. Both application health endpoints return HTTP 200. Original DGOP and the populated preview remain running. Isolated test cluster 55438 remains running because automatic approval review timed out twice before cleanup could execute; stopping it requires a fresh approved action.

This advances the history/review part of combined Cycle B (original Phases 6 + 8), and integrates the previously implemented MITIGATE and Low/Medium paths into a usable preview. It does not complete either whole original phase. Next independent work: higher-authority reversal/reopening, governed AVOID closure and ESCALATE outcome processing, followed by remaining shared severity/escalation/audit integration. Cycle A actual-source publication/pilot acceptance, Cycle C release/integration/reporting requirements and controlled Cycle D rollout remain open. Synthetic demonstrations never satisfy those acceptance gates.
