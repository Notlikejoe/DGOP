# Sprint 17 - Open Data Candidate Registry

## Scope

Sprint 17 adds the Open Data Management Center foundation. It lets authorized users register governed data assets as Open Data candidates, review publication eligibility signals, assign owner/steward/ODIAO reviewer accountability, and track lifecycle status through assessment, review, approval, publication, rejection, or retirement.

## Delivered

- Open Data candidate Prisma model, enums, migration, and seed records.
- Scoped Open Data APIs under `/api/open-data-candidates`.
- Candidate eligibility signals for classification, DQ readiness, personal data, ownership, and publication value.
- Candidate lifecycle transitions with blockers before approval/publication.
- Open Data candidate registry UI under `/governance/open-data`.
- Asset 360 Open Data readiness card with one-click candidate registration.
- Seeded Open Data permissions for `od_officer`, data owners, enterprise stewards, auditors, and admins.

## Verification

- Focused Open Data service tests.
- Full API test suite.
- API build.
- Web build.
- Prisma validate, migration status, and seed run.
