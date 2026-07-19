# Sprint 17 Test Cases

## Backend

1. `GET /api/open-data-candidates/summary` returns scoped totals and average eligibility.
2. `GET /api/open-data-candidates` filters by status, asset, and search text.
3. `POST /api/open-data-candidates` creates a candidate linked to a visible data asset.
4. `POST /api/open-data-candidates/from-asset/:assetId` registers a candidate from Asset 360.
5. Scoped users cannot create candidates for hidden assets.
6. Duplicate active candidates for the same asset are blocked.
7. Candidate approval/publication is blocked when classification, personal-data, ownership, DQ, or value signals are blocked.
8. Published candidates receive publication and next-review tracking.
9. Candidate writes produce audit log entries.

## Frontend

1. `/governance/open-data` loads candidate KPIs, list, detail panel, and ODIAO review cockpit.
2. Create/edit form validates required asset and bilingual title fields.
3. Candidate lifecycle actions appear only for valid next statuses.
4. Asset 360 shows Open Data readiness for assets with candidates.
5. Asset 360 can register a new candidate when the user has `open_data_candidates.create`.
6. English/Arabic labels switch without raw translation keys.
7. Light and dark modes keep readable contrast and consistent status colors.
8. Narrow viewport stacks filters, queue, detail, and forms without horizontal overflow.
