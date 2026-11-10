# Workflow intelligence and plain-language programme

Document status: CURRENT.

Owner mandate, 10 November 2026, given directly to session S17 (`session_0187kU9tKW97MLLTBWV9mtvY`, Opus): improve Corridra's commercial workflows, journeys, interface quality and development execution, prove each improvement, and preserve every authorised action. The owner's definition of success, verbatim: "Users(of 5th grade 12th grade literacy level) should know why they are on each screen, what they can do, what happens next, and how to progress toward a real commercial outcome." The mandate also says: "Never infer release authorization from this prompt" and asks for approval before any persistent tool installation.

This spec adds scope inside the [V3 revamp](../README.md). It never overrides the [V3 contract](../../V3_CONTRACT.md), the [UI direction](../../agents/ui-direction.md), the [AC/1 design system](../../design-system/README.md), the [layout budget](layout-budget.md) or an accepted ADR. Merges follow the current lanes rule (exact-head green CI plus Guardian PASS, the owner merges migrations and installers). Live state stays in the [ledger](../../V3_LEDGER.md).

## 1. Reality audit at main `9c48ead5`

Sources: `docs/revamp/COVERAGE.json` (127 routes, 79 IMPLEMENTED, 48 GATED, none VERIFIED), a read-only code map of five journeys, and direct reading of the files cited. "Verified" below means read in source by S17, not runtime acceptance.

| Area                          | State                                                                    | Evidence                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public intake `/plan`         | Implemented; real mode deployed under ADR056; runtime journey unverified | 5 steps (Goal, Where, Details, Results, Contact), about 16 to 25 fields, draft kept 24 hours in the tab (`apps/web/app/plan/intake.tsx:113-124`)                                                                             |
| Account need in real mode     | Implemented, disclosed late                                              | Password (at least 14 characters) and "Activate your account" appear only on step 5 (`intake.tsx:1453-1495`)                                                                                                                 |
| Customer Home and Work        | Implemented, several parts gated                                         | `apps/web/app/account/page.tsx` with views home, work, results, more                                                                                                                                                         |
| Request Room (sell or source) | Implemented behind `CORRIDRA_UX_ROAD`                                    | One next step chosen by state (`account/rooms/[requestId]/room-view.tsx:136-183`); the idle state names the Corridra team as holder                                                                                          |
| Decision and quote compare    | Implemented, gated by customer decision switches                         | `account/missions/[resourceId]`; the room and the mission page are two screens for one decision (overlap not yet measured)                                                                                                   |
| Delegation organiser          | Implemented, gated by `CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED` and others  | `/account/delegations/organise` shows only a workspace chooser before any programme work (`organise/page.tsx`)                                                                                                               |
| Operator Today                | Implemented                                                              | "Needs you now" counts only new requests and overdue missions (`operator/today.tsx:172-190`); customer questions, supplier or buyer replies and evidence waiting for review live in other sections                           |
| Operator mission page         | Implemented                                                              | 8 tabs; Companies, Quotes and Meetings tabs summarise and link out (`operator/mission-page.tsx:26-35`)                                                                                                                       |
| Reading level of copy         | Not measured anywhere                                                    | No readability check exists in `tests/` or `scripts/`; the UX gate checks layout, targets, focus and axe only. The plain-language rules in the UI direction (sentences under 20 words, common words) have no automated guard |
| Rejected finding              | Not a defect                                                             | `/account` links to `/plan#receipt-check`, which is hidden only for private programme submissions (`intake.tsx:318`, `:1629`), a mode an account visitor does not reach from that link                                       |

## 2. Journey improvement matrix

