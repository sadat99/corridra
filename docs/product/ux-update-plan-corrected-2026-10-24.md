# Corridra UX update plan, corrected candidate, 24 October 2026

Status: candidate for the owner's approval. It is not final until the owner records one dated sentence in the work log. Nothing in it is being executed: the planning freeze in [the verification record](ux-update-plan-verification-2026-10-24.md) stands.

What this is: the owner's plan of 24 October 2026 with every gap and mistake found in the verification fixed. It is built on [the UX charter](ux-charter.md), which governs. Where this plan and the charter differ, the charter wins. A lane session reads this file from the repository; nothing is pasted.

How it stays true as the system changes: it does not state facts that go stale (counts, line numbers, branch lists). Each lane starts with "premises to verify" and stops if one is false. The findings behind each fix are in the verification record, cited here as A1 to A17, D1 to D11 and P1 to P7.

Owner decisions that are still open are marked **[Decision N]**. Where one is open, this plan applies the recommended option and says so, so the plan is complete and can be changed in one place.

## 1. The target in one paragraph

The signed-in person lands on **Your Move** (what is waiting for them), opens a piece of work as a **Road** (Define, Find, Compare, Visit, Decide, Follow through), and goes deeper through **lenses** (Compare, Evidence now; Trip, People, Money when real). Suppliers answer through a no-registration **Reply Page** that extends the supplier response already on `/buyer`. **Pulse** reaches people by email. Languages sit behind one two-letter control. Everything old stays reachable under **All tools**. The customer navigation becomes Your Move, Missions, Companies, Library, More. The owner's decisions of 23 October apply unchanged: additive backend only from Phase 2; team sharing off by default; the contributor sign-in change waits for a security review; email first, then web push, WhatsApp later; one clear sample or real label per tenant; the home page concept A "Ledger" is not replaced.

## 2. The fixes this plan applies

| Fix                                                                                                                                                                                                                                                                                                       | Finding           | Status                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------- |
| UI direction is amended first, in Lane 4's first commit, before the navigation changes. The pull request cites V3-04-043 to V3-04-045 and V3-07-019                                                                                                                                                       | A1                | Applied. **[Decision 4]** for the labels    |
| Names are catalogue strings, so a label is one edit. A plain fallback set is prepared and both sets go through the cover-the-words test. Names are translated by meaning, not word for word                                                                                                               | A2                | Applied. **[Decision 4]**                   |
| The Room is a composition above the request page and the mission page. It does not replace either, and it invents no join between a request and a saved mission                                                                                                                                           | A3                | Applied                                     |
| The Road reuses `JourneyBar` semantics. The first front door card is the `NextStepCard`. Trust seals are `FactLabel`. No second set of parts                                                                                                                                                              | A4                | Applied                                     |
| The Road mapping is monotone. Compare and Decide light only from a readable record. ON_HOLD shows no marker                                                                                                                                                                                               | A5                | Applied. **[Decision 5]**                   |
| No holder badge on the Road in phase 1. Holders appear where true by construction                                                                                                                                                                                                                         | A6                | Applied. **[Decision 5]**                   |
| The front door is person-level, because there is no active workspace today. Each card names its workspace, and an action appears only for a role that may take it                                                                                                                                         | A7                | Applied                                     |
| The front door always carries a start action. Move sources are corrected: a service request waits on the customer when it is `quoted`; customers cannot record decisions and pending invitations cannot be listed, so those two sources are removed; an open evidence request is added                    | A8, D9, D13       | Applied                                     |
| Motion is at most 220 ms using `--dur` and `--ease`. No travelling card                                                                                                                                                                                                                                   | A9                | Applied                                     |
| No inline SVG. The emblem and Road line use CSS and `CorridraIcon`. An exception needs the owner                                                                                                                                                                                                          | A10               | Applied. **[Decision 6]** only if needed    |
| Trip features show the commercial itinerary only. No booking, selling or advice on flights, hotels or visas                                                                                                                                                                                               | A11               | Applied                                     |
| Pulse and the status link cite V3-06-009 and V3-09-045 and are never called commercially live. Every lane pull request lists requirement IDs and original and destination paths                                                                                                                           | A12               | Applied                                     |
| PR171 is the language base. Lane 2 becomes phase 2 after it merges. `CORRIDRA_UX_I18N` and `released.json` are dropped                                                                                                                                                                                    | A13, D2           | Applied. **[Decision 1]**                   |
| Recipient pages by link, the helper area and the founder view are named and scheduled for a later wave                                                                                                                                                                                                    | A14               | Applied. **[Decision 8]** for the date      |
| The plan's test gate is joined to UI direction's locked one. Its claims stay withheld until those tests are done                                                                                                                                                                                          | A15               | Applied                                     |
| The four states include "no internet". The accessibility menu is out of scope                                                                                                                                                                                                                             | A16               | Applied                                     |
| The Missions area holds requests and missions, and programmes (V3-04-045)                                                                                                                                                                                                                                 | A17               | Applied                                     |
| Links from email reach their page after sign-in, through a short allow-list of exact internal paths                                                                                                                                                                                                       | A18               | Applied                                     |
| Every starter (home cards, `/plan` pictures, guided-draft starters) maps to the same job keys. Lane 6 changes only `/plan`                                                                                                                                                                                | A19               | Applied. **[Decision 9]**                   |
| The existing Evidence lens select and Date and number display select stay inside the Compare lens. The new Evidence tab keeps its name                                                                                                                                                                    | A20               | Applied                                     |
| The quote cards move the existing verdict to the top. They add no new verdict                                                                                                                                                                                                                             | D13               | Applied                                     |
| The Reply Page extends the existing supplier response on `/buyer`. The database already accepts the extra terms, so the change is the form and the web layer                                                                                                                                              | D11               | Applied                                     |
| Message 4 already exists as the `yourMove` template. Lane 7 builds messages 5, 6 and mission complete                                                                                                                                                                                                     | D7                | Applied                                     |
| There is no specimen route. The specimen is extended in the test fixture                                                                                                                                                                                                                                  | D3                | Applied                                     |
| The saved report file is under `account/missions/`. Delegation presentation is larger than first stated. Phase 0 files are frozen                                                                                                                                                                         | D4, D5, D8        | Applied                                     |
| The documentation map and ADR index are shared files. The ledger is condensed by the integrator first. The `merging` label is created by the owner and uses a lowest-number lock. Container test traps are listed. Budget classes exist for new screens. Branch arithmetic is stated. Squash rule is kept | P1 to P7, D1, D10 | Applied. **[Decision 2]**, **[Decision 3]** |

