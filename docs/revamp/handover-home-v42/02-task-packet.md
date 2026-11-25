# Task packet, home page v4.2 (product stage output, stamp auth-011a44290375), with the conductor's decisions

Read together with the Authority Brief at /tmp/claude-0/-home-user-corridra/acadf3ac-4e00-55ec-a8b3-233bed0167c3/scratchpad/home-v42-authority-brief.md. Design evidence: the canvas copy /tmp/claude-0/-home-user-corridra/acadf3ac-4e00-55ec-a8b3-233bed0167c3/scratchpad/dc/project/Chosen.dc.html (stand-ins: hand-drawn flags, raw hex, sphere).

## OUTCOME
A public visitor in Bangladesh sees a re-composed home page, shown only when the new switch CORRIDRA_UX_HOME_V42 is exactly "true" (read server-side with uxSwitchOn, document in apps/web/lib/owner-switches.ts and the ux-switches names list; a test fails otherwise). Order: unchanged header; navy hero with live headline `home.title` and paragraph `home.tr.lead` exactly (including "key Asian markets" and "Choose yours.") plus a flat route-network diagram (Bangladesh linked to China, EU, UK, US, Australia, flags from /flags files and names, no gradient, no Key Asian Markets node; accessible name composed from live words); the "Which way is your business moving?" block as in the canvas option 1 form (two large cards "Bangladesh buys from [CN] China" and "Bangladesh sells to [EU] EU [GB] UK [US] US [AU] Australia", each ONE line at every width, never wrapping; stack the cards to one column below 1100 px; two small cards; one primary Start a Request; the three ticks); the route reveal (decision D1); a bento block (How it works, on every route: 14 steps in two vertical lists with 8 to 13 dashed and announced optional, note, plus the four "is not" rules; Trust, on every route on the navy token with the five FactLabel labels; the Day 1/6/11 record; Who it is for); four route cards; Straight answers; Plain limits on navy; the live closing band; the live footer trimmed. With the switch off the home and footer are byte for byte today's.

## REQUIREMENTS
V3-04-029 (three prominent choices plus secondary link; keep all three job links and "Something else", orderedJobs() in apps/web/lib/home-jobs.ts); V3-05-003 (unified homepage, keep every URL). L1 to L5 and conformance row "/" (v4.2 amends L4 by the later owner date; update the row).

