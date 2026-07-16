# Sprint 19 - Open Data Publication, Review, And Usage Monitoring

## Release Note

Sprint 19 completes the Open Data lifecycle MVP. Approved candidates can now be published through a simulated portal sync, reviewed periodically, retired or sent back for update, and measured with downloads/API usage metrics.

## User Stories

### US-19-01: Publish Approved Candidate
As an ODIAO reviewer, I want to simulate portal publication only after approvals pass, so that public release is controlled and auditable.

Acceptance:
- Only approved candidates can be published.
- Publication creates a publication record.
- Portal record ID, portal URL, publish date, sync status, and next review date are stored.
- Candidate status moves to Published.

### US-19-02: Review Published Dataset
As an ODIAO reviewer, I want to record periodic review decisions, so that published datasets stay current and governed.

Acceptance:
- Published candidates can receive review records.
- Review decisions support continue, update required, reassess, or retire.
- Review due dates remain visible.
- Update/reassess decisions move the candidate back to review.

### US-19-03: Monitor Usage Value
As a governance leader, I want usage metrics for published datasets, so that Open Data value can be measured.

Acceptance:
- Downloads, API calls, unique users, source, and date can be recorded.
- Usage totals appear in the Open Data KPI strip.
- Usage records are scoped and audited.

## Test Cases

| ID | Test | Steps | Expected Result |
| --- | --- | --- | --- |
| TC-19-01 | Simulate publication | Approve all required approvals, then publish candidate. | Publication record is created and candidate becomes Published. |
| TC-19-02 | Block direct publication | Attempt old status-based publication before assessment/approval gates pass. | API rejects the action. |
| TC-19-03 | Record periodic review | Select a published candidate, choose continue/update/retire, record review. | Review appears in candidate lifecycle and status updates correctly. |
| TC-19-04 | Record usage | Enter downloads/API calls/unique users and save. | Usage metric is saved and totals update. |
| TC-19-05 | Responsive and bilingual UI | Check page in English/Arabic and narrow width. | No clipped text, missing keys, or horizontal overflow. |

## Verification

- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
