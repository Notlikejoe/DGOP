# Phase 3N — Governed cadence and review status presentation

Implemented locally, 2026-09-13, with 3O/3P/3Q. The existing bilingual Angular/PrimeNG review screen now includes a read-only cadence configuration view. Review statuses follow FD §5.6: Upcoming / قادم, Due soon / يستحق قريباً, Overdue / متأخر and Completed / تمت; immutable server status codes remain unchanged.

Display labels require one currently effective published R_CADENCE version with four distinct values. Each approved value supplies residualBandCode and intervalDays metadata that matches the currently published R_LEVEL_DAYS engine policy. The source workbook locator is the risk reference sheet Q5:Q8 (L_CADENCE). No English or Arabic label is inferred from a numeric interval. The four-band engine retains its existing publication and critical-first-review policy gates.

New reviews pin the matching cadence version, code and bilingual labels in addition to their existing engine version. Retiring a display version does not rewrite history; future reviews use the newly approved matching version. Legacy reviews remain unmodified with nullable display pins and a neutral label-not-recorded message. Missing display approval does not silently replace or disable existing approved numeric scheduling.

The additive migration enforces complete-or-empty display pins, matching published metadata and append-only review history. The original workbooks and reference drafts are unchanged. Synthetic matching labels used in isolated tests are not production approval. R_IMPD source-range reconciliation and approved production cadence metadata remain release gates.

Verification: clean-install and baseline-upgrade PostgreSQL/Nest tests exercise missing/mismatched approval, matching pins, retirement/future-version behavior, immutable labels and authorized configuration reads. API/Angular production builds and focused AI security/native governance checks pass. No browser visual acceptance or live publication claimed.
