# DGOP automatic access updates — Batch 1 checkpoint

Completed Batch 1 only. Original main and app at http://localhost:4206 remain unchanged and healthy. The updated preview at 4208 has not started.

Session/login/me responses now include a deterministic accessRevision and AI capabilities, read together with active roles, grants, scopes and classification limits in a RepeatableRead transaction. Existing response fields, cookies and native business rules are preserved. Snapshot reads do not invoke permission-denial auditing. Database failures remain service errors rather than false session expiry.

The browser checks visible sessions every five seconds, with one request in flight and a three-second refresh timeout. It checks immediately on tab return, focus, connection recovery and successful local user/role saves. Session generations and cancellation reject superseded responses. Unchanged access does not increment the page-reset generation. A stale-access status is exposed after ten seconds without verification; Batch 2 will connect it to the protected-content cover and write blocking.

## Verification

- Auth tests: 12/12; access: 14/14; scope: 11/11.
- New capability/revision and database-failure assertions passed.
- Frontend auth/refresh/interceptor: 18/18.
- Nine database scenario groups passed, including all eight profiles, current-cookie grant/revoke, organization/domain/classification changes, role membership/status and overlapping grants, concurrent snapshots, disabled users, and audit-noise checks. Isolated permissions and memberships restored.
- API build and complete frontend application TypeScript check passed. Production frontend build and browser acceptance remain in later batches.

Failed receipts are preserved in the ledger; they were not relabeled as passing. Access/scope subchecks are reused because their inputs did not change. The frontend pass remains valid after later backend-only changes. Windows copy and bundler problems and corrected test fixtures are documented in the ledger.

## Identity and isolation

- Source SHA256: a5cb024e481fc9f4abb9d4c6ede0a4e5d3e5fd2c4e24f3a2d822723f75b89cd8
- API lock SHA256: 588e3d85a7bb954ada74a836153d896af1aa762309395f03148c21e92ffa7746
- Web lock SHA256: a60a51af1244700be47dc0d814de1522ffc30d0cd87ac6816e1ce9ee840c3a04
- API build SHA256: 6134be27526bcf822c8d0a04189b051f0d045a31a068b65cf9db734aa1e89a97
- Node: 24.19.0
- Database: 127.0.0.1:55436/dgop_access_sync_qa_20261007; profile access-sync-test.
- Independent source/dependencies/builds: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/source
- Source copy omits original runtime logs, environment secrets, license secret, storage and builds. Application source was byte-verified before implementation.
- Credential reference only: C:/Users/Youss/Documents/Codex/work/dgop-manual-access-20261007/private/credentials.json
- Checkpoint: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/checkpoint.json
- Evidence ledger: C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence-ledger.json

## Next batch

Batch 2: reactive visibility across navigation/cards/search/actions; page reset and discarded-edit notices; stale-request protection; optional lookup gating; connection cover; affected UI tests/builds. Batch 3 remains timed eight-account/browser acceptance and preview on 4208.

The full automatic UI behavior is not yet delivered. PrimeUI licensing, broad security review, full release acceptance and soaks remain outside this batch. No branch change, migration, reseed, shared-grant change or password change occurred in the original app.
