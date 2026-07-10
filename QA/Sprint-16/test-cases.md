# Sprint 16 Test Cases

## TC-16-01 Dashboard Release Health

Linked story: US-16-01  
Preconditions: API and web are running; admin can log in.  
Steps:
1. Log in as `admin@dgop.local`.
2. Open `/dashboard`.
3. Review governance, NDI, training, data quality, and workflow sections.
4. Toggle light/dark and English/Arabic.
Expected result: dashboard loads without errors, metrics are readable, theme/language are consistent, and no content overlaps.

## TC-16-02 Evidence Upload And Review

Linked story: US-16-02  
Preconditions: an NDI specification exists and a user has evidence permissions.  
Steps:
1. Open an NDI specification.
2. Upload an allowed file.
3. Submit it for review.
4. Review as a different authorized user.
5. Download the reviewed evidence.
Expected result: the file hash, status, reviewer, expiry state, and audit events are recorded; submitter cannot approve their own evidence.

## TC-16-03 Evidence Direct-ID Access

Linked story: US-16-02  
Preconditions: two users exist where one is not the submitter, reviewer, owner, admin, or auditor for the evidence.  
Steps:
1. Capture an evidence metadata URL and file URL as an authorized user.
2. Try the same URLs with the unauthorized user token.
Expected result: API returns not found/forbidden behavior and does not expose file metadata or file contents.

## TC-16-04 Data Quality CSV Import

Linked story: US-16-03  
Preconditions: data quality steward can access `/governance/data-quality`.  
Steps:
1. Import a CSV with multiple valid rows.
2. Import another CSV with a hidden or unknown asset code.
3. Review created issues and import errors.
Expected result: valid rows become database issues, invalid rows are reported, hidden asset codes are not distinguished from unavailable assets, and audit logs record the import.

## TC-16-05 Data Quality Remediation

Linked story: US-16-03  
Preconditions: an open data quality issue exists.  
Steps:
1. Open the issue queue.
2. Add RCA notes.
3. Close with a resolution summary.
4. Open the linked workflow case.
Expected result: issue status, evidence/history, workflow task, and audit log update consistently.

## TC-16-06 Security Review Workflow

Linked story: US-16-04  
Preconditions: security reviewer has visible assets.  
Steps:
1. Create a DLP incident for a visible asset.
2. Create a classification change request.
3. Open workflow inbox.
Expected result: both records are scoped, linked to workflow cases, and visible in review queues.

## TC-16-07 Role-Data Mapping Duplicate Guard

Linked story: US-16-04  
Preconditions: role-data mapping permission is available.  
Steps:
1. Create a role-data access map for a role/domain/classification scope.
2. Create the same active mapping again.
Expected result: the existing mapping is updated or the duplicate active row is blocked; no duplicate active role/scope access exists.

## TC-16-08 Training Readiness

Linked story: US-16-05  
Preconditions: training data is seeded.  
Steps:
1. Open `/governance/training`.
2. Sync role assignments.
3. Complete one assignment.
4. Review certification and CE sections.
Expected result: readiness metrics update and renewal/completion status remains clear.

## TC-16-09 Integration CSV Sync

Linked story: US-16-01  
Preconditions: user has integration run permission.  
Steps:
1. Open `/admin/integrations`.
2. Preview a catalog CSV.
3. Run catalog sync.
4. Review batch history and error rows.
Expected result: created/updated/unchanged/error counts are shown, failed rows are inspectable, and asset sync status updates.

## TC-16-10 Release 2 UI Consistency

Linked story: US-16-06  
Preconditions: browser is logged in.  
Steps:
1. Visit `/dashboard`, `/governance/training`, `/governance/data-quality`, `/governance/security`, `/admin/integrations`, `/governance/ndi-readiness`, and an NDI evidence screen.
2. Test desktop and narrow/mobile widths.
3. Toggle language and theme.
Expected result: no clipped text, no horizontal overflow, keyboard focus is visible, status is not color-only, and major actions are easy to identify.
