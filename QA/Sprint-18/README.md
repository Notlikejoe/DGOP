# Sprint 18 - Open Data Assessment And Approval Workflow

## Release Note

Sprint 18 adds a governed Open Data assessment and approval workflow. Candidates now keep assessment answers, readiness and risk scores, approval decisions, and an ODIAO workflow task link before publication can proceed.

## User Stories

### US-18-01: Complete Open Data Readiness Assessment
As an ODIAO reviewer, I want to complete a publication readiness checklist, so that privacy, legal, quality, metadata, aggregation, and anonymization checks are traceable.

Acceptance:
- The reviewer can save a draft assessment.
- Completing the assessment records readiness and risk scores.
- Completed assessments create required approval tasks.
- Assessment writes are audited.

### US-18-02: Approve Open Data Publication
As an approver, I want to record owner, steward, privacy, legal, quality, and ODIAO approval decisions, so that public release has accountable sign-off.

Acceptance:
- Required approvals are visible on the candidate detail screen.
- Pending approvals can be approved or sent back for changes.
- Final ODIAO approval creates or links a workflow task.
- The candidate cannot become approved while required approvals are missing or pending.

### US-18-03: Block Unsafe Publication
As a governance lead, I want unsafe Open Data candidates blocked, so that restricted or incomplete datasets cannot be published.

Acceptance:
- Non-public classification blocks readiness.
- Restricted information blocks readiness.
- Personal-data candidates require aggregation and anonymization.
- DQ, metadata, privacy, and legal checks are required before publication.

## Test Cases

| ID | Test | Steps | Expected Result |
| --- | --- | --- | --- |
| TC-18-01 | Save assessment draft | Open `/governance/open-data`, select a candidate, change checklist values, save assessment. | Assessment saves and candidate remains editable. |
| TC-18-02 | Complete assessment | Complete all readiness checks and click complete. | Required approval rows appear and an ODIAO workflow-linked task is created. |
| TC-18-03 | Approval gate | Try to approve/publish before all approvals are approved. | API rejects the action with an approval/readiness message. |
| TC-18-04 | Segregation of duties | Submitter attempts final ODIAO approval. | API rejects final approval. |
| TC-18-05 | Scope enforcement | Scoped user attempts to assess hidden asset candidate. | Candidate is hidden/not found. |

## Verification

- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
