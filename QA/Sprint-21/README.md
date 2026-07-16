# Sprint 21 - FOI Review, Decision, Disclosure, And Appeals

## Release Note

Sprint 21 completes the FOI lifecycle MVP. FOI officers can record classification/privacy/legal review evidence, exemption basis, decisions, disclosure records, and appeals with workflow links and audit trail coverage.

## User Stories

### US-21-01: Record Review And Exemptions
As a FOI Officer, I want to capture review outcomes and exemption evidence, so that partial or rejected disclosures are defensible.

Acceptance:
- Review records support classification, privacy, legal, owner, and disclosure checks.
- Review records can be completed or blocked with notes/evidence summaries.
- Exemption evidence stores basis code, title, description, and optional classification.

### US-21-02: Record Decision
As a FOI Officer, I want to approve, partially approve, reject, or extend a request with justification, so that the decision is traceable.

Acceptance:
- Decision outcome updates request status.
- Decision summary, justification, template, decision date, and actor are stored.
- Extended requests store a new due date.
- Decision actions write audit records.

### US-21-03: Disclose Or Appeal
As a FOI Officer, I want to record response disclosure and create appeals, so that the request remains audit-ready after decision.

Acceptance:
- Approved/partially approved requests can record disclosure method, recipient, URL, and summary.
- Disclosure closes the linked workflow case.
- Appeals generate appeal numbers and independent workflow cases.

## Test Cases

| ID | Test | Steps | Expected Result |
| --- | --- | --- | --- |
| TC-21-01 | Save review evidence | Select a request, choose review type, add evidence summary, save. | Review status updates and appears in the review path. |
| TC-21-02 | Add exemption | Add a basis code and evidence title. | Exemption appears on the decision file. |
| TC-21-03 | Record decision | Enter summary and justification, choose an outcome, save. | Request status changes to the outcome. |
| TC-21-04 | Record disclosure | Approve/partially approve a request, then record disclosure. | Disclosure appears and request becomes disclosed. |
| TC-21-05 | Create appeal | Add appeal reason on any request. | Appeal number and workflow case are created. |

## Verification

- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
