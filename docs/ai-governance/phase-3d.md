# Phase 3D — Response proposals, consultations and strategy approval

Implementation date: 2026-09-12. Previous checkpoint: a8b4b0e (Phase 3C). Uses existing NestJS/Prisma, Angular, installed DGOP/PrimeNG styling, live directory/grants/scope, workflow tasks, KSA calendar, evidence store and required audit. No new dependencies.

## Delivered packet

- Inherent assessment adoption opens one assigned Risk Owner proposal task and one officer response coordinator, both bound to the adopted immutable assessment and adoption decision. Existing pending Phase 3C coordinators can be prepared explicitly by their current Risk Owner. Scoped GET never creates tasks.
- Only the active assigned AI_RISK_OWNER with airs.risk.assess can propose. A current effective published R_STRATEGY containing exactly AVOID, MITIGATE, TRANSFER, ACCEPT and ESCALATE is mandatory. The proposal pins that publication, its bilingual choice labels, justification, existing DGOP evidence, assessment/adoption provenance and actual submission actor.
- TRANSFER requires a provider and contract evidence. Third-party involvement derives from the submitted intake or immutable handoff. Offshore processing requires an explicit owner confirmation and cannot suppress a true intake/handoff flag. TRANSFER with either flag opens separate privacy_officer and security_reviewer consultations. Other strategies do not manufacture transfer consultations.
- Reviewers require their actual installed specialist role, organization-view grant and scoped access. Combined-role Auditors are read-only. The officer requires AI_GOVERNANCE_OFFICER and case.approve.airs; Risk Owner, Use-Case Owner and proposal author cannot approve their own response (WF-05). Token role claims do not grant authority.
- Approve/Return requires written justification and 1–20 existing nondeleted evidence IDs. TRANSFER approvals revalidate provider/contract evidence. Officer approval requires both required consultations to approve this exact proposal. Retirement/expiry of the pinned strategy publication blocks approval while Return remains available.
- A reviewer Return cancels only the remaining open decisions for that proposal and opens a fresh proposal/coordinator pair against the same adopted assessment. Old proposals and decisions remain immutable. Neither consultation nor officer approval carries forward. Reassessment of inherent inputs is still a separate Phase 3C return path.
- Each mutation runs in a serializable transaction with optimistic risk-version locking, workflow event and required audit. Audit failure rolls back proposals, decisions, task creation/claims/cancellation and version changes. Concurrent duplicate submissions/decisions succeed exactly once.

## Protected downstream prerequisites

Officer strategy approval opens exactly one pending configured prerequisite task:

| Strategy | Next task | Outstanding operation |
| --- | --- | --- |
| MITIGATE | airs-treatment-plan | Real actions/ACT numbering, required evidence and independently approved plan |
| TRANSFER | airs-treatment-plan | Same action/plan controls after applicable consultations |
| AVOID | airs-avoidance-review | Justified scope change/stop and governed closure |
| ACCEPT | airs-acceptance-gate | Residual assessment and band-specific acceptance authority |
| ESCALATE | airs-escalation-gate | Existing DGOP escalation ladder and outcome processing |

Task snapshots explicitly record prerequisitesPending=true, riskAccepted=false, planApproved=false, required planned actions and the High/Critical completed-action prerequisite. These flags are provenance for later dedicated services, not enforcement of unfinished operations. This packet does not create/complete treatment actions, calculate residual risk, accept risk, restrict/stop a use case, close the case or execute escalation. The AIRS case stays Under Review. Generic shared-workflow mutations and maintenance remain blocked for AIUC/AIRS.

## Persistence, API and UI

Migration 20260912180000_ai_risk_response adds AiRiskResponse and AiRiskResponseDecision with restricted parent FKs, unique risk/round and task/decision-kind keys, role/strategy/evidence shape checks, immutable SQL triggers and task/assessment/publication parent guards. Existing intake, handoff and assessment snapshots remain unchanged. The AIRS managed seed revision is airs-lifecycle-phase3d-1; it preserves existing stage identities and adds proposal, consultation and protected prerequisite routes.

Scoped GET risks/:id/response exposes eligible actions, immutable proposal/decision history and publication/consultation wait state. POST response/prepare and response/propose require owner permission. POST response/tasks/:taskId resolves live stage-specific reviewer authority. HTTP whitelist validation rejects posted actor, computed score and acceptance fields.

The bilingual AI Risk Register now includes response proposal/review/history panels using the same responsive DGOP cards, form controls, buttons, status chips, toasts and design tokens as existing AI screens. Published choice labels are used. TRANSFER fields appear conditionally. No visual browser acceptance is claimed.

## Release and continuation boundary

AI work remains isolated and local: no active-app AI synchronization, live database substitution, production reference publication/import, push or deployment. About DGOP through 8640cdb and both source workbooks are preserved. Production reference reconciliation remains blocked by the impact-sheet versus named-R_IMPD category mismatch. Synthetic integration publications are test fixtures only.

Next bounded packet is Phase 3E: actual treatment-action records/ACT allocation, plan completeness/evidence, Risk Owner execution and independent officer plan approval. Then implement execution/completed-action gates and residual assessment/acceptance. AVOID closure and ESCALATE execution must receive their dedicated governed services; do not treat their pending tasks as completed business behavior.

## Verification

API and final Angular production builds pass; the final Angular build has no response-component warnings. Shared workflow checks pass 89/89 and focused AI security/graph contracts pass. Real opt-in isolated clean-install and baseline-upgrade PostgreSQL/HTTP checks pass. Tests cover all five routes, conditional consultations and their no-consultation path, fresh proposals after officer/specialist return, immutable proposal/decision history, publication retirement, live scope/roles/SoD, required-audit rollback of every action family, concurrent exactly-once preparation/submission/consultation/officer approval, unchanged handoff/intake and zero fabricated actions/residual acceptance, managed seed upgrade and authenticated HTTP field protection. No browser visual acceptance is claimed.

Account-wide five-hour usage: 56% at start, 66% after the first implemented slice, 71% during final verification; weekly 9%, 10%, 11%. No reset consumed; two credits remain available. Use the opt-in isolated harness on loopback port 55438; never substitute the live database URL. Ignored test storage/configuration is retained and the test cluster is stopped after verification.
