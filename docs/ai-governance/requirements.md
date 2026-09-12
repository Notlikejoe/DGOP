# Functional requirement implementation ledger

Generated from the supplied FD v1.0 requirement identifiers. Entries identify planned coverage, not implemented or passing tests. Cross-cutting rows will be refined to exact test files when their packet starts. Source documents remain authoritative.

Phase 1A update (2026-09-11): supporting database/module contracts are implemented and tested; see phase-1a.md and apps/api/test/ai-foundation.integration.ts. No entire FD business requirement is marked complete: authorization, public operations and workflow behavior are still pending. “Not implemented” below means the complete requirement is not yet delivered, rather than absence of foundation work.

| Requirement | Planned phase | Proposed verification | Status |
|---|---|---|---|
| BR-01 | 3 | Deterministic rule and negative-input tests | Not implemented |
| BR-02 | 5 | Deterministic rule and negative-input tests | Not implemented |
| BR-03 | 5 | Deterministic rule and negative-input tests | Not implemented |
| BR-04 | 8 | Deterministic rule and negative-input tests | Not implemented |
| BR-05 | 6,8 | Deterministic rule and negative-input tests | Not implemented |
| BR-06 | 8 | Deterministic rule and negative-input tests | Not implemented |
| BR-07 | 6,10 | Deterministic rule and negative-input tests | Not implemented |
| BR-08 | 8 | Deterministic rule and negative-input tests | Not implemented |
| BR-09 | 3 | Deterministic rule and negative-input tests | Not implemented |
| BR-10 | 10 | Deterministic rule and negative-input tests | Not implemented |
| BR-11 | 10 | Deterministic rule and negative-input tests | Not implemented |
| GEN-01 | 1–12 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-02 | 1–12 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-20 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-21 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-22 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-23 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-24 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-25 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-26 | 1,3,6 | AIUC final-decision segregation | Implemented — requester/linked owner excluded from decision queues and blocked at recording; configured tier role, claimed assignee and live permission enforced; generic task assignment/decision bypass blocked |
| GEN-27 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-28 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-29 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Implemented for AIUC Ethics review — Phase 2E; owner recusal is system-blocked and audit-recorded |
| GEN-30 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-31 | 1,3,6 | Evidence-backed authority decisions | Partial — AIUC Executive Team/Steering final decisions require justification, existing evidence and transactional audit; AIRS acceptance and higher-authority reversal remain |
| GEN-71 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-72 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-73 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-74 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-75 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-76 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-77 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-78 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-79 | 1 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-80 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-81 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-82 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-83 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-84 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-85 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-86 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-87 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-88 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-89 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-90 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-91 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-92 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-93 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-94 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-95 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-96 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-97 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-98 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-99 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-100 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-101 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-102 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-103 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-104 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-105 | 10 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-111 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-112 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-113 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-114 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-115 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-116 | 1,3,6 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-121 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-122 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-123 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-124 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-125 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-126 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-127 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-128 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-129 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| GEN-130 | 7,8 | Governed configuration / permissions / reporting; refine at packet entry | Not implemented |
| INT-01 | 1–7 | Platform integration and legacy-case regression | Not implemented |
| INT-02 | 1–7 | Platform integration and legacy-case regression | Not implemented |
| INT-03 | 4 | Identifier-gated pipeline integration | Partial — approved AIUC atomically links the existing AI asset model and one AIRS draft by platform identifiers; operational AIRS stages follow |
| INT-04 | 4 | Platform integration and legacy-case regression | Not implemented |
| INT-05 | 1–7 | Case numbering and request date | Partial — AIUC submission and automatic AIRS spawn reserve unique numbers in the existing annual scheme; Hijri request-date defaults and manual AIRS submission remain |
| INT-06 | 1–7 | Platform integration and legacy-case regression | Partial — AIUC approved/implemented/closed transitions and AIRS draft use existing case states; risk lifecycle/other terminal paths remain |
| MIG-01 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-02 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-03 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-04 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-05 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-06 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-07 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-08 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-09 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-10 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-11 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-12 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-13 | 11 | Import staging, source reconciliation and replay | Not implemented |
| MIG-14 | 11 | Import staging, source reconciliation and replay | Not implemented |
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
| RM-01 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-02 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-03 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-04 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-05 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-06 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-07 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-08 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-09 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-10 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-11 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-12 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-13 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-14 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-15 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-16 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-17 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-18 | 5 | AIRS assessment / decision / operations | Not implemented |
| RM-19 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-20 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-21 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-22 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-23 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-24 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-25 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-26 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-27 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-28 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-29 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-30 | 8 | AIRS assessment / decision / operations | Not implemented |
| RM-31 | 9 | AIRS assessment / decision / operations | Not implemented |
| RM-32 | 9 | AIRS assessment / decision / operations | Not implemented |
| RM-33 | 9 | AIRS assessment / decision / operations | Not implemented |
| RM-34 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-35 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-36 | 6 | AIRS assessment / decision / operations | Not implemented |
| RM-37 | 10 | AIRS assessment / decision / operations | Not implemented |
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
| WF-01 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-02 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-03 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-04 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-05 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-06 | 3,6,8 | Workflow gate and SoD negative tests | Implemented for AIUC — Phase 2E; personal-data Privacy co-signature blocks tier decision until complete |
| WF-07 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-08 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-09 | 3,6,8 | Workflow gate and SoD negative tests | Partial — immutable business identifiers, unique handoff source, asset reference/type and obligation asset integrity guarded; risk/action runtime allocation and library chain follow |
| WF-10 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-11 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |
| WF-12 | 3,6,8 | Workflow gate and SoD negative tests | Not implemented |

Phase 1B backend update: exact 10-role/25-permission catalog and reference publication controls are tested. Source-list reconciliation, full GEN-116 integration certification, and workflow assignment/completion wiring remain open; see phase-1b.md. Do not mark complete business requirements from these supporting components alone.

Phase 2A/2B update: UC-01 through UC-08 have tested API and requester-screen support for the exact field boundary, required-field and reference validation, requester/owner identity, warning conditions, append-only revisions, case numbering and controlled return edits. The first triage loop covers the five-day working-group task, return/resubmit, triage rejection and UC-24 numbering. Classification, conditional reviews, complete SLA notification behavior and downstream handoff remain open; see phase-2a.md and phase-2b.md.

Phase 2C update: UC-09 and UC-10 have tested API and reviewer-screen support for six justified governed scores, inline anchors, the server-side maximum rule, governed automatic tier bands, immutable version-pinned rounds and officer-verification task creation. The manual Unacceptable and override paths, full template/assignment-rule registration, conditional reviews and tier approval remain open; see phase-2c.md.
