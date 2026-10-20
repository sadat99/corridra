# UI direction: the single design contract

Read [the product vision v2.1](../product/corridra-product-vision-v2.1.md) and its [working summary](product-vision.md) first: they explain what Corridra is, for whom and why. Every visible change in Corridra follows this file. It turns the locked UX10X decisions (`docs/ux10x/master-handoff.md`, section 1.1) into concrete rules so that Claude Code and Codex produce one product, not two styles. The Fusion 01 prototype is a visual reference only. Its names, figures and statuses are fictional and carry no domain authority.

## Business objective and cognitive load (owner directive, 2026-10-15)

Corridra is a startup. Every screen must move a real person toward a business outcome: a qualified mission, an introduction, a commercial result or a Corridra service fee. The owner reports that the current product is too complex to understand, even for its builder. Treat cognitive load as a defect with the same weight as a bug.

Rules for every visible change:

1. **One job per screen.** A screen answers one question: what should I do next, why does it matter, who owns it. Everything else is behind a clearly named "More" or a disclosure.
2. **At most five primary choices** in any navigation level. Group by the user's job, not by how the system is built.
3. **One landing screen per audience** that shows the next action first. Do not show a directory of every tool before the person knows what they came to do.
4. **Say it in the user's words.** No internal programme names (V2 parts, UX phases), module names or system vocabulary in the interface. Prefer a verb and a result ("Review new briefs", not "Missions and requirements").
5. **Hide, never delete.** Reduce load by ordering, grouping, collapsing and role-based defaults. Keep every existing panel mounted and every action reachable, because tests, history and permissions depend on them.
6. **Money path first.** Order content by the path visitor, brief, qualified mission, introduction, meeting, commercial outcome, service fee. Gated or unavailable capabilities are shown honestly and briefly, never as the headline.

## Plain language for a global audience (owner directive, 2026-10-15)

Users in Bangladesh, China and other non-English countries must understand every screen without help. Many read English as a second language and some use machine translation. Write for them, without lowering the business standard or the product vision.

Rules:

1. **Short, common words.** Prefer words an intermediate English reader knows. Choose the plain word over the clever one, except for Corridra's owned words (mission, evidence, counterparty, corridor) and the five trust states, which keep their names and get a short plain explanation.
2. **Short sentences.** One idea per sentence, ideally under 20 words, active voice, present tense.
3. **One word per idea, everywhere.** Never use two names for one thing. Follow the glossary below.
4. **No idioms, metaphors or slang.** Nothing that breaks in translation ("in focus", "what needs to happen", "next move").
5. **Spell out abbreviations** on first use or avoid them (RFQ, MFA, SLA). Write dates unambiguously (15 Oct 2026) and always show the time zone for times.
6. **Keep the exact trade terms people already use** where they are standard and precise: price quote, payment terms, lead time, delivery terms. Do not simplify these away.
7. **Honest status words.** "Example" for demonstration data, the exact trust state for each fact (Self-declared, Evidence available, Verified, Derived, Outcome observed), "not available yet" for gated features. Never soften a limit and never call something verified unless it is.
8. **Names and originals stay as written.** Company names, Chinese text and original amounts are never translated or reworded. Bangla guidance remains available where it exists.
9. **Legal, privacy and consent text** changes only with owner review.

### Glossary (corrected after reading the source documents)

The Positioning Constitution (section 22) reserves a vocabulary that Corridra owns: market, mission, counterparty, commercial, relevant, qualified, evidence, outcome, progress, access, with corridor, buyer, supplier and others as supporting words. **Do not rename these.** Plain language means explaining them in one short line the first time, and choosing the plainer neighbour for everything else. The five trust states are fixed by the Public Experience and the code; keep their names and add the plain line.

