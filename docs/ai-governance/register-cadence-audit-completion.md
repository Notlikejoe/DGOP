# Register access, saved cadence cards and native audit presentation — 2026-09-15

Continues from b74ebba within the consolidated completion request. Uses the installed Nest/Prisma/PostgreSQL and Angular/PrimeNG stack and existing DGOP cards. No schema migration or permission grant is introduced.

## Delivered behavior

- The AI intake register honors live eligible own/org/all AIUC grants. Organization/all readers see submitted non-sample native AIUC cases within current organization/domain/classification scope. Other requesters' unsubmitted drafts remain private. Unlinked pipeline records cannot satisfy a restricted asset domain or classification scope. Reads use one repeatable-read snapshot for grants, scope and records.
- Draft creation, revision and submission retain existing purpose checks and actual requester checks. The UI disables editing for other requesters and hides creation from read-only Auditors. Auditor lookup directories include only people referenced by visible cases, rather than the complete creation directory. Existing requester-only service helpers remain compatible.
- The dashboard offers explicit live values or saved cadence values for a selected organization register. Daily cards use compatible daily captures and monthly cards use compatible completed-month captures. Each card shows its capture date/period. Missing observations show unavailable and —. Stale selection responses are discarded, loading clears previous observations, and live drilldowns/distributions/reconciliation are hidden in the saved view. Risk-owner-only mode stays live.
- The protected native audit query is available on AIUC/AIRS workflow case details and linked AI Asset 360 panels. Asset queries combine both native entity populations; empty case identifiers are omitted. Current backend scope and purpose checks remain authoritative. Auditor details display original metadata and stored chain fields; bounded exports remain page-specific. Selected stored links do not prove the whole global chain.
- Native AI workflow task titles use the governed stage's current language, unassigned role tasks show a translated role, task due dates and intake request-date companions show Hijri/Gregorian Saudi dates, and additional AIUC event/status labels are translated. Authored historic comments remain original.

## Evidence

API and Angular production builds pass. `ai-intake-visibility.integration.ts` passes against both existing isolated clean and upgrade databases at test stamp 1789404929675, covering submitted-case visibility, own draft editing, other-draft privacy, requester-only writes, domain/organization/classification restrictions, live grant revocation, Auditor restricted lookups, forged token-role claims and authenticated HTTP reads. It is integrated into the full native history regression for subsequent clean/upgrade runs; the complete prior suite was not rerun solely for these read/UI changes.

Targeted preview browser checks confirm both complete demonstrations in the register with editing disabled; EN/AR saved monthly cards show missing observations without substituting live totals; native AIUC audit loads ten recorded events; combined asset audit loads the linked trail; EN/AR workflow events, governed task titles, role labels and Saudi dual dates render correctly. Preview identity/core business fingerprints and the original stored capture match prior guards; the additional native manual observation is preserved. Original 4205 and AI preview 4206 remain healthy at 62 and 85 migrations respectively.

## Continue from here

Use `completion-cycle.md` and `consolidated-operational-completion.md` for the exact remaining extension gaps. These remain real work: thirteen-event governed notification unification and dispatch behavior; exact tier end-of-life compensation/closure; complete event/IP/old-new/global-chain reconciliation; approved snapshot granularity; full multi-actor/accessibility/reference-label and load acceptance. Actual filled pilot anchors, real organization approval and a concrete release/provider target are still missing. Do not claim whole extension or production acceptance from local tests.
