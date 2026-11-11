# Report a Problem: build spec

Document status: CURRENT.

Owner decisions, 10 November 2026, given directly to session S17 (verbatim answers):

- Help item "Report a Problem": "Build a form later: a real in-app problem report with staff review", then "3, now" (build it now).
- Scope exception: "Approve exception (Recommended)". A one-off exception to navigation-v1 binding 7 ("no ... migration change") for Report a Problem only: an additive optional module and a protected API that the owner merges and installs. Every other binding stays.
- Privacy: "Yes, it covers it (Recommended)". The privacy notice line "Messages you send us (support and privacy requests)" (`apps/web/app/privacy/page.tsx:257-260`) covers problem reports and the sanitised page path. No privacy text change.
- Customers with no workspace: "Allow it (Recommended)". They may file. Every report lands on exactly one staff queue side, proven by an orphan test.

Data contract: [ADR-078](../../adr/0078-problem-reports.md). This spec never overrides the V3 contract, the UI direction, the design system or an accepted ADR. Squad stages that produced it (authority stamp auth-c36160a85b5b): corridra-product, corridra-architect and corridra-designer, all in S17's run.

## Status as merged (11 November 2026)

All of the build is merged to main. Live state (installs, switches) stays in the [ledger](../../V3_LEDGER.md); this block is the build and decision status only.

| Part | What                                                                        | PR  |
| ---- | --------------------------------------------------------------------------- | --- |
| PR1  | Problem report module and installer (ADR-078)                               | 390 |
| PR1b | Bounded word removal, replay order, stricter plain text                     | 396 |
| PR2  | Backend: domain, services, routes (Sensitive)                               | 400 |
| PR2b | Customers remove the words of their own reports (migration 0003, Sensitive) | 403 |
| PR3  | Screens, menus and the staff panel (Sensitive)                              | 412 |

- Migrations 0001 to 0003 are installed in production: the problem report module reports 3 applied (owner-approved installs; the ledger holds the run numbers).
- Owner, 11 November 2026: approved all 16 customer sentences of the screens. This approves the words only; it is not an acceptance of the module's real use, which keeps its own switch and the real-staff triage requirement in section 7.
- ADR-078 decision 6 (an erasure path for removing words) was answered "A" by the owner on 10 November 2026 and is built in PR2b and PR3.

## 1. Outcome

Signed-in customers and signed-in team members report a problem from the Help menu where they hit it. They get a reference such as RP-000123 and see who acts next. A page lists only their own problem reports, with every status change and every staff note. Owners and admins triage in a protected queue (Received, In review, Resolved, Closed) with a note the reporter reads. No email or WhatsApp message is sent; the in-app page is the only channel.

## 2. Words (one word per idea)

- The thing is always a **problem report**, never "report" alone (the customer Reports tab means delivered results), "request", "ticket", "issue" or "feedback". The action is **Report a Problem**.
- Customers read "the Corridra team". Team members read "an owner or admin". Staff screens say "reporter".
- Status words, sentence case: Received, In review, Resolved, Closed. "Resolved" is never "fixed". Reporter kind: Customer, Team member.

## 3. Addresses (designer's; architect plan adapted)

| Address                                                                                                           | Purpose                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/account/problem-reports/new?from=<path>`                                                                        | Customer form: step 1, step 2 (check and send), sent screen. One address, client steps.                                                                    |
| `/account/problem-reports`                                                                                        | Customer's own list                                                                                                                                        |
| `/account/problem-reports/[reference]`                                                                            | Customer's own detail (All tools excluded: "Needs one problem report. It opens from Your problem reports.")                                                |
| `/operator/problem-reports/new?from=<path>`, `/operator/problem-reports`, `/operator/problem-reports/[reference]` | Team member's form, own list and detail. Add `problem-reports` to `reservedOperatorSegments` in `apps/web/lib/operator-urls.ts`; it is not a 19th section. |
| `/operator/settings`, panel `#problem-report-queue`                                                               | Staff queue, mounted directly after `ErasureQueue` (`apps/web/app/operator/workspace.tsx:703-708`)                                                         |

