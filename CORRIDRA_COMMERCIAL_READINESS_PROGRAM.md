# CORRIDRA COMMERCIAL READINESS PROGRAM v1.0

Document status: CURRENT.

## Owner override recorded 31 Oct 2026 (latest decision wins)

The owner launched this program in chat on 31 Oct 2026 with these added instructions: "I will be away, so must continue, execute and finish this entire thing with my advanced approval for everything, just proceed. Never get stuck for anything more than 35 minutes when you have other things to safely do. Also execute CI speedup for fastest merging and deploy. Keep committing, merging, deploying directly to production, no preview required in Vercel."

How the lead applies it, without widening anything else:

1. That chat message is the owner's merge command for the PRs of this program. Each PR merges to `main` only after its own CI `validate` check is green; a merge to `main` deploys itself (ADR050). No force push to `main`, no protection override.
2. Integration branch: the session branch `claude/sleepy-mccarthy-lchg16` plays the role of `release/commercial-ready-2026-11` so the repository stays inside the owner's branch budget (fewer than nine branches). Stream branches live only in local worktrees and merge locally into the integration branch; they are never pushed.
3. Production data (D20) and closed gates are unchanged: agents never connect to the production database, never dispatch the install workflow and never flip production settings. New schema ships as a reviewed module the owner installs with `Install customer modules`. Features behind the 5.4 flags ship dark in production until the owner sets the flag.
4. Verification runs against the local production build and the repository's isolated PostgreSQL, the same harness CI uses. "Vercel preview" in the text below reads as that harness.

---

**Source:** live QA review of https://c.obsidianglobal.studio on 31 Oct 2026 (87 defects CQ-01 to CQ-87 including 1 BLOCKER, 15 UX issues UX-01 to UX-15, 60 verification cases V-01 to V-60).
**Goal:** make Corridra ready for small-scale commercial use, with honest live wording, working end-to-end customer and team journeys, and a usable UI. Certain enterprise security controls are deferred by owner decision (section 9).
**Execution model:** 1 lead session, then 5 parallel workstreams in isolated git worktrees, then 1 integration pass. Designed so that streams never edit the same file and never wait on each other.

---

## 0. START HERE (owner: paste one line, then do nothing)

1. Put this file in the repository root as `CORRIDRA_COMMERCIAL_READINESS_PROGRAM.md`.
2. Open the repository in Claude Code desktop.
3. Paste this prompt:

```text
Read CORRIDRA_COMMERCIAL_READINESS_PROGRAM.md and execute it exactly as the LEAD. Run Wave 0 yourself, then launch the five workstreams in parallel as background subagents, each in its own git worktree, then run Wave 2 integration. Do not ask me questions: every decision is locked in section 2. Stop only on a STOP condition from section 3.6.
```

**The owner's only expected actions:**

- Approve tool permissions when Claude Code asks.
- At the end, review and merge one pull request, then promote the Vercel preview to production.

Agents never push to `main` or deploy to production. (Superseded by the owner override above.)

---

## 1. Definition of done

The program is done when all of the following are true:

1. Every item in sections 6.A to 6.E is implemented or explicitly marked DEFERRED with the reason from section 9.
2. Every repository quality gate passes on the integration branch (section 3.5).
3. Verification cases V-01 to V-60 (section 8) are automated as Playwright tests. They pass on the Vercel preview with a seeded Neon preview branch, except those marked DEFERRED.
4. `docs/qa/2026-10-31/RESULTS.md` exists in the format of section 10.
5. One pull request `release/commercial-ready-2026-11 -> main` is open and green, with screenshots for every UX change.

---

## 2. Locked decisions (agents must not ask; apply as written)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The product is LIVE for small-scale commercial use.** Remove every customer-facing and team-facing line that calls the live product test, sample, synthetic, invented, fictional, demonstration or "not yet available for real customers". Keep honest lines for features that are really off: online payment, AI assistance, automated outreach.                 |
| D2  | **Readiness and Owner pages tell the truth.** Status is "Live, small scale". Every open control (D01 to D08, OUTREACH, Live AI, RESTORE, WRITE) is shown as "Deferred by owner decision on <date of merge>" with its risk in one plain line. Never show a deferred control as passed or approved.                                                                   |
| D3  | **Real invoices stay blocked while legal details are made up.** The service refuses to issue a real invoice while any supplier field contains "(madeup)", and shows the owner one banner with the reason. Sample invoices and the "(madeup)" payment simulation stay available.                                                                                     |
| D4  | **Legal entity text.** /about uses exactly the controller wording from /privacy ("Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with operations in Gulshan, Dhaka, Bangladesh"). Add an owner checklist line to RESULTS.md: "Confirm Corridra Pte Ltd registration and real UEN before the first real invoice." Do not invent a UEN.                       |
| D5  | **One customer progress model** everywhere it describes a request: Define, Find, Compare, Visit, Decide, Follow through (the existing "Road"). The home and How it works pages use the same 6 names in plain words. The Trust page's 11 commercial stages stay, retitled "Commercial outcome stages (each needs its own evidence)".                                 |
| D6  | **Submitted is not draft.** No state machine change and no ADR. Customer-facing labels map the internal status of a request the customer has submitted to "Received, waiting for review". Only unsent guided drafts are called "Draft". Team Today counts only submitted requests as new or overdue.                                                                |
| D7  | **Notifications.** One notification service sends each email through the existing mission email provider and writes an in-app inbox item for every hand-off: team invite, contributor invite, participant invitation, task assigned, quote sent, quote accepted, report published, request received, reply posted. Copy-a-link stays only as a fallback button.     |
| D8  | **Team invites exist in the app**, built on the existing operator invitation model: owner and admin roles only, with email, role and a 7-day expiry, resend, cancel, and an audit event.                                                                                                                                                                            |
| D9  | **No raw machine values in any form.** References are chosen from searchable pickers. Dates use a date and time picker that shows the time zone. Money is typed in normal units with a live preview. Codes appear as plain labels. Raw JSON stays only behind an "Advanced (developers)" disclosure.                                                                |
| D10 | **Money entry.** One `MoneyInput` everywhere: the user types major units, storage stays in minor units, and the exponent comes from ISO 4217 (JPY 0, BHD 3). Currency pickers pin BDT, USD, EUR, CNY, GBP first and hide fund codes (BOV, CHE, CHW, CLF, COU, CUC, USN, UYI, XSU, XUA).                                                                             |
| D11 | **Date and time display.** One formatter: `24 Oct 2026, 06:08 (Dhaka, UTC+6)`, using the viewer's saved time zone, else the browser time zone. Date only: `24 Oct 2026`. No US numeric dates, no raw ISO strings anywhere in the UI.                                                                                                                                |
| D12 | **Timeouts never lose work.** Private view tokens become sliding with a 30-minute idle timeout. The step-up authenticator window stays 5 minutes, but a refused action returns `{ code: "STEP_UP_REQUIRED" }` and the client opens an in-place re-verify dialog, then retries automatically. Open forms keep a local draft.                                         |
| D13 | **Invitation codes are not shown again** (security). The organiser can email the code to the participant (new optional email field) or create a replacement. The UI says so in one line.                                                                                                                                                                            |
| D14 | **App shells.** Each role gets one shell: Public, Customer, Team, Contributor. No public marketing header inside Customer, Team or Contributor. The Team shell is a left sidebar: Today, Missions, Companies, Meetings, Quotes and billing, Reports, Network, Evidence, Settings. The Owner area is reached from Settings. Each route renders only its own section. |
| D15 | **Mission UI.** /operator/missions becomes a compact queue: one row per mission with customer, route, stage, owner, due date, next action and status chip. Add `/operator/missions/[missionId]` with tabs: Overview, Requirements, Companies, Quotes, Meetings, Delivery, History. Actions open one at a time in a side panel.                                      |
| D16 | **Languages.** English is the source. Add bn, zh, es, ar, fr and de strings for every new key, mark them in `docs/qa/2026-10-31/i18n-review.md` as "draft, needs native review", and keep privacy and consent lines in English with the existing note. Arabic is right to left in every shell.                                                                      |
| D17 | **Copy standard.** Plain, specific, natural English. No em dashes. No AI-sounding phrasing. No invented customers or claims. Made-up organisation data shows "(madeup)". Trust labels are exactly: Self-declared, Evidence available, Verified, Derived, Outcome observed. A meeting is never a sale; a contract is never cash.                                     |
| D18 | **Brand tokens.** Midnight Navy #142438, International Cobalt #2856C5 (links, focus, selected), Porcelain #F6F8FB (background), Copper #BF7548 (decoration only, never text), Ink #18283C (text). Newsreader for headings, Geist for text, Geist Mono for labels and codes only. Replace the off-palette text brown #865018 with Ink on the existing tint.          |
| D19 | **No new runtime dependencies** unless listed in Wave 0 step W0.6. No changes to the money ledger, evidence semantics, state machines, AI policy or RLS policies beyond section 5.2. Those require an ADR, and none is planned.                                                                                                                                     |
| D20 | **Production data.** Agents never connect to the production database. All work and tests use Neon preview branches from the sanitized parent. QA records listed in Appendix A are handled only by a dry-run script that the owner may run later.                                                                                                                    |

