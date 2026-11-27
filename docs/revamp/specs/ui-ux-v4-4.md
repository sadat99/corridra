# UI/UX.v4.4: redesign proposal (waiting for the owner)

Document status: WAITING OWNER. This is a proposal, not an amendment. Nothing here is binding, built or live. It becomes UI/UX.v4.4 only when the owner answers the nine decisions in section 3 in his own words and those words are recorded in section 2. Until then no agent builds from it, and `docs/agents/ui-direction.md` is not changed.

Written 27 November 2026 on main `dca07ce`. Source: a comparison of the redesign boards (`Corridra_Redesign_Interactive.html` and its PDF) against the repository, read from the files only. The boards themselves were not available in this session, so they are not copied into `docs/revamp/redesign-2026-11-27/` yet (section 6, step 1).

## 1. Why this is a proposal and not a lock

The repository already has a binding design contract (UI/UX.v4 with v4.1, v4.2 and v4.3), tests that fail on a broken rule, and a Guardian process that merges after the gates. The redesign overlaps it in nine places. Pasting it in would break CI or silently replace owner decisions. So it enters as an amendment, behind its own switch, one screen at a time, after the owner decides.

What matches already: `#142438` ink, `#2856C5` cobalt and `#F6F8FB` porcelain are the AC/1 tokens in `apps/web/app/globals.css`.

Correction to the comparison: the comparison treated the v4.3 home as off by default. The code default is off, but [ui-ux-v4-3.md](ui-ux-v4-3.md) records `CORRIDRA_UX_HOME_V43=true` set in production by Guardian G65 on 26 November 2026. So decision 4 below is about a page that is live, not a page waiting behind a switch. Re-check the switch value in Vercel before relying on this.

## 2. Owner words

None recorded yet. Do not write a quote here that the owner did not say. When he answers, add each answer with its date and exact words, then change the status line above.

## 3. The nine decisions

Each row has a recommended default (the option that keeps the repo's locked rules and costs the least rework). "Owner choice" stays empty until he answers.

| # | Redesign | Repo rule (source) | Recommended default | Owner choice |
|---|----------|--------------------|---------------------|--------------|
| 1 | Poppins headings, IBM Plex Mono labels | Newsreader headings, Geist text, Geist Mono labels, self-hosted (`apps/web/app/layout.tsx`, `docs/agents/ui-direction.md`) | Keep the repo fonts. Re-map the boards to Newsreader, Geist and Geist Mono | |
| 2 | Weight 700 | Weights 400, 500 and 600 only; radii 8, 12 and 16 only (`tests/design-system-guard.test.mjs`) | Drop 700, use 600 | |
| 3 | Marigold `#F0A92B` accent | Copper `#BF7548` is the only ornament; navy is never a call-to-action fill | Use copper. Add a token only by a separate owner decision | |
| 4 | Home with an animated route map and goal picker | v4.3: light hero with the industrial photo, nothing moves, no pause control, Solutions menu, four door cards (`CORRIDRA_UX_HOME_V43`, live per G65) | Keep v4.3. Offer the route map as a static drawing inside it, only if the owner wants it | |
| 5 | Team menu groups Today, Requests, Delegations, Results, Admin | Four groups only: Work, People and companies, Results, Admin; one Inbox ([team-desk-v4-1.md](team-desk-v4-1.md) decision 1; `CORRIDRA_UX_TEAM_DESK_V41`, owner switch pending) | Put Delegations under Work. No fifth group | |
| 6 | Team side says "Requests" | Customers say Request, the team says Mission; Quotes stays ([team-desk-v4-1.md](team-desk-v4-1.md) decision 2; [navigation-v1.md](navigation-v1.md) rule 3) | Use Missions on the team side | |
| 7 | Customer switch All, Sourcing, Selling | Journey switcher Sell, Source, Organise, always shown ([journey-modes.md](journey-modes.md), [home-work.md](home-work.md)) | Use the repo names and switcher | |
| 8 | Prototype copy and Mark As Read rows | Words guard: no "synthetic", "draft", "brief", "contributor" or "operator" on customer screens; Title Case actions; no em dashes in public copy (`tests/vocabulary-guard.test.mjs`) | Re-check every customer word against the guard before any build | |
| 9 | No Listen control in the header | The header has Listen today | Follow the owner's earlier instruction (no Listen), but record it as a decision here, because it removes a shipped control | |

Decisions 1 to 3 and 8 are CI-enforced. A build that ignores them fails the design-system and vocabulary guards, so these are not preferences.

## 4. Already in the repository (do not rebuild)

- The six customer steps in the board order (Define, Find, Compare, Visit, Decide, Follow through): `apps/web/lib/ux/customer-road.ts`.
- Customer account: Home, Requests, Companies, Meetings, Reports, the work list with a context selector ([home-work.md](home-work.md)).
- Delegations: programme pages, applications with decisions, participant accounts, fee schedule, payment declaration, fee dispute, results (`apps/web/app/account/delegations/`).
- Operator desk: counterparties, delivery, evidence, inbox, and the route pack editor in progress ([route-pack-editor.md](route-pack-editor.md), ADR-093).

## 5. Not in the repository (new work, each needs its own spec and approval)

| Item | Note |
|------|------|
| Free time: participants ask the team for private buyer meetings in gaps | No mention found in docs, app or lib. New feature. Touches consent, so likely sensitive (programme consent) |
| "What the customer sees" panel on the team side | New screen |
| Tracking of Compare and Decide on the team side | Already a known backend gap |
| Offers tab and a customer-side Evidence tab | New screens |

## 6. How it enters, in order

1. Copy the boards unchanged into `docs/revamp/redesign-2026-11-27/` as reference only, with a `SHA256SUMS` file, the way the landing pack was kept in `docs/revamp/landing-handoff/`. Blocked until the board files are supplied.
2. The owner answers section 3. Record his exact words in section 2 and the choice column. Change the status line.
3. Add the row to "Current locked decisions" in `docs/agents/ui-direction.md`, and register this file in `docs/PLAN_STATUS.md` as CURRENT. Those two edits are the Guardian's records.
4. Build one screen per PR, each behind its own switch (proposed names `CORRIDRA_UX_V44_<SCREEN>`, on only when exactly `true`, off by default), as a draft PR, merged by the Guardian after the gates. Turning a switch on in production needs the owner's word.

Suggested screen order once approved: the customer journey strip (reuses `customer-road.ts`, lowest risk), the team Delegations placement, the customer Evidence tab, then Offers. The free-time feature goes last and needs its own consent review.

## 7. Preservation rules for any later build

Keep every existing action, link destination, element `id` and `name`, form payload and test hook. Hide, never delete. English only; new words carry `lang="en"` where needed and no catalogue entry claims a translation. A switch off means byte-for-byte unchanged output.

## 8. Not verified

- Whether any v4.1, v4.2 or v4.3 switch is currently on in production (v4.3 is recorded on, the others are not confirmed; the ledger lists signed-in journeys with the new switches on as NOT VERIFIED).
- Whether `c.obsidianglobal.studio` is the same deployment as `corridra.vercel.app`.
- That the "Before" screenshots in the boards match commit `dca07ce`.
- The boards themselves: not read in this session.
