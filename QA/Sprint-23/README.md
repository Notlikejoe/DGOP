# Sprint 23 - Data Sharing And Integration Governance

## Scope

- Data sharing requests, approval reviews, agreements, agreement renewal signals, and usage metrics.
- Automatic workflow case/task creation for new data sharing requests.
- Risk scoring based on classification, consent, cross-border transfer, legal basis, and masking controls.
- Authenticated Angular workspace at `/governance/data-sharing`.

## User Stories

- As a data sharing officer, I can register a sharing request and see required controls before approval.
- As a reviewer, I can record owner, privacy, security, and technical review decisions.
- As an agreement owner, I can create an agreement from an approved request and monitor renewal/usage signals.

## Verification

- `npx prisma validate --schema apps/api/prisma/schema.prisma`
- `npx prisma migrate status --schema apps/api/prisma/schema.prisma`
- `npm run db:generate`
- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
- Authenticated smoke checks:
  - `GET /api/data-sharing/summary`
  - `GET /api/data-sharing/requests?page=1&pageSize=5`
  - `GET /api/data-sharing/agreements?page=1&pageSize=5`

## Notes

- Local route: `http://localhost:4205/governance/data-sharing`
- The web build passes with existing bundle budget warnings unrelated to Sprint 23.