Customer pages use `CustomerShell tab="more"` and need no workspace. The customer avatar menu is NOT changed (five items). The team avatar Account group gains "Your Problem Reports" (at most four rows). With the module not installed, every route answers 503 or notFound, the Help row stays Coming soon, and nothing is added anywhere: identical to today.

## 4. Form (Flow pattern; 1.0 desktop, 1.5 phone)

Step 1, "What went wrong?" (h2, focus target; "Step 1 of 2 · About 1 minute", JourneyBar "What went wrong", "Check and send"):

1. Category, Big choices (radio inside label, at least 76 px). Stored keys did_not_work, could_not_find, words_wrong, something_else. Labels and hints:
   - "Something did not work": "A button, page or save did not work."
   - "I could not find something": "You looked for a page or an action and it was not there."
   - "Words or information are wrong": "A word, number, date or name looks wrong."
   - "Something else": "Tell us in your own words below."
     Icons: `search`, `document`, `more`; `help` for "Something did not work" (no new glyph).
2. "Where did it happen?": radio "This page" (described by the masked path in mono) or "Another page" (field "Which page or screen?", hint "For example: Requests, or the Meetings page.", at most 120 characters). "This page" is preselected when `from` is a valid shell path; otherwise only the text field shows.
3. "Tell us more", tagged "Optional" or "Required" (Required, at least 10 characters, for Something else). Hint: "What did you try, and what happened? Do not include passwords, card numbers or other people's personal details." Counter "0 of 1000 characters".

Buttons: "Continue" (60 px), quiet "Not Now". Errors on Continue, inline, focus to the first: "Choose what went wrong.", "Write which page or screen.", "Write at least 10 characters about what happened."

Step 2, "Check your problem report": one plain sentence, then What went wrong / Where / What you told us, each with "Edit" (names "Edit What Went Wrong", "Edit Where", "Edit Tell Us More"), then "Send Problem Report" and quiet "Back".

Sent screen (`role="status"`, focus to its heading): "We received your problem report", "Your reference is RP-000123.", "The Corridra team will review it." (team: "An owner or admin will review it."), "We do not send email about this. Check its status here.", link "See Your Problem Reports", quiet "Go Back to Where You Were" (only for a valid internal `from`).

Path rules: path only; query and fragment removed; UUID segments shown and stored as `:id`; non-shell paths become "Another page"; wrap, never truncate. Drafts live in page memory only, never in browser storage.

## 5. States (exact copy)

- Sending: "Sending…", one send only, idempotent command id.
- Network drop: "Your problem report was not sent. Check your connection, then press Send Problem Report again. What you wrote is still here."
- 429: `limitWords` (`apps/web/lib/account-limit.ts`), text kept.
- 401: "Your sign-in has ended. Sign in again, then come back to this form." Button "Sign In Again".
- 403: "You cannot report a problem from this account. Nothing was sent." Link "Return to Your Account" (team: "Return to Today").
- 503 or not installed: "Problem reports are not available yet." and "You cannot report a problem here yet. Nothing was sent."
- Other 5xx: "Your problem report was not sent. Try again in a few minutes. What you wrote is still here."
- Lists: empty "You have not reported a problem." with action "Report a Problem"; error "Your problem reports could not be loaded. Check your connection and try again." with "Try Again"; closed disclosure "What Each Status Means":
  - Received: "We have your problem report. Nobody has started on it yet."
  - In review: "Someone in the Corridra team is looking at it." (team: "An owner or admin is looking at it.")
  - Resolved: "The Corridra team dealt with it. The note says what was done."
  - Closed: "The Corridra team closed it. The note says why."
- Detail: not found or not yours, the same message: "We could not find this problem report." History shows status and time, and the note when present ("Note from the Corridra team"; team: "Note from an owner or admin").

## 6. Staff queue