| Journey                           | Current experience (verified in source)                                      | Defect                                                                                   | Intervention                                                                                                      | Expected benefit (reasoned, not measured)                                  | Batch |
| --------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----- |
| All, every screen                 | Copy written to rules nobody measures                                        | Long or hard sentences for readers at grade 5 to 12 cannot be found or kept from growing | Reading-level measurement in the UX gate with a baseline that may only fall                                       | Every later copy change shows a before and after number                    | W1    |
| A, B, C, D new real customer      | Learns at step 5 of 5 that an account and a 14-character password are needed | Surprise at the end of the longest form; no early "Sign In" for returning customers      | One plain line on the first step shown: a password is set on the last step; returning customers get Sign In there | Fewer abandoned forms at step 5; returning customers skip retyping details | W2    |
| A, B, C customer copy             | Hints and notices on `/plan` and customer screens                            | Sentences above the measured limits (list produced by W1)                                | Rewrite the worst non-legal sentences in plain words; legal, privacy and consent text untouched                   | Lower grade and fewer long sentences, measured by W1                       | W2    |
| E operator                        | "Needs you now" shows new requests and overdue missions only                 | Waiting customer questions and counterparty replies are not in the first view            | Surface existing pending counts from existing endpoints in Today, each linking to its section; no new data        | The next useful action is visible without opening other sections           | W3    |
| D organiser                       | Workspace chooser before any programme work                                  | An extra step for the common one-workspace case                                          | When exactly one programme workspace exists, show it as the primary action; the chooser stays for more            | One fewer decision on the most frequent path                               | W4    |
| A, B, C waiting state in the Room | Idle next step says the team is working; primary button opens the request    | Holder wording differs from the glossary ("Waiting on the Corridra team")                | Align the idle state with the glossary words; keep every destination                                              | One word per idea across screens                                           | W4    |

Not changed by this programme: the mission stage command (reason, owner, next action and due date are domain-required in `packages/domain/src/missions.ts:145-168`), permissions, payloads, element names and ids, money, evidence and consent semantics.

## 3. Tool decisions

Read from each repository's README on 10 November 2026. No tool is installed. Any install needs the owner's approval and goes in its own PR.

| Tool                                                    | Decision                     | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impeccable (`pbakaus/impeccable`, Apache-2.0)           | Hold install; use the method | Its installer offers an edit hook that runs even when commands are denied, a live mode whose Apply can run an agent with permission checks off, telemetry, and `init` and `document` create `PRODUCT.md` and `DESIGN.md`, which would compete with the UI direction and design system. No release tag to pin. Its critique and audit questions are used as review prompts by the S17 reviewer without installing anything. If the owner wants it: project scope only, no hook, telemetry off, no `init` or `document`, pinned by commit. |
| Graphify (`Graphify-Labs/graphify`, Apache-2.0 and MIT) | Reject for now               | Installs a search hook that can deny Read and Grep, writes `graphify-out/`, and a commit hook. The repository already has a deterministic inventory (`scripts/v3-inventory.mjs`, `COVERAGE.json`). Reconsider only for a change that spans several packages where the inventory is not enough.                                                                                                                                                                                                                                           |
| Diagram Design (`cathrynlavery/diagram-design`, MIT)    | Hold; draw by hand           | No hooks stated, but it loads web fonts and writes profile files outside the repository. Diagrams here are drawn only when a decision needs one, as plain SVG with AC/1 tokens.                                                                                                                                                                                                                                                                                                                                                          |
| Superpowers (`obra/superpowers`, MIT)                   | Reject install               | A start-of-session hook, skills that trigger themselves, worktrees and parallel agents conflict with AGENTS.md. The useful practices already exist here: `scripts/gate.mjs`, `pnpm preflight`, test-first cases named by id, and evidence-backed completion.                                                                                                                                                                                                                                                                             |
| Taste Skill (`Leonxlnx/taste-skill`, MIT)               | Reject                       | A Stop hook finish gate, copied assets and photography for marketing sites conflict with AC/1 and the content rules.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 4. Batches

One branch at a time (branch cap below nine). Each batch is one PR, built by a Sonnet session on the S17 branch and reviewed by S17 before it is marked ready for the Conductor.

### W1. Reading-level measurement (tooling only, no product change)

Files: `tests/ux/readability-lib.ts`, `tests/ux/readability.spec.ts`, `tests/ux/readability-baseline.json`, unit cases for the scoring functions, and this spec.

