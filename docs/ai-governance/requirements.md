# Functional requirement implementation ledger

Delivery update (2026-09-13): use the original design phase numbers and combined cycles in phase-delivery-cycles.md. Historical alphabetic tasks are traceability, not completed design phases. Local implementation, running-app integration, actual-source validation and release acceptance are distinct statuses.

Generated from the supplied FD v1.0 requirement identifiers. Entries identify planned coverage, not implemented or passing tests. Cross-cutting rows will be refined to exact test files when their packet starts. Source documents remain authoritative.

Phase 1A update (2026-09-11): supporting database/module contracts are implemented and tested; see phase-1a.md and apps/api/test/ai-foundation.integration.ts. No entire FD business requirement is marked complete: authorization, public operations and workflow behavior are still pending. “Not implemented” below means the complete requirement is not yet delivered, rather than absence of foundation work.

| Requirement | Planned phase | Proposed verification | Status |
|---|---|---|---|
| BR-01 | 3 | Deterministic rule and negative-input tests | Not implemented |
| BR-02 | 5 | Deterministic rule and negative-input tests | Not implemented |
| BR-03 | 5 | Deterministic rule and negative-input tests | Not implemented |
| BR-04 | 8 | Deterministic rule and negative-input tests | Partial — protected engine cadence/anchor/deadline, renewed-authority rebase and per-organization annual 365-day calendar implemented; governed display pins/status mapping now implemented; production metadata approval/release certification remains |
| BR-05 | 6,8 | Deterministic rule and negative-input tests | Partial — scoped reads derive overdue from preserved KSA target deadline and completion; automatic governed status updates/reporting remain |
| BR-06 | 8 | Deterministic rule and negative-input tests | Partial — computed review status and protected task/evidence lifecycle implemented; complete governed status/register mapping remains |
| BR-07 | 6,10 | Deterministic rule and negative-input tests | Partial — current approved-plan mean completion derived from immutable execution rounds; reporting/KPI persistence and full model remain |
| BR-08 | 8 | Deterministic rule and negative-input tests | Not implemented |
| BR-09 | 3 | Deterministic rule and negative-input tests | Not implemented |
| BR-10 | 10 | Deterministic rule and negative-input tests | Implemented locally — approved SDAIA HIGH use-case count from current scoped non-sample register, independent of proposed tiers/residual bands; real store reconciliation tested |
| BR-11 | 10 | Deterministic rule and negative-input tests | Implemented locally — absent approved SDAIA classification count from current scoped non-sample register; register total reconciliation tested |
| GEN-01 | 1–12 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-02 | 1–12 | Governed configuration / permissions / reporting; refine at packet entry | Partial — 21 live scoped dashboard indicators, repaired register counts/reconciliation and immutable governed as-of captures implemented; historical period reconstruction/source acceptance remain |
| GEN-20 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-21 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-22 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-23 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-24 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-25 | 1,3,6 | Computed band authority | Implemented — immutable residual band selects protected actual-owner/RAIO/Ethics/Executive/Steering tasks and explicit permissions; posted roles/bands cannot confer authority |
| GEN-26 | 1,3,6 | AIUC final-decision segregation | Implemented — requester/linked owner excluded from decision queues and blocked at recording; configured tier role, claimed assignee and live permission enforced; generic task assignment/decision bypass blocked |
| GEN-27 | 1,3,6 | Risk-owner self-acceptance exclusion | Implemented — actual Risk Owner cannot accept/countersign Medium+, including combined competent roles; native SQL guards reinforce the service checks |
| GEN-28 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Implemented — approval excludes nominated executors and progress/completion excludes the immutable plan approver, including combined roles |
| GEN-29 | 1,3,6 | Independent Ethics owner recusal | Implemented for AIUC and inherent AIRS review — actual owner identities blocked and recusal audit persists on rejection |
| GEN-30 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Partial — Auditor scoped AI dashboard/archive/comparison/export/library reads and write denial implemented alongside prior reviews/annual snapshots; broader platform integration certification remains |
| GEN-31 | 1,3,6 | Evidence-backed authority decisions | Partial — AIUC and AIRS authority decisions require justification, existing evidence and transactional audit with immutable conditions; higher-authority reversal remains |
| GEN-71 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-72 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-73 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-74 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-75 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-76 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-77 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-78 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-79 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-80 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — all 21 live projections and immutable as-of observations with governed existing-worker daily/closed-month cadence slots implemented; historical month-end cohort reconstruction remains |
| GEN-81 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — submitted non-sample AIUC case count, once per case rather than resubmission; historical month-close reporting remains |
| GEN-82 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — terminal AIUC acceptance ratio from latest completed adoption resolution and installed terminal lifecycle; historical month-close reporting remains |
| GEN-83 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — completed triage attempts within pinned KSA business-day deadline over completed triage attempts; governed as-of reporting schedules now implemented; historical period reconstruction remains |
| GEN-84 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — distinct completed triage return-event attempts over completed triage attempts; governed as-of reporting schedules now implemented; historical period reconstruction remains |
| GEN-85 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — full-population scoped registered-use-case count and stable read-only summaries implemented; immutable daily observations now implemented; historical source reconstruction remains |
| GEN-86 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — full-population scoped identified AIR-reference risk count implemented; immutable daily observations now implemented; historical source reconstruction remains |
| GEN-87 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — current calculated paired HIGH/CRITICAL residual count and 4×4 matrix implemented; governed observation schedules now implemented; load certification remains |
| GEN-88 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — actual-owner scoped open-risk count using installed closed/cancelled lifecycle mapping implemented; governed as-of reporting schedules now implemented; historical period reconstruction remains |
| GEN-89 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — scoped identified risks without assigned owner count implemented; immutable daily observations now implemented; historical source reconstruction remains |
| GEN-90 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — mean current inherent score with missing/superseded round exclusion and source count implemented; governed monthly observation slots now implemented; historical period reconstruction remains |
| GEN-91 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — mean valid current paired residual score with missing/superseded exclusion implemented; governed monthly observation slots now implemented; historical period reconstruction remains |
| GEN-92 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — mean valid current paired score reduction including negative values and null empty denominator implemented; governed monthly observation slots now implemented; historical period reconstruction remains |
| GEN-93 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — verified current approved-plan treated risks over approved-plan risks implemented; source sample migration/scheduled monthly reporting remain |
| GEN-94 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — protected Saudi deadline overdue current approved-plan action count and read-only drilldown implemented; dedicated source sample provenance/immutable daily observations now implemented; historical source reconstruction remains |
| GEN-95 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — complete-population scoped live periodic overdue count implemented with sample/supersession exclusions; SQL aggregates, scoped filters/drilldown and explicit monthly archive implemented; full dashboards and scheduled reporting remain |
| GEN-96 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — due-as-of live compliance numerator/denominator and no-due null state implemented; immutable explicit closed-month capture/archive implemented using current population/state at capture time; automatic historical reporting/full dashboards remain |
| GEN-97 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — current inherent HIGH/CRITICAL risks with at least one verified current approved-plan action complete over current HIGH/CRITICAL risks, plus gap drilldown implemented; governed monthly observation slots now implemented; historical period reconstruction remains |
| GEN-98 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Implemented locally — exact approved SDAIA HIGH non-sample scoped register count and reconciliation, not proposed tier or residual risk band |
| GEN-99 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Implemented locally — absent approved SDAIA classification non-sample scoped register count and reconciliation |
| GEN-100 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — current due native assessment rounds and eight justified competent-role contributions computed; missing deadlines separated; governed monthly observation slots now implemented; historical month-end reconstruction remains |
| GEN-101 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — exact current approved-HIGH Ethics coverage and separate mandatory-review cohort computed with current-decision evidence; governed monthly observation slots now implemented; historical month-end reconstruction remains |
| GEN-102 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Implemented locally — repaired cards use store queries with no spreadsheet cross-references or client-computed values |
| GEN-103 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — independently counted High/unclassified/other classified totals reconcile to eligible register and organization distribution implemented; historical source migration reconciliation remains |
| GEN-104 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — executive allowed KPI subset and numeric residual matrix, no case-action authority and aggregate-only privacy implemented; certified read-only executive summaries/drilldowns remain |
| GEN-105 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Partial — register/risk sample flags and optional immutable plan/action JSON sample markers excluded from current projections; dedicated treatment-plan source sample migration/admin certification remains |
| GEN-111 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-112 | 1,3,6 | Band-derived permissions and Critical denial | Implemented — Low/Medium/High accept permissions resolve from computed residual band; Critical has no acceptance permission and only Steering restrict/stop/return outcomes |
| GEN-113 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-114 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-115 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-116 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-121 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-122 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-123 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-124 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Partial — periodic and organization-register annual occurrences, assigned native Review tasks, evidence-backed completion and next scheduling implemented; approved cadence display pins and safe officer handover implemented; production metadata/notification certification remains |
| GEN-125 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Partial — original and additional evidenced procedure triggers, immutable ledger, fresh assessment restart and renewed-authority monitoring regeneration implemented; full event/reporting integration remains |
| GEN-126 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Partial — native review threshold warnings/breach, EN/AR plans, escalation and timeline events implemented; provider delivery and full KPI dashboards remain |
| GEN-127 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-128 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-129 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-130 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| INT-01 | 1–7 | Platform integration and legacy-case regression | Not implemented |
| INT-02 | 1–7 | Platform integration and legacy-case regression | Not implemented |
| INT-03 | 4 | Identifier-gated pipeline integration | Partial — identifier-gated AIUC/AIRS assessment/decision/treatment, periodic reviews and off-cycle reassessment/monitoring rebase implemented; annual/closure integration remains |
| INT-04 | 4 | Platform integration and legacy-case regression | Implemented locally — existing Asset 360 scoped AI register/current paired residual/approved mitigation/assessment decisions/native calendar and executive aggregate privacy; broader legacy/browser/production validation remains |
| INT-05 | 1–7 | Case numbering and request date | Partial — AIUC submission and automatic AIRS spawn reserve unique numbers in the existing annual scheme; Hijri request-date defaults and manual AIRS submission remain |
| INT-06 | 1–7 | Platform integration and legacy-case regression | Partial — native AIUC/AIRS states, guarded Critical suspension/archive and periodic review Implemented state integrated; other terminal paths/full integration certification remain |
| MIG-01 | 11 | Import staging, source reconciliation and replay | Partial — immutable original/corrected validate-only preparation, versioned evidenced corrections and independent review implemented; target phase promotion/order/closure remain gated |
| MIG-02 | 11 | Import staging, source reconciliation and replay | Partial — exact resolution and reviewed canonical current-reference/active Person/unit bindings implemented with pinned provenance and stale configuration gates; target promotion remains |
| MIG-03 | 11 | Import staging, source reconciliation and replay | Partial — original classification row and empty intake form preserved, six-score MAX/tier/date previews and approval-provenance quarantine implemented; full intake field promotion/Hijri/source-owner decomposition remain |
| MIG-04 | 11 | Import staging, source reconciliation and replay | Partial — source use-case candidates, reference/identity/date/sample checks and linked-risk/highest-score previews implemented; target lifecycle/asset/approved-tier migration remains |
| MIG-05 | 11 | Import staging, source reconciliation and replay | Partial — causal risk and eight-dimension source candidates, native inherent/residual preview comparisons and source branch quarantine implemented; independently evidenced target rounds/cases remain |
| MIG-06 | 11 | Import staging, source reconciliation and replay | Partial — source action candidates, source-proven percent-unit conversion, dates/closure/parent/sample checks implemented; approved-plan/native ACT task promotion remains |
| MIG-07 | 11 | Import staging, source reconciliation and replay | Partial — corrected source library batch proposal/independent native publication path, original IDs and immutable lineage/replay implemented; real source publication and native use-case/risk/assessment/action migration remain gated |
| MIG-08 | 11 | Import staging, source reconciliation and replay | Partial — named-range source aliases and exact existing published-list reconciliation implemented; no second source seed/publication path introduced |
| MIG-09 | 11 | Import staging, source reconciliation and replay | Partial — immutable original/corrected counts/checksums/quarantine and genuine selected-library-proposal target comparison/exports implemented; overall zero-diff and complete pilot sign-off remain pending |
| MIG-10 | 11 | Import staging, source reconciliation and replay | Partial — original formula/cache/numeric text plus separately prepared candidates and computed diff checks retained; target zero-diff is explicitly null until a genuine target load/comparison |
| MIG-11 | 11 | Import staging, source reconciliation and replay | Partial — preserved source AIRL identifiers with immutable source-to-target version links and collision/replay guards implemented; full loaded AI/AIR/ACT identifier chains remain pending |
| MIG-12 | 11 | Import staging, source reconciliation and replay | Partial — source samples conservatively propagated, computed cells preserved only as provenance and aggregate/engine previews calculated separately; sample-marked target promotion remains |
| MIG-13 | 11 | Import staging, source reconciliation and replay | Partial — retained-source preparation identifies one filled register anchor and nineteen missing AI-001..020 anchors, with no fabricated rows; actual pilot load and acceptance remain |
| MIG-14 | 11 | Import staging, source reconciliation and replay | Partial — independent evidenced preparation review implemented, explicitly distinct from pilot sign-off; production load remains unavailable |
| MIG-15 | 12 | Import staging, source reconciliation and replay | Not implemented |
| NFR-01 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-02 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-03 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-04 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-05 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-06 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-07 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-08 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-09 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-10 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-11 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-12 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-13 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-14 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-15 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-16 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-17 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-18 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| NFR-19 | 7,11,12 | Cross-phase acceptance; production evidence where applicable | Not implemented |
| RM-01 | 5 | AIRS lifecycle | Partial — inherent assessment/review/adoption and returns implemented; response, treatment, residual acceptance and monitoring remain |
| RM-02 | 5 | AIRS initiation paths | Implemented locally — automatic AIUC handoff, workshop creation, published-library draft instantiation and existing-case off-cycle reassessment paths implemented; new drafts require assigned owner submission |
| RM-03 | 5 | AIRS numbering | Partial — atomic immutable AIR submission numbers and native workshop/library/handoff case identities implemented; native case code is reserved at draft creation, rather than FD submission-only timing |
| RM-04 | 5 | Risk source facts and sample handling | Partial — department/source handoff preserved and third-party involvement confirmed at intake; sample reporting exclusions and other computed fields remain |
| RM-05 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-06 | 5 | Risk record fields | Partial — intake/controls, inherent/residual score histories, adoption/response/consultation and treatment progress implemented; full governed status/monitoring/control-domain model remains |
| RM-07 | 5 | Mandatory causal triple | Implemented — draft submission rejects missing cause/event/effect with field-specific issues; no AIR reference or assessment task created on rejection |
| RM-08 | 5 | Competent-role impact assessment rounds | Implemented — eight fresh competent-role inherent/residual tasks, immutable rounds, officer adoption/returns, conditional inherent Ethics and fresh High residual Ethics; returned/reference-change rounds carry no previous scores/approvals |
| RM-09 | 5 | Final impact and highest dimension | Implemented — read-only MAX of eight and highest dimension via pinned R_IMPD, with governed deterministic tie order and retained tied set |
| RM-10 | 5 | AIRS assessment / decision / operations | Partial — permanent ACT records, one-to-one assigned DGOP tasks, authorized evidence-backed progress/completion and immutable execution history; full field/status/control-domain model remains |
| RM-11 | 5 | AIRS assessment / decision / operations | Partial — immutable version-pinned AIRL business provenance/FK resolves from risk and its existing ACT/use-case chain; original workbook source reconciliation remains |
| RM-12 | 5 | Server-only computed outputs | Partial — inherent/residual outputs computed server-side, injected score/authority/acceptance rejected and persisted rounds SQL-immutable; other reporting/cadence rollups remain |
| RM-13 | 5 | Inherent risk scoring | Implemented — justified 1–4 likelihood with published bilingual anchors × MAX impact, server-calculated range 1–16 |
| RM-14 | 5 | Risk bands and harmony | Partial — four governed inherent/residual bands through published R_LEVEL implemented; reporting and model-harmony alerts remain |
| RM-15 | 5 | Severity emission and overrides | Partial — P4/P3/P2/P1 emitted in inherent result/audit/UI; shared WorkflowCase severity integration and justified override authorities remain |
| RM-16 | 5 | AIRS assessment / decision / operations | Implemented — version-pinned governed control effectiveness and current post-treatment controls mandatory before residual calculation |
| RM-17 | 5 | AIRS assessment / decision / operations | Implemented — fresh justified residual likelihood/eight impacts after completed treatment; no effectiveness-based numeric modifier |
| RM-18 | 5 | AIRS assessment / decision / operations | Implemented — immutable residual probability × max impact, governed score/band/severity and display-only risk reduction |
| RM-19 | 6 | Band authority matrix | Partial — actual Low owner, sequential independent Medium countersign, fresh High Ethics/Executive and Critical Steering native tasks/decisions implemented; higher-authority reversal and structured shared escalation records remain |
| RM-20 | 6 | Critical restriction/stop | Implemented — Critical acceptance denied; Steering restrict/stop/return only, with guarded actual use-case suspension/archive linked to immutable decision |
| RM-21 | 6 | No Risk Owner self-acceptance Medium+ | Implemented — server-resolved actual Risk Owner excluded from Medium/High/Critical authority decisions despite extra roles; Medium owner/countersigner must also be independent |
| RM-22 | 6 | AIRS assessment / decision / operations | Partial — published strategies, transfer consultations, approved MITIGATE/TRANSFER plans/execution and residual acceptance/Critical decisions implemented; avoidance closure and separate escalation execution remain |
| RM-23 | 6 | AIRS assessment / decision / operations | Partial — ACT records/independent plan approval, assigned target-date tasks and evidence-backed execution with derived mean/overdue; warning/breach notifications and automatic governed status/KPI reporting remain |
| RM-24 | 6 | AIRS assessment / decision / operations | Implemented — residual start/contribution/calculation blocks inherent High/Critical with zero verified completed actions; approved treatment requires all planned actions complete |
| RM-25 | 8 | AIRS assessment / decision / operations | Partial — published four-band R_LEVEL_DAYS interval/first-review metadata, immutable cadence snapshots and native calendar registration implemented; authoritative R_CADENCE mapping/production reconciliation remain |
| RM-26 | 8 | AIRS assessment / decision / operations | Implemented — current residual authority decision/monitoring entry opens an actual-owner review; evidence-backed completion records last review and schedules exactly one next governed occurrence |
| RM-27 | 8 | AIRS assessment / decision / operations | Partial — computed overdue/due-soon within seven days/upcoming/completed review panel and actual-owner task implemented; governed register projection and approved due-soon notification templates remain |
| RM-28 | 8 | AIRS assessment / decision / operations | Partial — existing scheduler emits deduplicated 50/80/95 warnings and deadline breach, bilingual native alerts/planned channels, council escalation and completion resolution; provider delivery/full PRC-05 KPIs remain |
| RM-29 | 8 | AIRS assessment / decision / operations | Implemented locally — seven evidenced off-cycle triggers, review supersession, active-reassessment additional triggers with pending-task cancellation/fresh scores, independent new authority and decision-based monitoring rebase |
| RM-30 | 8 | AIRS assessment / decision / operations | Implemented locally — per-organization register annual Review task/calendar, pinned register history, officer trends/control-effectiveness/non-conformity findings plus existing evidence, 365-day next cycle and scoped Auditor read-only visibility |
| RM-31 | 9 | AIRS assessment / decision / operations | Partial — governed AIRL entities/versions/publications plus corrected 66-row candidate selection, atomic source proposals, provenance and subset target reconciliation implemented; real source/pilot activation remains gated |
| RM-32 | 9 | AIRS assessment / decision / operations | Partial — source-linked ISO definitions/dimensions, independent library mappings, separate draft suggestions/owner-selected risk and action tags, native submission freeze/execution provenance implemented; automatic R_CATMAP and real source activation remain |
| RM-33 | 9 | AIRS assessment / decision / operations | Implemented locally — current published library version creates an editable native risk draft with immutable source/library and approved ISO-link suggestions; actual owner tags remain explicit, with no fabricated event, auto-submission, control certification or score |
| RM-34 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-35 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-36 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-37 | 10 | AIRS assessment / decision / operations | Partial — computed approved-High/unclassified cards and current register reconciliation implemented/tested beyond 100 rows; original workbook migration reconciliation remains |
| UC-01 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A |
| UC-02 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B |
| UC-03 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B |
| UC-04 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B; publication gate open |
| UC-05 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B |
| UC-06 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B |
| UC-07 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B/2E; personal-data condition creates the mandatory Privacy co-signature and blocks decision until completion |
| UC-08 | 2 | AIUC intake / classification / handoff | Implemented — Phase 2A/2B |
| UC-09 | 3 | AIUC intake / classification / handoff | Implemented — Phase 2C; publication gate open |
| UC-10 | 3 | AIUC intake / classification / handoff | Implemented — Phase 2C; governed band metadata required |
| UC-11 | 3 | AIUC intake / classification / handoff | Partial — manual Unacceptable verification, Ethics gate and Steering restrict/stop with no adoption/downstream task implemented; operational AIRS handling and direct Ethics manual-tier proposal remain |
| UC-12 | 3 | AIUC intake / classification / handoff | Partial — override evidence, authority reference, pinned source and proposed/approved values preserved through final configured-authority endorsement; higher-authority reversal remains |
| UC-13 | 3 | AIUC intake / classification / handoff | Partial — final tier authorities, Unacceptable prohibition, atomic asset/AIRS draft effects and governed provisional cadence implemented; High-tier Steering notification remains |
| UC-14 | 3 | AIUC intake / classification / handoff | Partial — handoff reads pinned tier-to-level and published R_LEVEL_DAYS metadata to seed provisional review basis; approved Limited mapping and residual recomputation remain |
| UC-15 | 3 | AIUC intake / classification / handoff | Partial — approved path stages 1–8 includes independent Data Owner registration approval and closure; additional workflow actions/non-approved closure paths remain |
| UC-16 | 3 | AIUC intake / classification / handoff | Partial — existing task and decision types reused across the registered template; final decision/asset/closure operations remain |
| UC-17 | 3 | AIUC intake / classification / handoff | Partial — five-day task implemented; SLA warning/escalation pending |
| UC-18 | 3 | AIUC intake / classification / handoff | Partial — five-day return/resubmit implemented; warning/closure pending |
| UC-19 | 3 | AIUC intake / classification / handoff | Implemented — Phase 2F corrects proposed-High coverage even when lowered; approved High/Unacceptable also require Ethics; managed seed upgraded and final decision revalidates the gate |
| UC-20 | 3 | AIUC intake / classification / handoff | Implemented — Phase 2E; conditional Privacy/Security/Ethics tasks run in one all-instantiated merge gate |
| UC-21 | 3 | AIUC intake / classification / handoff | Implemented for initial AIUC routing — Phase 2E; AR-AIUC-01..05 are active template configuration data evaluated by priority |
| UC-22 | 3 | AIUC intake / classification / handoff | Partial — stage-6 live permission, configured authority, requester/owner exclusion, Ethics recusal and generic bypass protection implemented; broader AIRS duties from GEN-27/28/31 remain |
| UC-23 | 4 | AIUC intake / classification / handoff | Implemented — Phase 2G independent approval creates/links one AI asset with AI identity and atomically opens exactly one AIRS draft sharing its UUID; concurrent duplicate spawn blocked |
| UC-24 | 4 | AIUC intake / classification / handoff | Implemented — Phase 2B |
| UC-25 | 4 | AIUC intake / classification / handoff | Implemented handoff contract — immutable AIRS draft snapshot carries intake/owner/tier/flags/programs/lifecycle/conditions and governed provisional review basis; AIRS intake editing/confirmation follows |
| UC-26 | 4 | AIUC intake / classification / handoff | Partial — structured conditions visible in registration and linked atomically to asset/AIRS risk; discharge/treatment visibility remains |
| UC-27 | 4 | AIUC intake / classification / handoff | Partial — triage and final reject/return paths implemented; final rejection retains AI identifier and creates no asset/AIRS; withdrawal/escalation/noncompletion closure and notifications remain |
| UC-28 | 4 | AIUC intake / classification / handoff | Partial — specialist and final decisions require existing DGOP evidence; remaining stage-specific checklists/upload requirements remain |
| UC-29 | 4 | AIUC intake / classification / handoff | Not implemented |
| WF-01 | 3,6,8 | Actual Low owner acceptance | Implemented — only the active actual Use-Case Owner with explicit Low grant can accept the computed Low residual round |
| WF-02 | 3,6,8 | Sequential Medium owner/countersign | Implemented — actual-owner decision then independent officer countersign; no acceptance/advancement after owner alone, including current-owner changes and combined-role exclusion |
| WF-03 | 3,6,8 | Mandatory procedure review gates | Partial — AIUC and inherent/residual officer/Ethics gates plus fresh independent High Ethics before Executive acceptance enforced; later monitoring/escalation procedure gates remain |
| WF-04 | 3,6,8 | Critical acceptance denial | Implemented — computed Critical routes to Steering restrict/stop/return only; plain acceptance blocked in service/SQL and HTTP rejects injected band/authority fields |
| WF-05 | 3,6,8 | Owner–approver segregation | Implemented for current AIUC/AIRS review/treatment/acceptance — actual owners/assessors cannot adopt their own rounds; independent plan/execution and Medium countersign/High Ethics checks are audited |
| WF-06 | 3,6,8 | Workflow gate and SoD negative tests | Implemented for AIUC — Phase 2E; personal-data Privacy co-signature blocks tier decision until complete |
| WF-07 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-08 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-09 | 3,6,8 | Workflow gate and SoD negative tests | Partial — permanent AI/AIR/ACT identities and AIRL version/source/FK immutability implemented, with referenced library histories append-only; original source migration chain reconciliation remains |
| WF-10 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-11 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-12 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |

Phase 1B backend update: exact 10-role/25-permission catalog and reference publication controls are tested. Source-list reconciliation, full GEN-116 integration certification, and workflow assignment/completion wiring remain open; see phase-1b.md. Do not mark complete business requirements from these supporting components alone.

Phase 2A/2B update: UC-01 through UC-08 have tested API and requester-screen support for the exact field boundary, required-field and reference validation, requester/owner identity, warning conditions, append-only revisions, case numbering and controlled return edits. The first triage loop covers the five-day working-group task, return/resubmit, triage rejection and UC-24 numbering. Classification, conditional reviews, complete SLA notification behavior and downstream handoff remain open; see phase-2a.md and phase-2b.md.

Phase 2C update: UC-09 and UC-10 have tested API and reviewer-screen support for six justified governed scores, inline anchors, the server-side maximum rule, governed automatic tier bands, immutable version-pinned rounds and officer-verification task creation. The manual Unacceptable and override paths, full template/assignment-rule registration, conditional reviews and tier approval remain open; see phase-2c.md.

Phase 3H/3I update (2026-09-12): periodic review registration/completion and future-version cadence pins, Saudi dates/status, actual-owner tasks, existing-scheduler warning/breach signals and native escalation are implemented locally. Planned channels/local timeline events do not establish external delivery, CloudEvents integration, approved template publication or complete KPI reporting. RM-29/GEN-125 off-cycle reassessment and RM-30 annual comprehensive review remain open. See phase-3h.md and phase-3i.md.

