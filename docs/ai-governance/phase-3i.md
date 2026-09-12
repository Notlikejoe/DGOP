# Phase 3I — Periodic review warnings and breach escalation

Implemented locally on 2026-09-12 with Phase 3H. Extends DGOP's existing governance-operations scheduler, native notification/delivery-plan records, escalation records, holiday calculations and council ladder. No separate worker, external broker or provider installed.

## Executable behavior

- The existing scheduler invokes AI review signals under its existing scheduler lock. Pending reviews are paged in batches of 100, so later records are not permanently excluded by a fixed first-page limit. The live actual owner, active directory/user, explicit Risk Owner grant, Auditor exclusion and current data scope must still match.
- Warnings occur at 50/80/95% of elapsed Saudi business days within the pinned review window using DGOP's Friday/Saturday weekend and configured/recurring holidays. Breach occurs only at the actual deadline, never early through business-day rounding. A missed sweep catches up crossed thresholds once; an immediate Critical first review produces only the breach signal.
- Each threshold creates bilingual native in-system notification records for the Risk Owner, Working Group and Responsible AI Officer. Native in-app/email delivery attempts are **planned**, carrying AIRS-NTF-04/AIX-NTF-02 identifiers and parameters. No attempt is marked sent/delivered and no email or other external message is dispatched. Approved template catalog/provider dispatch remains an integration/release task.
- Breach creates one native governance escalation with the existing overdue-business-day council ladder, owner-role mapping and penalty calculation. Later sweeps update the same unresolved escalation when its level/penalty changes; acknowledgements are preserved and resolved rows are not reopened. SLA escalation does not grant risk-acceptance authority or implement the separate ESCALATE response strategy.
- Signals, notification identifiers and escalation pointers are immutable. Unique threshold/source dedupe keys and serializable transactions prevent duplicates. Required-audit failure rolls back the corresponding signals, notifications, delivery plans, escalation and native workflow events.
- Native timeline actions `governance.airs.review.due.v1` and `governance.airs.review.overdue.v1` record local domain-event evidence; they are not claimed as Kafka/CloudEvents publication. Completing a review archives its alerts, resolves its native escalation and keeps its signal history while scheduling the next occurrence.
- The existing risk panel shows recorded warning/breach thresholds. The scoped Working Group/Officer can refresh alerts using the existing cadence permission; public callers cannot supply clock, thresholds or actor fields. Generic SLA recalculation excludes these protected periodic-review tasks, preventing a second incompatible alert/escalation stream.

## Verification and limits

API/web builds, 30/30 native governance checks, 89/89 shared workflow checks, AI security/graph contracts and isolated clean/upgrade database/HTTP tests pass. Integration checks include warning catch-up/repeat dedupe, concurrent Critical breach, exact native audience/plan counts, bilingual content, no email sent markers, immutable signal/escalation links, escalation progression, completion archival/resolution and audit rollback.

Complete PRC-05 dashboards/KPIs, due/≤7-day approved notification templates, email/provider delivery, full notification permission certification, off-cycle reassessment/rebasing, annual comprehensive reviews, higher-authority reversal, AVOID closure and the separate ESCALATE strategy remain open. The ledgers are a tested foundation for KPI computation; the full reporting requirements are not marked complete.

Next bounded packet: Phase 3J — evidence-backed PRC-05 off-cycle reassessment triggers, fresh assessment/authority progression and safe replacement/rebasing of outstanding monitoring occurrences. Annual comprehensive review follows separately. Preserve source publication blockers, About DGOP and the isolated-development boundary.
