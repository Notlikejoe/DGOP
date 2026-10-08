# DGOP current localhost release decision

Evaluated: 2026-10-05T00:45:33.802+04:00 (Asia/Dubai).

**NO-GO for the licensed presentation. Engineering verification passed.** A genuine PrimeUI key is absent and the port-4207 presentation profile is uninstalled. Security remains deferred as requested. Remaining operational business-integrity issues and exact coverage limits are documented in the accompanying A–J review.

| Gate | Current result |
|---|---|
| Complete API tests / production build | PASS |
| Frontend tests / production build | PASS — 24 tests, 6 files |
| Static QA / tooling / Prisma validation | PASS — 565 route contracts; 13 demo-tooling tests |
| Independent clean lockfile installations and builds | PASS — isolated API client and dependencies |
| Dependency audits | PASS — API 0; web 0 advisories |
| Clean and upgrade database suites / schema drift | PASS — both complete suites; empty drift |
| Interrupted installation recovery / setup replay | PASS — preserved accounts, credentials and native identities |
| Three start/check/stop cycles / all persona logins | PASS — 3 cycles, 22 personas |
| Ten fresh native governance repetitions | PASS — 10 separate databases with native writes and replay |
| Fresh database/file restore and application smoke | PASS — exact fingerprints, audit chain and retained bytes; all persona logins |
| 105-record registers and actual requester/reviewer UI writes | PASS — browser discovery beyond 100, draft/save and independent triage |
| Complete role/layout browser matrix | FUNCTIONAL PASS — 22 personas, 1582 checks; genuine license failure retained |
| 60-minute engineering availability soak | PASS — 116 health samples, 232 authenticated reads, 0 failures; read p95 51.99 ms |
| Navigation reference budget | PASS — role p95 range 726–1418 ms, target ≤3000 ms |
| Bilingual PDF / complete CSV | PASS — 51 rows, 8 pages; independent readers and visual check |
| Genuine license / port-4207 presentation | BLOCKED — key absent, presentation profile uninstalled |
| Security-specific repair work | DEFERRED by user |

- Source SHA-256: `bd3e69624736fc40a502115db100a2aeb0d0c3ec3dfd258954ef807aa8d9f126` (982 files; 228 changed/additive files).
- API lock SHA-256: `abb33f687286d976f11fe780d59341b001787b6ba860acb923cdb54f8b85a648`.
- Web lock SHA-256: `95b739987410827df5aaacbe1a4b1314de223fbfe5ccdab50813ec94555c7e1d`.
- API build SHA-256: `c1fa39c151720709d29163f83c90537fe382da502ab57c71fbb49636f0eeb8bd`.
- Web build SHA-256: `b0e9d47512feb0e7255dc19d66bfbf147bad877028f1e7d076b68409df0c6291`.
- Node 24.19.0 / npm 11.13.0; Chrome 154.0.8037.58.
- Delivery patch SHA-256: `11c8d624346ace9427e84f1952212241ac1c1c040a148872cc05204646f16f6f`.
- Current results and logs are retained in the delivery verification folder. Historical failure diagnostics explicitly retain their old source binding and cannot satisfy current gates.

The original app remains available at http://localhost:4206. Its main checkout was preserved. Use the EN/AR operator guide for the explicit candidate profile; engineering credentials are not presentation login details. No real external delivery/provisioning or compliance acceptance was performed.