| Avoid                                      | Use                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brief, mission brief, test brief           | request, mission request, example request                 | **Applied 2026-10-15** across customer and staff screens and the tests that assert them. "Meeting brief" is a different thing and keeps its name. Data field names (`brief` in payloads and APIs) are not UI copy and are unchanged. The privacy page was deliberately left unchanged because it is legal text; it still says "briefs" and needs owner review before the wording is aligned. |
| mission                                    | mission                                                   | Brand word. First use: "a mission is a planned piece of work to meet the right companies".                                                                                                                                                                                                                                                                                                   |
| evidence                                   | evidence                                                  | Brand word and a trust state. Gloss: "documents and facts that support a statement".                                                                                                                                                                                                                                                                                                         |
| counterparty                               | buyer, supplier, distributor, company                     | Prefer the real role in interface text. Keep "counterparty" in explanations.                                                                                                                                                                                                                                                                                                                 |
| corridor, commercial direction             | route, for example "Bangladesh to China route"            | Keep "corridor" as a supporting brand word where it already appears.                                                                                                                                                                                                                                                                                                                         |
| Self-declared                              | Self-declared, with the line "stated by the company"      | Fixed state name.                                                                                                                                                                                                                                                                                                                                                                            |
| Evidence available                         | Evidence available, "proof was provided"                  | Fixed state name.                                                                                                                                                                                                                                                                                                                                                                            |
| Verified                                   | Verified, "checked by a defined process"                  | Use only when it is true. Fixed state name.                                                                                                                                                                                                                                                                                                                                                  |
| Derived                                    | Derived, "worked out from available data"                 | Fixed state name.                                                                                                                                                                                                                                                                                                                                                                            |
| Outcome observed                           | Outcome observed, "a real result was recorded"            | Fixed state name.                                                                                                                                                                                                                                                                                                                                                                            |
| qualification, assessment                  | review for fit                                            | Keep "qualified" where the product means it.                                                                                                                                                                                                                                                                                                                                                 |
| quotation, RFQ                             | price quote, price request (RFQ written out on first use) | Quote terms stay exact.                                                                                                                                                                                                                                                                                                                                                                      |
| synthetic, test                            | sample, sample data                                       | Say "sample", never "synthetic". Say clearly that no real record is created where details are entered.                                                                                                                                                                                                                                                                                       |
| operator                                   | Corridra team                                             | Customer screens only. Staff screens may say "operator".                                                                                                                                                                                                                                                                                                                                     |
| workspace, control center, readiness gates | team area, settings and checks, ready to start?           | Staff screens.                                                                                                                                                                                                                                                                                                                                                                               |
| scope, capability, disclosure              | what you can see                                          |                                                                                                                                                                                                                                                                                                                                                                                              |
| execution network, contributor             | Corridra Network, helper                                  | Public name is Corridra Network.                                                                                                                                                                                                                                                                                                                                                             |

The earlier proposal to rename mission to project, evidence to proof and verified to checked is **withdrawn** because it conflicts with the Constitution.

## Lead journey and order of work (owner decision, 2026-10-15)

The first journey to make clear, fast and conversion-ready is **Bangladesh to China sourcing missions** (suppliers and machinery) and **leading or taking delegations to China**. Build and polish that path end to end for every audience. Then extend to the other routes and jobs one at a time: sell in Spain or the EU, enter a market, business trips. Each later route reuses the same screens and words; do not fork screens by country.

Stored values are data, not UI copy. Mission objectives such as "Sell in a new market" are saved and validated by the backend. Never reword them to improve a screen; change only the label shown to people, and only where a mapping already exists.

## Intent

Quiet Intelligence (V10) is the grammar: calm, legible, mission first. SourceLab (V07) sets technical rigour for quotations and evidence. Heritage Atlas (V01) sets public editorial authority. Precision Ledger (V02) sets operator density. The result must read as one company: confident, precise, unhurried, never decorative for its own sake.

A person should always know what they may do next, why, what evidence supports it, what is uncertain and who owns it. Complexity recedes; it is never hidden or invented.

## How consistency is enforced

Building one screen at a time must not produce a scattered product. Four mechanisms make drift fail early:

