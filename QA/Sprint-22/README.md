# Sprint 22 - PDP Privacy Operations

## Scope

- Privacy legal bases, RoPA records, DPIAs, DPIA gates, DSR requests, privacy breaches, consent records, and retention rules.
- Automatic workflow case/task creation for DPIAs, DSRs, and privacy breaches.
- Scope-aware privacy reads and writes using the existing role/data-scope model.
- Authenticated Angular workspace at `/governance/privacy`.

## User Stories

- As a privacy officer, I can see open DPIAs, DSRs, breach notifications, RoPA reviews, and retention signals in one operating view.
- As a reviewer, I can update DPIA gate decisions with notes and reviewer assignment.
- As an operator, I can register a DSR or breach and have workflow evidence created automatically.

## Verification

- `npx prisma validate --schema apps/api/prisma/schema.prisma`
- `npx prisma migrate status --schema apps/api/prisma/schema.prisma`
- `npm run db:generate`
- `npm --prefix apps/api run test`
- `npm --prefix apps/api run build`
- `npm --prefix apps/web run build`
- Authenticated smoke checks:
  - `GET /api/privacy/summary`
  - `GET /api/privacy/legal-bases`
  - `GET /api/privacy/dpia?page=1&pageSize=5`
  - `GET /api/privacy/dsr?page=1&pageSize=5`
  - `GET /api/privacy/breaches?page=1&pageSize=5`
  - `GET /api/privacy/ropa?page=1&pageSize=5`

## Notes

- Local route: `http://localhost:4205/governance/privacy`
- The web build passes with existing bundle budget warnings unrelated to Sprint 22.
