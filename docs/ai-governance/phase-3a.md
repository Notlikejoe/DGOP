# Phase 3A — AIRS ownership and risk identification

Implementation date: 2026-09-12. Existing NestJS/Prisma, Angular, DGOP design tokens, installed PrimeNG environment, workflow configuration, KSA calendar, directory, scope, evidence and audit services are reused. No dependencies added.

## Delivered scope

- Added the bilingual AI Risk Register at `/governance/ai-risks`, using the existing AI Review queue, context cards, controls and responsive layout.
- Scoped discovery of AIRS records linked to active governed assets. Live explicit own/org/all grants and organization/domain/classification scope are enforced on reads and writes; JWT role claims cannot grant access.
- Working-group assignment/reassignment of an existing active directory Risk Owner with an explicit `case.create.airs` grant and asset scope. Assignment binds the draft to `AIRS_LIFECYCLE_V1`, cancels previous open intake tasks and creates an assigned identification task with configured KSA-business-day deadline. Role membership is never granted by assignment. Auditors remain read-only, including combined-role users.
- Only the assigned Risk Owner can save the draft or submit it. Saves remain partial and allocate no AIR reference. Unknown/computed fields, invalid governed codes and nonexistent evidence identifiers are rejected; optimistic versions reject stale writes.
- Submission requires title, cause/event/effect, current controls, all seven governed classifications and a boolean third-party confirmation. Validation returns field-specific issues. Selected published values and their reference versions are pinned in the submitted intake snapshot.
- Atomic submission allocates `AIR-###`, increments the risk version, completes identification, records submission, and opens one assigned inherent-assessment task. It preserves the existing reserved AIRS workflow case number, the original AIUC handoff snapshot, asset and obligation links. Scores and acceptance decisions are not fabricated.
- Required audit failure rolls back assignment, save and submission business writes. Serializable transactions protect concurrent submission and reference allocation.
- One additive migration adds nullable object-only `AiRisk.intakeData`. Existing immutable handoff/reference/parent/version SQL guards remain in force.

## Configuration and release boundary

Initial identification and inherent-assessment stages use the registered AIRS configuration. Later assessment-adoption, response, treatment, residual, monitoring and closure stages are a route skeleton only: their APIs, conditional review/authority gates and executable progression remain future work. Generic workflow operations remain blocked for AIRS and cannot advance the pending assessment task.

Seven current, unambiguous published lists are required: `R_RISKCAT`, `R_ETHICS`, `R_LIFECYCLE`, `R_CTRLEFF`, `R_SOURCE`, `R_INTENT`, `R_TIMING`. Missing/ambiguous references block submission. Synthetic test publications are fixtures, not approval to publish workbook contents. Preserve the source workbooks and Phase 1B reconciliation gate; no production reference import or publication is authorized by this implementation.

This packet completes intake for the automatic handoff path. Manual/workshop creation, library-based starts, risk-register maintenance and reassessment remain later packets. The workflow case number was already reserved on automatic spawn in Phase 2G; only the AIR business reference is allocated at submission here. Hijri request-date presentation and sample-data reporting exclusions remain open.

## Verification

API and Angular production builds passed. Shared workflow regression passed 89/89. Real clean-install and baseline-upgrade PostgreSQL/HTTP integration passed, including owner reassignment/inactivity/scope, stale and computed-field rejection, missing causal fields/references/evidence, required-audit rollback for assignment/save/submission, exactly-one concurrent AIR allocation/assessment task, pinned values/versions, preserved source links and generic workflow bypass rejection. No visual browser acceptance is claimed. Tests use only the isolated loopback cluster on port 55438, preserve baseline data and never drop databases.

## Next bounded packet: Phase 3B

Read the preserved SDAIA risk workbook and FD/TD risk-scoring contract. Implement justified 1–4 likelihood and eight impact dimensions, governed anchors/rules, server-calculated inherent score and band, immutable version-pinned assessment history and the Risk Owner assessment screen. Preserve intake and handoff snapshots. Assessment adoption and conditional independent authority reviews follow as a separate packet. Do not use the live database, publish source lists, synchronize the active application or deploy as part of an isolated development packet.

Quota observations: account-wide five-hour usage 60% at start, 74% after the first verified slice and 78% at completion; weekly 94% to 97%. No reset credits consumed; two remain available. Isolated PostgreSQL cluster stopped after successful verification; ignored configuration and test storage retained.