1. **One token layer.** Every colour, font, size, radius, shadow and duration comes from the tokens in the "Design system layer" of `apps/web/app/globals.css`. New CSS goes below that marker and may use tokens only.
2. **An automated check.** `tests/design-system.test.mjs` runs in `pnpm test` and in CI. It fails on any raw hex colour, colour function or font family written after the marker, and it stops the older CSS from growing (`tests/design-system-baseline.json`). When you remove old values, lower the baseline in the same change. Never raise it.
3. **Five page patterns.** Build new screens from these only, so that people learn the product once:
   - _Landing_: label, one headline, one sentence, one or two choices, then simple steps.
   - _Flow_: one question per step, progress shown, draft kept, clear send action.
   - _Record_: header with status and owner, next action first, details in disclosures.
   - _Queue_: filters on top, one row per item, status badge, one primary action per row.
   - _Report_: headline numbers with their denominators, then detail, then export.
4. **One log, one contract.** Every change is recorded in `docs/agents/work-log.md` and must match this file. If a screen needs something this file does not allow, change this file first, with the reason.

Review checklist before any visual change is done: it passes the Product Decision Test in v2.1 section 23 (real commercial problem, who pays, what they do today, more access, trust or progress), tokens only, one of the five patterns, plain words from the glossary, one primary action, readable at 390 px, keyboard and focus work, axe clean.

## Rules inherited from the Public Experience (section 26)

One primary call to action per visual section, secondary actions visually quieter. Never auto-rotate a carousel. Never hide the main action in a clever interaction. No account wall before value. No modal in the first seconds. No chat widget over mobile actions. No fake activity. No endless homepage: every section earns its place. No jargon before comprehension: explain first, name later. Mobile first for intake, buyer links and helper screens. Never publish "Trusted by", "Results" or "Our global network" without real facts.

## Foundation (implemented in `apps/web/app/globals.css`, section "Design system")

| Layer     | Rule                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour    | Ivory paper, forest green and ink are the brand. Use semantic tokens only (`--surface-*`, `--text-*`, `--brand-*`, `--accent-gold`, `--positive`, `--caution`, `--critical`, `--info`, `--unknown`). Text must reach WCAG AA. No new hex values in component CSS.                            |
| Type      | Inter for all interface and data text. An editorial serif for hero and section headings on public pages only. Bangla and Han fallbacks stay in every stack. Money, quantities, dates and ids use tabular numerals. Scale: 12, 13, 14, 16, 18, 20, 24, 32, 44, 60 px with fixed line heights. |
| Space     | 4 px base: 4, 8, 12, 16, 24, 32, 48, 72, 96. No other values.                                                                                                                                                                                                                                |
| Shape     | Controls 8 px, cards 12 px, large panels 16 px, pills for badges only.                                                                                                                                                                                                                       |
| Elevation | Three levels, soft green-tinted shadows. Borders carry structure; shadows carry focus and overlays.                                                                                                                                                                                          |
| Motion    | 120 to 220 ms ease-out for state changes only. Honour `prefers-reduced-motion`. Never block a task on animation.                                                                                                                                                                             |
| Focus     | 2 px brand ring with white halo on every interactive element. Never removed.                                                                                                                                                                                                                 |
| Targets   | Interactive targets at least 44 px on touch.                                                                                                                                                                                                                                                 |

## Components

Buttons (primary, secondary, quiet), fields (label above, helper below, error inline, 44 px), cards, status badges, data tables (sticky header, tabular numerals, intentional local scroll below 640 px), disclosure panels, notices (info, caution, critical, unknown), section rail and tabs, empty states, loading states and recovery states. Reuse the existing class names (`primary-link`, `text-link`, `field`, `operator-form`, and others) so behaviour and tests are untouched. Add a class only when no existing one fits, and document it here.

## Maps and the atlas

The platform serves any country to any country. Two routes are spotlighted (Bangladesh to China, Bangladesh to Spain or the EU) and any other pair can be chosen.

1. Map colours come from the `--map-*` tokens only. No raw colour values in component CSS, outside `:root`.
2. A route that is not a configured corridor says plainly that no operating offer is announced for it, and links to the request page with both countries filled in. An arc is a commercial direction, never a shipment route or a promise of coverage.
3. The EU is drawn as its 27 member states. A country too small to draw at map scale is shown as a marker.
4. Map outline data is generated outside the repository and checked in, with its sources and licences in the file header. `tests/world-geography.test.mjs` fails if a supported country has neither an outline nor a point.
5. Country names come from the browser's own locale data, which can differ from the server's. Long country lists show codes until the page has hydrated, so server and browser output match.
6. Every select has a visible label tied to it with `for` and `id`, never a label that wraps the whole select, so assistive technology reads the label alone.

