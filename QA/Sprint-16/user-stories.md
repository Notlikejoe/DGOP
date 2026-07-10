# Sprint 16 User Stories

## US-16-01 Release 2 Connected Demo

As a DMO administrator, I want to demonstrate the Release 2 flow from catalog sync to dashboard readiness, so that stakeholders can see operational governance working end to end.

Acceptance criteria:
- Catalog sync can load governed assets or flag bad rows.
- Dashboard readiness reflects assets, evidence, data quality, training, and security signals.
- Audit logs show important release actions.

## US-16-02 Evidence Access Hardening

As a compliance evidence owner, I want evidence files limited to authorized users, so that uploaded proof is not exposed outside its owner, submitter, reviewer, or auditor context.

Acceptance criteria:
- Unauthorized users cannot fetch evidence metadata or files by guessing IDs.
- Admins and auditors can review evidence for UAT.
- Evidence upload, submit, review, revoke, delete, and download remain audited.

## US-16-03 Data Quality UAT

As a data quality steward, I want to import, triage, remediate, and close quality issues, so that governance actions move through workflow and leave evidence.

Acceptance criteria:
- CSV import creates valid issues and reports row errors.
- Issues are scoped to visible assets.
- RCA and closure create history and audit records.
- Rule lifecycle and profiling summaries remain explainable.

## US-16-04 Security Review UAT

As a security reviewer, I want DLP incidents, classification requests, role-data mappings, and access-review decisions to respect scope, so that sensitive actions cannot bypass authorization.

Acceptance criteria:
- Out-of-scope security writes are rejected.
- DLP incidents and classification requests create workflow cases.
- Duplicate active role-data mappings are prevented.
- Access-review explanations show the relevant role, asset, classification, and decision.

## US-16-05 Awareness And Training UAT

As a stewardship lead, I want certification, renewal warnings, community knowledge, and mentorship activity visible, so that readiness is measurable before go-live.

Acceptance criteria:
- Training assignments can be synced and completed.
- Certification progress and renewal risk are visible.
- Community articles, experts, and mentorships are searchable enough for UAT.

## US-16-06 Release 2 UI Consistency

As a senior stakeholder, I want Release 2 screens to share one consistent product language, so that the platform feels trustworthy and usable for nontechnical teams.

Acceptance criteria:
- Light/dark mode and Arabic/English layout remain consistent.
- Status uses text plus color.
- Desktop and mobile layouts avoid clipped text and horizontal overflow.
- Screens expose next actions without raw technical overload.