## 3. Rules for every lane

### A. Start of every work chunk

Run `git status --short`, fetch main and open pull request metadata, then `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`. Follow `docs/v3/CONTEXT.md`. Read once per session: `docs/V3_CONTRACT.md`, `docs/product/corridra-product-vision-v2.1.md`, `docs/agents/ui-direction.md` in full, `docs/design-system/README.md` including section 7a, `docs/design-system/ART_REVIEW.md`, `docs/v3/KNOWN_ISSUES.md`, the master design contract in `docs/source/ac1-design-system/`, [the charter](ux-charter.md) and this plan. Never guess a path: use `rg --files` and `rg`, then read only the lines needed.

### B. Non-negotiables

1. Merging to main deploys to the live site (ADR-050). Work on one short-lived branch named `ux/l<number>-<name>`. Run `node scripts/check-git-branch-budget.mjs <branch>` before creating it. Never deploy by hand, bypass protection or force-push.
2. Every new capability sits behind its own environment switch, read on the server, default off when unset, with a plain label in `apps/web/lib/owner-switches.ts` (a test fails otherwise). With all new switches unset the product behaves exactly as main does. Prove it by running the existing suites unchanged.
3. Hide, never delete. Keep every route URL, role check, deep link, draft, evidence record, trust label, money record and history. The 18 operator section ids and already issued recipient links keep working.
4. Never edit, skip or weaken a test to make it pass. Never bypass authorization or row-level security. Never fake data, dates, urgency, counts or controls: a control with no working backend is MISSING, not shipped.
5. Migrations are additive and need an approved ADR. Customer areas have their own migration folders applied by offline owner-run tooling. State the blast radius before touching auth, row-level security, money or event records.
6. Closed gates stay closed: D01 to D06 and D08. No real outreach, payments, payouts, production AI inference, billing activation or real-file processing. Customer mission mail stays separate from outreach and stays off until the owner has reviewed the privacy wording.
7. Never print credentials or production personal information. Name new secrets; the owner sets them.
8. No new npm dependency without the owner's written approval.
9. Material contract changes need an ADR with the reserved number in the lane. Write ADRs as status "proposed".
10. Phase 0 files are frozen: `apps/web/lib/foundations.ts`, `apps/web/proxy.ts`, `apps/web/app/operator/owner/**`, `apps/web/app/operator/view-as/**` and the existing `packages/auth/src/*mail*` templates for message 1. Only the lane named for a file may add to it, and view-as only after the owner says "go".

### C. Design rules (AC/1 Atlantic Cobalt)