Phase 3J1/3J2 update: seven recognized PRC-05 trigger entry and immutable supersession now lead through fresh assessment/authority to renewed monitoring pinned to the new decision/current cadence. No carry-forward acceptance, reopening of superseded reviews or operational use-case reactivation. Annual comprehensive review remains RM-30/Phase 3K; additional triggers within an active reassessment and complete reporting/release certification remain open. See phase-3j1.md and phase-3j2.md.

Phase 3K/3L/3M update (2026-09-12): the annual register-review loop, additional triggers during an active reassessment and scoped live periodic-review report are implemented together. Annual snapshots are immutable and require complete current register visibility; additional triggers retain completed history but cancel pending tasks and require fresh eight-dimensional scoring. GEN-95/96 projections include complete scoped populations, explicit due-as-of denominators, and no client dates/authority. Annual findings and periodic measures are distinct. These packets do not complete the 21-KPI dashboard, scheduled monthly reporting, source metadata release reconciliation or production certification. See phase-3k.md, phase-3l.md and phase-3m.md. Prior pending notes above are historical.

Phase 3N/3O/3P/3Q update (2026-09-13): approved R_CADENCE display version pins and FD status labels, evidence-backed immutable annual officer handover, scoped filtered SQL review reporting/read-only drilldown and one-per-register closed-Saudi-month immutable capture/archive are implemented locally. Monthly captures use currently eligible source membership and completion state at capture time, not historical month-end reconstruction. Executive detail remains denied; Auditor writes remain denied. These packets do not claim full 21-KPI dashboard, automatic scheduling, production reference approval or release certification. See phase-3n.md through phase-3q.md.

