# DGOP automatic access updates — Batch 2 checkpoint

Batch 2 implementation and focused checks are complete in the isolated repair copy. Eight-account browser acceptance and the 4208 preview are pending Batch 3. No release-readiness claim is made.

## Delivered behavior

- Navigation, tool cards/counts, quick links, search entries, route access and affected actions read the current access snapshot. AI tools use native server capability eligibility. Administrator oversight and existing independent business-decision checks are preserved.
- An access revision clears page state and recreates the authorized page. Revoked pages disappear and return to About; a visible bilingual notice explains discarded edits. Old scoped GETs are cancelled and late responses cannot restore removed records or actions.
- Superseded login requests are cancelled. Writes require verified current access; old write results are ignored and writes are never automatically replayed. Successful user/role saves refresh access; failed saves do not.
- After ten seconds without access verification, an opaque connection cover hides protected content and blocks writes. The background is inert, focus stays on the cover, and recovery restores the same page when access is unchanged. Invalid sessions return to sign-in.
- Ownership avoids unauthorized user-directory/reference calls. Authorized lists remain usable when optional lookups fail; dependent forms explain why they are disabled.
- AI review requests only eligible panels. Officers no longer request the registrar queue without native eligibility. Optional reference failures remain separate from permitted queue failures, which produce an error instead of a false empty queue.
- English/Arabic messages and logical layout styles are included. Actual RTL, theme, mobile and keyboard presentation acceptance remains in Batch 3.

## Fresh verification

| Check | Result | Evidence |
|---|---|---|
| Six focused frontend files | 36/36 passed | [UI receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-07T16-42-29.051Z-ui/receipt.json) |
| Authentication and capability projection | 12/12 auth tests plus capability assertions passed | [API receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-07T16-46-19.567Z-auth/receipt.json) |
| API production build | Passed | [API build](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-07T16-46-51.969Z-apiBuild/receipt.json) |
| Web production build and templates | Passed; initial bundle 611.30 kB | [Web build](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-07T16-47-36.539Z-webBuild/receipt.json) |

The tests exercise actual Angular route recreation with stale reads and drafts, polling/timeouts, cancellation, access removal, write blocking, focus containment, optional references and AI panel eligibility. Mocked component/session fixtures are functional evidence; they do not replace timed browser or database-backed acceptance.

Receipt sources, both locks, pinned Node, nested timestamps, exit codes and newly written build outputs were validated against the frozen candidate. Earlier failed receipts remain on disk and in the ledger. No passing result was inherited over a newer failure. The existing Access Management stylesheet produces a 43.44 kB warning against its 42 kB warning budget (45 kB error budget); that stylesheet is unchanged.

## Preservation and blockers

- Original branch remains main. Original source, both lockfiles and both build hashes exactly match the baseline. Original users, passwords and shared grants were not changed. No installation, migration, reseed or dependency upgrade occurred in this batch.
- At Batch 2 preflight, localhost:4206 and the local database at 127.0.0.1:55436 were unavailable. Original runtime health is not claimed. No guessed database cluster was started or unrelated process stopped.
- Database-backed Batch 1 receipts are retained as historical evidence; they are not relabeled as acceptance of changed Batch 2 code.
- PrimeUI license is still unconfigured; licensed presentation acceptance remains separate. Security review remains deferred.
- The sealed candidate and previous AI repair were not edited. Preview 4208 has not started.

## Frozen identity

- Source SHA256: 89e0d5ac24f31214295976d09e54ecca8b21cb365ff4fb030eed233a1b62b06a (1482 files).
- API lock SHA256: 588e3d85a7bb954ada74a836153d896af1aa762309395f03148c21e92ffa7746
- Web lock SHA256: a60a51af1244700be47dc0d814de1522ffc30d0cd87ac6816e1ce9ee840c3a04
- API build SHA256: 9b8bea3a5015baea4c778792db5b9b7110c6b6d70546c9939fb740bfc94175e5
- Web build SHA256: 3c6625f57055ecaff203b0940f3cfab0496c47ea4a7cc19c45e185ff4e8dcb04
- Node: 24.19.0
- Profile: access-sync-test; database: 127.0.0.1:55436/dgop_access_sync_qa_20261007.
- [Checkpoint](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/checkpoint.json); [Evidence ledger](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence-ledger.json). The ledger lists 33 files changed in Batch 2 and 38 cumulative application/test files. Credential and configuration references are stored there; no passwords are copied into evidence.

## Next action

Batch 3 only: recover the verified local runtime/database without changing original files or shared grants; preflight the isolated access-sync-test database, eight existing persona credentials, ports and license; run timed eight-account acceptance, scope/role/disabled-user and API enforcement checks, multiple tabs/account switching/delayed-response/recovery checks, EN/AR/RTL/themes/mobile/keyboard checks and polling counts; restore isolated baselines, then present preview at 4208. No reseed, upgrade, full release matrix or soak.
