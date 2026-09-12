# Phase 2E — AIUC workflow routing and specialist review gates

Status: implemented on 2026-09-12. This quota-sized packet registers the AIUC route and implements its conditional specialist-review gate in the existing NestJS, Prisma, Angular, DGOP workflow, evidence, permission, audit, KSA calendar, design-token, and bilingual UI stack.

## Delivered

- Registered the managed system workflow template `AIUC_APPROVAL_V1` with the intake, triage, requester-completion, six-criterion classification, conditional parallel Privacy/Security/Ethics reviews, all-instantiated merge, tier-dependent decision, asset handover, and closure stages.
- Declared AR-AIUC-01 through AR-AIUC-05 as template configuration data. Runtime routing reads the active template stage records and their priorities instead of embedding role decisions in the BPMN graph.
- Bound every new AIUC workflow case and each runtime task to the registered template and stage. Task names, types, roles, and KSA business-day due dates now come from the active workflow configuration.
- Preserved server-derived routing facts from submitted intake through triage, classification, officer verification, and any reassessment loop.
- Instantiated the Privacy co-signature only when the governed Arabic personal-data value is نعم, the Security review only when data classification is سرية, and the Ethics review for every High or manual Unacceptable approved tier.
- Grouped matched specialist tasks as one conditional parallel approval set. The tier decision is created only after every instantiated task is complete; no-match cases proceed directly.
- Routed the next decision by configured priority: Unacceptable to STEERING_COMMITTEE, High to AI_EXECUTIVE_TEAM, and Minimal/Limited to AI_GOVERNANCE_OFFICER.
- Added role-filtered specialist queues and evidence-backed Approve, Return, and Reject operations. Return cancels sibling reviews and reopens working-group classification; reject cancels siblings and rejects the workflow case.
- Enforced Ethics Committee recusal when the reviewer is also the AI use-case owner and recorded the GEN-29 recusal block in the existing audit trail.
- Extended the existing bilingual AI Review screen with a fourth specialist queue. Privacy, Security, and Ethics reviewers see the read-only intake/classification context, assigned stage and SLA date, and the mandatory justification/evidence decision form.

## Verification

- NestJS API production build passed.
- Angular production build passed after the compiler was allowed to resolve the existing project paths.
- Focused AI governance and intake contract tests passed.
- The Phase 2 integration module compiles and covers template binding, configured task creation, Privacy-only routing, Security plus Ethics routing, decision blocking at the parallel merge, tier-dependent assignment priorities, mandatory evidence, role-scoped queues, and GEN-29 owner recusal.
- The `AIUC_APPROVAL_V1` graph passes the existing DGOP BPMN route validator with ready status.
- The isolated PostgreSQL runtime test remains unavailable because port 55438 cannot bind in this environment. The live DGOP database was not used as a substitute.

## Release boundary and next packet

The registered decision stage is now created only after its gates pass, but recording the stage-6 authority decision is the next packet. Phase 2F should add the evidence-backed adopt/return/reject operation, enforce requester/owner segregation and `case.approve.aiuc`, apply the universal Decision Made/Approved/Rejected states, and prepare the approved path for independent asset registration and AIRS handover.

No live database, active DGOP source, production reference data, source workbook, or preserved workbook copy was changed.

