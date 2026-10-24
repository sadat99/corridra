# UX10X coverage reconciliation, 15 October 2026

**Document status: HISTORICAL.** The UX10X programme was merged (UX-01 to UX-05 and bounded UX-06). This is a dated record, not a to-do list. See the [plan status register](../../PLAN_STATUS.md).

Dated verification record for `main` at `bbb7d71`. It answers one question: what do the existing UX ledgers still leave unverified, and what does an executed run show today? It does not replace the UX-06 ledger (`docs/ux10x/ux06/coverage.json`), which is retained unchanged. Nothing here certifies functional preservation, and no real customer operation, provider, outreach, payment or payout was touched.

## Result in one table

| Question                                                                            | Answer from this run                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the UX-06 ledger current?                                                        | No. It was generated at `ebb992c`. Current `main` has 45 routes (ledger 43), 807 source controls (ledger 773), 70 endpoint entries (ledger 69) and 235 test declarations (ledger 222). Missing routes: `/operator/forgot-password`, `/operator/reset-password`. Detail: `ledger-drift.json`. |
| Do the existing gates still pass?                                                   | Yes, apart from one Docker-only test. See "Checks run".                                                                                                                                                                                                                                      |
| How many controls does a passing browser test actually touch?                       | 310 of 807 (38 percent) were clicked, typed into, changed or submitted. 307 more were displayed only. 190 were never displayed by any suite.                                                                                                                                                 |
| Are customer sign-up, sign-in and the account page exercised by a real rendered UI? | No. Zero of 39 controls in that area were interacted with. 33 were never rendered by any suite here.                                                                                                                                                                                         |
| Public and unauthenticated states at all six required widths?                       | Clean. 36 routes at 1440, 1280, 768, 390, 360 and 320: 216 checks, 0 axe violations (WCAG 2.2 AA tag set), 0 horizontal overflow, 0 non-GET requests.                                                                                                                                        |
| Does the UI match the Fusion reference?                                             | Home page: close. Participant mission view: structurally different. See "Visual comparison".                                                                                                                                                                                                 |

## Checks run

