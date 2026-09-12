# Phase 3B — Competent-role inherent risk assessment

Implementation date: 2026-09-12. Reuses NestJS/Prisma, Angular, installed DGOP/PrimeNG styling, live authorization/scope, directory, workflow configuration, KSA calendar and transactional audit. No dependency or schema migration added. Previous checkpoint: 8640cdb (About typography), AI intake: 0ba0904.

## Delivered packet

- The assigned Risk Owner starts assessment of submitted AIRS intake. Eight pending impact tasks use the configured inherent stage and published dimension metadata. Role queues provide scoped own-case discovery; assignment does not grant membership or permission.
- Privacy: privacy_officer; bias and safety: assigned AI_RISK_OWNER; transparency: AI_MODEL_OWNER; security: security_reviewer; operational: AI_MLOPS_LEAD; reputation: actual linked AI_USECASE_OWNER; data quality: business_steward. The linked Use-Case Owner must be active, eligible and in asset scope before start. Auditors remain read-only, including combined-role users.
- Each competent actor submits an integer 1–4 with mandatory written justification. Live role/permission, assigned identity where applicable, scope, task provenance and risk version are checked server-side. Completion claims role-queue tasks for the actor; replay and concurrent duplicate writes are rejected.
- Only the assigned Risk Owner supplies justified 1–4 likelihood and finalizes after all eight contributions complete. Impact is MAX of eight, with no averaging or weighting. Published tieBreakOrder determines the reported highest dimension and retains the full tied set. Score is likelihood × impact; published bands emit LOW 1–2/P4, MEDIUM 3–6/P3, HIGH 8–12/P2, CRITICAL 16/P1.
- A database-immutable inherent assessment round retains justified inputs, actors, roles, source task IDs, full configuration, three version IDs, engine version and calculated result. It does not change the immutable submitted intake/handoff. Computed outputs cannot be posted through assessment DTOs.
- Calculation completes the coordinator and creates one configured officer adoption task with adopted=false. Ethics review is flagged for HIGH/CRITICAL score or approved High source tier; review execution, independent recusal and adoption are Phase 3C. Case remains Under Review; no acceptance, residual assessment, treatment or cadence is invented.
- Required audit and workflow events are committed in the same serializable transaction as start, contribution, restart and finalization. Required-audit failures roll back all associated business writes.
- Bilingual assessment cards reuse existing AI Review controls, status chips and responsive styling inside the AI Risk Register. Each user sees only the controls their current authority permits. Published anchors, submitted justifications, results and the latest 20 immutable inherent rounds are visible to authorized scoped readers.

## Reference contract and source reconciliation

Start requires one effective published version of each list, and rejects incomplete/malformed metadata:

| List | Metadata required on values |
| --- | --- |
| R_SCORE14 | Four unique score integers 1–4; anchors.likelihood and anchors.impact, each with nonempty en/ar text |
| R_IMPD | Eight unique canonical dimension values (dim_privacy, dim_bias, dim_safety, dim_transparency, dim_security, dim_operational, dim_reputation, dim_data_quality); matching assessorRoleCode; unique tieBreakOrder 1–8 |
| R_LEVEL | Four approved bands with minScore, maxScore and severityCode as above |

Governed value codes follow the existing uppercase database contract; canonical dimension identifiers remain metadata. Labels are bilingual governed value labels. Synthetic publications are integration fixtures only, not production seeds or source approval.

All three version IDs are pinned at start. Retirement/expiry blocks contribution and finalization; no silent reference replacement occurs. The assigned Risk Owner can restart with written justification: cancel the old open coordinator/tasks, preserve completed submissions, create a fresh coordinator/eight tasks and pin the currently published configuration. Finalization locks the pinned published rows, satisfying the existing SQL assessment-reference guard. Completed rounds remain unchanged.

Read-only inspection of the preserved SDAIA risk workbook confirmed:

- Impact sheet تقييم الأثر, C4:J4 agrees with the functional design's eight dimensions.
- Named range R_IMPD, reference-sheet P5:P12 instead lists regulatory, privacy, security, operational, financial, reputation, individual harm and decision-quality categories. These cannot be mapped by position. Reviewed canonical dimension/role/tie metadata and approved bilingual labels remain a production publication dependency.
- Methodology sheet منهجية التقييم A6:C9 contains likelihood anchors (<1%, 1–10%, 10–50%, ≥50%); A14:B17 generic impact anchors; A28:E31 contains the four score bands and review periods. Review periods are not used to implement monitoring in this packet.

Original workbooks remain unchanged. Adjacent task-workspace phase3b-source-evidence.json records extracted evidence; the prior reconciliation file and Phase 1B approval gates remain applicable. Document suggestions of alternative infrastructure are source material, not authorization to replace DGOP's stack.

## Integration and release limits

The managed AIRS seed revision is airs-lifecycle-phase3b-1, with R_IMPD dimension multi-instance/coordinator metadata. Existing eight-stage routing is retained. Generic workflow mutation and maintenance still cannot bypass AIRS controls. Assessment APIs cover context, start, justified restart, individual contribution and final calculation only.

Severity is emitted in assessment results/audit/UI. Existing WorkflowCase has no severity column, so shared case severity integration and justified overrides remain open (RM-15 partial). Inherent scoring does not complete model-harmony alerts, residual computation, reporting rollups, notifications, SLA alerts or all RM-12/RM-14 requirements.

AI changes remain in the isolated development checkout. No live database substitution, production reference publication/import, active-application AI synchronization, push or deployment. About DGOP changes through 8640cdb are preserved.

## Verification

API and Angular production builds passed. Focused AI contracts and the scoring test passed: all 16 matrix cells, each maximum dimension, governed tie ordering and invalid/incomplete score/anchor/role/band rejection. Shared workflow regression passed 89/89. Real isolated clean-install and baseline-upgrade PostgreSQL/HTTP tests passed. Tests cover scoped role queues, wrong-role/Auditor blocks, version conflicts, reference retirement/restart provenance, required-audit rollback, exactly-one concurrent claims/finalization, immutable round updates/deletes, preserved source links and HTTP computed-field/actor injection rejection. No browser visual acceptance is claimed.

## Next bounded packet: Phase 3C

Implement officer assessment adoption and conditional independent Ethics review with GEN-29 recusal, evidence/justification, returns for reassessment and immutable decisions. Reuse established AIUC review/authority patterns and current stack. Resolve review ordering and stage assignment from the functional contract before progression; calculation is not adoption or risk acceptance. Response/treatment and band-required acceptance authorities follow separately. Preserve source approval gates and use only the isolated database.

Quota observations: account-wide five-hour usage 0% at start, 10% after the first working slice and 24% at completion; weekly 0%, 2% and 4%. No reset credits consumed; two remain available. Isolated PostgreSQL cluster stopped after final verification; ignored test storage/configuration retained.
