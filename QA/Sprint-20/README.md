# Sprint 20 - FOI Request Registry And Intake

## Release Note

Sprint 20 adds the FOI Management Center foundation. FOI officers can register requests from web, email, CRM, call center, or manual channels, validate requester/contact details, calculate due dates, and place requests into a governed workflow queue.

## User Stories

### US-20-01: Register FOI Request
As a FOI Officer, I want to register an information request with requester, channel, category, subject, and description, so that every intake path enters one controlled registry.

Acceptance:
- Request number is generated automatically.
- Requester type, request channel, category, received date, due date, assigned officer, and status are stored.
- Identity and contact validation flags are captured.
- Request can link to a governed data asset.

### US-20-02: Track SLA
As a FOI Officer, I want a clear SLA countdown, so that urgent and overdue requests are visible without reading technical fields.

Acceptance:
- Due date is calculated with a KSA business-day placeholder.
- Queue rows show on-track, due-soon, overdue, or closed status with text and color.
- Summary metrics show open, due-soon, and overdue requests.

### US-20-03: Create Workflow
As a governance lead, I want each FOI request to create a workflow case and task, so that intake work appears in the platform operating model.

Acceptance:
- Request creation links a workflow case.
- Starter review records are created.
- Create/update actions are audited.

## Test Cases

| ID | Test | Steps | Expected Result |
| --- | --- | --- | --- |
| TC-20-01 | Manual intake | Open `/governance/foi`, create a new request, complete required fields, save. | Request number is generated and request appears in the queue. |
| TC-20-02 | SLA display | Review seeded/new requests with different due dates. | Rows show due date, days remaining, and text status. |
| TC-20-03 | Workflow creation | Create a request and open Workflow Inbox/search. | Linked FOI workflow case/task exists. |
| TC-20-04 | Search and filters | Search by request number, subject, requester, and channel. | Matching records are returned only. |
| TC-20-05 | Responsive and bilingual UI | Check page in English/Arabic and narrow width. | No clipped text, missing keys, or horizontal overflow. |

## Verification

- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