Phase 3R/3S/3T/3U update (2026-09-13): existing-stack bilingual AI dashboard with approved-SDAIA repaired counts/reconciliation, current risk posture/paired residual matrix, current approved-plan treatment measures, adoption-pipeline ratios and explicit 21-KPI definitions is implemented locally. Nineteen live current-scope projections have values; GEN-100/101 cohorts have no fabricated output and remain next work. Actual-owner operational scope, Auditor reads, executive aggregate-only audience subset, sample exclusions, source pairing, null empty denominators and stable filtered summaries are tested. Scheduled daily/month-close snapshots, R_DEPT distribution expansion, source migration and production/load certification remain open. See phase-3r.md through phase-3u.md.

Phase 3V/3W update (2026-09-13): GEN-100 current due assessment dimension completeness and GEN-101 current approved-HIGH Ethics coverage are implemented locally. Mandatory Ethics coverage is separately labelled. All 21 live scoped KPI computations are available, with current source/round/role provenance, null empty denominators and read-only gap views. Historical 3R–3U pending-cohort notes are superseded. Automatic dashboard period snapshots remain open. See phase-3v.md and phase-3w.md.

Phase 3X–4G update (2026-09-13): seven reporting capabilities (immutable observations, daily slots, previous-closed-month slots, archive, comparison, safe CSV export and versioned schedule controls/retry history) plus three library/initiation capabilities (governed proposal/publication, published browsing and scoped idempotent workshop/library risk drafts) implemented locally. Complete isolated clean-install and baseline-upgrade tests pass with all earlier phases; API/Angular builds, AI security and 30 native governance checks pass. No live/production/source publication or deployment. Historical month-end cohorts, exact workbook/control-area import, authority reversal, avoidance/ESCALATE execution and release/Asset360 certification remain separate. See phase-3x-4g-plan.md and phase-3x.md through phase-4g.md.


4H–4V update (2026-09-13): fifteen source-preparation packets implemented; see phase-4h-4v-plan.md. Preview acceptance never implies a target load, source publication, pilot sign-off or production authorization. Original source contradictions and pending wider workflow/Asset 360/release requirements remain explicit.