## Content rules

Natural, concrete English. No em dashes. No fake urgency, counts, logos, testimonials, coverage or availability. Synthetic or test data is always labelled. Original currency, language, source and version stay visible. Unknown is shown as unknown, never as zero or success. Availability is stated once, where a person enters details (the request page notice and its acknowledgement), in the privacy page and on the account, sign-in and workspace screens where the state is functional. It is not repeated as banners, status chips or taglines on marketing pages (owner directive, 2026-10-15). On public pages say "sample" for example material, never "synthetic" or "invented" (readers in Bangladesh and China do not know these words); the request page keeps "invented details" because it is an instruction to the person typing. The product name is always written "Corridra" with a capital C, including the header and footer wordmark (owner directive, 2026-10-15).

## By audience

| Audience           | Priority                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Public visitor     | Commercial clarity, one dominant next action, honest availability       |
| Customer           | Mission passport, one next action, approved evidence, timeline          |
| Buyer and supplier | One scoped decision, original terms, private reply                      |
| Institution        | Real denominators, approved agenda, export                              |
| Contributor        | Exact task, terms, pending acknowledgement, review state                |
| Operator           | Next action first, dense filtered tables, source and permission visible |
| Owner and admin    | Readiness blockers, exact-currency economics, independent review        |

## Programme phases

| Phase | Scope                                                                                                                          | Status                                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Design foundation: tokens, type, controls, forms, surfaces, header                                                             | Done (PR 48)                                                                                                                                                                                                 |
| A     | Front door: home lead section for both routes, five-item header, footer keeps every destination                                | Done (PRs 48, 50, 51, 54)                                                                                                                                                                                    |
| B     | Request flow and the customer project screen, in plain words, for sourcing and delegations                                     | In progress. Remaining: finish the customer mission view with machinery quotation comparison                                                                                                                 |
| C     | Operator: one landing queue and five job areas instead of 19 sections                                                          | In progress. Directory in five job areas and the Today panel are done. Remaining: buyer replies and evidence review sources                                                                                  |
| D     | Delegation programme report, helper and account screens                                                                        | Not started                                                                                                                                                                                                  |
| E     | Other routes one by one: sell in Spain or the EU, enter a market, business trips                                               | Mostly done (PRs 50, 52, 55). Remaining: data-driven corridors list                                                                                                                                          |
| F     | Core noun pass (needs owner confirmation), empty and error states, motion, accessibility and performance, Fusion parity review | Partly done (wording). Remaining: empty and error states, motion, performance, Fusion parity review                                                                                                          |
| G     | Guided experience standard: 36 designed screens, eight binding rules, locked navigation (see the Guided section below)         | Style locked 2026-10-19. Public site built 2026-10-20 (home, header, footer, corner dock, how it works, routes, trust, ways to work, about, network, institutions). Request flow and later screens not built |

The [master plan](master-plan.md) is the authority for status. This table is a summary and must match it.

## Guided experience standard (LOCKED, owner decision 2026-10-19)

The owner approved the Guided UX v2 mockups (36 screens, a private design canvas titled "Corridra Guided UX v2") as the visual and interaction style for all of V3. This section sits on top of everything above. Where it is stricter, it wins. Changing anything in it needs the owner's approval, and this file is changed first, with the reason.

### Who it is for

Business owners and organisers in Bangladesh and China, mostly on phones, often reading English as a second language, some with low reading skill or low comfort with tech tools, some blind or low vision. Long forms and many steps put them off, so every necessary step is split, saved and explained. A screen that needs explaining is a wrong screen.

### The eight rules (binding)