1. Same routes as the UX gate (every static public route, signed-out), production build, 1440 px wide, default state.
2. Read visible prose only: `p`, `li`, `dd`, `figcaption`, `label` hint text and `[role=alert]`/`[role=status]` blocks of at least five words, outside `header`, `nav` and `footer`, in English (`lang` absent or `en`). The footer is measured once, on `/`, under its own key.
3. Per route: words, sentences, Flesch-Kincaid grade over all prose, the count of sentences over 20 words, and the count of hard sentences (at least 8 words and a sentence grade above 9).
4. The baseline may not rise for long or hard sentences; the route grade may not rise by more than 0.5. New routes start from their measured values only with an explicit update flag, as the UX gate does. Lower the baseline when copy improves; never raise it.
5. A local report (in `work/`, not committed) lists the 20 worst sentences per route for W2.
6. Unit cases (named `R-01` and up) pin the syllable counter, sentence splitter and grade formula on fixed sample text.
7. The grade is an approximation for English; it guides plain words and never replaces native review or user testing. No screen claims a reading level.

Acceptance: the spec passes on the current build with the recorded baseline; unit cases pass; `pnpm format:check`, `lint`, `typecheck`, `test`, `build` and `test:ux` pass; no file under `apps/` or `packages/` changes.

#### W1 build notes

Built on the production build at `bf17e42b`, 1440 px wide, default state. Baseline recorded once with `READABILITY_UPDATE_BASELINE=1`; two later runs gave byte-identical reports.

- Route set: the UX gate's own route walk is not exported, so the spec uses `pageRoutes()` (docs/revamp/COVERAGE.json) filtered to the two public audiences with no dynamic segment, plus the corridor pages the gate also adds. That is 26 routes plus the footer under `/#footer`, 27 baseline entries. Two are not measured: `/coming-soon` redirects to `/`, and `/fairs` is unavailable. A static public page missing from COVERAGE.json would not be seen; there is no guard for that yet.
- Measured: 24 routes plus the footer, 1,697 words in 193 sentences. `/decision-card` has no prose block of five words in its default state, so it records 0 words.
- Totals: sentences over 20 words 1 (on `/sell`); hard sentences 33; grade median 5.95 and maximum 10.8 (`/about`), over the 24 routes and the footer that have prose.
- Five worst routes by hard-sentence count: `/about` 11 (grade 10.8); `/institutions` 4 (9.8); `/privacy` 4 (8.7); `/machinery` 2 (9.7); `/corridors/bangladesh-china` 2 (8.3, tied with `/enter-market` on count).
- `/plan` records only 28 words in its default state (5 sentences, grade 3.5, no hard sentence). Its later steps and hints behind a closed disclosure are not read, so the W2 rewrite list for `/plan` needs a second look at those steps.

Limits of the measure, plainly:

- The syllable counter is a vowel-group rule with a short exception list. It is often right and can be off by one on words such as "business", "every" or "doesn't". Short pages swing by a grade on one word.
- The sentence splitter knows a short list of abbreviations. A block with no closing mark, such as a list item, counts as one sentence. "U.S." at the end of a sentence does not end it.
- Only English prose in `p`, `li`, `dd`, `figcaption`, alerts, status blocks and the two hint classes is read. Headings, button and label text, and anything in `header`, `nav` or `footer` are not (the footer is read once, on `/`). A block that holds another prose block is read through the inner one only.
- Only the default state is read. Closed `details`, later steps, signed-in pages and other languages are not measured.
- The numbers guide plain wording. They are not a reading-level claim for any screen and never replace native review or user testing.

### W2. Early account notice and the worst copy

1. On the first intake step a real-mode, signed-out visitor sees (not in private mode, not when signed in): one plain sentence that a password is set on the last step so only they can read the replies, and the existing "Sign In" link with its existing return path. English words carry `lang="en"` in translated forms. No payload, field, name or id changes.
2. Rewrite the worst English sentences from the W1 report on `/plan` hints and public non-legal pages. Legal, privacy, consent and the owner-locked home headline are excluded. Each rewrite lowers the W1 numbers, and the baseline is lowered in the same PR.
3. `/plan` stays inside its confirmed limits (2.6 phone, 1.85 desktop) in `tests/browser/layout-budget-plan.spec.ts`.
4. `Sensitive: yes` (public unauthenticated route): needs Guardian PASS.

### W3 and W4

Specified in this file before their build, after W1 and W2 merge, with their files and tests read first.

## 5. Measurement

Measured for each changed journey: steps and fields before and after, repeated inputs removed, reading-level numbers from W1, UX gate counts, and the page lengths from the layout budget tests. Conversion, satisfaction, revenue and speed are not claimed: no measurement for them exists.
