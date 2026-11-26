# UI/UX.v4.3: public home amendment (owner decision, 26 November 2026)

Document status: CURRENT. A design amendment inside UI/UX.v4, named v4.3 after the owner's v4.2. It covers the public home `/`, the public header menu and the public footer only. Every UI/UX.v4, v4.1 and v4.2 rule that this file does not change stays in force; it is not UI/UX.v5. Built behind the switch `CORRIDRA_UX_HOME_V43`, on only when exactly `true`, off by default; with the switch off the home, the header and the footer are byte for byte what they are today (the v4.2 home when `CORRIDRA_UX_HOME_V42` is on, the legacy home when it is off). The v4.2 text stays the text for V42-only. With V43 on, V43 wins over V42. Turning the switch on in production needs the owner's word; this record never claims it live.

## Owner words (first hand, via the Guardian)

- Owner, 26 November 2026, via the Guardian: "update as per attachment 100% correctly".
- The attachment is the landing handoff pack, kept as reference only in [landing-handoff](../landing-handoff/README.md) (its prompt, `reference/index.html` and `SHA256SUMS`). The pack is not a deciding source on its own: where it meets a binding rule below, the rule wins and the deviation is listed here.
- On that word the Guardian (G65) decided: a light hero with the industrial photo, one homepage at `/`, contextual demos (the examples follow the chosen route), the hero headline "Find the right business partners." with the pack lead, and the three studies (Directive, Field, Table) folded into the journeys of that one page. No other owner quote is recorded.

## What it amends

- v4.2 H2 (navy hero, headline `home.title`, lead `home.tr.lead` with "key Asian markets", flat route map) and the page order of v4.2 H1, only while V43 is on. v4.2 H3 to H6 and H10 (door framing, one-line sentences, flags, Key Asian Markets placement, one `#home-start`) are kept.
- ui-direction.md rows "Public home", "Public footer", "Flags" and "Home page length", by this later date, only while V43 is on.
- Nothing else. No route, payload, permission, migration, event or money change; the home sends nothing until `/plan`.

## Deviations from the pack (every one, with the rule that wins)