## MUST PRESERVE
- Header unchanged (site-header.tsx); the canvas header is a stand-in, not built.
- Primary action Start a Request to /plan (`home.tr.cta.none`, id `home-start`); door-driven href via routeHref and ctaWords; Talk to a Person / WhatsApp (TalkLink, supportWhatsappHref()) only when the owner's number is set.
- Four doors as the radio group name="home-route" (DoorCard, components/ux/door-card.tsx): native radio, icon (buy, sell, people, draft), Selected state, side labels `home.tr.side.supply/demand`, titles/texts `home.tr.door.*`. Three ticks `home.tr.assure.*`.
- Route data and payload: routeHref, goalLinks, quotes, visitStops (lib/home-routes-data.ts); sections #route-china, #route-sell, #route-delegation, #route-other (Example-tagged, send nothing); HomeBrief (#start) opening the real /plan form (test home-brief-href).
- Honesty copy: `home.tr.rs.ready*`, `home.tr.rs.ready.end`, FAQ `home.tr.fq.6.a2`, `home.tr.fq.5.a1`.
- Five trust labels in English in every language from FactLabel (an icon plus a word); history record keys `home.tr.tr.day1/day6/day11(.text/.kept)`, `home.tr.tr.newEntry`, `home.tr.q.example`; revision 1 stays visible (struck), USD 36,800 and USD 37,400 exact; Example tag kept.
- Flags only through components/ux/flag.tsx (Flag, Flagged, RouteLine) with /flags/*.svg; never a flag alone; Key Asian Markets gets RegionMark never a flag; v4-1 guard baseline never rises.
- Key Asian Markets: removed only from the Sell Abroad route line and the Sell route status card; kept in the hero sentence; never "Asia" alone; /corridors keeps it.
- Route cards keep live claims: "Bangladesh to China, Open now"; Sell, Open now; "Into Bangladesh", Selective; "Any other route", Ask us with `home.tr.rs.other.sub`; link Explore Every Route to /corridors (`home.other.link`).
- Straight answers keys `home.tr.fq.1..8`; Plain limits `home.tr.not.*`; rules `home.tr.nv.1..4`; steps `home.tr.ms.*`; closing band `home.tr.fn.*`, three job links (/plan?job=...), `home.else`; phone StartBar (home-shared.tsx).
- Footer (components/site-footer-view.tsx) keep: logo, Sign In, "Already working with us? Open Your Workspace", the access-doors row where CORRIDRA_UX_ACCESS_DOORS is on, the three family columns, four bottom links, `footer.private`, copyright, LanguageSwitcher; signed-in rule (never offered sign-in), staff-preview quiet mode. Remove only: `footer.tagline` headline, the second Start a Request, the five trust chips (`footer.facts`, `footer.factsMore`), `footer.routes`. "No repeated links" (ui-direction l.96) still applies.
- Six-language catalogs: lib/i18n/home-words.ts + lang/<code>.ts; tests/language-english-freeze.json; tests/integration/language-base.test.ts (regenerate deliberately). Words in the chosen language only while CORRIDRA_LANGUAGES_PAGES is on; hero diagram labels and card lines come from catalog keys.
- No auth, session read, route, payload, id, permission, migration, event or money change. The home sends no data until /plan.

## ACCEPTANCE CHECKS
1. Switch unset or anything but exactly "true": home and footer identical to a054c51c; all existing browser specs pass unchanged (home-board-3c, home-two-routes, v41-a-public, public-experience, public-hero-layout, footer-option-b, no-repeated-links).
2. Switch "true": block order as OUTCOME; hero text character for character; diagram exactly Bangladesh plus five places each with its /flags file and written name; no gradient; no Key Asian Markets node.
3. The two card lines read exactly as above, flag before each name, ONE line (line box height equals one line, no overflow, no horizontal scroll) at 320, 390, 768, 1024, 1440, 1920; radio, 44 px targets, keyboard, Selected state work.
4. Exactly one primary Start a Request in the choice block (href /plan or the chosen door's), three ticks.
5. Bento as OUTCOME; Trust tile on the existing navy token with white (--on-brand) text only; Day 1/6/11 shows revision 1 struck and "New entry".
6. The Sell route line and the Sell status card contain no "Key Asian Markets"; "Bangladesh to China" and "Into Bangladesh" cards unchanged; four open and four closed answers with the live full text.
7. Footer: removed items absent, kept items present (incl. language switcher); phone fit per footer-option-b (819 of 844 px) or the test is changed with the owner quote in its header.
8. `pnpm test:ux` at six widths, axe clean, no sideways scroll, 44 px targets up to 768, reduced motion respected; design-system and v4-1 guards pass (no raw hex, fonts, weights 400/500/600, radius set, icon family, flags through flag.tsx, baseline not raised); language freeze passes after deliberate regeneration.
Denial/state: signed out shows Sign In and Open Your Workspace; signed in the workspace button; staff preview inert; switch values "TRUE", "1", unset stay off. Recovery: native radios and a working /plan link without JS; reload keeps the page; switch back to off returns the old home with no data change.

## CONDUCTOR DECISIONS on the product stage's owner questions (made 25 Nov 2026 by the conductor, taking the claim-preserving option; the owner may veto each)
- D1 Route reveal: KEEP the existing in-place reveal (#route-china, #route-sell, #route-delegation, #route-other with the worked examples, the HomeBrief and the "Showing" bar content) but collapsed by default: nothing extra on first view; once a door is chosen the matching route section opens directly under the choice block. The page headline stays the fixed live headline; the Start a Request href and label follow the chosen door as today. Keep `home.tr.hint` only if it stays true.
- D2 Halftone mark: follow the owner's pick (option 2 hero): diagram only, no sphere. Record as an L4 amendment in the v4.2 spec.
- D3 Who it is for: static eight tiles in the compact tile form, each showing the FULL live "You get" text (`home.tr.pe.N.get`), no "You give", no invented note. (The door no longer preselects a person in v4.2.)
- D4 Straight answers: full live answers; open by default the four the canvas opens (live keys 3, 8, 4, 6), the other four closed, as <details>.
- D5 Keep the readiness chips and the "Open now does not claim legal approval" line under the route cards; keep "Matches your route" only if the reveal keeps it.
- D6 Footer: when the switch is on, the one footer trim applies on every public page that uses the footer; /plan compact footer gets the same removals; off, unchanged.
- D7 Keep the language switcher in the footer.
- D8 Keep Key Asian Markets in the FAQ sentences and the calculator radio (the owner's answer covered lines, cards and chips only).
- D9 Keep Start a Request in the choice block and the closing band (the no-repeated-links exception for `/` already recorded); do not add more.
- "Plain limits" eyebrow is the owner's own wording ("Plain Limits(black)"), allowed.

## NEW WORDING (English first, then all six catalogs; native review NOT done)
Supply card line "Bangladesh buys from" + China; demand card line "Bangladesh sells to" + EU, UK, US, Australia (approved by the owner); "Plain limits" eyebrow (owner's words). Everything else is live copy (hero diagram accessible name composed from live words). Footer strings unchanged.

## DEVIATIONS OF THE CANVAS (do not copy these)
Raw hex, copper eyebrow bar (breaks "no copper"; use the live eyebrow), hand-drawn flags/sphere/icons (use /flags, Flag/Flagged, CorridraIcon; person icons need existing names or an approved addition), h1 84 px (home display token is 56), h2 38/40/46 (scale: section 24, page 40, display 56), 17 px titles (scale 18), 13 px notes (scale 12 or 14), corner radii 14/20/999 (set: 8 controls, 12 cards, 16 panels, capsule for status only), drawn "chip" labels (use FactLabel). Check the live .ux-route-line (flag.css line 33) wrapping rule for the one-line requirement.

## OUT OF SCOPE
Header redesign; any route/payload/id/permission/migration/event/money change; real outreach, payments or AI; production value of the switch (owner/Guardian step; ships off); /corridors, /how-it-works, /trust; UI/UX.v5. Records are the scribe's, applied last, in the same PR: docs/revamp/specs/ui-ux-v4-2.md (design lock, owner words verbatim, 25 Nov 2026), ui-direction.md amendment and rows (Home page length, Public footer, Public home, Flags), PLAN_STATUS row, public-home.md dated "replaced by v4.2" note, V3_LEDGER (12 KiB), conformance row `/` and guard baselines, work log.

## RISKS
Money examples keep the Example tag; correction keeps revision 1; five labels keep icon plus word; "Verified" never without its meaning line; privacy promise for the Delegation leader not truncated; "Open now" never read as a legal claim; removing Key Asian Markets from a line must not imply it is closed.