Environment: Node 24.19.0, pnpm 11.19.0, PostgreSQL 16.15 started locally on loopback (the repo's Docker daemon is unavailable here), ClamAV 1.5.4 with one local EICAR test signature (public signature download is blocked here), Chromium 1194 from the preinstalled browser path.

| Gate                                                    | Result                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `lint`, `typecheck`                | pass                                                                                                                                                                                                                                                                                      |
| `pnpm test` (13 document tests, 7 infrastructure tests) | pass                                                                                                                                                                                                                                                                                      |
| `pnpm test:integration`                                 | 203 of 204 pass, 25 files. Failure: `non-production backup restores evidence and retains runtime denial rules`. It shells out to `docker exec corridra-part03-postgres pg_dump`, so it cannot run without Docker. Environment limit, not a product finding. It was not run any other way. |
| `pnpm build`                                            | pass                                                                                                                                                                                                                                                                                      |
| `pnpm test:e2e` (public browser)                        | 80 of 80 pass, also with the recorder in front                                                                                                                                                                                                                                            |
| `pnpm test:operator` (protected browser)                | 14 of 14 pass, also with the recorder in front                                                                                                                                                                                                                                            |

Not run: CodeQL and the other CI-only security jobs, hosted Neon Auth, a real mail delivery, the pinned Postgres image (this run used Ubuntu's 16.15), the full ClamAV signature set. Counts differ from the older evidence files (199 integration, 78 public, 13 operator) because later PRs added tests.

## What the controls table means

Method: the unchanged public and protected suites ran behind a passive recorder (`scripts/ux10x-runtime-coverage/`). It injects one inline script that notes the identity of every control a page displays and every control a test touches, using same-origin GET beacons so the suites' own "no writes" assertions still hold. The notes are linked to the static control inventory by observable identity: name, aria-label, link target, visible text, wrapper label, placeholder, first option, maxlength. The linking is heuristic. Generated and mapped controls can be under-matched, so every "never rendered" figure is an upper bound. Three runs of the collector gave 190 to 194 never-rendered rows, because the display census is timing based. The tables below use the last run.

| Product area                                      | Controls | Interacted | Displayed only | Never rendered |
| ------------------------------------------------- | -------: | ---------: | -------------: | -------------: |
| Operator workspace panels                         |      542 |        245 |            203 |             94 |
| Public discovery, navigation, workspace directory |       98 |         21 |             62 |             15 |
| Staff access, recovery and errors                 |       46 |          8 |             17 |             21 |
| Customer identity and account                     |       39 |          0 |              6 |             33 |
| Scoped buyer, client, programme                   |       33 |         16 |              8 |              9 |
| Contributor                                       |       26 |         10 |              6 |             10 |
| Brief intake                                      |       23 |         10 |              5 |              8 |
| Total                                             |      807 |        310 |            307 |            190 |

"Interacted" says a passing test touched the control. It does not say the allowed and denied outcomes were both asserted, so none of these rows can be promoted to `VERIFIED` by this record alone. The ledger rules still require positive and negative tests per consequential action.

## Concrete gaps this run found

1. **Customer identity UI is never exercised.** `components/account-form.tsx` (12 controls), `app/account/page.tsx` (10), `app/account/customer-missions.tsx` (4) and the verified-email, reset and signed-in states have no rendered coverage. This matches the documented "hosted identity lifecycle" limit and the `PARTIAL` static account fixture. The sign-in form was not rendered at all, so there is no browser evidence for signup, verification, sign-in, invitation redemption or sign-out through the real forms.
2. **Staff invitation acceptance form is almost never rendered.** In `app/operator/setup/setup-form.tsx` only the invitation re-check button was touched; the password fields, confirmation and submit (5 controls) were not displayed. The invitation is covered by integration tests and the guidance page. The MFA enrolment journey starts from the sign-in form, not from this form.
3. **Operator error and recovery screens** (`operator/error.tsx`, `operator/recovery-form.tsx`, `operator/page.tsx`): 21 staff-access controls were not rendered. On `operator/error.tsx` the retry link and the operator sign-in exit were not observed. The startup-outage test passes, but it starts its own server on port 3300 and drives the contributor error screen (`contributor/error.tsx`, including its retry link), so the recorder did not see it. The operator error boundary itself has no recorded browser exercise. In `operator/recovery-form.tsx` 4 controls were displayed and 4 were not; the visible form was not submitted through the recorded UI path, only by the API-level reset tests.
4. **Contributor entry page**: the signed-out and error states (`contributor/page.tsx`, 6 controls) are not rendered. The task board is partly covered (10 of 26 contributor controls interacted).
5. **Operator panels with the largest unseen counts:** `commercial-mission.tsx` (15 of 33, includes forms generated by shared field helpers that the matcher cannot always identify), `delivery-experience.tsx` (12 of 47), `workspace.tsx` (11 of 52), `network.tsx` (10 of 46), `counterparties.tsx` (10 of 54), `delivery.tsx` (8 of 65), `opportunities.tsx` (7 of 55), `access.tsx` (6 of 68). The full row list is in `runtime-coverage.json`.
6. **Membership management** (PR 46): the owner form is new since the ledger. The form renders and the role select was changed, but the revoke checkbox and the Update membership button were only displayed, never activated. The integration suite covers the server rules; no recorded browser test submits this form.
7. **Ledger drift**: 60 controls appear by content that were not in the ledger, 26 disappeared or were reworded, and the two staff recovery routes are absent. The inventory can be regenerated for a new phase directory with `scripts/ux10x-inventory.mjs`. Regenerating the existing ledger in place was deliberately not done.

Items the ledger lists as unexpanded and this run did not close: role by response-state combinations, dynamic action menus and repeated records, hosted identity and email lifecycle, measured performance. Axe and overflow are now measured for unauthenticated states only. Authenticated screens rely on the 16 axe assertions already inside `tests/operator/workspace.spec.ts` and the evidence helpers, which pass.

## Visual comparison with Fusion 01

Compared against `desktop-discover.png`, the contact sheet and the repo's current captures (`docs/ux10x/ux06/evidence/after/participant/`, dated to PR 44).

| Fusion screen        | Current surface                                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover             | `/` at 1440                                      | Close. Same three-line headline, forest Atlas card, direction caption and gold accents. Differences: the objective selector is below the fold here and adds a perspective choice; the service line reads "Customer operations / Not available" where Fusion reads "Service availability / Not yet live"; the footer lists real destinations instead of design-study text. All are honest-copy improvements, none is a defect. |
| Mission cockpit      | `/client` participant view                       | Not close. Fusion has a left section rail, a four-step progression strip, an evidence and trust panel and a "commercial reality" note. The current page has the next-move card and the situation panel but one long column, no progression strip and no persistent rail. All real data, originals and disclosures are present; this is a layout and hierarchy gap.                                                            |
| SourceLab comparison | participant "Original quotations and comparison" | Table of original terms with "NOT SUPPLIED" cells and a missing-terms notice is present. Fusion's "differences only" and "missing evidence" filters, per-row uncertainty badges and clarification draft step are not.                                                                                                                                                                                                         |
| Operator queue       | operator workspace                               | Not compared at pixel level. The decision-queue pattern (priority, owner, status columns with search) is not present as one table; the current workspace is sectioned panels.                                                                                                                                                                                                                                                 |
| Institution          | `/programme` participant view                    | Counters with denominators and the permission note exist; Fusion's progress bars are not used, which avoids implying percentages.                                                                                                                                                                                                                                                                                             |

Fusion's fictional counts, suppliers and statuses were not treated as requirements.

## Recommended next bounded PRs

1. **Customer identity coverage.** Render the real account forms in the protected suite using the existing SDK fixture, assert signup validation, verified-only invitation redemption, denial for an unverified session and sign-out. Closes gap 1.
2. **Invitation acceptance and error recovery.** Browser tests for `setup-form`, `operator/error.tsx` retry and exits, and the contributor signed-out page. Closes gaps 2 to 4.
3. **Rebase the ledger.** Generate a new phase ledger from `main` with the two staff recovery routes and the 34 net new controls, link rows to test ids from `runtime-coverage.json`, and mark `VERIFIED` only where an allowed and a denied test exist.
4. **Mission cockpit layout.** Add the section rail and progression strip to the participant view using existing approved fields only.

## Files

- `ledger-drift.json`: ledger versus current main.
- `runtime-coverage.json`: all 807 controls with status and observed event kinds.
- `a11y-sweep.json`: routes, widths and totals for the unauthenticated sweep.
- `../../../scripts/ux10x-runtime-coverage/`: collector, matcher and sweep. `sh scripts/ux10x-runtime-coverage/run.sh <dir>` reproduces the two runs and the matching from a clean tree with the local services from the development runbook.

Preservation: no application source, domain package, API handler, migration, source original, dependency, lockfile or gate was changed. The existing contributor evidence image that the operator suite rewrites was restored before commit.