---

## 3. Global rules for every agent

### 3.1 Precedence

`AGENTS.md`, then the ADRs in `docs/adr`, then the Implementation Canvas, then this file, then nearby code. If this file conflicts with an ADR, follow the ADR, implement the nearest compliant version, and log it in your status file. Never stop for it.

### 3.2 Ownership is absolute

Each stream may create or edit **only** paths it owns, listed in `docs/qa/2026-10-31/OWNERSHIP.md` (produced in Wave 0). Reading any file is allowed. If a fix seems to need an unowned file:

1. Implement the nearest version inside your own paths, for example a local wrapper or an adapter.
2. Write the needed glue change as a one-line entry under "Integration notes" in your status file. The lead applies it in Wave 2.
3. Never edit the file yourself.

### 3.3 Shared files protocol

These files are touched by more than one stream and use pre-created marker blocks from Wave 0:

- **Locale catalogs:** add keys only inside your own `WS-X` block, with keys prefixed `wsx.`.
- **Navigation config:** Wave 0 fills every entry. Streams never edit it.
- **Migrations:** Wave 0 creates all of them. Streams never add migrations.
- **Package manifests and the lockfile:** streams never edit them.
- **Feature flag registry:** Wave 0 registers every new flag. Streams only read flags.

### 3.4 Token efficiency (mandatory)

- Read only: sections 2, 3, 4 and 5, plus your own section in 6. Read the Implementation Canvas only if your item names it.
- Find code with grep or glob first, then read only the needed line ranges. Never read a whole large file to find one thing. Never re-read a file you just edited.
- Group related edits into one pass per file.
- Run targeted tests while working. Run the full gate once at the end.
- Status updates are short: 10 lines maximum per update, 300 words maximum in the final report.
- Do not paste code or logs into status files. Point to paths and test names instead.

### 3.5 Quality gates

Every stream, at the end, in its worktree:

```text
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm exec playwright test tests/e2e/verification/<your-stream-folder>
```

If the repository uses different script names, use the equivalents recorded in OWNERSHIP.md. A stream is not done until its own gates pass. Never weaken a test, skip a test, or bypass RLS or authorization to pass a gate.

Every user-facing change must also pass all of these:

- **Keyboard:** usable with the keyboard only, with a visible focus outline.
- **Labels:** every control has a label, and every error is linked to its field and announced.
- **Size:** works at 390, 768 and 1280 px with no horizontal page scroll and tap targets of at least 44 px.
- **Copy:** follows D17.
- **Dates and money:** follow D10 and D11.
- **Languages:** follow D16.

### 3.6 STOP conditions (the only reasons to stop and ask the owner)

1. A change would touch production data or production configuration.
2. A required secret or credential is missing and no preview substitute exists.
3. A gate failure is caused by another stream's merged code and cannot be fixed inside your own paths. Report it; don't fix it.
4. Something looks like it exposes one customer's private data to another.

For anything else, choose the safest compliant option, record it in your status file, and continue.

### 3.7 Commits, branches and pull requests

- Branch: `qa/ws-a-public`, `qa/ws-b-customer`, `qa/ws-c-team-work`, `qa/ws-d-team-control` or `qa/ws-e-platform`, all from `release/commercial-ready-2026-11`.
- Commits are small and named with item IDs, for example `fix(plan): keep focus in field after validation [CQ-01]`.
- At the end, open a PR into `release/commercial-ready-2026-11` using the repository PR template: problem, architecture impact, data migration (none), privacy and security impact, tests, screenshots, rollback.

### 3.8 Status file protocol

Write to `docs/qa/2026-10-31/status/WS-X.md` inside your own worktree. Use this layout:

```text
State: RUNNING | BLOCKED(reason) | DONE
Items: <ID>=DONE|DEFERRED(reason)|PARTIAL(reason), ...
Gates: lint ok, typecheck ok, unit ok, integration ok, build ok, e2e ok
Integration notes: <one line each, for the lead>
Decisions taken: <one line each>
```

---

## 4. Execution plan

### WAVE 0: LEAD only, serial (target 60 to 90 minutes)

**W0.1 Baseline.**

1. Create branch `release/commercial-ready-2026-11` from `main`.
2. Run the full gate once and record the baseline in `docs/qa/2026-10-31/BASELINE.md`.
3. Note pre-existing failures. Streams are not responsible for those.

**W0.2 Recon and ownership.**

1. Map the real repository to section 5.1.
2. Write `docs/qa/2026-10-31/OWNERSHIP.md` with exact globs per stream, derived from the route and package rules in 5.1.
3. Make sure every source file has exactly one owner, or is marked LEAD.
4. Record the real script names for the gates.