| #   | Rule                     | What it means in the build                                                                                                                                        |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One question, one button | One question per screen and one main action. Everything else is quieter or behind a disclosure.                                                                   |
| 2   | Always say where you are | Step number, time left and what comes next on every flow screen. Work items show the journey bar.                                                                 |
| 3   | Language first           | English, বাংলা, 中文 are chosen first and remembered. Company names and original text are never translated. Every language is reviewed by a native speaker.       |
| 4   | Read aloud everywhere    | A Listen button on every screen. Hidden, not broken, where the phone cannot speak that language.                                                                  |
| 5   | Tap more than type       | Big choices, plus and minus steppers, tappable examples. "I am not sure yet" is always allowed.                                                                   |
| 6   | Never lose work          | Each answer is saved as it is given. Back always works. Nothing is sent until the person presses the send button, and a plain sentence summary comes first.       |
| 7   | Help is one tap away     | "I am stuck" opens: read it to me, show an example, ask the Corridra team, skip for now.                                                                          |
| 8   | Honest, never pushy      | Every fact shows its trust label with an icon and a word. Example data says Example. Unknown says "Not measured yet". No fake urgency. Progress is the only hook. |

### Locked parts (use these names in code and reviews)

| Part               | Locked behavior                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar            | Back, title with step and time left, Listen, Help. Language chip beside them on public and home screens.                                     |
| Journey bar        | Done, now, later, with the words under every step. Current step has a ring and is announced to screen readers.                               |
| Big choice         | At least 76 px tall, icon plus word, selected state has a check and a tinted fill. A real radio input inside a label, never a clickable div. |
| Next-step card     | The dark green card with one light button. One per screen, always first on Home and on a piece of work.                                      |
| Action bar         | Primary button at least 60 px tall at the bottom of flow screens, one quiet "Back" or "Not now" below it.                                    |
| Fact label         | The five fixed trust names, each with an icon and its plain line. Colour is never the only signal.                                           |
| Four states        | Loading, nothing here yet, something went wrong (answers are safe), no internet (keep going, send later). Every screen designs all four.     |
| Counts             | Always out of a total ("12 of 20"). Unknown is "Not measured yet", never zero.                                                               |
| Help sheet         | The four options above, in that order.                                                                                                       |
| Accessibility menu | In More: language, text size (three steps), read aloud automatically, stronger colours, less movement.                                       |

### Navigation (locked, at most five)

| Audience      | Items                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public header | How it works, Routes, Sign in, one button "Start a request", plus language and Listen. The old Solutions list and "Start here" move into the footer under "Ways to work". Nothing is deleted. |
| Customer      | Home, My Work, Companies, Results, More. Bottom tab bar on phones, top bar on desktop.                                                                                                        |
| Corridra team | Today, Missions, Companies, Delivery, Outcomes, and "All tools and settings", which keeps every original section reachable.                                                                   |
| Founder       | Business, Operations, Routes and settings, People and access, Ready to start?                                                                                                                 |

### Words added to the glossary

| Plain title shown to people | Contract name kept as a small label under it |
| --------------------------- | -------------------------------------------- |
| Sell my products            | Find Buyers & Partners                       |
| Buy products or machines    | Find Suppliers & Products                    |
| Lead a group trip           | Organise a Delegation                        |

Also: "Ready to start?" for readiness gates, "Routes and settings" for corridors and policies, "Work the next case" for the team queue.

### Screen map (all 36 are design only, none built)

| Group                  | Screens                                                                                                                                                      | Pattern                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Kit                    | The Guide kit                                                                                                                                                | Reference              |
| Public                 | Choose language, home (phone, desktop), how it works, sign in                                                                                                | Landing, Flow          |
| Request                | What to expect, pick one, a number, type or speak, check it, sent                                                                                            | Flow                   |
| Customer               | Home (phone, desktop), My Work, one piece of work, choose companies one by one, company in plain words, price quotes, meeting time, Companies, Results, More | Landing, Record, Queue |
| Delegation             | Home, create, review one sign-up, programme days, money, participant "My trip"                                                                               | Record, Flow           |
| Corridra team, founder | Today, work one case, Missions, Companies, Delivery, Outcomes, founder page                                                                                  | Queue, Report          |

### Token rules for the build

The mockups use larger sizes than the current token layer. Add these to the "Design system layer" in `apps/web/app/globals.css` before use, and nowhere else: guided control radius 14 px, guided card 16 px, hero card 20 px, guided body text 18 px, touch targets 48 px and 60 px for the main action. Mockup spacing that fell between steps (18, 22, 28) snaps to the 4 px scale when built. No raw colours, as before.