- h2 "Problem reports". Intro: "Customers and team members report problems with Corridra here. Move each one when you start work on it, and again when it is resolved or closed."
- SegmentedFilter "Show" with counts; button "Load Problem Reports"; summary "Showing 10 of 40 problem reports."; "Oldest waiting: filed 6 Nov 2026, 09:12 (UTC), 4 days ago." or "No problem report is waiting in Received." or "Oldest waiting: Not measured yet."
- Rows show reference, status, Sample or Real (`ModeLabel`), reporter kind, filed time with zone, category, masked page, and a closed "Show Details and History". Never a name, email or workspace content.
- Actions: Received gets "Start Review" (note optional) and "Mark Closed"; In review gets "Mark Resolved" and "Mark Closed" (note required, 10 to 1000 characters). Move form under its row, label "Note to the reporter", caution always visible: "The reporter will read this note. You cannot change or delete it after you save." Buttons "Save", "Cancel".
- Errors: step-up through `StepUpDialog`, note kept; 403 "This role cannot manage problem reports."; 409 "This problem report has changed. Reload and try again." with "Reload", note kept; 503 "Problem reports are not available yet."

## 7. Resolved open questions (conductor routing, 10 Nov; the owner may override)

1. No pause control: installing turns it on, and rollback is an app revert.
2. Closed customer accounts read their reports through the API only for now; no change to the closed-account gate screen.
3. Real-side reports are triaged only by real staff, which needs `CORRIDRA_REAL_USE_ENABLED=true`; the owner checks that switch.
4. Removing words under an erasure request stays owner-only (`members.manage`), the same as the erasure queue.
5. Stored path is the path only (privacy over convenience); the designer's option to keep fixed `view` values is not taken.
6. Received may move straight to Closed (duplicate or empty), with a required note.
7. No inbox item for note changes in this build.

## 8. PRs (architect plan, ADR-078)

1. PR1, migration (the owner merges, then runs the install with `apply=yes` and `field_modules_action=problem_reports`):
   - `packages/db/customer-problem-report-migrations/0001_problem_reports.sql`
   - `packages/db/src/customer-problem-report-migrate.ts`
   - installer wiring in `scripts/install-customer-modules.ts` and `.github/workflows/install-customer-modules.yml`
   - `tests/workflow-inputs.test.mjs`
   - owner page entry (`apps/web/lib/owner-switches.ts`)
   - database and installer integration tests
2. PR2, backend (Sensitive, Guardian review):
   - domain `problem-report.ts` and the moved plain-text rule
   - permissions `problems.report` and `problems.triage` (fresh MFA)
   - services in `packages/auth/src/problem-reports.ts`
   - routes `/api/customer-problem-reports` and `/api/workspace/problem-reports`
   - private headers in `next.config.ts`
   - route tests
3. PR3, screens and menus (Guardian review):
   - the addresses above, the staff panel and the erasure word-removal action
   - menu flags carried like `organisationProfiles`
   - the Coming soon tests updated stricter, never weakened
   - CRUD matrix entry, ledger and work log

## 9. Acceptance

Positive:

- Filing by customer and by team member: reference, list, detail.
- Triage through every allowed move, with the reporter reading notes in order.
- The path sanitiser never outputs `?` or `#`.

Denial:

- Signed out gets 401 and nothing is filed.
- Another reporter, a co-member or an unknown reference gets the same not-found answer.
- The wrong side or another staff tenant gets not found.
- Operator, reviewer and viewer get 403 on triage; a stale MFA gets the step-up.
- A customer session on staff routes is refused, and the reverse.
- Revoked or disabled reporters are refused. A closed account cannot file but can read.
- Direct SQL by the runtime role has no grants, and rewrite is rejected.

Recovery:

- Idempotent create; conflicting reuse gets 409.
- A retry after a network drop does not duplicate.
- Stale triage gets 409 and the note is kept.
- The 11th report in 24 hours gets 429 and the text is kept.
- Not installed gets 503 and Coming soon.

States and accessibility:

- Loading, empty, error and denied states are distinct.
- Keyboard only works end to end, with focus to the step heading and the first error.
- Targets 44 px; axe clean and no sideways scroll at 320, 390, 768 and 1440 in the real frames (KI-16).
- Page budgets as above.

Measurable:

- Every report is visible on exactly one staff side (orphan matrix).
- The queue shows "n of total" and the oldest Received age.
- Problem reports never count as commercial activity.