**W0.3 Contracts.**

1. Create every interface in section 5.2 with a minimal working implementation, so every stream can compile against it from minute one.
2. Write unit tests for each contract's signature.

**W0.4 Schema contract.**

1. Write every migration listed in section 5.3: forward-compatible, all nullable or with defaults, with rollback notes and an RLS test for each new table.
2. Run the migrations on a fresh Neon preview branch and on an upgraded one.

**W0.5 Shared scaffolding.**

1. Insert empty marker blocks `WS-A` to `WS-E` in every locale catalog, separated by blank lines.
2. Write the final navigation config from D14 with every route, even routes whose pages don't exist yet (they render a "Coming in this release" placeholder owned by the route's stream).
3. Register the feature flags from 5.4, default ON in preview and OFF in production config.
4. Create `tests/e2e/verification/{ws-a,ws-b,ws-c,ws-d,ws-e,integration}/` with a shared fixture file.
5. Write the seed script `scripts/qa/seed-preview.ts`. It creates the accounts OWNER, REVIEWER, CUST_A, CUST_B, CONTRIB and PARTICIPANT, plus the "QA test (madeup)" records the V-cases need. Preview only; it refuses to run if the database host matches production.

**W0.6 Dependencies.** Allowed only if no equivalent already exists in the repository:

- an accessible combobox primitive, if `packages/ui` has none;
- a date and time picker primitive, if none.

Install them now in Wave 0 only. Never add any other dependency.

**W0.7 Commit and gate.**

1. Commit Wave 0 to `release/commercial-ready-2026-11`.
2. Run the full gate; it must be green, or match the baseline failures exactly.
3. Push.

### WAVE 1: five parallel workstreams (background subagents)

Launch all five in **one message**, each as a background subagent with `isolation: "worktree"`, branched from the Wave 0 commit. Use this prompt template:

```text
You are workstream WS-<X> of the Corridra Commercial Readiness Program. Your branch: qa/ws-<x>-<name>, created from release/commercial-ready-2026-11 at the Wave 0 commit.
Read only sections 2, 3, 4, 5 and section 6.<X> of CORRIDRA_COMMERCIAL_READINESS_PROGRAM.md, plus docs/qa/2026-10-31/OWNERSHIP.md.
Implement every item in 6.<X>. Edit only paths OWNERSHIP.md assigns to WS-<X>.
Write automated tests for your V-cases under tests/e2e/verification/ws-<x>/.
Keep docs/qa/2026-10-31/status/WS-<X>.md current.
When gates pass, push your branch, open the PR into release/commercial-ready-2026-11, and return a final report of at most 300 words: items done, items deferred with reasons, gate results, integration notes.
Never ask the owner questions. Follow section 3.6 for the only stop conditions.
```

The lead does not poll or read stream code while they run. It waits for completion notifications, and sets one fallback check-in at 2 hours in case a stream hangs.

### WAVE 2: LEAD integration (serial)

1. **Merge order:** WS-E, then WS-D, then WS-C, then WS-B, then WS-A.
   - Merge each PR into `release/commercial-ready-2026-11`.
   - Conflicts can only appear in marker-block catalogs. Resolve them by keeping both blocks.
   - Run the full gate after each merge. If a merge breaks the gate, the fault belongs to the stream just merged: fix only the glue, never rewrite stream logic.
2. **Apply integration notes:** apply every "Integration notes" line from the five status files as one commit, `chore(integration): apply stream glue`.
3. **Remove placeholders:** take out the "Coming in this release" placeholders whose real pages now exist.
4. **Run the verification suite:** run `tests/e2e/verification/**` on the Vercel preview with the seeded Neon preview branch. Re-run only failing cases, once, after a targeted fix.
5. **Run the UX measurement script** (V-56 to V-60) and attach its output to RESULTS.md.
6. **Write RESULTS.md** (section 10).
7. **Open the final PR** `release/commercial-ready-2026-11 -> main`, with the screenshot gallery and links to RESULTS.md. Do not merge it. (Superseded by the owner override above.)

---

## 5. Architecture contracts (built in Wave 0, then owned as listed)

### 5.1 Ownership rules (Wave 0 turns these into exact globs)

| Stream                                                    | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Never touches                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **WS-A Public and intake**                                | Public routes `/`, `/how-it-works`, `/about`, `/trust`, `/privacy`, `/plan`, `/sell`, `/source`, `/machinery`, `/enter-market`, `/business-trips`, `/trade-missions`, `/institutions`, `/network` (public page), `/corridors/**`, `/fairs`, `/coming-soon`, `/signin`, `/signup`, `/forgot-password`, `/workspace`, the not-found page; the /plan form module and its validation schemas; public page content files                                                                 | Shells, `packages/ui`, `/client`, `/buyer`, `/programme` |
| **WS-B Customer, participant and contributor experience** | `/account/**`, `/contributor/**`; customer-side components for requests, rooms, service requests and quote acceptance, delegations and programmes (organiser and participant), notifications settings page, profile, billing pages                                                                                                                                                                                                                                                  | Team routes, shells, quote and publication services      |
| **WS-C Team work**                                        | `/operator/missions/**` (including the new `[missionId]` route), `/operator/research`, `/operator/meetings`, `/operator/commercial`, `/operator/delivery`; `/client`, `/buyer`, `/programme` (private link views); packages `missions`, `opportunities` (quotes, invoices, commercial chain), delivery and publication services, `communications` producers for its events                                                                                                          | Network, evidence, settings, owner, auth, shells         |
| **WS-D Team control, access and trust**                   | `/operator` (Today home), `/operator/network`, `/operator/evidence`, `/operator/sources`, `/operator/operations`, `/operator/dashboard`, `/operator/control-center`, `/operator/health`, `/operator/readiness`, `/operator/settings`, `/operator/audit`, `/operator/authenticator`, `/operator/controls`, `/operator/setup`, `/operator/owner`, `/operator/view-as/**`, `/operator/signin`; packages `auth`, `dcg`, `evidence`; deferred controls register; QA data hygiene scripts | Customer routes, mission routes, shells                  |
| **WS-E Platform and UX system**                           | Root layout, the 4 role shells, header, footer, `packages/ui`, i18n infrastructure (not catalog blocks of other streams), formatters, notification service internals and email templates, middleware (host redirect, security headers), brand tokens and global CSS, operator shell section routing, the Playwright harness and UX measurement script, CI workflow files                                                                                                            | Any page content inside routes owned by A to D           |
| **LEAD**                                                  | Migrations, schema files, feature flag registry, navigation config, package manifests and lockfile, seed scripts, `docs/qa/2026-10-31/*` except stream status files                                                                                                                                                                                                                                                                                                                 | Stream logic                                             |

### 5.2 Interfaces (signatures fixed in Wave 0; the owner improves internals only)

