# Phase 3C — Independent assessment review and officer adoption

Implementation date: 2026-09-12. Previous checkpoint: d773f37 (Phase 3B). Reuses existing NestJS/Prisma, Angular, installed DGOP/PrimeNG styles, directory, live grants/scope, configured workflows, KSA calendar, evidence store and required audit. No new dependencies.

## Delivered packet

- Calculation now opens the officer adoption task and, when required, an independent Ethics task bound to the same immutable assessment ID. HIGH/CRITICAL inherent score or approved High source handoff requires Ethics approval. The source-tier rule also applies when the computed score is Low/Medium; clients cannot disable it.
- Only an active AI_ETHICS_COMMITTEE member with an explicit organization-view grant and scoped access can review the Ethics task. Actual Risk Owner/Use-Case Owner identities are checked at completion; combined-role owners are blocked by GEN-29. Standalone required audit records denial and recusal even though the business transaction is rejected. Combined-role Auditors remain read-only (GEN-30).
- Only AI_GOVERNANCE_OFFICER with explicit case.approve.airs and scoped visibility can adopt. STEERING_COMMITTEE's shared approval grant cannot adopt this stage. Owners and actual assessment contributors/calculation actor cannot self-adopt (WF-05). Ethics membership alone does not grant officer authority; an eligible officer may also be an independent committee member, consistent with the committee's RAIO chair role.
- Approve and Return for reassessment require nonempty written justification and 1–20 existing, nondeleted DGOP evidence IDs. Each task is claimed by its actual reviewer, attributed by role and completed with required audit in the same serializable transaction.
- Adoption approval is blocked until required Ethics approval exists for this exact round. Approvals revalidate the pinned effective publications and recompute the immutable inputs to check score/band/severity consistency. Reference retirement/expiry blocks approval while leaving Return available.
- A Return from either reviewer cancels only open tasks for that assessment and opens a fresh assigned inherent coordinator using the original submitted intake. Old calculation/review records remain unchanged. Starting the coordinator pins current references and creates eight fresh competent-role tasks; previous Ethics approval never carries into a new round. The Phase 3B context now correctly distinguishes an unstarted returned coordinator from historical pinned configuration.
- Officer adoption approval opens one configured response-strategy task with assessment/adoption provenance. The AIRS case remains Under Review. Assessment adoption is not residual acceptance, response approval, treatment execution or use-case restriction/stop.
- Pending Phase 3B cases lacking Ethics tasks are supported by explicit officer preparation, protected by live scope/authority, version locking, audit rollback and exactly-one creation. GET does not create business tasks. Already adopted/returned rounds cannot be prepared or reviewed again.

## Persistence and workflow configuration

One additive migration, 20260912150000_ai_risk_assessment_decisions, adds AiRiskAssessmentDecision. Decisions reference their immutable assessment and original workflow task, store kind/outcome/actor/role/justification/evidence/IP/time, and are unique per assessment/kind and per task. SQL rejects updates/deletes, invalid kind/outcome/role/evidence-array shape and task/assessment/stage parent mismatches. Existing calculation and submitted handoff snapshots remain unchanged; adoption state is derived from the decision ledger rather than overwriting result.adopted=false.

The AIRS managed seed revision is airs-lifecycle-phase3c-1. It adds the independent Ethics stage, adoption review-gate metadata and explicit reassessment returns, preserving earlier task stage identities. Generic workflow mutation/maintenance remains blocked for AIRS. Later response/treatment/residual/monitoring stages still require dedicated operational implementation; the generic graph is not a bypass for these services.

API operations: scoped GET assessment/adoption; POST assessment/adoption/prepare; POST assessment/reviews/:taskId. The review service resolves its stage-specific explicit grant, actual configured role and scoped visibility; token role claims and posted actor/recusal/computed fields do not confer authority.

## User interface

Bilingual review/adoption panels appear in the existing AI Risk Register, using existing cards, responsive review layout, buttons, forms, status chips, toast handling and design tokens. Current authority controls approve/return/preparation actions. Independent-review wait, owner recusal and changed-reference notices explain blocked actions. Existing evidence IDs support review minutes and records; shared evidence upload remains outside this packet. Immutable review history displays outcome and justification alongside assessment history; assessment badges now derive Adopted/Returned/Pending from recorded decisions.

## Release boundary

AI work remains in the isolated development checkout. No active-app AI synchronization, live database substitution, production publication/import, push or deployment. About DGOP through 8640cdb and both original workbooks are preserved. Production reference reconciliation remains blocked, including the impact-sheet vs named-R_IMPD mismatch documented in Phase 3B.

This packet supports Approve/Return for inherent assessment review. Other committee outcomes/escalations, quorum/coverage reporting, full case-level severity overrides, response strategies, treatment-plan independence, residual acceptance authorities, notification/SLA warnings, monitoring and production release remain separate packets. Do not mark the full AIRS requirements complete because review/adoption works.

## Verification

API and Angular production builds pass. Shared workflow checks pass 89/89; focused AI security contracts cover added owner/assessor adoption exclusions, existing duties and validation of the AIRS conditional route/default branches. Real isolated clean-install and baseline-upgrade PostgreSQL/HTTP checks pass. They exercise mandatory review and all score-band paths, High-source/Low-score gating, owner recusal audit, combined-role Auditors, live role/scope/evidence enforcement, legacy preparation, required-audit rollback, immutable ledger updates/deletes, exactly-one preparation/adoption, both reviewer returns with fresh rescoring/no carried approvals, changed-reference return, managed seed reconciliation and HTTP authentication/field injection. No browser visual acceptance is claimed.

## Next bounded packet: Phase 3D

Implement the Risk Owner's response proposal and officer response-strategy decision using published R_STRATEGY and original causal/assessment context. Reuse current scope, authority, evidence, audit and UI patterns. MITIGATE must lead to a real approved segregated treatment plan; TRANSFER needs provider/contract evidence and applicable consultations; ACCEPT must route through residual/band-required authority controls, never accept inherent High/Critical directly. Treatment actions/ACT numbering, residual scoring and monitoring remain later packets unless the next bounded scope explicitly includes their prerequisites. Verify source/reference metadata before adding operational paths; retain workbook publication and isolated-development boundaries.

Quota observations: account-wide five-hour usage 26% at start, 42% after the first integrated slice, 53% at completion; weekly 4%, 7%, 8%. No reset credits consumed; two remain available. Isolated PostgreSQL cluster stopped after final verification, with ignored configuration/test storage retained. Commit locally using per-command Codex identity; no global Git setting changes.
