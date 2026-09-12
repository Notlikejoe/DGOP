# Phase 3F1 — Assigned action progress and completion

Bounded packet implemented 2026-09-12 from f682524, authorized by the user with approximately 13% five-hour quota remaining. Uses the existing NestJS/Prisma, Angular/DGOP/PrimeNG styles, grants/scope/directory, workflow tasks, evidence and required audit. No dependencies added. Residual scoring is explicitly excluded from this packet.

## Delivered

- Assigned active executors with an explicit airs.risk.assess grant, live scoped visibility, their original installed execution role and active directory person can record justified integer action progress 0–100. Completed actions are terminal: no update, replay or reopen is supported. Nonterminal percentage corrections retain prior history.
- Execution requires the action's current adopted inherent assessment, approved response/plan, immutable action details and its exact linked active AIRS treatment task. Task case/action/response/decision provenance and original KSA target deadline are checked. Missing approval, changed assignment/role/person/scope, archived cases, task metadata drift and stale risk versions block writes.
- GEN-28 checks the immutable plan decision's actual actor, not the editable task hint or posted values. Combined-role plan approvers cannot execute. Combined-role Auditors remain read-only. The approval-time executor exclusion introduced in Phase 3E remains active.
- Progress 0–99 moves the native DGOP task to In Progress. Progress 100 completes it, derives completedAt/KSA closure date on the server and requires existing nondeleted execution evidence for PREVENTIVE/CORRECTIVE actions. Every supplied evidence ID is validated. Approved planData and immutable submission snapshots remain unchanged.
- Each update appends an immutable AiTreatmentProgress round, updates the native task and action/risk versions, and writes the workflow event and required audit in one serializable transaction. Audit failure rolls back ledger/task/version changes. Concurrent duplicate progress or completion succeeds exactly once.
- Scoped treatment reads derive each action's latest completion, closure date and overdue indicator and the current plan's mean completion. Overdue is based on the preserved KSA target deadline and incomplete state; it does not depend on a posted status or modify governed R_TREATSTATUS. GET creates no tasks or ledger entries.
- Existing bilingual treatment cards now display progress, overdue/completed chips, closure date, recent immutable update history and assigned-executor progress/evidence controls. The server owns overall completion and closure/overdue values. Newly approved tasks advertise execution availability; existing Phase 3E tasks are recognized from their immutable approved-plan linkage without a GET migration.

## Persistence and API

Migration 20260912200000_ai_treatment_progress adds one append-only progress ledger with action/task FKs, unique action/round, percentage/evidence/justification/completion-time checks and a matching approved-plan/independent-executor SQL parent guard. Existing task/action identities and approved-plan freezing remain intact. No workflow graph revision is needed; the current managed seed remains airs-lifecycle-phase3e-1.

POST risks/:id/actions/:actionId/progress accepts expectedVersion, completionPct, justification and evidenceIds. HTTP whitelist validation rejects posted actor/approver, closure date and other computed/provenance fields. Existing scoped GET treatment includes the derived execution state and history.

## Continuation and release boundary

Next packet is Phase 3F2: completed-action prerequisite enforcement, fresh residual likelihood/eight-dimension assessment and governed residual score/band. Then band-specific acceptance and monitoring. Completing all actions in this packet does not create residual assessments, accept risk, close the case or start monitoring. Cases remain Under Review awaiting the next dedicated gate. RM-24 is still open until an operational residual transition checks it.

SLA warning/breach notifications, automatic governed action-status changes, cancellation/reopening, full treatment field/control-domain model, reporting/KPI persistence, residual acceptance, AVOID closure and ESCALATE execution remain separate. Derived completion/overdue UI does not establish completion of full RM-23.

AI development remains local/isolated. No active-app synchronization, live database substitution, production publication/import, push or deployment. About DGOP and original workbooks remain preserved. Source R_IMPD reconciliation/publication and release gates remain blocked. No browser visual acceptance is claimed. Verification and final quota/runtime observations are recorded in checkpoint.md.

## Verification and quota

API and Angular production builds pass. Real isolated clean-install and baseline-upgrade PostgreSQL/HTTP checks pass, including all previous AI packets. New assertions cover executor/live-scope/activity/person/Auditor controls, immutable-approver GEN-28 despite modified task hints, approved-plan/deadline provenance, percentage/justification/evidence validation, audit rollback of progress/completion, concurrent exactly-once progress/completion, terminal replay prevention, append-only execution history, computed mean/overdue/KSA closure and unchanged approved plans/target dates with zero fabricated residual rounds. The workflow graph did not change; its latest 89/89 regression passed in Phase 3E. No browser visual acceptance is claimed.

Account-wide five-hour usage: 87% start, 92% after first verified slice, 94% completion; weekly 14%, 14%, 15%. No resets consumed; two remain available. Isolated PostgreSQL test cluster stopped after verification, with ignored storage/configuration retained. Continue with Phase 3F2 after sufficient quota is available.