| Contract                                                                                             | Owner after Wave 0                   | Signature and behaviour                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatDateTime(value, opts?)`, `formatDate(value)`, `formatRelativeDue(value)`                      | WS-E                                 | Per D11. `opts.timeZone`, else the viewer setting, else the browser. Never outputs ISO strings or US numeric dates.                                                                                                                                                                                                                          |
| `formatMoney(minor, currency, locale?)`, `toMinor(major, currency)`, `currencyExponent(code)`        | WS-E                                 | Per D10. Never adds different currencies.                                                                                                                                                                                                                                                                                                    |
| `<MoneyInput currency value(minor) onChange(minor)>`                                                 | WS-E                                 | Types major units and shows a live preview such as "USD 100.00".                                                                                                                                                                                                                                                                             |
| `<DateTimeInput value onChange timeZone>`                                                            | WS-E                                 | Shows the time zone label next to the value.                                                                                                                                                                                                                                                                                                 |
| `<SearchSelect options pinned? onChange>`, `<CountrySelect>`, `<CurrencySelect>`, `<TimeZoneSelect>` | WS-E                                 | Searchable. Pinned first: BD, CN, ES, then EU (countries); BDT, USD, EUR, CNY, GBP (currencies); Asia/Dhaka, Europe/Madrid, Asia/Shanghai, UTC (time zones). Labels are names, not codes.                                                                                                                                                    |
| `<ReferencePicker kind="contributor\|source\|mission\|route\|reviewer\|publication" onChange>`       | WS-E (UI) and WS-D (search APIs)     | Replaces every raw reference text field. Backed by `GET /api/picker/<kind>?q=` with tenant-scoped results.                                                                                                                                                                                                                                   |
| `useFormDraft(key)`                                                                                  | WS-E                                 | Session-scoped draft persistence. Restores after a reload or re-verify. Cleared on success.                                                                                                                                                                                                                                                  |
| `withStepUp(action)` plus `<StepUpDialog>`                                                           | WS-E (client) and WS-D (server code) | The server returns HTTP 401 with `{ code: "STEP_UP_REQUIRED" }`. The client opens the dialog, re-verifies the authenticator in place, then retries once. Any other failure shows a visible field or page error. Never silent.                                                                                                                |
| `<ActionFeedback scope>`                                                                             | WS-E                                 | Scoped success and error messages next to the action. Messages from other panels never show. Success clears after 6 s.                                                                                                                                                                                                                       |
| `<ErrorSummary>`                                                                                     | WS-E                                 | Receives focus **once** on submit, never on input change (fixes CQ-01 everywhere). Lists errors as links to their fields.                                                                                                                                                                                                                    |
| `<PageHeader title breadcrumb primaryAction>` and `pageMetadata(title)`                              | WS-E                                 | Each route sets a unique `<title>` and one H1.                                                                                                                                                                                                                                                                                               |
| `<StatusChip status>`, `customerRoad(mission)`                                                       | WS-E (component) and WS-B (mapping)  | Per D5 and D6.                                                                                                                                                                                                                                                                                                                               |
| `notify({ recipientAccountId, recipientEmail?, type, payload, locale })` and `<NotificationInbox>`   | WS-E                                 | Writes an inbox row (5.3) and sends email through the existing mission email provider when the user's email choice allows. `type` is an enum fixed in Wave 0: TEAM_INVITE, CONTRIBUTOR_INVITE, PARTICIPANT_INVITE, TASK_ASSIGNED, QUOTE_SENT, QUOTE_ACCEPTED, REPORT_PUBLISHED, REQUEST_RECEIVED, REPLY_POSTED. Producers (B, C, D) call it. |
| `listDeliveredPublications(customerAccountId)`                                                       | WS-C                                 | Returns approved publications for requests the customer created. WS-B renders them in Library, the room and Your Move. Wave 0 stub returns [].                                                                                                                                                                                               |
| `getTeamToday(tenantId)`                                                                             | WS-D                                 | Returns new submitted requests, overdue submitted requests, accepted quotes not started, replies to review and meetings in the next 7 days. Wave 0 stub returns zeros.                                                                                                                                                                       |
| `assignRoute(missionId, routePackVersionId)`                                                         | WS-C                                 | Records a route assignment for a mission. Uses the existing route assignment model.                                                                                                                                                                                                                                                          |
| `createRoutePack(input)`                                                                             | WS-D                                 | Takes guided form input and builds the existing reviewed command server-side. No raw JSON from the user.                                                                                                                                                                                                                                     |

### 5.3 Schema contract (Wave 0 migrations only; all additive)

1. `notifications`: id, tenant_id, recipient_account_id, type, payload jsonb, read_at, created_at; with RLS so only the recipient reads it.
2. `team_invitations`: only if the existing operator invitation model lacks resend, cancel or expiry fields; then add those columns instead of a new table.
3. Nullable `mission_id` and `organisation_id` on sources and claims (CQ-80).
4. Nullable `recipient_email` on programme participant invitations (D13).
5. Indexes needed by `getTeamToday` and `listDeliveredPublications`, if missing.

No column renames, no drops, no state machine enum changes.

### 5.4 Feature flags (registered by the LEAD; preview ON, production OFF until the owner flips them)

- `CORRIDRA_UX_SHELLS_V2` (D14)
- `CORRIDRA_UX_MISSIONS_V2` (D15)
- `CORRIDRA_NOTIFICATIONS_V2` (D7)
- `CORRIDRA_TEAM_INVITES` (D8)
- `CORRIDRA_ROUTE_PACK_FORM` (CQ-66)

Copy and content fixes ship without flags.

---

## 6. Workstream packets

Each item lists: ID, where, the defect, and what "done" means. V-cases are the automated proof (section 8).

### 6.A WS-A Public site and request intake

| ID                  | Where                                    | Defect                                                                                                                                                                                                                     | Done when                                                                                                                                                                        |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CQ-04               | /corridors/bangladesh-china, -spain, -eu | Says "Not yet available: Real customer mission admission", "scoped synthetic test journeys", "Operator validation uses invented records"; button "Prepare a test mission request"; jargon such as "Structurally supported" | Availability block rewritten per D1 in plain words; button reads "Start a request on this route"; Spain page talks about buyers, not supplier offers                             |
| CQ-05               | /business-trips, /machinery              | "This test flow lets you describe a mission with invented details"; "Prepare a ... example request"; ALL CAPS titles                                                                                                       | Live wording; buttons read "Plan a business trip" and "Plan a machinery request"; titles in sentence case                                                                        |
| CQ-11               | /plan step 3                             | Raw "Too small: expected string to have >=3 characters" under an optional empty field                                                                                                                                      | All schema messages mapped to plain text on the correct field; optional fields never error when empty                                                                            |
| CQ-13               | /plan step 4                             | "Desired outcomes" required but unmarked, next to a field labelled "(optional)"                                                                                                                                            | Required groups marked "Required", with an error next to the group                                                                                                               |
| CQ-14               | /plan?job=                               | A resumed draft overrides the chosen journey; ?job is not reapplied after Clear draft                                                                                                                                      | If ?job differs from the draft, ask "Continue your saved request or start a new <job> request?"; after Clear draft, ?job applies                                                 |
| CQ-15 (adopt)       | /plan, /corridors                        | Countries sorted by ISO code                                                                                                                                                                                               | Use `<CountrySelect>`                                                                                                                                                            |
| CQ-16               | /plan group trip, step 3                 | Seller wording and towel placeholder                                                                                                                                                                                       | Trip-leader questions and placeholder for the delegation job                                                                                                                     |
| CQ-18               | /about                                   | Operator statement differs from /privacy                                                                                                                                                                                   | Per D4                                                                                                                                                                           |
| CQ-19               | /workspace                               | Says "needs no account"                                                                                                                                                                                                    | "Start without an account. You create one at the last step to send it."                                                                                                          |
| CQ-25               | /, /how-it-works                         | 4 steps on home, 8 on How it works, jargon labels                                                                                                                                                                          | Per D5, with jargon labels removed                                                                                                                                               |
| CQ-38               | /signup                                  | No 14-character rule shown; subtitle says "Sign in"                                                                                                                                                                        | Rule shown under the field before submit; subtitle "Create your account to send and follow requests."                                                                            |
| CQ-41               | /corridors                               | "built for any route" vs "Two routes to start"; mixed route, corridor and direction terms                                                                                                                                  | One term: "route". Copy: "We start with Bangladesh to China, Spain and the EU. Ask us about other routes."                                                                       |
| CQ-43               | /fairs                                   | Empty with no next step                                                                                                                                                                                                    | Empty state with "Ask us about a fair" linking to /plan?job=trade_fairs                                                                                                          |
| CQ-44               | not-found                                | Title is the home title                                                                                                                                                                                                    | Title "Page not found \| Corridra"                                                                                                                                               |
| CQ-45               | /account while signed out                | Return path lost                                                                                                                                                                                                           | /signin?next=... preserved and honoured after sign-in (safe internal paths only)                                                                                                 |
| CQ-49               | /plan step 5, receipt box                | No autocomplete; native validation bubble; no hint about receipt codes; "Original budget" shown but never asked                                                                                                            | Autocomplete name, organization and email; custom error style; hint "The code from your request receipt email"; budget row hidden unless supplied                                |
| CQ-53               | / at phone width                         | Swipe carousel has no hint                                                                                                                                                                                                 | Visible next and previous controls and a peek of the next card                                                                                                                   |
| CQ-58               | /plan submit while signed in             | No confirmation, no receipt, status DRAFT                                                                                                                                                                                  | Success page with "Request sent", the receipt code, what happens next, and a link to the request; calls `notify(REQUEST_RECEIVED)`; label per D6 (WS-B handles the account side) |
| UX-08 (public part) | /, /how-it-works                         | Different step models                                                                                                                                                                                                      | Per D5                                                                                                                                                                           |
| UX-14               | /privacy                                 | 8 screens with no contents list                                                                                                                                                                                            | Contents list with anchors and a 5-line summary at the top; legal text unchanged except D4                                                                                       |

**V-cases:** V-10 (submit part), V-49, plus new A-1 to A-6: no forbidden words on public pages; /plan error focus stays in the field; ?job switch; signup rule visible; 404 title; next param honoured.

### 6.B WS-B Customer, participant and contributor experience

| ID                   | Where                                           | Defect                                                                         | Done when                                                                                                                                           |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| CQ-06                | /account/request/[id]                           | "TEST MODE ... use @example.invalid ... Email delivery is not enabled"         | Removed per D1. This form becomes the signed-in route into the /plan flow (UX-07): one request form                                                 |
| CQ-07                | /account/delegations, /account/delegations/[id] | "Fictional registration only." and "Fictional planning only."                  | Live wording per D1                                                                                                                                 |
| CQ-21                | /account/move, rooms                            | A submitted request shows as draft and "Nothing is waiting"                    | Your Move lists the customer's real next actions; unsent drafts show "Finish and send"; submitted requests show "Received, waiting for review" (D6) |
| CQ-22                | /account/drafts/[id]                            | An error shows on load; "no saved drafts" while drafts exist                   | No error before input; the drafts list matches                                                                                                      |
| CQ-23                | Saved requests                                  | Every card titled "Request"; empty reference                                   | Title is objective plus market (for example "Sell in Spain"); reference shown or row hidden                                                         |
| CQ-24                | /account/requests/[id]                          | Unordered fields, duplicates, Title Case, "Request format version", raw "AZ"   | Grouped and ordered (Goal, Where, Details, Results, Contact); deduplicated; sentence case; internal fields hidden; country names shown              |
| CQ-26                | Customer tabs                                   | Tab names and page headings don't match                                        | Tabs: Home, Requests, Companies, Reports, Account. Headings match. "Manage programmes" opens "Programmes"                                           |
| CQ-27                | /account/service-requests/new                   | Plain 404 without parameters                                                   | Shows a source picker ("What is this help for?")                                                                                                    |
| CQ-28                | /account/profile/[id]                           | Free-text country code; reason required on first save                          | `<CountrySelect>`; reason only required when editing                                                                                                |
| CQ-30 (copy)         | Notifications page, request form                | Contradictory email statements                                                 | One true statement, using WS-E's notification state                                                                                                 |
| CQ-37                | Programme fees                                  | "start charging participants" wording                                          | "Record fees owed by participants (your own bookkeeping; Corridra moves no money)"                                                                  |
| CQ-50                | /account/notifications                          | 5 email languages; raw time zone IDs; "Not sent yet" rows                      | All 7 languages; `<TimeZoneSelect>`; message types not yet sent are hidden instead of listed                                                        |
| CQ-51, CQ-52         | Delegations, Library, work view                 | "Inspect a invitation", "authorized"; button wall; misaligned buttons          | Grammar and UK spelling fixed; one primary action per card, the rest in a "More" menu; buttons aligned                                              |
| CQ-56                | Workspaces, billing                             | "Example workspace" without "(madeup)"; "sample plan" wording                  | Made-up workspaces show "(madeup)"; plan copy for live accounts                                                                                     |
| CQ-60, CQ-61, CQ-63  | /contributor, /contributor/setup                | Wrong "no invitation" message after setup; no task state; no password rule     | Shows "You're set up. No tasks assigned yet" or the task list; password rule shown; cards no longer loop back                                       |
| CQ-70 (customer)     | Help request form                               | "Where do you need it?" offers only "Scope agreed per request"; US date format | Real place options from the source; `<DateTimeInput>`                                                                                               |
| CQ-71                | Help request sent                               | Confirmation off-screen                                                        | Scrolls to and focuses the confirmation                                                                                                             |
| CQ-72                | Quote accept                                    | Turns "OUT OF DATE" during confirm                                             | Uses `withStepUp` and fresh fetch; "out of date" only if the quote really changed, with a "Review the new version" action                           |
| CQ-77 (customer)     | Library, room, Your Move                        | Published reports never appear                                                 | Renders `listDeliveredPublications`; Your Move item "New report ready"                                                                              |
| CQ-82 (client)       | Programme pages                                 | Forms vanish on view expiry                                                    | `useFormDraft` plus `withStepUp`; no form unmounts on refresh                                                                                       |
| CQ-83                | Programme invitations                           | Raw ISO expiry; "sample" and "test participant" wording; "Create a invitation" | `formatDateTime`; live wording; grammar fixed                                                                                                       |
| CQ-84 (adopt)        | Fee schedules                                   | Two money conventions; 168 currencies                                          | `<MoneyInput>` and `<CurrencySelect>`; amounts shown in the schedule list                                                                           |
| CQ-85                | Programme saved                                 | "Not available here" next to "Invite: NOW"                                     | Message removed; the Invite step links to the People tab                                                                                            |
| CQ-86                | Participant codes                               | Code shown once; lost on expiry                                                | Per D13: "Email code to participant" (calls `notify(PARTICIPANT_INVITE)`) and "Create replacement code" with a one-line explanation                 |
| CQ-87                | Participant registration                        | Jargon success text; reminders error; duplicate "Apply for a place"            | "You're registered for <programme>."; reminder error fixed or hidden when empty; one button                                                         |
| UX-07                | Requests home                                   | Three request forms; 7 buttons per workspace                                   | One "New request" primary action; one requests list with status chips; workspace settings under Account                                             |
| UX-08 (account part) | Road, room                                      | Per D5 and D6                                                                  | `customerRoad()` used everywhere                                                                                                                    |

**V-cases:** V-23 (customer side), V-25 (customer side), V-30 (customer side), V-32, V-37, V-38, V-39, V-40, V-41, V-42, V-43, V-44, V-46, plus B-1 to B-4: no forbidden words in /account; requests list titles; contributor post-setup state; Arabic account right to left (with WS-E's shell).

### 6.C WS-C Team work: missions, quotes, delivery, private views

| ID                                            | Where                       | Defect                                                                                                            | Done when                                                                                                                                             |
| --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01, UX-10, CQ-55, CQ-69, CQ-36 (page part) | /operator/missions          | 14 screens; every form shown at once; inert Jump-to; panel opens far down                                         | Per D15: queue plus `/operator/missions/[missionId]` tabs; side-panel actions; links move view and focus; queue renders in under 2 s with 50 missions |
| CQ-08                                         | /operator/meetings          | "Invented records only. Synthetic delivery sends no email"; "demonstration channel"; empty list without a message | Live wording that states the real channel; "No introductions yet" empty state                                                                         |
| CQ-09                                         | Mission detail              | "Route not classified"; empty route filter                                                                        | Overview tab gets an "Assign route" action (`assignRoute`) listing reviewed packs from WS-D; filter lists the routes                                  |
| CQ-32 (missions)                              | Mission views               | Raw "self_declaration · self_declared", "real-intake-...", enum stages                                            | Plain labels; internal version strings hidden                                                                                                         |
| CQ-03                                         | Invoices                    | Real invoices possible with made-up legal data                                                                    | Per D3 server guard plus a clear message                                                                                                              |
| CQ-29                                         | Customer invoices panel     | Contradictory approval text                                                                                       | Text matches the enforced rule                                                                                                                        |
| CQ-40                                         | Replies                     | No reply review queue                                                                                             | "Replies to review" list on Today data (`getTeamToday`) and a tab on each mission                                                                     |
| CQ-42                                         | /client, /buyer, /programme | "Retry approved view", "your Corridra operator"                                                                   | Plain: "This private link has expired or was replaced. Ask the person who sent it for a new link."                                                    |
| CQ-67, CQ-75                                  | Quote and publication forms | Lost on step-up; silent 401                                                                                       | `useFormDraft` plus `withStepUp`; visible errors                                                                                                      |
| CQ-68                                         | Quote form                  | Minor units, no preview, wrong JPY hint                                                                           | `<MoneyInput>` and `<CurrencySelect>`                                                                                                                 |
| CQ-70 (team)                                  | Delivery list               | "Sample requests from customers"; wrong date                                                                      | "Help requests from customers"; shows the date sent                                                                                                   |
| CQ-73 (producer)                              | Quote accepted              | Team never told                                                                                                   | `notify(QUOTE_ACCEPTED)` to the mission owner; WS-D shows it on Today                                                                                 |
| CQ-76                                         | Publication form            | Empty fields; date with no time zone; misaligned checkbox                                                         | Pre-filled from the mission; `<DateTimeInput>`; aligned                                                                                               |
| CQ-77 (producer)                              | Publish                     | Not delivered to the signed-in customer                                                                           | `listDeliveredPublications`; `notify(REPORT_PUBLISHED)`                                                                                               |
| CQ-78                                         | Private link                | Fresh link shows "Access denied"                                                                                  | Root cause fixed and covered by a test that opens a fresh link in a signed-out context; revoke and expiry still deny                                  |
| UX-04 (team work)                             | All C forms                 | Raw IDs and ISO text                                                                                              | `<ReferencePicker>` and `<DateTimeInput>` only                                                                                                        |

**V-cases:** V-08, V-09, V-23 (team side), V-24, V-25 (producer), V-26, V-27 (blocked path per D3), V-28, V-29, V-30, V-31, V-33, V-34, V-35, V-36, plus C-1 and C-2: mission page density targets; no forbidden words in /operator mission and meeting pages.

### 6.D WS-D Team control, access, network, evidence and owner

| ID                   | Where                                      | Defect                                                                         | Done when                                                                                                                                                                      |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CQ-74                | /operator/controls                         | No team invite                                                                 | Per D8, behind `CORRIDRA_TEAM_INVITES`; `notify(TEAM_INVITE)`; audit event                                                                                                     |
| V-03                 | Recovery                                   | Lost team authenticator: "reviewed recovery" only                              | Owner or admin can reset another member's authenticator with step-up; audit event; the member re-enrols at next sign-in                                                        |
| CQ-62                | Sessions                                   | Contributor setup ends the team session silently                               | Separate cookies per identity type, or a clear warning before switching; covered by a test                                                                                     |
| CQ-82 (server), D12  | Private view tokens                        | Expire in 1 to 2 minutes                                                       | Sliding 30-minute idle; STEP_UP_REQUIRED code everywhere                                                                                                                       |
| CQ-64, CQ-59         | /operator/network                          | Raw IDs; unknown "eligibility source"; silent invite success; stale errors     | `<ReferencePicker>` for contributor, source and reviewer; inline "Invitation sent" via `<ActionFeedback>`; reviewer must differ from the creator                               |
| CQ-65                | Contributor invites                        | Not emailed; "sending is paused" text                                          | `notify(CONTRIBUTOR_INVITE)` with status sent, opened or accepted; contradictory text removed; Copy link as fallback                                                           |
| CQ-66                | /operator/settings                         | Route pack via raw JSON; leftover "AL to AU" route                             | Guided "Add route pack" form (`createRoutePack`) behind `CORRIDRA_ROUTE_PACK_FORM`; JSON only under "Advanced (developers)"; AL to AU labelled "(madeup)" via the data script  |
| CQ-79                | /operator/evidence                         | Decision defaults to VERIFIED; capitals                                        | No default (a placeholder that must be chosen); labels "Verified" and "Rejected"                                                                                               |
| CQ-80                | /operator/sources                          | No mission or company link; source reference never shown                       | Optional mission and company pickers (new columns); reference shown with a copy button                                                                                         |
| CQ-81                | Evidence uploads                           | Upload invisible to the uploader                                               | "My submitted evidence" list with status "Waiting for another reviewer"                                                                                                        |
| CQ-35 (UI)           | Evidence                                   | Scanner bypass                                                                 | One line: "Files are checked for type and size. Virus scanning is deferred." Logged in the deferred register                                                                   |
| CQ-34, CQ-73 (Today) | /operator                                  | Drafts counted; accepted quotes missing                                        | `getTeamToday` per 5.2                                                                                                                                                         |
| CQ-32 (operations)   | /operator/operations                       | Raw ID filters and enum codes                                                  | Pickers and plain labels                                                                                                                                                       |
| CQ-02, D2            | /operator/readiness, owner, control center | Contradictory live and synthetic statements                                    | Per D2, plus "Live, small scale" status                                                                                                                                        |
| UX-03, CQ-39, CQ-54  | /operator/owner                            | 15 screens of tables; developer instructions; undescribed settings; "27 of 27" | One-screen status board first (live state, blocked items, who acts); tables collapsed under "Technical details"; install instructions moved to `docs/runbooks`; counts precise |
| UX-13, CQ-57         | Owner and readiness tables                 | Mono font everywhere; sideways scroll on phones                                | Geist labels with Mono only for codes; cards on phones                                                                                                                         |
| CQ-33                | Data                                       | Synthetic records in production with no "(madeup)"                             | `scripts/qa/label-synthetic.ts` dry-run by default; it lists and would relabel only, never deletes (owner runs it later)                                                       |

**V-cases:** V-01 to V-07, V-11 to V-22, V-45 (D-owned types), V-47, V-48 (preview only), V-51 (Neon PITR check plus runbook; actual drill DEFERRED), plus D-1 and D-2: Today counts; owner status board fits within 2 screens.

### 6.E WS-E Platform and UX system

| ID                                                        | Where                                          | Defect                                                                                                            | Done when                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-02, CQ-31, CQ-36 (shell), D14                          | Shells and operator layout                     | Four navigation layers; public header in the app; one title for all team pages; all sections loaded on every page | 4 shells behind `CORRIDRA_UX_SHELLS_V2`; the operator layout renders only the active route segment; `pageMetadata` used by every shell                                                             |
| CQ-01                                                     | `<ErrorSummary>`                               | Focus stolen on each keystroke                                                                                    | Per 5.2; regression test on /plan                                                                                                                                                                  |
| CQ-10                                                     | Account shell                                  | Arabic header and tabs in English, left to right                                                                  | Shell strings translated; `dir` set from the locale on every shell                                                                                                                                 |
| CQ-12, CQ-15, CQ-50 (component), CQ-84 (component), UX-12 | Formatters and pickers                         | Per 5.2                                                                                                           | Contracts complete, with unit tests per locale and currency exponent                                                                                                                               |
| CQ-17                                                     | Middleware                                     | corridra.vercel.app serves the full site                                                                          | 308 redirect to c.obsidianglobal.studio, preserving path and query; canonical link on every page                                                                                                   |
| CQ-20                                                     | Skip link                                      | Hidden under the header                                                                                           | Skip link above the header (z-index), visible on focus, at 1280 and 390 px                                                                                                                         |
| CQ-30 (infra), D7, UX-06                                  | Notifications                                  | No in-app inbox; emails inconsistent                                                                              | `notify` sends and logs; inbox in every signed-in shell; all switched-on email types send (V-45)                                                                                                   |
| CQ-46, D18                                                | Tokens and CSS                                 | Off-palette text, mono overuse, h3 in Geist                                                                       | Tokens enforced; a lint rule or test fails on unknown hex colours in components                                                                                                                    |
| CQ-47                                                     | Header                                         | "REAL" badge unexplained, even on sample previews                                                                 | Badge removed from public shells; team shell shows "Live" in the status area; preview shows "Preview"                                                                                              |
| CQ-48                                                     | i18n                                           | Trust labels English with no note; mixed digits; flash of English                                                 | Trust labels with a tooltip "Kept in English so evidence labels stay exact"; consistent digits per locale; no English flash (server-rendered locale)                                               |
| UX-05                                                     | `useFormDraft`, `withStepUp`, `<StepUpDialog>` | Work lost on timeouts                                                                                             | Contracts complete                                                                                                                                                                                 |
| UX-09, UX-11                                              | `<ActionFeedback>`, help pattern               | Long rule paragraphs; message pile-up                                                                             | One-line field help plus a "?" popover component; scoped feedback                                                                                                                                  |
| UX-15                                                     | Floating Help and Listen buttons               | Cover content and right-to-left text                                                                              | Moved into the header help menu on phones; auto-hide on scroll on desktop; respect `dir`                                                                                                           |
| V-52 to V-60 harness                                      | Tests                                          | No automated UX measures                                                                                          | `scripts/qa/ux-measure.ts` (screens, forms, inputs and buttons per page; no forbidden words; no ISO or US dates; no raw ID fields) plus Playwright projects for 390, 768 and 1280 px and 7 locales |

**V-cases:** V-05 (client), V-06 (shell part), V-45 (infrastructure), V-52 to V-60, plus E-1 to E-3: redirect; skip link; locale and `dir` on each shell.

---

## 7. Cross-stream dependencies (all satisfied by Wave 0 contracts)

| Consumer   | Needs                                                                                           | Provided by                      | Before Wave 2                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| A, B, C, D | Pickers, MoneyInput, DateTimeInput, formatters, ErrorSummary, ActionFeedback, StepUp, FormDraft | Wave 0 stubs (working)           | Streams build against stubs; WS-E improves internals without changing signatures |
| B          | `listDeliveredPublications`                                                                     | Wave 0 stub returning []         | B's UI tests use a seeded fixture; the full proof is V-30 in Wave 2              |
| D          | `getTeamToday` data sources                                                                     | Wave 0 stub                      | D implements against existing tables plus the 5.3 indexes                        |
| C          | Route packs to assign                                                                           | WS-D `createRoutePack`           | C's tests seed a pack directly; the full proof is V-07 and V-08 in Wave 2        |
| B, C, D    | `notify`                                                                                        | Wave 0 stub writes the inbox row | WS-E adds email sending                                                          |

No stream waits for another. Cross-stream proof happens only in Wave 2.

---

## 8. Verification matrix (automate in `tests/e2e/verification/**`)

Use the seeded preview accounts (W0.5). Every case captures a screenshot, the final network status, and a database or API assertion. Status is PASS, FAIL or DEFERRED (reason).

| Case                   | Proves                                                                                                                                                          | Owner folder               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| V-01, V-02, V-03, V-04 | Team invite, roles, authenticator recovery, audit log                                                                                                           | ws-d                       |
| V-05                   | Timeouts keep work; refused actions always visible                                                                                                              | ws-e (client), integration |
| V-06                   | Sessions don't silently end each other                                                                                                                          | ws-d, ws-e                 |
| V-07, V-08, V-09       | Route pack form, route assignment, begin qualification                                                                                                          | ws-d, ws-c, integration    |
| V-10                   | Submitted vs draft labels and counts                                                                                                                            | ws-a, ws-b, ws-d           |
| V-11 to V-17           | Contributor invite, setup, profile, task, scope, evidence, rewards (original currency, append-only)                                                             | ws-d, integration          |
| V-18 to V-22           | Self-review blocked, verification and 30-day expiry, rejection, scanner (DEFERRED per 9), sources linked                                                        | ws-d                       |
| V-23 to V-29           | Quote question, decline and versions; currencies; accepted quote to Today; sample invoices; real invoice blocked per D3; madeup payment; commercial chain       | ws-c, ws-b, integration    |
| V-30 to V-36           | Report reaches customer; private link works, expires and revokes; save and decide; pre-fill; supplier reply page; intros and meetings; requirement confirmation | ws-c, ws-b, integration    |
| V-37 to V-41           | Organiser sees registration; places; fees from schedule; series and CSV; invitation codes per D13                                                               | ws-b                       |
| V-42 to V-44           | Workspaces and roles; company profile and link; help requests from each source                                                                                  | ws-b                       |
| V-45, V-46             | Every switched-on email sends; email choices                                                                                                                    | ws-e, ws-b                 |
| V-47 to V-50           | Password reset; code sign-in (preview only); receipt check; privacy rights process documented                                                                   | ws-d, ws-a                 |
| V-51                   | Backup: PITR enabled and retention recorded; restore drill DEFERRED                                                                                             | ws-d                       |
| V-52 to V-55           | 390, 768 and 1280 px; keyboard and screen reader basics; 7 locales; speed under 3 s                                                                             | ws-e, integration          |
| V-56 to V-60           | UX targets: under 2 screens for key content; 1 open form; top tasks within 3 clicks; no raw values; no silent loss or stale messages                            | ws-e, integration          |

**Sensitive-path tests** (required by the Implementation Canvas, section 21) in every relevant stream:

- Cross-tenant access fails.
- A private link discloses only approved fields.
- The ledger cannot be mutated or deleted.
- Verification needs a different human reviewer.
- Duplicate submits don't duplicate quotes, invoices or registrations.

---

## 9. Deferred register (owner decision: small-scale commercial launch now, hardening later)

Show each item honestly in the product per D2, and list it in RESULTS.md.

| Control                                                                       | Status                 | Interim mitigation in this program                                              |
| ----------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| D01 Malware scanner for uploads                                               | DEFERRED               | Team-only uploads, type and size checks, a clear UI line (CQ-35)                |
| D02 to D04 GitHub branch protection enforcement, secret scanning, CodeQL      | DEFERRED               | CI gates still required on the PR; no secrets in code                           |
| D05 EU production object storage, D06 cleanup                                 | DEFERRED               | Existing storage; nothing deleted                                               |
| D08 Legal review, DSAR process, data processing agreements                    | DEFERRED               | Privacy notice accurate per D4; a manual DSAR runbook in `docs/runbooks` (WS-D) |
| RESTORE drill                                                                 | DEFERRED               | V-51 confirms PITR is on and records retention                                  |
| OUTREACH automation, Live AI, external pen test, WAF and rate-limit expansion | DEFERRED               | Features stay off and are labelled honestly                                     |
| Real invoicing                                                                | BLOCKED until real UEN | D3                                                                              |

---

## 10. RESULTS.md format (LEAD writes it in Wave 2)

Write it in this order:

1. **Header:** date, commit SHA, preview URL, Neon preview branch, flags state.
2. **Summary:** counts of DONE, DEFERRED and PARTIAL across all IDs; counts of PASS, FAIL and DEFERRED across V-cases; top 5 residual risks.
3. **Items table:** ID, Stream, Status, PR, Test names, Screenshot.
4. **V-case table:** V, Result, Evidence.
5. **UX measurement output:** before and after numbers for the pages in report section 2b.
6. **Owner checklist:**
   - Confirm the legal entity and UEN (D4).
   - Flip the production flags in 5.4 after reviewing the preview.
   - Optionally run `scripts/qa/label-synthetic.ts` and `scripts/qa/cleanup-qa-records.ts --dry-run`.
   - Promote the preview.
7. **Deferred register snapshot** (section 9).

Rules for RESULTS.md: no em dashes, and no real customer names, emails or amounts.

---

## Appendix A. QA records created in production on 31 Oct 2026 (do not touch from agents; script handles dry-run)

All records contain "QA test (madeup)" unless noted.

| Record              | Details                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission             | Request 265f16f8 "QA Test Co (madeup)", Sell, Bangladesh to Spain, customer dreamywalk                                                                         |
| Help request        | Market access mission on request 53fd07af (XYZ workspace); quote v1 USD 100.00, accepted                                                                       |
| Client publication  | "QA test (madeup) market access update" (mission XYZ), plus a private link expiring 7 Nov 2026, 17:00                                                          |
| Source and claim    | Claim 02604514-8cab-4104-8ea8-5d958b464131; one test image as evidence, waiting for review                                                                     |
| Programme           | "QA test (madeup) Dhaka to Madrid knitwear trip"; fee schedule "QA test (madeup) trip fees" (BDT); 2 participant codes; registration "QA test (madeup) Dreamy" |
| Contributor invites | Two contributor invitations sent to the owner's own test addresses, both set up                                                                                |

`scripts/qa/cleanup-qa-records.ts` (WS-D) defaults to `--dry-run`. It lists matching records and their dependencies, and it archives or revokes only with `--apply` and an explicit `--confirm-production` flag. It never hard-deletes ledger, audit or evidence rows.

## Appendix B. Forbidden live-copy patterns (CI check by WS-E; streams fix their own pages)

Case-insensitive, in rendered customer and team UI, excluding "(madeup)" demo panels and the deferred register:

`test mode`, `test flow`, `test mission request`, `example request`, `synthetic`, `invented`, `fictional`, `demonstration channel`, `sample requests from customers`, `real customer mission admission`, `approved test participant`, `sample invitation code`, `@example.invalid`, the em dash character (U+2014), and raw ISO timestamps matching `\d{4}-\d{2}-\d{2}T\d{2}:`.