Midnight Navy `#142438` is chrome and never a button fill. International Cobalt `#2856C5` is the only primary action, selected, focus and link colour. Porcelain `#F6F8FB` is the page. Ink `#18283C` is text. Copper `#BF7548` is ornament only. Use existing tokens and no new hex values. Controls 8 px, cards and guided choices 12 px, panels and bands 16 px, capsules for status badges only. 64 px space inside work screens. Touch targets 44 px up to 768 px. Icons only through `CorridraIcon`; no inline `<svg>` (a true diagram needs the owner's approval to join the diagram exceptions); no pastel tiles, sparkle or gear; every icon keeps its word. One primary action per region, at most five primary choices per level, one job per screen. Text at least 12 px. Money, quantities, dates and ids use tabular numerals. Motion at most 220 ms with `--dur` and `--ease`, state changes only, off under reduced motion. Axe WCAG 2.2 AA clean, visible focus, no overflow at 320, 390, 768, 1024, 1440 and 1920 px.

Reuse before invention: `CustomerShell`, `JourneyBar`, `NextStepCard`, `FactLabel`, `CorridraIcon`, `ComparisonMatrix` and the comparison engine. A new part needs a new job.

Compositions by task: Meridian for customer screens, SourceLedger for Compare and Evidence, Encounter for Trip and Programme, Signal for operator and owner, Atelier for public pages. Add no new look.

New styles go in a CSS file next to the component, imported by it. Do not edit `apps/web/app/globals.css` (one exception: Lane 2 phase 2 moves PR171's language styles out of it, as a pure move).

**Scroll budget** (phone screens at 390 wide, desktop at 900 high, default state, every disclosure closed, measured on `next start`, never `next dev`, with fixtures mounted in the real frame, KI-16 and KI-18):

| Page type                 | Phone | Desktop | Used for                                                                                                                                    |
| ------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow step                 | 1.5   | 1       | First question, the Reply Page                                                                                                              |
| Landing page per audience | 5     | 3       | Your Move                                                                                                                                   |
| Record, queue or report   | 4     | 2.5     | The Room, All tools (groups folded, with counts), the operator Move panel, the reply review queue, the programme room, the status link page |
| Reading page              | 6     | 3       | Fair pages                                                                                                                                  |

Record the measured length in the pull request, with the state it was taken in.

### D. Words

Short common words, short sentences, one word per idea. "Sample", never "synthetic". "Corridra team" on customer screens, never "operator". "Request", never "brief". Use the real role (buyer, supplier) in interface text. The five trust names stay exact: Self-declared, Evidence available, Verified, Derived, Outcome observed. Names, Chinese company text, quotations and original currencies are never translated. Privacy, legal and consent text changes only after the owner's review: put proposed wording in the pull request description and leave the page as it is. Figures of speech (Move, Road) are explained at first use and translated by meaning.

### E. Evidence for every visible package

Before and after screenshots at 320, 390, 768 and 1440 px (1024 and 1920 for dense grids) under `docs/design-system/evidence/<package>/before` and `after`; the real-frame audit for signed-in screens; a keyboard walk; the four states (loading, nothing here yet, something went wrong, no internet) and the denied state; right-to-left and Bangla samples for new components; the denial checks of the affected suites; a parity table (action, route, component, service, permission, test); the requirement IDs the change touches and the original and destination paths. If a change would reduce what any user can do today, stop and report.

### F. Checks

Before every push run `pnpm preflight` (and `node scripts/preflight.mjs full` before a lane's final push). The full set on the frozen head is `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`, `pnpm test:operator`, `pnpm test:ux`, with the UX baseline never rising. Run long checks through `node scripts/gate.mjs NAME -- COMMAND`. Use `set -euo pipefail`. Container traps: set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the Chromium that exists (KI-12 and KI-19 name different paths); the protected operator suite needs the native PostgreSQL steps in KI-15; operator test 8 (`workspace.spec.ts`, governed SDK fixture review) fails in the cloud container on clean main (KI-19), so compare with clean main before blaming a change. Quote real exit codes and totals.

### G. Shared files and the merge protocol

| Shared file                                                                                                                                    | Rule                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/globals.css`                                                                                                                     | Nobody edits it. Lane 2 phase 2 may move language styles out of it. If a token is missing, the lane stops and reports it.                                                                                           |
| `apps/web/lib/owner-switches.ts`                                                                                                               | Lane 1 reserves every new name as kind `planned`. Each later lane flips only its own entries to `flag`. PR171's two language settings stay.                                                                         |
| `apps/web/next.config.ts` private headers                                                                                                      | Lane 1 adds, in one commit, private no-store blocks for `/api/move/:path*`, `/api/pulse/:path*`, `/api/reply/:path*` and `/reply/:path*` (the last with no-referrer and no indexing). No other lane edits it.       |
| `tests/ux/ux-baseline.json`                                                                                                                    | A lane adds only the keys for its own new static routes. On a conflict keep both sides and re-run `pnpm test:ux`. The counts never rise.                                                                            |
| `docs/documentation-map.json`                                                                                                                  | Every new Markdown file needs an entry (a test fails otherwise). Add entries, never reorder.                                                                                                                        |
| `docs/adr/` and `docs/adr/README.md`                                                                                                           | Numbers are reserved below. A lane never takes a number that is not its own. Add one index line for each ADR, appended.                                                                                             |
| `docs/agents/work-log.md`                                                                                                                      | Append only, at the end. On a conflict keep both entries in time order.                                                                                                                                             |
| `docs/V3_LEDGER.md`                                                                                                                            | One writer: the integrator. The integrator first condenses it (it has little room, KI-20) and refreshes the stale branch, main and active-work lines. Lanes keep their ledger line in the pull request description. |
| `package.json`, `pnpm-lock.yaml`                                                                                                               | No new dependency in any lane without the owner's written approval.                                                                                                                                                 |
| Install files: `.github/workflows/install-customer-modules.yml`, `scripts/install-customer-modules.ts`, `tests/real-use-install-head.test.mjs` | Only Lanes 7 and 8, one after the other: Lane 7 first, Lane 8 rebases.                                                                                                                                              |

Reserved ADR numbers: **0062** language, written retrospectively to match PR171 (Lane 2 phase 2); **0063** notification records and Pulse (Lane 3); **0064** Move records (Lane 3); **0065** Reply Page extending the existing supplier response (Lane 3); **0066** decision card and sharing (Lane 3); **0067** Road display of the real mission status (Lane 5); 0068 and 0069 spare, assigned by the integrator; **0058** emailed status link exists as proposed and is the owner's decision.

Merge protocol, every pull request:

1. `git fetch origin`, then merge `origin/main` into the branch. Never rebase a pushed branch.
2. Run `node scripts/v3-context.mjs verify`, `pnpm preflight` and the lane's focused tests.
3. Push. Wait for CI and CodeQL green on that exact head.
4. Merge only through the label lock. The owner creates the label `merging` once. Add it to your pull request, then list open pull requests that carry it. The lowest pull request number holds the lock; the others remove their label and wait. Merge by squash, then remove the label.
5. Immediately after merging: fetch main, run `node scripts/v3-context.mjs verify` and `wc -c docs/V3_LEDGER.md`. Confirm the deployment of the merged SHA is READY and serves that SHA.
6. Delete the branch, remote and local. After any squash merge, restart a reused branch from main (KI-17). Run the branch budget script before the next branch.
7. Do not touch the ledger. Put the ledger line and the work-log text in the pull request description; append the work-log entry in the pull request.

If two pull requests conflict in a way that keeping both sides does not resolve, stop and report the files.

### H. Stop conditions and report format

Stop and report, without guessing, if: a premise you were told to verify is false; a test would have to be weakened; a gate would have to open; a migration is needed without an approved ADR; you need a file another lane owns; or a screen cannot meet its scroll budget without hiding an action.

Report at the end of each wave in plain words: what was done; evidence (check names, exit codes, totals, pull request numbers, merged SHA, deployment state); what the owner should look at and which switch to set to see it; one next step. Also list what could not be verified and what was chosen not to be done. Never write "done" without the output that proves it.

## 4. Waves, gates and the first moves

```
Wave 0  owner steps, no code: decisions 1 to 4, the merging label, the integrator, branch cleanup, mark this plan final
Wave 1  Lane 1 Foundation      Lane 3 ADR pack (documents only)      Lane 2 phase 2 (after PR171 merges)
Wave 2  needs Lane 1 merged, and Lane 2 phase 2 for strings:
        Lane 4 Front door and navigation    Lane 5 Room, Road and lenses    Lane 6 First question and sample label
Wave 3  needs Wave 2 merged, the owner's Gate 2 and the ADRs accepted:
        Lane 7 Move records and Pulse    Lane 8 Reply Page    Lane 9 Operator URLs and view-as stage 2 (optional)
Wave 4  needs Gate 3: Lane 10 Programme Room    Lanes 11a to 11e languages    Lane 12 Fair pages and books
        Lane 13 Helper and founder front doors (to be scoped)  [Decision 8]
```

Each wave ends with a stop for the owner's review. A later wave never starts on its own. Parallel width is at most the number of free branch names minus one spare (the limit is eight names including main). **[Decision 2]**, **[Decision 7]**: start with two lanes, add a third after the merged `ccr-998044a6-w7yufu` branch is deleted, a fourth after PR171's branch is gone.

**Gate 2** (before Wave 3): the owner's art review of the Wave 2 screens on the deployed site, and the cover-the-words test with 8 of 10 target users including Bangla readers, run with both label sets (A2). UI direction's own conditions are added for the claims "easy for any literacy" and "usable without sight": a five-person task test from the target audience and blind users with TalkBack, VoiceOver and NVDA. Those conditions gate the claims, not the merging, because every capability is off by default.

**Gate 3** (before Wave 4): the 10 to 15 interviews on co-owner or bank involvement, the supplier test with about ten real suppliers, and service promises set per route.

## 5. The corrected design decisions

### 5.1 Navigation and labels (A1, A2, A17)

Customer navigation: Your Move, Missions, Companies, Library, More. Companies appears only where the approved-companies module is on, as today. Missions holds two sections, requests and missions, and programmes. Library holds Results and saved reports and keeps "Results" visible as a heading. More holds the account, company profile, service requests, plan and billing (when its switch is on), the accessibility menu when it is built, and help. All tools lists every route the person may reach. With the navigation switch off, the component is byte for byte today's, including labels and order. The plain fallback label set for the cover-the-words test: Waiting for you (Your Move), Supplier or Buyer (Them), Corridra team (Corridra), Where this request stands (Road).

### 5.2 The front door, Your Move (A7, A8)

One landing for the customer audience, scoped to the person. There is no active workspace today and none is invented. A person's requests belong to the person; each card names its workspace when the person has more than one; an action appears only for a role that may take it (several are for a workspace owner or admin). The first card is the next-step card. Cards come only from states the inventory proves readable, and are left out otherwise. The candidates the code supports, each to be confirmed:

| Card                                  | Source state                                                                         | Holder        |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| Finish your draft                     | An unfinished mission draft                                                          | You           |
| Accept or decline a quote             | A service request in status `quoted` (owner or admin)                                | You           |
| Add evidence to a company link        | A company link in status "More evidence needed" (owner or admin)                     | You           |
| Answer an evidence request            | An open evidence request on a delivered report                                       | You           |
| Read a new reply                      | A team reply newer than a last-seen mark on the device, cleared by a "forget" action | You           |
| Waiting on the Corridra team (folded) | Items the team holds, such as a request under review                                 | Corridra team |

A date appears only where a real date exists. No streaks, no badges, no invented urgency. A configured service-promise value per route may be read as a target, defaulting to empty. The first five cards show, then "show more". When nothing waits, the screen says so honestly, shows the most recent request and where it stands, and makes "Start a request" the primary action. "Start a request" is otherwise always present as a quiet action. The page is a landing page for the scroll budget.

### 5.3 The Room and the Road (A3, A4, A5, A6)

The Room is keyed by the request. It shows a deterministic emblem built from the name (never stock imagery), the received date, the Road, a message strip of the team's replies, and the lens tabs. The team's replies are read only today and the Room adds no reply box. It composes the existing request page and mission page (and keeps the mission passport, whose "YOUR NEXT MOVE" shows the staff-approved next action) and mounts the existing comparison matrix and `SavedCommercialReport` as the Compare and Evidence lenses only where a readable link between the request and a saved mission exists. Where none exists it links out. Both old URLs keep working and every old action stays reachable from the Room.

The Road shows six steps. The marker follows this mapping, which is proposed for ADR-0067 **[Decision 5]**:

| Mission status                         | Road step                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| DRAFT, QUALIFICATION                   | Define                                                               |
| ACTIVE, TARGETING, OUTREACH            | Find                                                                 |
| MEETINGS                               | Visit                                                                |
| FOLLOW_UP, COMMERCIAL_PIPELINE, CLOSED | Follow through, each with a plain sub-line taken from the status     |
| ON_HOLD                                | No marker; a side note, because the paused-from step is not readable |
| CANCELLED                              | A side note                                                          |
| Any unknown status                     | A plain status line, no marker                                       |

Compare and Decide light only when a readable record for the same piece of work exists (a delivered report, a reviewed decision disclosure). Customers cannot record a decision; they read reviewed ones. Otherwise they read "not tracked yet". A property test over the legal transition graph proves the step never decreases. Step shapes differ as well as colour: done, now, later, not tracked yet. If the retention window has passed, the page says so and offers a way back.

No holder badge appears on the Road in phase 1. Replies only come from the team, so "You" and "Them" cannot be derived from them. A holder appears on front door cards and on service request rows where the state says who waits. The third holder is shown as Supplier or Buyer. It arrives with Move records and the Reply Page.

### 5.4 Lenses (A4, A11)

Compare: quote cards over the existing engine and component, with the matrix one tap away. Today each offer already states NOT COMPARABLE or COMPARABLE ON SUPPLIED TERMS below a table that scrolls sideways on a phone (`mission-experience-view.tsx`); the cards move that verdict first and add no new one. The existing "Evidence lens" select (it filters offers by how current they are) and "Date and number display" select stay inside the Compare lens; the language control sets the default of the date select (A20). A filled seal and the words "Comparable on supplied terms" only when the engine says so; otherwise an open ring and "Not comparable yet" with the missing terms, an expired quote or a total mismatch exactly as the engine reports. Never rank, score or recommend unless the engine already does. Original currency with its code, tabular figures, a missing term shown as "not stated", never zero. Each price carries its trust label through `FactLabel`.

Evidence: trust labels on each fact with the one-line gloss, through `FactLabel`. Never a weaker word than "Verified".

Trip: built only if the inventory shows customers can read visit or meeting data. It shows the commercial itinerary: meetings, visits and programme days. It never books, sells or advises on flights, hotels or visas. Otherwise it moves to Phase 3 and the pull request says why.

### 5.5 The supplier side (D11)

The Reply Page extends the existing supplier response on `/buyer` (`recipient-response.tsx`, table `app.recipient_detail_response`, migration 0025). It keeps its link model, its operator review and its three answers. The database function already accepts 18 quotation term keys, including `moq`, `validUntil`, `incoterm`, `shipping`, `warranty`, `installation`, `training` and `spares`; the form shows only 7. The Reply Page adds: one question at a time, a language the team sets per recipient with a limited Chinese catalogue, the terms the form does not show yet (minimum order, trade term, how long the quote is valid, what is included) and a receipt to the supplier. All answers stay Self-declared, versioned and reviewed by staff before any customer sees them. No account. No files until gate D01 closes. If a supplier cannot use the page, staff enter the same form for them. Lane 8 checks that the database function accepts the new terms (it does today), so the change is the form and the web layer, and a new database module only if the check shows otherwise. The whole `/buyer` path is sample only today (contacts end in `@example.invalid`, the channel is SYNTHETIC or MANUAL, staff share links by hand and the page says "Invented demonstration. No real outreach."), so real supplier use waits for the real-outreach gate.

### 5.6 Language (A13, D2)

PR171 is the base: browser-stored choice, five languages, release by `CORRIDRA_LANGUAGES_REVIEWED`, drafts by `CORRIDRA_LANGUAGES_PREVIEW`. A language is offered only after a native reviewer is recorded with a name and a date. New strings for new components go into the same message module. The UI language list is tied by a test to what `displayDate` and `displayMoney` accept. Mission mail stays English until ADR-0063 stores a language in notification preferences. The privacy page does not mention the stored choice yet; that wording is the owner's. Bangla currently falls back to a serif face; whether to add a sans face is the owner's call (plan question 2). French and German are later additions. Arabic PDFs need a font and shaping first, so Arabic users get the CSV until then.

### 5.7 Pulse (D7, A12)

The `yourMove` template is message 4. Lane 7 builds messages 5 (Update), 6 (Countdown) and mission complete as new template functions and wires message 4 to Move records. Recipient is only the verified account holder. Titles and dates only; prices, supplier names and files stay behind sign-in. Mute per request, daily digest, quiet hours by time zone. Plain-text twin, no open-tracking pixel, single column, dark-mode safe, right-to-left ready, links to the canonical origin only. Web push after email; WhatsApp is not covered. Requirements V3-06-009 and V3-09-045 stay GATED or PARTIAL.

## 6. The lanes

Each lane starts with section 3A and ends at its stop line. Premises are checked first; if one is false, the lane stops and reports.

### Lane 1. Foundation: inventory, teaching layer, reserved names (Wave 1)

Branch `ux/l1-foundation`. Depends on nothing. Merges first.

**Owns:** `docs/design-system/phase-1-data-inventory.md` (with its documentation-map entry), `apps/web/components/mr/**` (new), additions to `apps/web/components/corridra-icon.tsx`, new entries in `apps/web/lib/owner-switches.ts`, one commit in `apps/web/next.config.ts`, additions to `tests/ux/specimen.spec.ts` and new unit tests. **Reads only:** everything else.

**Premises to verify first:** no production route imports `components/mr`; `owner-switches.ts` accepts `planned` entries without a state source; `tests/ux/specimen.spec.ts` builds its fixture inside the test and there is no specimen route.

Tasks, in order:

1. **Data inventory (documentation, no code).** For each customer area list the exact fields a signed-in customer can read and the function or route that returns them: requests and their progress; drafts; customer decisions; workspace invitations; company links and their status; service requests with the status values and the actions at each; programmes and participants; delivered commercial reports; the billing pages (default off). Confirm from the code the premise that the request list returns `progress` with `status`, `receivedAt` and `replies` only inside the retention window, citing `customer.private_requests`, `customer_private.request_result`, `app.mission_receipt` and the component that validates them. Produce the complete route list for All tools by running `find` over `page.tsx` and `route.ts` under `apps/web/app`, classified as customer, public, recipient by link, staff, contributor, founder or API. List every status word the customer can see and where it is shown. State what a customer cannot read. Answer: can a request be joined to a saved commercial mission for the same customer? Which Move sources in 5.2 are readable? Anything the design needs that is not readable becomes a numbered "needs backend" item for Lane 3 and Wave 3. Do not work around it.
2. **Reserve names** as kind `planned`, each with a plain label, one line and the right group: `CORRIDRA_UX_MOVE`, `CORRIDRA_UX_ROAD`, `CORRIDRA_UX_LENSES`, `CORRIDRA_UX_NAV`, `CORRIDRA_UX_FIRSTQ`, `CORRIDRA_UX_TRIP`, `CORRIDRA_UX_MOVE_RECORDS`, `CORRIDRA_REPLY_PAGE`, `CORRIDRA_PULSE_ENABLED`, `CORRIDRA_STATUS_LINK`, `CORRIDRA_SHARE_CARD`, `CORRIDRA_UX_OPERATOR_URLS`, `CORRIDRA_UX_PROGRAMME`, `CORRIDRA_UX_FAIRS`, `CORRIDRA_UX_BOOKS`. Not `CORRIDRA_UX_I18N`. Do not touch existing entries. The owner page test must still pass.
3. **Reserve headers** in `next.config.ts` for the four prefixes in 3G, copying the existing pattern exactly. Check the compiled headers after a build (register, then rebuild).
4. **Teaching layer** under `apps/web/components/mr/`: a holder badge with three fixed shapes (You, Corridra team, and Supplier or Buyer), always with the word; the Road, built on `JourneyBar` semantics (ordered list, `aria-current`, done markers), vertical on phones and horizontal on wide screens, with four shapes (done, now, later, not tracked yet); `statusToRoadStep`, a pure typed function for the 5.3 mapping with tests for every status, an unknown status, and the monotone property over the transition graph in `packages/missions/src/index.ts`; a Move card (one verb, one object, one holder, a date only when a real date is passed in); a comparable seal and quote card as pure presentation taking the engine's result; a ghost state (an empty screen drawn as a faded real one, tagged "Example"); a sample or real label for the tenant mode. Trust seals are `FactLabel`; add no second set. All text arrives as props. New glyphs go into `CorridraIcon` only. One motion: the marker advances inside 220 ms; off under reduced motion. Styles in `components/mr/*.css`, tokens only. No inline SVG.
5. **Specimen.** Extend the fixtures in `tests/ux/specimen.spec.ts` with every component in hover, focus, disabled, loading, selected, error and long-copy states, plus Bangla, Chinese and Arabic samples and one right-to-left sample. The UX baseline does not rise. Mount the components the way the operator specs mount theirs.
6. Unit tests for the mapping, accessible names, a pseudo-long-text test (text 40 percent longer) and reduced motion.

**Done when:** no new component is imported by a production route; the inventory is complete; names and headers are reserved; all checks are green; screenshots are stored. Then stop.

### Lane 2. Language, phase 2 (Wave 1, after PR171 merges)

Branch `ux/l2-language-phase2`. Depends on PR171 merged **[Decision 1]**. Writes ADR-0062.

**Owns:** `docs/adr/0062-*.md`, additions to the message module and tests added by PR171, the review record for each released language (reviewer name and date), a pure move of language styles out of `globals.css`. **Reads only:** `packages/domain/src/locale.ts`, fonts.

Tasks: write ADR-0062 (proposed) recording what PR171 does: browser-stored choice, release by setting, drafts by preview setting, right-to-left, numerals, and what is deliberately not done (cookie, server knowledge of the language). Add a test tying the UI language list to what `displayDate` and `displayMoney` accept. Add strings for the new components (Your Move, Room, Road, quote cards, first question) in English and as drafts for review. Move PR171's stylesheet lines into a component stylesheet without changing a rule. Record screenshots of Bangla text in buttons, labels and a table, and list the Bangla type question for the owner. Localization standard for every string: scannable at a glance; buttons one to three words; Bangla in a modern corporate register with transliterated tech words in Bengali script; terms like B2B and RFQ stay as professionals say them; words with legal or commercial weight translated for exact meaning; the five trust names never weakened; figures of speech translated by meaning.

**Done when:** with both language settings unset the page is byte for byte as main; tests pass. Then stop.

### Lane 3. ADR pack (Wave 1, documents only)

Branch `ux/l3-adr-pack`. Depends on nothing. Touches only `docs/` (ADR files, `docs/adr/README.md`, `docs/documentation-map.json`, `docs/product/phase2-*.md`).

Write four ADRs (status proposed) and one design note, then stop for approval. Each states the goal, the exact data, who can read and write, row-level security, the blast radius, abuse cases, rollback, the test plan and the controlling switch.

- **ADR-0063 Notification records and Pulse.** Align with `docs/product/phase0-mission-email-proposal.md`. Messages 5, 6 and mission complete; message 4 exists. Mute per request, daily digest, quiet hours by time zone, a stored language preference for mail, recipient only the verified account holder, titles and dates only, web push after email.
- **ADR-0064 Move records.** A staff-set record with a verb from a fixed list of about twelve, a holder, a date and a status, read by the customer through a security-definer function with row security, like `customer.private_requests`. Reuse the typed `MissionMove` input already in the mail code. State why the mission `next_action` must not be reused.
- **ADR-0065 Reply Page.** Extends the existing supplier response. Record that the database function already accepts the extra terms, list only the form and web changes, the review step, the link model, leakage, scraping, look-alike pages, rate limits, URL fragments in the WeChat and WhatsApp in-app browsers, the staff-entry fallback and the real-outreach gate that keeps the path sample only.
- **ADR-0066 Decision card and sharing.** A read-only, expiring card for a co-owner or bank using the existing link model. Team sharing stays off by default. Any sharing is explicit, revocable and audited.
- **Design note** `docs/product/phase2-interviews.md`: the 10 to 15 questions that decide whether the decision card and Pulse are worth building.

Add a short "Decision needed" list at the end of ADR-0058 without changing its status. **Done when:** the documents are merged and the pull request lists each owner decision in plain words. Wave 3 code lanes cannot start until the owner marks each ADR accepted.

### Lane 4. Front door, navigation and All tools (Wave 2)

Branch `ux/l4-front-door`. Depends on Lanes 1 and 2 phase 2 merged.

**Owns:** `apps/web/app/account/move/**` (new), `apps/web/components/customer-nav.tsx`, `apps/web/components/customer-shell.tsx` (only to pass the new tab set), `apps/web/app/account/all-tools/**` (new), `apps/web/app/account/page.tsx` (only the redirect of the bare address when the switch is on), navigation tests, and the amendment of `docs/agents/ui-direction.md`. **Does not own** the request, mission, billing or delegation pages (read and link only).

Tasks: (1) **First commit:** amend UI direction's customer navigation row, customer kit table and glossary, with the reason and the owner's recorded approval. The pull request cites V3-04-043 to V3-04-045 and V3-07-019. (2) **Your Move** at a new route under `/account/`, per 5.2, behind `CORRIDRA_UX_MOVE`. Sources are the five the code supports; none is invented. (3) **Navigation** behind `CORRIDRA_UX_NAV` per 5.1; `?view=` and hash redirects (`hash-redirect.tsx`) keep working; only the bare `/account` address redirects. (4) **All tools** generated from Lane 1's inventory with a plain verb per route; a test fails if any customer `page.tsx` is neither listed nor excluded with a written reason; recipient-by-link pages are excluded with a written reason; billing appears only when its switch is on. (5) Update the navigation tests for the labels the owner released, without weakening any assertion, and add the new assertions beside them. (6) Strings come from the message module: English, plus a draft Bangla set for review.

**Done when:** the parity table is complete; the legacy suites are green with switches off; both new pages are within budget; screenshots are stored. Then stop.

### Lane 5. Room, Road and lenses (Wave 2)

Branch `ux/l5-room`. Depends on Lanes 1 and 2 phase 2 merged. Writes ADR-0067.

**Owns:** `apps/web/app/account/rooms/[requestId]/**` (new), consumers of the Lane 1 components (compose, never edit them), `apps/web/components/comparison-matrix.tsx` (add a cards view beside the matrix and keep the matrix), `apps/web/app/account/missions/saved-commercial-report.tsx` (only to mount the lens), tests. **Does not own** `apps/web/app/account/requests/[requestId]/page.tsx` (link to the Room from it only with one line behind the switch).

Tasks: write ADR-0067 (proposed): the Road displays the real status a customer may already read, the mapping in 5.3, the holder rule, and what the page says when `available` is false. Build the Room per 5.3 and the lenses per 5.4. Scroll budget: a record, 4 phone screens and 2.5 desktop. Tests: mapping for every status; `available` false; no mission data reaches the page for another customer; comparison output unchanged against the existing engine tests. Switches `CORRIDRA_UX_ROAD`, `CORRIDRA_UX_LENSES`; `CORRIDRA_UX_TRIP` stays planned unless the inventory allows the Trip lens.

**Done when:** switches off equals main; on, the Room works for a sample mission; the comparison tests are untouched and green. Then stop.

### Lane 6. First question and sample label (Wave 2)

Branch `ux/l6-first-question`. Depends on Lane 1 merged, and Lane 2 phase 2 for strings.

**Owns:** the first step of `apps/web/app/plan/intake.tsx` only (read the whole file first; device memory and the code link from Phase 0 live there and must not change), `apps/web/components/mr/first-question.*`, the mode label mount point in the header (rebase on PR171's change to `site-header.tsx`), a proposal document, tests. **Does not own** the home page.

Tasks: (1) a picture-first first question behind `CORRIDRA_UX_FIRSTQ`: Buy products, Buy a machine, Sell abroad, Lead a group trip, Something else. Every existing job type stays selectable; ship a mapping table from each picture to the job types it opens, taking the authoritative list from the code. The table also covers the home cards and the guided-draft starters so the three never disagree (A19) **[Decision 9]**; only `/plan` changes in this lane. Flow-step budget. Draft saving, retained submission, the receipt flow and the 24 hour draft handoff are untouched. (2) One sample or real label per tenant, replacing the always-on "(sample request)" screen-reader text on the header button; update the accessible-name tests without weakening them. (3) `docs/design-system/home-tiles-proposal.md`: a one-page comparison of the home chosen on 22 October with the four-tile idea, for the owner's decision. Do not change the home page.

**Done when:** switch off equals main; the mapping table is complete; the label test is updated and still strict. Then stop.

### Lane 7. Move records and Pulse (Wave 3)

Branch `ux/l7-moves-pulse`. Depends on Lanes 4 and 5 merged, Gate 2 passed, and ADR-0063 and ADR-0064 accepted. If either is not accepted, stop at once.

**Owns:** `packages/db/customer-move-migrations/**` and `packages/db/customer-notification-migrations/**` (new, additive), the installer wiring (first in line), `packages/auth/src/customer-moves.ts` and `customer-notifications.ts` (new), `apps/web/app/api/move/**`, `apps/web/app/api/pulse/**`, an operator panel for setting a Move (a new file, mounted with a one-line edit), the Your Move source for Move records, and new template functions for messages 5, 6 and mission complete. Message 1 is not edited. Message 4 gets its trigger from Move records.

Build exactly what the accepted ADRs say, and the mail rules in 5.7. Tests: denial (another customer, another tenant, signed out), idempotence, retry caps, mute scope, no personal data in logs, populated upgrade preservation of the existing mission mail module. Before Pulse ships, extend the sign-in return rule (`accountReturnTo`, which allows only `/plan` today) to a short allow-list of exact internal paths with strict validation, so an email link reaches its page after sign-in (A18). It is navigation only and grants no access. Nothing is installed or enabled by merging. The owner's install steps go in `docs/product/phase2-install.md`. Switches `CORRIDRA_UX_MOVE_RECORDS`, `CORRIDRA_PULSE_ENABLED`; enabling needs the owner's privacy review.

### Lane 8. Reply Page (Wave 3)

Branch `ux/l8-reply-page`. Depends on Lanes 4 and 5 merged, Gate 2 passed and ADR-0065 accepted. Merges after Lane 7 on the installer files, if it needs them.

**Owns:** additions to the supplier response under `apps/web/app/buyer/**` or a `reply` route as ADR-0065 decides, a migration module only if a check shows the database function cannot accept the new terms, `apps/web/app/api/reply/**`, the operator review queue as a new file mounted with a one-line edit, a limited Chinese catalogue for this page, tests.

Build exactly what ADR-0065 says, per 5.5. Add the missing terms to the form first; they need no database change. Operator side: review beside the requirement with the engine's gaps highlighted; actions to publish to the customer, ask the supplier for missing terms (a pre-filled link), or reject with a reason. Tests: link expiry and revocation, replay, tampering, field allow-listing, rate limits, a narrow mobile viewport, and a written manual test plan for the WeChat and WhatsApp in-app browsers. Nothing is enabled by merging. Switch `CORRIDRA_REPLY_PAGE`.

### Lane 9. Operator URLs and view-as stage 2 (Wave 3, optional)

Branch `ux/l9-operator-urls`. Depends on Wave 2 merged and the owner's "go" for view-as stage 2. Optional **[Decision 7]**: stop and ask if any protected operator test needs an edit. It may link each Today row to its mission through the section URL (the rows are text only today).

Give each of the 18 operator sections a real URL that renders the same workspace with that section selected, while `#hash` links keep working and the 18 ids and mounted panels are unchanged. The dynamic segment must not shadow `owner`, `setup`, `signin`, `forgot-password`, `reset-password` or `view-as`. Extend view-as stage 2 (real components with sample data) to render Your Move and the Room as inert samples for the customer role. Switch `CORRIDRA_UX_OPERATOR_URLS`.

### Lane 10. Programme Room (Wave 4)

Branch `ux/l10-programme-room`. Depends on Gate 3. One session.

Regroup presentation only under `apps/web/app/account/delegations/**` (discover the files; the area is large): one shared Road for the programme, a private lane per participant company, a boarding list ("14 of 20 ready") showing readiness only and booking nothing, an Encounter-style agenda with conflicts inline, and a Money lens that keeps terms, fee schedules, pricing templates and the economics ledger exactly as built, with the four money domains never mixed. The organiser sees permitted activity and aggregates, never private participant data. Every sub-panel stays mounted and reachable. Prove parity with the table and with the existing delegation tests untouched. Switch `CORRIDRA_UX_PROGRAMME`.

### Lanes 11a to 11e. Languages (Wave 4)

One session each, at most two at once. Order: Chinese, Spanish, French, German, Arabic. Each depends on Lane 2 phase 2 and on a named native reviewer recorded by the owner. Each owns only its catalogue entries in the message module and its review record. Formal register for Spanish, French and German; modern corporate Chinese; Modern Standard Arabic in an enterprise register; short-label keys beside long ones for German and French; the pseudo-language test at 40 percent longer; for Arabic, full mirroring by logical properties with only directional icons flipped, and numerals decided with the reviewer. Never list a language before its sign-off.

### Lane 12. Fair pages, Countdown and the closing books (Wave 4)

Branch `ux/l12-fairs-books`. Depends on Gate 3. Fair pages store, for every date, who verified it and when, and show "dates last checked"; no date is inferred. Countdown appears only on a Road that has a real date; a missed milestone is stated plainly with the next possible date. Trip Book and Supplier Book build on the existing delivery PDF with Bangla and Chinese fonts and contain the commercial itinerary only (A11). Switches `CORRIDRA_UX_FAIRS`, `CORRIDRA_UX_BOOKS`. Fair pages are reading pages for the budget.

### Lane 13. Helper and founder front doors (Wave 4, to be scoped) **[Decision 8]**

Not started and not scoped. The helper area (`/contributor`, `/network`) and the founder view (`/operator/owner`) each get a front door that follows the charter's shape, with the locked navigation sets in UI direction. The owner schedules it after Wave 3.

## 7. Owner steps

| #   | Task                                                                                                                 | When                           |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Decide PR171 and re-scope Lane 2 **[Decision 1]**                                                                    | before Wave 1                  |
| 2   | Delete `ccr-998044a6-w7yufu`; decide `fix/view-as-preview-polish` and `docs/network-release-status` **[Decision 2]** | before Wave 1                  |
| 3   | Create the label `merging`; name the integrator **[Decision 3]**                                                     | before Wave 1                  |
| 4   | Approve the navigation amendment and labels, and the plain-label test **[Decision 4]**                               | before Wave 2                  |
| 5   | Confirm the Road mapping and holder rules **[Decision 5]**                                                           | before Lane 5                  |
| 6   | Approve, change or reject ADRs 0062 to 0067 and 0058                                                                 | before Wave 3                  |
| 7   | Pass Gate 2 and Gate 3                                                                                               | before Waves 3 and 4           |
| 8   | Run the install workflow for new database modules, and set production switches                                       | when each lane reports         |
| 9   | Run the code sign-in test for an address with no account and record it in the runbook                                | any time                       |
| 10  | Register the Neon mail webhook on the non-production branch first (there is no Neon fallback once registered)        | when ready                     |
| 11  | Write the one founder sentence (`MISSION_EMAIL_FOUNDER_LINE`)                                                        | before mission mail is enabled |
| 12  | Name a native reviewer per language and record the sign-off; review the privacy wording for the stored language      | per language                   |
| 13  | Review the seven Pending items on `ART_REVIEW.md`                                                                    | any time                       |
| 14  | Run the interviews, the supplier test and set service promises                                                       | by Gate 3                      |
| 15  | Parallel width, Bangla interface type, and Lane 9 **[Decision 7]**; schedule Lane 13 **[Decision 8]**                | as each lane approaches        |
| 16  | One starter set across home, `/plan` and guided drafts **[Decision 9]**                                              | before Lane 6                  |

## 8. Journeys

The journeys, before and after this plan, are drawn in a private canvas linked from the verification record. The table says which lane changes which journey.

| Journey                                          | What changes                                                                      | Lane    | Wave |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ------- | ---- |
| Visitor starts a request                         | Picture-first first question, one sample or real label, a language control        | 6, 2    | 2, 1 |
| Create an account and sign in                    | No change to the steps; a language control                                        | 2       | 1    |
| Return and see what is waiting                   | Your Move replaces Home                                                           | 4       | 2    |
| Follow a request                                 | The Road and message strip replace the status word                                | 5       | 2    |
| Compare quotes and decide                        | Quote cards with the engine's verdict; the matrix stays                           | 5       | 2    |
| Companies, service requests, workspaces, billing | Same pages under Companies and More; cards on the front door when something waits | 4       | 2    |
| Supplier or buyer replies                        | The Reply Page extends the supplier response                                      | 8       | 3    |
| Email                                            | Message 4 gets its trigger; messages 5, 6 and mission complete                    | 7       | 3    |
| Organiser runs a programme                       | Programme room regroups the same panels                                           | 10      | 4    |
| Participant                                      | No change in phases 1 to 3                                                        | none    | none |
| Delivery views by link, mute                     | No change                                                                         | none    | none |
| Corridra team                                    | Optional real URLs per section; a panel to set a Move; the reply review queue     | 9, 7, 8 | 3    |
| Helper and founder                               | Later wave                                                                        | 13      | 4    |