| #   | Pack                                                                               | V43                                                                                                                                                                                                          | Rule                                                          |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | Sentence-case actions ("Start a request", "See a worked example", "Sign in")       | Title Case in the text, never by `text-transform`: every button, button-styled link, text action link and menu item, toggles and sub-labels in buttons included                                              | Owner, 5 Nov 2026; `tests/browser/title-case-actions.spec.ts` |
| 2   | FAQ questions, section headings, field labels                                      | Pack sentence case kept (headings and questions are not actions)                                                                                                                                             | Action labels row                                             |
| 3   | The words brief and draft                                                          | Nine substitutions, none in ids or class names (list below), plus the further ones the guard forces (list below)                                                                                             | Owner, 23 Nov 2026; `tests/vocabulary-guard.test.mjs`         |
| 4   | Place names written in the copy ("China", "Bangladesh", "European Union", ...)     | Slots `{bd} {cn} {eu} {gb} {us} {au} {asia}` drawn through one helper and `Flagged`; market names are the short forms already in the catalogue (EU, UK, US, Australia, Key Asian Markets)                    | Flag policy; `tests/v4-1-guard.test.mjs` ratchet              |
| 5   | `<option>` text with place names                                                   | Option labels come from the existing `home.country.*` keys; flags show in the route line beside the form                                                                                                     | Same                                                          |
| 6   | Textarea of 1000 characters                                                        | 600 characters, the product's existing `needLimit` and its help text, so the composite note (route, need, timing) is never cut silently by `briefHref`                                                       | Intake handoff, 1000-character cut                            |
| 7   | Hero "Start a Request" is the header-style cobalt button to `#start`               | `.primary-link` with `href="#start"` (hash only, no repeated address); focus lands on the choice group; `#home-start` stays the one primary of the choice region                                             | One primary per region (v4.1); no repeated links              |
| 8   | China radio checked on load                                                        | Radios start unchosen (the V42 rule). Example, stages, role, markets and request show the China content until a door is chosen; the long route block opens only when the visitor acts on a door or an anchor | v4.2 Door rule                                                |
| 9   | Header and footer CTA is `#start`                                                  | Header "Start a Request" stays `/plan`; the V43 header menu is not applied on `/plan` (compact shell unchanged) and signed-in shells keep their own                                                          | Brief: /plan and signed-in shells unchanged                   |
| 10  | Seven `aria-live` regions answer a door choice                                     | Exactly one polite announcement under V43 (fix walk m5). V42 keeps its regions: its markup must not change                                                                                                   | Guardian resolution 4                                         |
| 11  | "Bangladesh guide" link to a studio page; Bangla link to `bangladesh/bn/`          | "Bangladesh Guide" goes to the existing `/corridors/bangladesh-china`, listed once (not also under Explore); the Bangla entry is the existing language switcher option. No new route                         | Conductor resolution 10; no new routes                        |
| 12  | Five visible request fields (job, company based in, target market, timing, notes)  | Kept as the pack has them. This exceeds the Forms row (one to three fields per step); it is not a flow step and nothing is required                                                                          | Owner "100%" against the Forms row; recorded                  |
| 13  | Menu label "Solutions"                                                             | "Solutions" under V43 only (the one nav label that differs from "What We Do"); a missing entry shows English                                                                                                 | Guardian resolution 5                                         |
| 14  | Lead names no key Asian markets                                                    | The v4.2 H2 clause is dropped under V43 only; the words stay in the questions, calculator and selectors                                                                                                      | Guardian decision                                             |
| 15  | Terrain canvas, parallax, sweep, gradient, overlay, `region.svg`, "Pause motion"   | Not ported. The schematic is a static CSS drawing; the compass mark shows for Key Asian Markets beside the name, never a flag; nothing moves, so no pause control exists                                     | v4.1 guard, Motion row, Flags row                             |
| 16  | Two ledgers in the pack and the product                                            | One ledger (the pack's) in V43; the product's Day 1, 6 and 11 record is not drawn under V43. Revision 1 stays visible, "New entry"                                                                           | History rule; packet conflict 9                               |
| 17  | Type sizes, radii, colours of the pack                                             | Tokens only: the locked scale, radii 8/12/16, Newsreader headings, Geist UI                                                                                                                                  | Brand and tokens row                                          |
| 18  | Pack URLs on the studio host; `/table/#programme`, `/field/#atlas`, `/bangladesh/` | Relative product paths only (see the studies fold-in)                                                                                                                                                        | Brief resolution 9                                            |

### Vocabulary substitutions (owner, 23 Nov 2026: "there shouldnt be synthetic, draft etc"; a CI test enforces it)

The nine named in the plan, none in an id or class name:

1. "Build my brief" becomes "Build My Request".
2. "Use this route in the brief" becomes "Use This Route in the Request".
3. "Build an inbound brief" becomes "Build an Inbound Request".
4. Stage "Set the brief" becomes "Set the Request".
5. "Review draft" becomes "Review Request".
6. "YOUR DRAFT" becomes "Your request".
7. "Copy draft details" and "Draft details copied" become "Copy Request Details" and "Request details copied".
8. "Review the draft, then open Corridra's request form ..." becomes "Review the summary, then open Corridra's request form ...".
9. The delegation example "from the original brief" becomes "from the original request".

Further substitutions the guard forces (the same test reads every English value, so these words cannot be written either): "The example and request brief will update to match." becomes "The example and request will update to match."; "or a visit brief" becomes "or a visit plan"; "meeting briefs" becomes "meeting agendas"; "A clear first brief" becomes "A clear first request"; stage "Match hosts to the brief" becomes "Match hosts to the request". The words file test lists every one of them. Open question for the Guardian: the owner's 26 Nov "100%" and the owner's 23 Nov rule collide on these words; the guard is kept, as the plan and the conductor default decide.

## Decisions (designer D1 to D13 as applied, then Guardian and conductor)

| #        | Decision                                                                                                                                                                                                                              | Applied how                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D1       | Headlines use the locked scale, pack radii become 8/12/16, fonts are Newsreader, Geist and Geist Mono                                                                                                                                 | Applied                                                                                            |
| D2       | Title Case reaches every button, link-button and menu link; headings, door labels, card titles and FAQ questions keep pack case                                                                                                       | Applied (deviations 1 and 2)                                                                       |
| D3       | Doors reuse the V42 doors with the pack title and line; the V42 "Supply side" and "Demand side" lines are dropped                                                                                                                     | Applied; the China radio is not checked on load (deviation 8, plan decision 11 wins over the spec) |
| D4       | "Build My Request" is a quiet secondary link; `#home-start` is the one cobalt primary of the choice block                                                                                                                             | Applied                                                                                            |
| D5       | Five request fields kept visible                                                                                                                                                                                                      | Applied (deviation 12)                                                                             |
| D6       | At 390 x 844 the first screen shows the hero text, both actions and the image; the choice heading starts at 760 px or less                                                                                                            | Applied, measured in the UX spec                                                                   |
| D7       | Footer legal row: Bangladesh Guide to an existing page, Bangla through the language mechanism                                                                                                                                         | Applied (deviation 11)                                                                             |
| D8       | Key Asian Markets: compass mark and name, never a flag, no sentence "Bangladesh to Key Asian Markets"                                                                                                                                 | Applied                                                                                            |
| D9       | The six job pages stay reachable from the header                                                                                                                                                                                      | Open: the plan moves them to the footer and the closing band; see the open items                   |
| D10      | One polite live region answers a door choice                                                                                                                                                                                          | Applied (deviation 10)                                                                             |
| D11      | The long route block opens only after the visitor acts on a door or an anchor, with its own Example tags and numbers; two sets of invented quotes never share a block                                                                 | Applied                                                                                            |
| D12      | The word "brief" kept as written                                                                                                                                                                                                      | Not applied: superseded by the vocabulary guard (deviation 3)                                      |
| D13      | Straight apostrophes, middle dot kept, no em dashes                                                                                                                                                                                   | Applied                                                                                            |
| G1 to G9 | Guardian G65 resolutions: switch inside the V42 boundary, the record, the hero image through `next/image` with `alt=""`, m5, Title Case and "Solutions", hero action, no new dependencies or migrations, footer pack, studies fold-in | Applied; each is a row above or below                                                              |
| C10      | Conductor resolution 10: the Bangladesh Guide link goes to `/corridors/bangladesh-china`                                                                                                                                              | Applied (deviation 11)                                                                             |

## Studies fold-in

- Directive (`/directive/`, `?goal=`): never existed on production. No redirect, no new query. `/` is the home.
- Field (`/field/#atlas`): the Markets explorer on the home plus `/corridors` and `/corridors#mission-example`. Gap: the product had no counterparty fit, evidence and next action dossier or reversible shortlist. A small example dossier is added inside the open sample at `/corridors#mission-example`, shown only while V43 is on (a later step). The sell example's Fair List and Qualified Shortlist toggle is the reversible shortlist on the home itself.
- Table (`/table/#programme`): the delegation card's "Walk Through a Sample Programme" goes to `#route-delegation` (the existing programme table, organiser and participant views), with the three-phase console and a prefilled delegation request. No new surface.
- Bangladesh guides: not new routes (deviation 11). The `/#mission-example` redirect stays.

## What it replaces (only while the switch is on)

- v4.2 H1 order and H2 hero; the v4.2 hero route map moves out of the hero (the flags stay near the route choice).
- ui-direction.md rows "Public home", "Public footer", "Flags" and "Home page length": the amendment paragraph and the "Current locked decisions" index name V43 by this later date.
- The public header's "What We Do" menu label becomes "Solutions" (four anchors; the six job pages stay reachable), and the footer becomes the pack hierarchy on public non-compact pages.

## Evidence

Present now: `tests/integration/home-v43-switch.test.ts` (switch exactly "true", registered and described, V43 before V42 before legacy, lazy boundary); the baseline fixtures `tests/ux/fixtures/home-v42-on-c783c0f.html` (header, main and footer of the V42-on home, normalised as `home-v42-off.spec.ts` does) and `tests/ux/fixtures/header-off-c783c0f.html` (the public header), captured on 26 Nov 2026 from an unchanged build of c783c0f (the header does not depend on V42). The steps that follow add the words, state and browser evidence to this list; until they merge nothing below is acceptance.

## Release state

Built behind `CORRIDRA_UX_HOME_V43`, off by default, in steps; not claimed live. The owner's word is needed to turn it on; rollback is to remove the setting and redeploy. Native review of the new words is NOT done and that gate stays OPEN: the new words are English-only keys that fall back to English in every other language; no translation is claimed and no draft or translation note appears on any page.

## Reconciliation table (draft inventory; the verification column is filled by the later steps)

Previous entry is what exists today (V43 off). New entry is where V43 sends it. Verification names the later step; "pending" is not a pass. Each item gets direct load, reload, Back, query or hash link, menu close, focus return and no-JS fallback when it is verified.

### A. Home anchors

| Previous entry                                                                                                                                       | New entry (V43)                                                                   | Verification          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------- |
| `#hero`, `#home-title`                                                                                                                               | Hero section and its h1, same ids                                                 | pending (home steps)  |
| `#pick`, `#hv42-question`, `#home-start`                                                                                                             | Choice block `#start` with `#pick` wrapper, legend id kept, `#home-start` kept    | pending               |
| `#brief`, `#brief-start`                                                                                                                             | Request section, same ids                                                         | pending               |
| `#how`                                                                                                                                               | "See the Full Process" disclosure holding the 14 stages; `#process` is new        | pending               |
| `#who`, `#who-panel`                                                                                                                                 | People section: `#people` new, `#who` the role group, `#who-panel` the record     | pending               |
| `#trust`                                                                                                                                             | Trust section, same id                                                            | pending               |
| `#routes`                                                                                                                                            | `#markets` (explorer) new, `#routes` (statuses and chips) kept beside it          | pending               |
| `#faq`                                                                                                                                               | "More Answers" disclosure holding the eight shipped answers; `#questions` is new  | pending               |
| `#limits`, `#final`, `#final-start`                                                                                                                  | Plain limits and closing band, same ids                                           | pending               |
| `#reveal`, `#route-china`, `#route-sell`, `#route-delegation`, `#route-other`                                                                        | Route block reveal and its four routes, same ids, opened by door or anchor        | pending               |
| `#gaps`, `#quote-a`, `#quote-b`, `#quote-c`, `#visit-title`, `#comparable-title`                                                                     | Inside `#route-china`; anchor opens China first                                   | pending               |
| `#worth-title`, `#faircost-title`                                                                                                                    | Inside `#route-sell`; anchor opens Sell first                                     | pending               |
| `/#mission-example`                                                                                                                                  | Still redirects to `/corridors#mission-example` (`LegacyHashRedirect`, unchanged) | pending (server spec) |
| (new) `#start`, `#solutions`, `#service-source`, `#service-sell`, `#service-delegation`, `#example`, `#process`, `#inbound`, `#people`, `#questions` | Pack anchors, each on one element, none duplicated                                | pending               |

### B. Header destinations

| Previous entry                                                                                              | New entry (V43, public pages except `/plan`)                                                                                                                                                  | Verification          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Logo to `/`                                                                                                 | Same                                                                                                                                                                                          | pending (header step) |
| "What We Do" panel: `/sell`, `/source`, `/machinery`, `/trade-missions`, `/business-trips`, `/enter-market` | "Solutions" panel: `/#service-source`, `/#service-sell`, `/#service-delegation`, `/#inbound`; the six job pages stay reachable (footer secondary list, closing band jobs links; open item D9) | pending               |
| "Something else? Tell us your business goal" to `/plan`                                                     | Kept                                                                                                                                                                                          | pending               |
| `/how-it-works`, `/corridors`, `/trust`                                                                     | Same destinations                                                                                                                                                                             | pending               |
| (mobile) none                                                                                               | "FAQs" to `/#questions` added in the drawer only                                                                                                                                              | pending               |
| Sign In (`/signin`, or `/account`, `/operator` when signed in), Sign Out                                    | Same                                                                                                                                                                                          | pending               |
| Start a Request to `/plan`                                                                                  | Same                                                                                                                                                                                          | pending               |
| Listen, language chooser, Help dock                                                                         | Same                                                                                                                                                                                          | pending               |
| Menu open, close, Escape, focus return, outside click, trap, inert                                          | Same code; Escape returns focus to Solutions or Menu; a link click focuses the target after any reveal                                                                                        | pending               |

### C. Footer destinations

| Previous entry                                                                                                                                                                                                                                                                       | New entry (V43, public non-compact pages)                                                                                                                                 | Verification          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| The 16: `/source`, `/machinery`, `/corridors/bangladesh-china`, `/corridors#mission-example`, `/trade-missions`, `/business-trips`, `/institutions`, `/network`, `/sell`, `/enter-market`, `/corridors/bangladesh-eu`, `/corridors`, `/how-it-works`, `/about`, `/trust`, `/privacy` | Pack hierarchy (Solutions, Explore, Already working with us, legal row); each destination exactly once; `/corridors/bangladesh-china` is the legal row's Bangladesh Guide | pending (footer step) |
| Sign In `/signin`, `/workspace`, the `/access/*` doors, the language switcher, the "Your work stays private" line                                                                                                                                                                    | Kept (customer account, team sign-in, local helper sign-in through the access doors when on)                                                                              | pending               |
| Signed-in quiet footer (`/trust`, `/privacy`), staff preview, compact `/plan` footer                                                                                                                                                                                                 | Unchanged (`/plan` keeps today's trimmed compact footer)                                                                                                                  | pending               |

### D. Features

| Previous entry                                                                     | New entry (V43)                                                                                      | Verification |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| Four doors, one radio group `home-route`, one `#home-start`                        | Same doors, same group, flags 22 px, one-line sentences                                              | pending      |
| Reveal bar and "All Routes" (focus to `#home-start`)                               | Own bar markup in V43, same return                                                                   | pending      |
| Request section with six goals, note, four timings, summary card, Talk or WhatsApp | V43 request form (textarea 600), preview card, Review Request dialog, Talk link only with the number | pending      |
| China quotes A, B, C, visit timeline, comparable list                              | Kept in the opened route block; compact quote console is separate and tagged                         | pending      |
| Sell filters, fair-cost calculator, fair list against shortlist, outside list      | Kept in the opened route block; compact shortlist console beside it                                  | pending      |
| Delegation programme table                                                         | Kept at `#route-delegation`; phases console added                                                    | pending      |
| Other route                                                                        | Kept at `#route-other`; question console added                                                       | pending      |
| FAQ (eight), open keys                                                             | Pack eight visible; shipped eight under "More Answers"                                               | pending      |
| People tabs and choices                                                            | Role buttons with You bring and You get; shipped cards under "Read the Full Promise for Each Role"   | pending      |
| StartBar, closing band, jobs links                                                 | Kept                                                                                                 | pending      |
| Language fallback (ADR-066, ADR-074)                                               | New words English-only; missing entry shows English; Arabic RTL; five trust names stay English       | pending      |

### E. Intake goals

| Previous entry                                                                                                                                         | New entry (V43)                                                                                                        | Verification              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| china to `job=sourcing`; machinery to `machinery_procurement`; sell to `buyers`; fair to `trade_fairs`; delegation to `delegations`; other to no `job` | Same six goals through `briefHref`                                                                                     | pending (href unit tests) |
| `note` (cut at 1000 whole characters)                                                                                                                  | Same; composed from the visitor's own answers                                                                          | pending                   |
| `companyCountry` with `marketCode` (EU allowed as a market)                                                                                            | Added through an optional third argument of `briefHref`, only as a valid pair; omitted for Other and Key Asian Markets | pending                   |

### F. Sample actions (fixture data only, nothing is sent)

| Previous entry                                                                             | New entry (V43)                                                 | Verification |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------ |
| `/corridors#mission-example` open, close, steps                                            | Unchanged; example dossier slot added while V43 is on           | pending      |
| Example tags on the four routes                                                            | Kept; the compact consoles carry "Sample data"                  | pending      |
| Copy request details                                                                       | Clipboard in the Review Request dialog; failure shows a message | pending      |
| Quote pick, shortlist toggle, phase pick, stage pick, role pick, market and direction pick | `aria-pressed` buttons, reversible, send nothing                | pending      |

### G. Cross links into the home

| Previous entry                                                                      | New entry (V43)      | Verification                                               |
| ----------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `/corridors`, `/workspace`, founder overview (`/corridors#mission-example`), footer | Same links; `rg '"/# | /#[a-z]'` is rerun and recorded when the table is finished | pending |

## Open items for the Guardian (defaults apply until answered)

1. brief and draft words: the guard is kept and the substitutions above apply (plan default). If the owner lifts the 23 Nov rule for these words, the guard and the language-base rule are edited by the owner's word, not by the builder.
2. Two cobalt actions in different regions (hero "Start a Request" and `#home-start`): both `.primary-link`, one per region (default).
3. Header job pages: the plan moves the six job pages out of the header into the footer and the closing band; the UI spec D9 keeps them in a "More Ways to Work" foot of the Solutions panel. Settled in the header step.
4. Radios: the spec D3 checks China on load; the plan and the v4.2 rule leave them unchosen (the default here).
