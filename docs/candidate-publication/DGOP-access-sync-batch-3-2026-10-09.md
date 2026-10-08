# DGOP live permissions — Batch 3 results

9 October 2026, Asia/Dubai. Functional acceptance passed. The isolated preview is running at [localhost:4208](http://localhost:4208). The unchanged original remains running at [localhost:4206](http://localhost:4206). Licensed presentation acceptance remains pending because PrimeUI is unconfigured.

## Results

- Eight account profiles: 69 persona browser checks passed. Only qa.admin has administrator rights. AI-free owners/steward/privacy, own-case requester/auditor, and officer review-panel visibility match their profiles.
- Fourteen live scenarios have validated passing evidence, including native administrator changes, immediate API denials, multiple tabs, rapid updates, stale snapshots/data, account switching, scope changes, drafts, disabled users, RTL/mobile and recovery.
- Observed access-change maximum: 5446 ms (target ≤10,000 ms). Connection cover appeared 10004 ms after the measured verification baseline; its source timer is ten seconds and the runtime observation allows scheduler tolerance. Recovery: 69 ms.
- Three probes in a 16-second visible window, one request in flight, no probes during the controlled hidden interval, and immediate return verification were checked. Actual two-tab return behavior was also exercised. No refresh loop or replayed write was observed.
- Nine database scenario groups passed, covering baseline profiles, grants, scopes, overlapping roles, concurrent snapshots, invalid sessions and absence of permission-denial audit noise from probes.
- Four fresh routed-shell tests and the affected web production build passed. Batch 2 API/session tests, the API production build and unchanged frontend checks remain valid and are reused.
- All automated role/scope/membership/status experiments were restored in the separate test database. No password changes or reseeding occurred.

## One application repair

After a permission change cleared global search, its input could retain focus while the results stayed closed during later typing. A focused regression failed, the input handler was repaired, the regression passed, and the Finance-to-HR browser search journey passed. Only shell.ts and shell.spec.ts changed from Batch 2. No API rebuild, dependency install, migration, full release matrix or soak was run.

## Live scenario evidence

| Scenario | Result | Evidence |
|---|---|---|
| ai_grant_revoke_tabs | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-23-16.506Z-live/receipt.json) (unchanged path reused) |
| edit_revoke_draft | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| scope_lists_details_search_badges | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-29-28.413Z-live/receipt.json) |
| roles_overlap_status_and_membership | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-23-16.506Z-live/receipt.json) (unchanged path reused) |
| disable_session | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| failed_admin_save | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-23-16.506Z-live/receipt.json) (unchanged path reused) |
| rapid_changes_delayed_snapshot | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| connection_cover_recovery_keyboard | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-32-39.014Z-live/receipt.json) |
| polling_singleflight_hidden_return | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| same_browser_admin_editor | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| business_eligibility_independence | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| scope_detail_delayed_response | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| account_switch_delayed_data | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |
| arabic_dark_mobile_live_access | Pass | [Receipt](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence/2026-10-08T21-30-03.325Z-live/receipt.json) |

## Evidence integrity and preservation

The validator checks latest per-persona/per-scenario results, source and lock bindings, node identity, nested timestamps, error observations and restored baselines. Reconstructed Batch 2 source identity proves the exact two-file delta. The three clean earlier live cases and unaffected profile cases are reused with explicit reasons; their old source hashes are retained. Parent failures and diagnostic failures remain failed. No stale passing receipt is substituted for a newer failed case.

Failures caused by the original browser setup, API-rate pacing and the cover timing observation are preserved with diagnoses in the ledger. The measured cover time does not establish the timing of the earlier failed observation. Actual Arabic/dark mobile output was visually inspected: [Screenshot](C:\Users\Youss\Documents\Codex\2026-10-02\github-plugin-github-openai-curated-remote\work/../output/playwright/access-sync-batch3-arabic-dark-mobile.png). The existing license banner is visible.

Original main source, both locks and both build hashes match the preservation baseline. The sealed candidate and prior AI repair were untouched. Health checks confirm database up for dgop_dev on 4206 and dgop_access_sync_qa_20261007 on 4208. Security review stays deferred; this is focused functional acceptance, not full release, production or compliance approval.

## Delivery

- [Private account details and EN/AR walkthrough](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/private/manual-accounts-4208.md). Existing passwords are kept only in the ignored private guide and original credential file.
- [Checkpoint](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/checkpoint.json) and [Evidence ledger](C:/Users/Youss/Documents/Codex/work/dgop-access-sync/evidence-ledger.json).
- Source: 333bab70fa889b2a96c1fd82dcec99ddae0ec98155dabf0b65a64399251febb6
- API lock: 588e3d85a7bb954ada74a836153d896af1aa762309395f03148c21e92ffa7746
- Web lock: a60a51af1244700be47dc0d814de1522ffc30d0cd87ac6816e1ce9ee840c3a04
- API build (unchanged): 9b8bea3a5015baea4c778792db5b9b7110c6b6d70546c9939fb740bfc94175e5
- Web build: 14c4ceb319f7b50c5f8f822ce2b0dc6007f4b9b9ccf08eebaff20edab6dab2b2
- Runtime: pinned Node 24.19.0; profile access-sync-test.

Manual user review at 4208. Keep 4206 unchanged; replacement requires review. No further automatic batch, platform audit, release matrix or soak.