### Before any guided screen ships

1. Passes the checks in "Verification for every UI change", with axe clean at 320, 390, 768 and 1440 px.
2. Works with a keyboard and with 200 percent text zoom. Focus moves to the question heading on each step and the screen reader says its number.
3. Copy for each language chip is written and reviewed by a native speaker. A language without reviewed copy is not offered.
4. Tested with real people: a five-person task test from the target audience, and blind users with TalkBack, VoiceOver and NVDA. Until then the claims "easy for any literacy" and "usable without sight" are not made anywhere, in the product or in marketing.
5. Every control works. A control without a working backend is marked missing, not shipped.

### Open decisions (not locked, owner to settle)

1. Where "Ask the Corridra team" goes. In-app request thread is the safe default. Any outside channel is real outreach and stays gated.
2. How answers are saved before an account exists (this device, or an account draft).
3. Language screen: preselect from the browser language, show it once on a first visit, and allow skipping to English.
4. Voice input stays optional and is hidden where the phone does not support it.
5. Staff keyboard shortcut for the next case.

### Public site rules (built 2026-10-20)

- The corner dock is two 44 px icon buttons, bottom-right on every page and screen size: Help (a short sheet) and Listen (reads the page aloud; hidden, not broken, where the browser has no voice). Listen is never in the header.
- Words are the cost. A block is one idea in at most two short sentences. A headline puts each sentence on its own line. No essay paragraphs.
- "Start a request" has no arrow. The phone shows all three home choices in the first screen, with contract names kept for screen readers.
- The Help sheet has no contact channel until the owner decides one (open decision).

### Type scale (built 2026-10-20)

One scale, set as tokens in `apps/web/app/globals.css`. Do not add a raw size; pick the nearest step.

| Step             | Size        | Use                                                           |
| ---------------- | ----------- | ------------------------------------------------------------- |
| `--text-xs`      | 12 px       | Captions, small labels, status words                          |
| `--text-sm`      | 14 px       | Notes, hints, footer bottom row, table cells                  |
| `--text-base`    | 16 px       | Buttons, links, form controls and labels, footer links, cards |
| `--text-lg`      | 18 px       | Reading text and lead paragraphs, large buttons               |
| `--text-xl`      | 20 px       | Card and step titles                                          |
| `--text-2xl`     | 24 px       | Form step titles, key figures                                 |
| `--text-h2`      | 24 to 36 px | Section headings                                              |
| `--text-h1`      | 30 to 48 px | Page headline                                                 |
| `--text-display` | 34 to 60 px | Home headline only                                            |

Phone headlines use a smaller range so each sentence stays on one line. Form controls stay at 16 px so phones never zoom on focus.

### Request page (built 2026-10-20)

- One calm form card beside a sticky summary on wide screens; on phones the form comes first, then the summary, then receipt lookup.
- Steps are numbered dots joined by a line; the phone shows only the current label. The progress element stays for screen readers.
- Choices are whole-card targets; the checked card is marked by border, tint and weight, not colour alone.
- Every field name, label, heading, alert and button name is unchanged, so tests and assistive tools see the same page.

### Build order

One PR per step, each behind its existing flag where the module is optional, with no change to routes, forms, permissions, money or evidence: 1 language, public home and request flow; 2 customer Home, My Work, one piece of work; 3 company choice, price quotes, meeting time; 4 delegation; 5 team Today and one case; 6 founder; 7 team area lists.

## Hard limits (the backbone)

A UI change may not alter domain packages, API handlers, authentication, RLS, migrations, money or evidence semantics, permission checks, production gates, element `name` or `id` attributes, link destinations, form payloads or test hooks. Presentation only. Run the checks in `docs/verification-guide.md` and record the results in the work log.

## Verification for every UI change

`pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, and `test:operator` where a protected surface changed. Capture screenshots at 1440, 768 and 390 px before and after. Axe must stay clean. Record all of it, and what was not run, in `docs/agents/work-log.md`.
