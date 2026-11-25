# Authority Brief, home page v4.2 (stamp auth-011a44290375, produced by corridra-authority, 25 Nov 2026)

Pasted by the conductor from the authority agent's report. Recompute with `node scripts/authority.mjs stamp`; a stamp mismatch means STALE BRIEF (expected after rebasing on main, then rerun authority).

BASE: branch ccr-6f12d452-jiebrb at 40c5d9aa; origin/main was a054c51c at the time (5 commits ahead: #647 base, then #650, #651, #652). TAKE MAIN FIRST: apps/web/components/home-more.tsx (People gets a `choices` prop used on the home as aria-pressed buttons), apps/web/components/home-routes.css, tests/browser/home-two-routes.spec.ts, tests/design-system-guard.test.mjs, tests/vocabulary-guard.test.mjs. Ledger verify PASS. authority.mjs: drift none across 77 documents.

TASK CLASSES: visible UI (public home `/`, footer), copy/words (home-words, six languages), release. No auth, RLS, money, events or migrations.

## Owner directions in force (latest first)
- 25 Nov 2026, this session, first hand: (1) "like option 2 for hero section, option 3 for \"How it works, on every route.\", \"Trust, on every route(black)\", \"who it is for\", \"Plain Limits(black)\". the rest on option A(using as base). and current footer without redundancy." (2) "i didnt like your arrngement on what i liked. do it again. also \"Which way is your business moving?\" section must be always like in the option 1" (3) "lock this v4.2. but Demand side section\\s got line break, australia came to second line. needs to be one line. supply side should China to BD. also ensure proper responsiveness" (4) earlier: "also remove \"Key Asian Market\" text from any block on landing page where it breaks the line and looks bad".
- 25 Nov 2026 answers to the one batched question (first hand): Key Asian Markets: "Lines, cards and chips only (Recommended)" = remove it from the Sell Abroad route line and the route status card; KEEP it in the hero sentence; never "Asia" alone; /corridors and the route list keep it. Supply side: "it is coinfusing. curreent focus is bd is sourcing from china, products and machineries. on the other hand, bd is selling to eu etc. so how to best frame it. the major audience is BD audience for the site, implicitly." The conductor's decision on that: sentence framing with a verb, no arrow: supply card line "Bangladesh buys from [CN] China", demand card line "Bangladesh sells to [EU] EU [GB] UK [US] US [AU] Australia" on one line; route status cards keep the live claims ("Bangladesh to China, Open now", "Into Bangladesh, Selective"). Footer: "Trim as shown (Recommended)": remove the repeated headline, the second Start a Request, the five trust chips and the "Open now from Bangladesh" line; keep logo, Sign In, the access row, the three link columns, the four bottom links, the privacy line and the copyright. Release: "Add a switch, off by default": a new switch CORRIDRA_UX_HOME_V42, off by default; with it off the home and footer are exactly as today.
- 24 Nov 2026 (ui-direction.md, team desk v4.1): adds the "No repeated links" rule, binding on every page a unit touches. Read that row before cutting footer links.
- 23 Nov 2026 (ui-ux-v4-1.md): "nice. lock ir as v4.1" (design lock only).
- 23 Nov 2026 (ledger): "there shouldnt be synthetic, draft etc, all must be live and commercially ready". "Finish all six, keep live"; native review NOT done, gate OPEN. Solid sticky header supersedes the 18 Nov translucent header.
- 18 Nov 2026: UI/UX.v4. Home: "the page size limit is not applicable here ... only footer was said to remain as it is". Board 3c in full (public-home.md LP3).
- 17 Nov 2026 routes: "All five as equal open destinations"; deliverable "EU, UK, USA, Australia, Key Asian Markets". Flag policy: Key Asian Markets gets a compass mark, never a flag.
- 12 Nov 2026: Option B footer, locked mockups revision 2.
- 3 Nov 2026: "always keep the branch count below 9".

## FOLLOW
- /home/user/corridra/AGENTS.md, /home/user/corridra/apps/web/AGENTS.md | binding | UI/UX.v4 rules, V3 execution rules (never weaken a test, never claim done without command output), Codex lean rule.
- docs/agents/ui-direction.md | CURRENT | UI/UX.v4 contract and v4.1 section. Read the whole file for visible UI. Rows: Public home (l.60), Public footer Option B (l.58), Flags (l.84), Routes and markets (l.51), Home page length (l.89), Action labels Title Case, No repeated links (l.96), Page length (l.54), "How to build a new screen" checklist (about l.200 to 260: widths 320, 390, 768, 1024, 1440, 1920, axe, screenshots).
- docs/revamp/specs/ui-ux-v4-1.md | CURRENT | L1 to L10 and constraints: existing tokens only, copy exactly as live unless the owner approves wording, no gradient, glass, glow or copper text, every symbol keeps a visible word or the Explain rule, 44 px touch targets, reduced motion respected, no route, payload, id or permission changes. L4 home hero, L5 routes list order China, EU, UK, US, Australia, Key Asian Markets, L1 flag before every place name, L2/L3 icon and chosen state per choice.
- docs/revamp/specs/ui-ux-v4-1-rollout.md and docs/revamp/v4-1-conformance.json | CURRENT | The `/` row is wave A, L1 to L4 "built". Evidence: tests/browser/v41-a-public.spec.ts, home-routes.tsx, door-card.tsx. A changed screen needs its ledger row updated (scripts/v4-1-conformance.mjs).
- docs/revamp/specs/public-home.md | CURRENT | LP3 of 18 Nov is the live shape: board order, no page-length budget, footer and header unchanged, "New words are English in every catalog", where UI/UX.v3 wins over the board (tokens only, "no dark mode", cobalt is the only action fill, Start a Request above the doors, section title sizes).
- docs/revamp/specs/layout-budget.md | CURRENT | other pages keep their budgets; the page-length report still measures the home.
- EVIDENCE ONLY: docs/revamp/evidence/owner-2026-11-18/two-routes-board-3c.html; docs/revamp/evidence/owner-2026-11-23-v4-1/. The canvas Chosen.dc.html (copy at /tmp/claude-0/-home-user-corridra/acadf3ac-4e00-55ec-a8b3-233bed0167c3/scratchpad/dc/project/Chosen.dc.html) is design evidence only. The 21 Nov UX/UI Upgrade Execution Pack stays "a proposed plan".
- IGNORE: UI/UX.v3 version block, footer "A Ledger", concept G and two-spotlight routes, the translucent header.
- REQUIREMENTS: no ID looked up. Run `node scripts/v3-context.mjs requirement <ID>` once the stage names them; contract section "three prominent choices" (V3_CONTRACT l.293). ADRs in force: none for the home page (check docs/adr/README.md only if footer, languages or flags change).

## (a) Home page length, board 3c, footer
Row (ui-direction l.89): "The home page follows board 3c in full and has no page-length budget. Only the footer stays as it is (the Option B footer, locked)." The owner's 25 Nov decision is later and first hand, so it governs the middle of the home page and replaces the 3c sections it names: hero, how it works, trust, who it is for, plain limits and "Which way is your business moving?". The footer is kept and trimmed; this amends the 18 Nov lock.

## (b) v4.1
L4 "navy hero, live headline and copy unchanged, four choices below": option 2 hero departs from it, so v4.2 amends L4 by a later date. L1: a flag or mark beside every place name in a route or demand/supply line; the flag component keeps the name beside the flag.

## (c) Copy freeze, languages
tests/language-english-freeze.json hashes every English key; tests/integration/language-base.test.ts fails on an unseen change. After a deliberate English change run `LANGUAGE_FREEZE_WRITE=1 pnpm vitest run` on that test, then rewrite the other five languages (23 Nov "Finish all six, keep live", native review NOT done). Home words: apps/web/lib/i18n/home-words.ts; language switch CORRIDRA_LANGUAGES_PAGES (page.tsx, i18n/pages.ts). v4.1: "copy exactly as live unless the owner approves wording". Wording approved by the owner above: removal of Key Asian Markets from lines/cards/chips, the two card sentences, the footer trims. Any other new v4.2 wording needs the owner.

## (d) Tests and docs that bind
tests/browser/home-board-3c.spec.ts (4 "Key Asian" matches), home-two-routes.spec.ts (1; changed on main), v41-a-public.spec.ts (1), public-experience.spec.ts, public-hero-layout.spec.ts, footer-option-b.spec.ts (footer Option B, phone fit L14: 819 px in 844 px), public-header-nav, public-body-rhythm, public-large-text/normal-text/largest-200, layout-budget-public, wave6-public-quality, tests/integration/home-brief-href.test.ts, home-jobs-order.test.ts, tests/operator/ux-home-languages.spec.ts, tests/vocabulary-guard.test.mjs, tests/design-system-guard.test.mjs and design-system.test.mjs (TS and CSS colours, fonts, icon family, weights, radii, type scale), tests/v4-1-guard.test.mjs with tests/v4-1-guard-baseline.json (place names must go through components/ux/flag.tsx; counts may fall, never rise) and `pnpm test:ux` at 320, 390, 768, 1024, 1440, 1920. A test that fails because the design changed is changed in the same PR with the owner's quote in its header; never weakened or skipped.

## (e) Record in the same PR for the decision to count
1) New spec docs/revamp/specs/ui-ux-v4-2.md, status CURRENT, "design lock", owner words verbatim, dated 25 Nov 2026, and what it replaces in 3c LP3, the home row and the Option B footer. 2) docs/agents/ui-direction.md: a v4.2 amendment, rows "Home page length (UI/UX.v4)", "Public footer", "Public home" and "Flags" edited with the date. 3) docs/PLAN_STATUS.md: a row for the new spec; public-home.md gets a dated "replaced by v4.2" note. 4) docs/V3_LEDGER.md: owner direction, merge, checks (limit 12 KiB). 5) docs/revamp/v4-1-conformance.json `/` row and guard baselines. 6) work log entry. Then `node scripts/authority.mjs` again. (Records are the scribe's, applied last.)

## (f) Switch
The home has no CORRIDRA_UX_* switch today (it reads CORRIDRA_LANGUAGES_PAGES; the footer reads CORRIDRA_UX_SHELLS_V2 and CORRIDRA_UX_ACCESS_DOORS). The owner chose a new switch, off by default: CORRIDRA_UX_HOME_V42 (see lib/ux-switches). With it off the home and footer are exactly as today.

## Closed gates and owner-only steps
Native language review gate stays OPEN, never claimed closed. The word "live" for outreach and money stays the owner's. No real payments. Owner switch values in production are not read here. Tokens for light text on navy (#c7d3e3, #9db8f7) are "not locked": only `--on-brand` white is allowed on navy.

## Conflicts resolved by the conductor (all from the owner's answers above, 25 Nov 2026)
1. "Black" sections (Trust, Plain Limits): the canvas uses the brand navy (#142438 = the existing navy token). Build with the existing navy token only; no black, no raw hex. Light text on navy: white (--on-brand) only.
2. Key Asian Markets: removed from the Sell Abroad route line and the route status card only; kept in the hero sentence; never "Asia" alone; the compass mark rule stays where the name is shown; tests that assert the name in removed blocks change with the owner quote.
3. Supply and demand lines: sentence framing as above. The route status cards keep the live claims.
4. Footer: trimmed as above; the "No repeated links" rule still applies.
5. Hero: option 2 (route network diagram, built from existing flag files and tokens); headline and paragraph unchanged from live copy including "key Asian markets" in the sentence.
6. The 25 Nov decision counts only when recorded as in (e).

## Mandatory reads for later stages
The whole of docs/agents/ui-direction.md; apps/web/AGENTS.md; the v4.1 spec and LP3 of public-home.md; the "How to build a new screen" checklist; docs/v3/KNOWN_ISSUES.md before debugging CI. Long checks through `node scripts/gate.mjs`. Screenshots at 320, 390, 768, 1024, 1440, 1920, no horizontal scroll, axe clean, 44 px touch targets up to 768 px.
