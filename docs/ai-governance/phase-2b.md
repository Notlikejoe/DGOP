# Phase 2B — AIUC intake screen and triage loop

Status: first workflow loop implemented and verified on 2026-09-11. This packet completes the requester intake screen and stages 1–3 of `AIUC_APPROVAL_V1`, then opens the stage-4 classification task after triage acceptance. Classification scoring and the later conditional/decision/handover stages remain separate packets.

## Delivered

- Added the bilingual `/governance/ai-use-cases` Angular screen using the existing DGOP page, card, button, status-chip, navigation, permission-guard, spacing, colour-token and responsive-layout patterns.
- Rendered the exact 28-field contract in nine sections, including governed picklists and active directory users, completion progress, warnings, field-level validation, draft creation/save, submission, returned-case editing and resubmission.
- Added `GET /api/ai/use-cases/lookups`. It returns only current published governed-list values and active directory identities, and reports missing lists through an explicit configuration gate. It does not publish or infer workbook values.
- On submission, created an existing DGOP `WorkflowTask` for `AI_WORKING_GROUP` with a five-KSA-business-day due date. The task reuses the platform task and holiday calendar models.
- Added the protected triage queue and Accept / Return for Completion / Reject operations. Return and Reject require justification. Return opens an Awaiting Info requester task and a new append-only edit path; resubmission closes that task and creates a new five-day triage task.
- Allocated `AI-###` atomically only on triage Accept, retained the already allocated `AIUC-YYYY-NNNNNN`, moved the case to Under Review and created the pending classification-review task. Triage rejection allocates no `AI-###`.
- Reused the Phase 1B `aiuc.classify.assess` permission for the working-group action. Own-scope requesters cannot read or operate the triage queue.
- Recorded task transitions and triage decisions in the existing workflow-event and audit services while preserving every submitted and returned intake revision.

## Verification

The API and web production builds pass. The isolated PostgreSQL harness passes on clean installation and upgrade from the Phase 1B baseline. Integration coverage exercises submit-to-task assignment, KSA due dates, immutable post-submit intake, mandatory return/reject justification, return/edit/resubmit, triage acceptance numbering, stage-4 task creation, optimistic version checks, audit capture and HTTP authorization.

The screen compiles against the existing Angular stack with no added package. Visual acceptance against a running isolated UI remains a release check; no AI code was copied into the active DGOP source.

## Release boundary and next packet

The shared attachment contract currently accepts existing DGOP evidence UUIDs; a screen-level upload flow is not added here. The full `AIUC_APPROVAL_V1` registration, SLA warning notifications, six-criterion scoring, privacy/security parallel reviews, ethics review, tier authority decision, asset registration, AIRS handoff and closure remain open. Source-list publication also remains blocked on the recorded workbook discrepancies and owner approval.

No live database, active API source, production reference data or source workbook was changed.
