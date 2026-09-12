# Phase 2F — AIUC tier adoption decisions

Status: implemented on 2026-09-12 using the existing NestJS, Prisma, Angular, PrimeNG/DGOP design tokens, workflow, evidence, audit, permissions and KSA calendar. No new dependency or database migration.

## Delivered

- Added the stage-6 decision queue and recording API, guarded by live `case.approve.aiuc`, the configured tier authority, and any existing task assignee. Minimal/Limited go to the AI Governance Officer, High to the AI Executive Team, and Unacceptable to the Steering Committee.
- Excluded the requester and linked use-case owner from both the decision queue and recording operation, including users who also hold an authority role. Existing auditor-deny and GEN-26 duty checks apply without administrator bypass.
- Bound every decision to the latest immutable officer classification, its pinned reference version and approved tier. A prior tier override must retain its recorded higher-authority reference; the final decision copies that reference rather than accepting a replacement from the client.
- Revalidated all configured specialist gates before adoption. Ethics now applies whenever the proposed tier was High, even if subsequently lowered, or the approved tier is High/Unacceptable. The managed system-template revision is advanced so existing system seeds receive the corrected gate; independently published templates retain the existing reconciliation boundary.
- Supported Approve, Approve with Conditions, Return and Reject for known adoptable tiers. Unacceptable supports only Restrict, Stop and Return. Restrict/Stop record a rejected adoption and create no downstream asset task; they do not stop an external operational system. Operational AIRS enforcement remains a later packet.
- Required nonblank justification and existing, nondeleted DGOP evidence for every final decision. Conditional approvals require structured conditions and atomically create distinct `AiApprovalObligation` records.
- Recorded the authority, tier source, evidence, conditions, resolution and timestamp on the completed decision task, with transactional workflow events and required append-only audit including role and client IP. Stale/replayed decisions fail; required-audit failure rolls back the complete decision.
- Applied Decision Made followed by Approved/Rejected states, retaining the structured Approved with Conditions resolution. Return opens a fresh working-group classification task with the server-derived intake facts.
- Approval opens the configured stage-7 asset handover task only. Independent asset approval, exactly-one asset/AIRS creation, obligation linkage and final closure are intentionally reserved for Phase 2G.
- Added a fifth bilingual AI Review tab using existing controls and layout. Navigation accepts either organization review visibility or `case.approve.aiuc`, allowing properly authorized Executive Team/Steering users to enter without granting unrelated organization permissions.
- Blocked generic workflow case/task/form/decision mutations for AIUC so those endpoints cannot bypass the AI evidence, authority and segregation controls. Shared reads, comments and attachments remain available. Generic maintenance assignment excludes AIUC and rechecks the case type transactionally, preserving governed role queues.

## Verification

- NestJS API and Angular production builds passed.
- Shared workflow regression checks passed: 88/88, including generic AIUC bypass blocks and preservation of AIUC role queues.
- Clean-install and baseline-upgrade PostgreSQL/HTTP integration verification passed, including full Nest application startup, prior Phase 1B security/publication checks, foundation integrity, and the complete AIUC flow. The harness uses only the isolated port-55438 test cluster and uniquely named test databases.
- Integration assertions cover proposed-High/lowered-tier Ethics, all-required-review gates, tier authority, requester/owner exclusions, evidence and condition validation, Unacceptable adoption prohibition, Stop without downstream creation, conditional obligations, reassessment/reject/approve paths, stale replay, managed-seed reconciliation, mandatory-audit rollback, and generic endpoint rejection.
- Production builds establish compilation; browser visual acceptance is not claimed for this packet.

## Resume boundary

Implement Phase 2G from this checkpoint: independent registration approver segregation, exactly-one governed asset and AIRS handover, obligation linkage, retry/concurrency safety and the stage-7/8 user flow. Continue using existing asset/risk/evidence/workflow interfaces. Review UC-23 through UC-29 and the asset registration requirements before choosing the packet boundary.

Source-list publication remains blocked by the unresolved workbook reconciliation approvals from Phase 1B. Source workbooks and preserved copies are unchanged. No active DGOP source, live database, production reference publication, push or deployment occurred.
