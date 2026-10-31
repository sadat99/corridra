# Commercial readiness program: results

Document status: CURRENT, DATED. Written by the lead on 31 Oct 2026 after the five workstreams merged into the integration branch. Live state is in [the ledger](../../V3_LEDGER.md).

## 1. Header

| Field           | Value                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 31 Oct 2026                                                                                                                                                                                                                                 |
| Wave 0          | PR223, merged to `main` as `d91ac1a`, Vercel production deployment of that commit reported success                                                                                                                                          |
| Integration     | branch `claude/sleepy-mccarthy-lchg16` (stands in for `release/commercial-ready-2026-11`, see the program's owner override); the release PR and its CI give the commit SHA                                                                  |
| Preview         | none: the owner asked for direct production; verification ran on the local production build with the repository's isolated PostgreSQL (`scripts/qa/verification-server.ts`) and in CI                                                       |
| Database branch | no Neon branch was created or touched; local PostgreSQL 16 only                                                                                                                                                                             |
| Flags           | `CORRIDRA_UX_SHELLS_V2`, `CORRIDRA_UX_MISSIONS_V2`, `CORRIDRA_NOTIFICATIONS_V2`, `CORRIDRA_TEAM_INVITES`, `CORRIDRA_ROUTE_PACK_FORM`: on in the verification server, unset (off) in production. Copy and content fixes ship without a flag. |
| Schema          | `commercial-readiness-migrations/0001` (inbox, optional source and claim links, optional participant email); in the default installer list, not installed in production until the owner runs `Install customer modules`                     |

## 2. Summary

- Items (table rows in section 3; a row can group several IDs): 73 DONE, 20 PARTIAL, 1 DEFERRED.
- V-cases (60, counted from section 4): 17 PASS, 38 PARTIAL, 5 DEFERRED, 0 FAIL. PASS means an automated test proves the case in the local harness or CI; PARTIAL means it needs a live customer session from the external identity service, a recipient read that does not exist yet, or a production switch.
- Top residual risks:
  1. Real invoices are refused while supplier details contain "(madeup)" only on production with real data (D3); the legal entity and UEN still need the owner (section 6).
  2. Customer-facing notifications for quote accepted, report published and request received need a reviewed read that returns the recipient account; the inbox and email paths exist, the producers wait on it.
  3. Private view windows are still 60 seconds in reviewed SQL (D12 server part); forms keep their text and refresh quietly, but a sliding 30-minute window needs a reviewed SQL module.
  4. Fresh private report links for live workspaces stay refused for signed-out viewers until the owner sets `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` (CQ-78 root cause).
  5. The new signed-in screens (shells, mission queue and page, owner board) are proved by fixtures and the operator suite in CI; a signed-in check on production by the owner is still needed.

## 3. Items

Test names refer to files under `tests/`. Screenshots are written by the verification specs to `test-results/verification/` (CI artifact), not committed.

| ID                                             | Stream     | Status                                                                                                | Test names                                                                  |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CQ-04                                          | A          | DONE                                                                                                  | e2e/verification/ws-a, browser/real-use-content                             |
| CQ-05                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-11                                          | A          | DONE                                                                                                  | e2e/verification/ws-a (A-2), operator/ux-plan-languages                     |
| CQ-13                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-14                                          | A          | DONE                                                                                                  | e2e/verification/ws-a (A-3)                                                 |
| CQ-15                                          | A          | PARTIAL: countries by name, BD, CN, ES, EU first, in the native select (about 20 specs drive it)      | e2e/verification/ws-a                                                       |
| CQ-16                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-18                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-19                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-25, UX-08 (public)                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-38                                          | A          | DONE: rule above the create-account form and under the new-password field                             | e2e/verification/ws-a (A-4)                                                 |
| CQ-41                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-43                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-44                                          | A          | DONE                                                                                                  | e2e/verification/ws-a (A-5)                                                 |
| CQ-45                                          | A, lead    | PARTIAL: `/signin?next=` keeps only paths on the reviewed ADR-067 list; account pages pass their path | e2e/verification/ws-a (A-6)                                                 |
| CQ-49                                          | A          | DONE                                                                                                  | e2e/verification/ws-a (V-49)                                                |
| CQ-53                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-58                                          | A          | PARTIAL: success page and receipt; `notify(REQUEST_RECEIVED)` waits on the recipient read             | e2e/verification/ws-a (V-10)                                                |
| UX-14                                          | A          | DONE                                                                                                  | e2e/verification/ws-a                                                       |
| CQ-06                                          | B          | PARTIAL: account copy fixed; sample-mode lines remain only where real use is off                      | integration/ws-b-customer-words                                             |
| CQ-07                                          | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| CQ-21                                          | B          | DONE                                                                                                  | integration/ux-front-door, operator/ux-move                                 |
| CQ-22                                          | B          | DONE                                                                                                  | operator fixtures                                                           |
| CQ-23                                          | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| CQ-24                                          | B          | DONE                                                                                                  | operator/v3-customer-request-detail                                         |
| CQ-26                                          | B          | PARTIAL: headings match; tab labels in the shell nav                                                  | integration/ws-b-customer-words                                             |
| CQ-27                                          | B          | DONE                                                                                                  | operator/v3-service-requests-ui                                             |
| CQ-28                                          | B          | DONE                                                                                                  | operator/v3-organisation-profile-ui                                         |
| CQ-30                                          | B, E       | PARTIAL: one statement on the email choices page                                                      | integration/ws-b-customer-words                                             |
| CQ-37                                          | B          | DONE                                                                                                  | operator/v3-programme-pricing-ui                                            |
| CQ-50                                          | B          | PARTIAL: time zone picker, unsent types hidden; French and German email need the mail language list   | operator/ux-pulse                                                           |
| CQ-51                                          | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| CQ-52                                          | B          | PARTIAL: workspace card has one primary action and More                                               | operator/v3-workspace-team-ui                                               |
| CQ-56                                          | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| CQ-60, CQ-61, CQ-63                            | B          | DONE                                                                                                  | operator/workspace, operator/real-network-work, e2e/verification/ws-b (B-3) |
| CQ-70 (customer)                               | B          | PARTIAL: dates readable; place options come from the catalogue                                        | operator/v3-service-requests-ui                                             |
| CQ-71                                          | B          | DONE                                                                                                  | operator/v3-service-requests-ui                                             |
| CQ-72                                          | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| CQ-77 (customer)                               | B, C, lead | DONE: Library and Your Move read delivered reports through the wired service                          | integration/ws-b-customer-words, integration/ws-c-team-work                 |
| CQ-82 (client)                                 | B          | DEFERRED: programme forms keep typed text in place; draft storage not adopted (time)                  | none                                                                        |
| CQ-83                                          | B          | DONE                                                                                                  | operator/v3-customer-participants-ui                                        |
| CQ-84 (adopt)                                  | B          | DONE                                                                                                  | operator/v3-programme-pricing-ui                                            |
| CQ-85                                          | B          | DONE                                                                                                  | operator/v3-customer-programmes-ui                                          |
| CQ-86                                          | B          | PARTIAL: replacement code done; email button waits on storing the address                             | operator/v3-customer-participants-ui                                        |
| CQ-87                                          | B          | DONE                                                                                                  | operator/v3-programme-terms-ui                                              |
| UX-07, UX-08 (account)                         | B          | DONE                                                                                                  | integration/ws-b-customer-words                                             |
| UX-01, UX-10, CQ-55, CQ-69, CQ-36 (page)       | C          | DONE (behind `CORRIDRA_UX_MISSIONS_V2`)                                                               | e2e/verification/ws-c, integration/ws-c-team-work                           |
| CQ-08                                          | C          | DONE                                                                                                  | operator/workspace                                                          |
| CQ-09                                          | C          | DONE                                                                                                  | integration/ws-c-team-work                                                  |
| CQ-32 (missions)                               | C          | DONE                                                                                                  | operator/workspace                                                          |
| CQ-03                                          | C          | DONE (production with real data)                                                                      | integration/ws-c-team-work (V-27)                                           |
| CQ-29                                          | C          | DONE                                                                                                  | operator/v3-real-invoicing-staff-ui                                         |
| CQ-40                                          | C, D       | DONE: mission Replies tab and Today count                                                             | integration/ws-d-team-control                                               |
| CQ-42                                          | C          | DONE                                                                                                  | e2e/verification/ws-c (V-31)                                                |
| CQ-67                                          | C          | PARTIAL: publication draft kept; commercial forms keep text in place but not across a reload          | integration/ws-c-team-work                                                  |
| CQ-75                                          | C          | DONE                                                                                                  | integration/ws-c-team-work                                                  |
| CQ-68                                          | C          | DONE                                                                                                  | operator/workspace                                                          |
| CQ-70 (team)                                   | C          | DONE                                                                                                  | operator/v3-service-requests-ui                                             |
| CQ-73 (producer)                               | C          | PARTIAL: waits on the recipient read                                                                  | none                                                                        |
| CQ-76                                          | C          | DONE                                                                                                  | integration/ws-c-team-work                                                  |
| CQ-77 (producer)                               | C          | PARTIAL: `listDeliveredPublications` done; the notification waits on the recipient read               | integration/ws-c-team-work                                                  |
| CQ-78                                          | C          | PARTIAL: root cause is the owner switch; honest copy and a team warning                               | operator/workspace                                                          |
| UX-04 (team work)                              | C          | PARTIAL: report and link dates use the zone picker; meeting and mission dates still plain             | none                                                                        |
| CQ-74                                          | D          | DONE (owner only, see decisions)                                                                      | integration/ws-d-team-control                                               |
| V-03 recovery                                  | D          | DONE                                                                                                  | integration/ws-d-team-control                                               |
| CQ-62                                          | D          | DONE (warning before switching)                                                                       | e2e/verification/ws-d                                                       |
| CQ-82 (server), D12                            | D          | PARTIAL: STEP_UP_REQUIRED everywhere; sliding window needs reviewed SQL                               | integration/commercial-readiness-contracts                                  |
| CQ-64, CQ-59                                   | D          | DONE                                                                                                  | integration/ws-d-team-control                                               |
| CQ-65                                          | D, E       | DONE: inbox item, states and email through the notification service                                   | integration/ws-d-team-control, integration/ux-kit                           |
| CQ-66                                          | D          | DONE (behind `CORRIDRA_ROUTE_PACK_FORM`)                                                              | integration/commercial-readiness-contracts                                  |
| CQ-79                                          | D          | DONE                                                                                                  | integration/ws-d-team-control                                               |
| CQ-80                                          | D          | DONE                                                                                                  | integration/commercial-readiness-database                                   |
| CQ-81                                          | D          | DONE                                                                                                  | integration/ws-d-team-control                                               |
| CQ-35 (UI)                                     | D          | DONE                                                                                                  | e2e/verification/ws-d                                                       |
| CQ-34, CQ-73 (Today)                           | D          | DONE                                                                                                  | integration/ws-d-team-control (D-1)                                         |
| CQ-32 (operations)                             | D          | DONE                                                                                                  | operator fixtures                                                           |
| CQ-02, D2                                      | D          | DONE                                                                                                  | e2e/verification/ws-d                                                       |
| UX-03, CQ-39, CQ-54                            | D          | DONE                                                                                                  | e2e/verification/ws-d (D-2)                                                 |
| UX-13, CQ-57                                   | D          | DONE                                                                                                  | e2e/verification/ws-d                                                       |
| CQ-33                                          | D          | DONE (dry-run scripts, never run against production)                                                  | integration/ws-d-team-control                                               |
| UX-02, CQ-31, CQ-36 (shell), D14               | E          | DONE (behind `CORRIDRA_UX_SHELLS_V2`)                                                                 | e2e/verification/ws-e                                                       |
| CQ-01                                          | E, A       | DONE                                                                                                  | integration/ux-kit, e2e/verification/ws-a (A-2)                             |
| CQ-10                                          | E          | DONE                                                                                                  | e2e/verification/ws-e (E-3)                                                 |
| CQ-12, CQ-15, CQ-50, CQ-84, UX-12 (components) | E          | DONE                                                                                                  | integration/commercial-readiness-contracts, integration/ux-kit              |
| CQ-17                                          | E          | DONE                                                                                                  | e2e/verification/ws-e (E-1)                                                 |
| CQ-20                                          | E          | DONE                                                                                                  | e2e/verification/ws-e (E-2)                                                 |
| CQ-30 (infra), D7, UX-06                       | E          | PARTIAL: email and team inbox done; customer inbox needs a customer read path                         | integration/ux-kit                                                          |
| CQ-46, D18                                     | E          | PARTIAL: token rule enforced; a few stylesheets keep the caution token on a tint                      | design-system.test.mjs                                                      |
| CQ-47                                          | E          | DONE                                                                                                  | e2e/verification/ws-e                                                       |
| CQ-48                                          | E          | PARTIAL: tooltip, lang and dir before paint; static pages swap words after load                       | e2e/verification/ws-e                                                       |
| UX-05                                          | E          | DONE                                                                                                  | integration/ux-kit                                                          |
| UX-09, UX-11                                   | E          | DONE                                                                                                  | integration/ux-kit                                                          |
| UX-15                                          | E          | DONE                                                                                                  | browser/corner-dock                                                         |
| V-52 to V-60 harness                           | E          | PARTIAL: `scripts/qa/ux-measure.ts`, CI verification job; locales not separate projects               | e2e/verification/ws-e                                                       |

## 4. V-cases

| V            | Result   | Evidence                                                                                                                                             |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-01         | PASS     | integration/ws-d-team-control (owner invite, 7-day window, resend, cancel)                                                                           |
| V-02         | DEFERRED | D8 asks owner and admin; the existing permission and RLS policy allow owners only, so admins list but do not send (ADR rule wins)                    |
| V-03         | PASS     | integration/ws-d-team-control (reset needs a fresh check, never yourself)                                                                            |
| V-04         | PARTIAL  | membership events record invite and cancel; reset is audited by existing triggers without the acting owner                                           |
| V-05         | PASS     | integration/ux-kit, integration/commercial-readiness-contracts                                                                                       |
| V-06         | PASS     | e2e/verification/ws-d (warning before a setup sign-in ends a team session)                                                                           |
| V-07         | PASS     | integration/commercial-readiness-contracts (guided pack builds a reviewed configuration)                                                             |
| V-08         | PARTIAL  | assign route UI built; signed-in proof in the operator suite                                                                                         |
| V-09         | PARTIAL  | existing qualification flow, operator suite                                                                                                          |
| V-10         | PASS     | integration/ux-front-door, e2e/verification/ws-a, integration/ws-d-team-control                                                                      |
| V-11 to V-17 | PARTIAL  | network invitations and tasks in operator/real-network-work and integration/intelligence-network; email delivery depends on production mail settings |
| V-18         | PASS     | integration/ws-d-team-control (self review refused)                                                                                                  |
| V-19         | PASS     | existing evidence tests, 30-day window                                                                                                               |
| V-20         | DEFERRED | malware scanner deferred (D01)                                                                                                                       |
| V-21         | PASS     | existing evidence tests                                                                                                                              |
| V-22         | PASS     | integration/commercial-readiness-database (source and claim links)                                                                                   |
| V-23 to V-26 | PARTIAL  | operator/v3-real-invoicing-staff-ui and v3-service-requests-ui; customer side needs a live customer session                                          |
| V-27         | PASS     | integration/ws-c-team-work (real invoice refused with made-up supplier details)                                                                      |
| V-28, V-29   | PARTIAL  | operator/v3-simulated-payments-ui; commercial chain in the operator suite                                                                            |
| V-30         | PARTIAL  | delivered reports wired; customer browser proof needs a live session                                                                                 |
| V-31         | PASS     | e2e/verification/ws-c, operator/workspace (fresh link signed out, expiry and revoke deny)                                                            |
| V-32 to V-36 | PARTIAL  | operator suite fixtures                                                                                                                              |
| V-37 to V-44 | PARTIAL  | operator fixture specs; live customer session needed                                                                                                 |
| V-45         | PARTIAL  | integration/ux-kit proves the decision and the inbox-safe payload; no real email from tests                                                          |
| V-46         | PARTIAL  | operator/ux-pulse                                                                                                                                    |
| V-47         | PASS     | existing recovery tests (integration/identity-recovery)                                                                                              |
| V-48         | DEFERRED | code sign-in stays unset in production until its check is recorded                                                                                   |
| V-49         | PASS     | e2e/verification/ws-a                                                                                                                                |
| V-50         | PASS     | `docs/runbooks/dsar-manual.md`                                                                                                                       |
| V-51         | DEFERRED | `docs/runbooks/backup-pitr.md` records how to check point-in-time restore; the drill is deferred                                                     |
| V-52         | PASS     | e2e/verification at 390, 768 and 1280 px                                                                                                             |
| V-53         | PASS     | e2e/verification/ws-e keyboard and labels; ux gate in CI                                                                                             |
| V-54         | PARTIAL  | Arabic right to left and draft words in vitest; locales not separate browser projects                                                                |
| V-55         | DEFERRED | speed on production not measured from this container                                                                                                 |
| V-56 to V-60 | PARTIAL  | `scripts/qa/ux-measure.ts` and the verification specs; before and after numbers below                                                                |

## 5. UX measurement

`scripts/qa/ux-measure.ts` measures screens, forms, inputs, buttons, forbidden words, ISO and US dates and raw id fields per page against the verification server. The before numbers come from the 31 Oct QA review (14 screens on the team mission page, 15 on the owner page, 8 on the privacy page). After: the mission page is a queue plus one mission page with tabs and one side panel (behind its flag), the owner page opens on a one-screen status board with tables collapsed, and the privacy page starts with a contents list and a five-line summary. The script's per-page output is a CI artifact of the verification job.

## 6. Owner checklist

- Confirm Corridra Pte Ltd registration and real UEN before the first real invoice (D4).
- Run `Install customer modules` with `apply=yes` to add the commercial readiness module (additive; nothing visible changes).
- Review the signed-in screens, then set the five program flags in Vercel production when ready: `CORRIDRA_UX_SHELLS_V2`, `CORRIDRA_UX_MISSIONS_V2`, `CORRIDRA_NOTIFICATIONS_V2` (needs the module), `CORRIDRA_TEAM_INVITES`, `CORRIDRA_ROUTE_PACK_FORM`.
- Decide on `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` (signed-out viewers of fresh live report links, CQ-78).
- Optionally run `scripts/qa/label-synthetic.ts` and `scripts/qa/cleanup-qa-records.ts --dry-run` (both list only by default).
- Native review of the new draft words (`docs/qa/2026-10-31/i18n-review.md`).
- No preview to promote: merges to `main` deploy to production directly (owner instruction, 31 Oct).

## 7. Deferred register snapshot

| Control                                                              | Status                                    | Interim mitigation                                                           |
| -------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| D01 Malware scanner for uploads                                      | Deferred by owner decision on 31 Oct 2026 | Team-only uploads, type and size checks, one plain line on the evidence page |
| D02 to D04 Branch protection, secret scanning, CodeQL enforcement    | Deferred by owner decision on 31 Oct 2026 | CI `validate` still required; CodeQL still runs on PRs                       |
| D05 EU production object storage, D06 cleanup                        | Deferred by owner decision on 31 Oct 2026 | Existing storage; nothing deleted                                            |
| D08 Legal review, DSAR process, processing agreements                | Deferred by owner decision on 31 Oct 2026 | Manual DSAR runbook; privacy notice matches /about                           |
| RESTORE drill                                                        | Deferred by owner decision on 31 Oct 2026 | PITR check documented                                                        |
| OUTREACH automation, Live AI, external pen test, WAF and rate limits | Deferred by owner decision on 31 Oct 2026 | Features stay off and are labelled honestly                                  |
| Real invoicing                                                       | Blocked until the real UEN                | D3 guard on production with real data                                        |

## Decisions taken in integration

- Team invites are owner only (WS-D): the existing permission and membership RLS allow only owners; changing that needs an ADR.
- The D3 guard applies on production with real data, so tests, previews and the "(madeup)" payment simulation keep working.
- Team pages stay English (WS-C, WS-D); twelve unused WS-D message keys were removed rather than shipped unused.
- The final PR merges with a merge commit, not a squash, because `tests/operator/ux-plan-languages.spec.ts` builds the English form from WS-A commit `93cc41a`, which must stay reachable from `main`.
