# Phase 2G — Independent asset registration and atomic AIRS handover

Status: implemented on 2026-09-12 in the existing NestJS/Prisma/Angular/DGOP workflow, asset, scope, evidence, audit and bilingual design-token stack. No new dependency or service technology.

## Delivered

- Added the sixth AI Review tab for working-group registration and independent Data Owner approval. It follows the existing form/card controls and shows the approved tier and structured approval conditions.
- Added explicit `aiuc.asset.register` (AI_WORKING_GROUP) and `aiuc.asset.approve` (installed `data_owner`) grants through the existing opt-in AI security catalog. Startup does not install permissions or alter memberships. Production catalog reconciliation remains an explicit release step.
- Split configured stage 7 into registration and approval tasks with KSA-business-day deadlines. The approval task is assigned to the Data Owner nominated by the intake directory user ID, not to an arbitrary member of the role queue.
- Validated both tasks against the same completed adoption decision and latest immutable classification. Unacceptable/rejected cases cannot register. The requester, linked use-case owner, registration author and tier approver cannot also serve as the nominated independent asset approver; combined roles do not bypass the gate.
- Added Create / Link proposals with bilingual asset names, AI product subtype, active domain and data classification. Validation reuses DGOP's asset rules and effective role data scope. The three AI product subtypes are added to both backend and existing registry UI definitions.
- Resolved the owner directory's organization text by exact active department code/English name/Arabic name; ambiguous or missing matches block handover. Existing saved department identities must still agree with the directory. No department is guessed or selected from a JWT.
- Required a published `L_CLASS` intake-to-asset mapping and DGOP's minimum classification for personal data. Link mode requires an active AI Data Product with the same department/domain/classification, exactly one effective approved primary Data Owner matching the nominee, and no different AI use-case identity.
- Registration stores the proposal and opens the independent approval task without creating an asset. Return records its evidence-backed decision and opens a fresh registration task, preserving the adoption source.
- Approval revalidates the stored proposal and atomically creates/links one asset, writes its `aiUseCaseRef`, records the standard approved Data Owner stewardship assignment for new assets, links both AIUC records, opens one AIRS draft and links every approval obligation to both the asset and risk record. AIUC then records Implemented and Closed while retaining its original adoption resolution.
- Created the AIRS workflow draft and parent `AiRisk` with a durable, immutable handoff snapshot: identifiers, names/description/objective, owner/department, proposed/approved tiers and reference version, personal/sensitive/third-party facts, programs/streams, lifecycle mapping, conditions, source tasks and intake revision. The causal triple, risk owner, scores and AIR identifier are intentionally unset until risk intake/submission.
- Seeded a provisional review basis from governed tier-to-level and `R_LEVEL_DAYS` metadata. Published lifecycle/model mappings are mandatory; missing/ambiguous mapping or ownership data blocks with no partial asset/AIRS creation. The first residual assessment must replace the provisional basis later.
- Added one additive migration: a unique automatic-handoff source and JSON snapshot on `AiRisk`, and an explicit asset FK on approval obligations. Database guards protect handoff source/payload, linked use-case asset identity, asset reference/type and cross-record obligation asset integrity. Manual risks remain distinct and are not limited to one per use case.
- Required justification and existing DGOP evidence for approval/return; required audit, workflow events, numbering, asset/ownership and condition writes share one serializable transaction. Failed audit or concurrent stale decisions cannot leave a partial handover. Repeating a completed task is rejected rather than creating duplicates.
- Extended generic workflow write and maintenance protections to AIRS drafts. AIUC/AIRS routing and role assignment remain controlled by the AI module; shared reads/comments/attachments remain available.

## Governed metadata contract and release gates

The implementation requires these approved metadata fields, never runtime defaults: `L_CLASS.metadata.assetClassificationCode`; `L_STAGE.metadata.airsLifecycleCode` resolving to a published `R_LIFECYCLE` code; `L_MODEL.metadata.thirdParty` boolean; pinned `R_SDAIA_TIER.metadata.cadenceLevelCode` resolving to a published `R_LEVEL_DAYS` value with integer `metadata.days`. Every mapping version is retained on the handoff snapshot.

The synthetic integration fixtures (including Limited → Medium/180) are tests, not production seed approval. The Limited mapping and workbook discrepancies remain unresolved release gates from Phase 1B. Existing pinned classifications lacking these metadata must be reassessed using an approved reference version; published versions must never be edited in place. No source workbook, production reference publication or live database was changed.

## Verification and next packet

API and web production builds passed. Shared workflow checks passed 89/89, asset checks passed 9/9, AI security contracts passed, and final clean/upgrade database/HTTP verification passed with full Nest startup. Tests include create and link paths, registration return, nominated approver and combined-role independence, missing mapping blocks, required-audit rollback, concurrent exactly-one handoff, ownership requirements, condition linkage and database identity guards. Browser visual acceptance is not claimed.

Next: Phase 3A — discover the handed-off AIRS drafts in the existing UI, implement risk-owner assignment and causal-triple intake/submission, allocate `AIR-###` only at submission, bind the initial risk stages to the AIRS lifecycle configuration and preserve the handoff snapshot. Risk scoring, library import, acceptance, treatment, authoritative cadence/monitoring and bilingual notification delivery follow in separate packets. UC-29 notifications and SLA warnings remain open; no external notification was sent by this packet.

No push, live deployment, active application synchronization, new technology installation, or reset credit consumption.
