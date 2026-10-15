# UI direction: the single design contract

Read [product-vision.md](product-vision.md) first: it explains what Corridra is, for whom and why. Every visible change in Corridra follows this file. It turns the locked UX10X decisions (`docs/ux10x/master-handoff.md`, section 1.1) into concrete rules so that Claude Code and Codex produce one product, not two styles. The Fusion 01 prototype is a visual reference only. Its names, figures and statuses are fictional and carry no domain authority.

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

| Avoid                                      | Use                                                       | Notes                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| brief, mission brief, test brief           | request, mission request, example request                 | Owner decision 2026-10-15. The source copy says "mission brief"; change it to "request" in a copy pass that also updates the tests asserting it. |
| mission                                    | mission                                                   | Brand word. First use: "a mission is a planned piece of work to meet the right companies".                                                       |
| evidence                                   | evidence                                                  | Brand word and a trust state. Gloss: "documents and facts that support a statement".                                                             |
| counterparty                               | buyer, supplier, distributor, company                     | Prefer the real role in interface text. Keep "counterparty" in explanations.                                                                     |
| corridor, commercial direction             | route, for example "Bangladesh to China route"            | Keep "corridor" as a supporting brand word where it already appears.                                                                             |
| Self-declared                              | Self-declared, with the line "stated by the company"      | Fixed state name.                                                                                                                                |
| Evidence available                         | Evidence available, "proof was provided"                  | Fixed state name.                                                                                                                                |
| Verified                                   | Verified, "checked by a defined process"                  | Use only when it is true. Fixed state name.                                                                                                      |
| Derived                                    | Derived, "worked out from available data"                 | Fixed state name.                                                                                                                                |
| Outcome observed                           | Outcome observed, "a real result was recorded"            | Fixed state name.                                                                                                                                |
| qualification, assessment                  | review for fit                                            | Keep "qualified" where the product means it.                                                                                                     |
| quotation, RFQ                             | price quote, price request (RFQ written out on first use) | Quote terms stay exact.                                                                                                                          |
| synthetic, test                            | example, example data                                     | Say clearly that no real record is created.                                                                                                      |
| operator                                   | Corridra team                                             | Customer screens only. Staff screens may say "operator".                                                                                         |
| workspace, control center, readiness gates | team area, settings and checks, ready to start?           | Staff screens.                                                                                                                                   |
| scope, capability, disclosure              | what you can see                                          |                                                                                                                                                  |
| execution network, contributor             | Corridra Network, helper                                  | Public name is Corridra Network.                                                                                                                 |

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

Review checklist before any visual change is done: tokens only, one of the five patterns, plain words from the glossary, one primary action, readable at 390 px, keyboard and focus work, axe clean.

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

## Content rules

Natural, concrete English. No em dashes. No fake urgency, counts, logos, testimonials, coverage or availability. Synthetic or test data is always labelled. Original currency, language, source and version stay visible. Unknown is shown as unknown, never as zero or success.

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

| Phase | Scope                                                                                                                          | Status        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1     | Design foundation: tokens, type, controls, forms, surfaces, header                                                             | Done          |
| A     | Front door for China sourcing and delegations: home lead section, five-item header, footer keeps every destination             | Done in PR 48 |
| B     | Request flow and the customer project screen, in plain words, for sourcing and delegations                                     | Not started   |
| C     | Operator: one landing queue and five job areas instead of 19 sections                                                          | Not started   |
| D     | Delegation programme report, helper and account screens                                                                        | Not started   |
| E     | Other routes one by one: sell in Spain or the EU, enter a market, business trips                                               | Not started   |
| F     | Core noun pass (needs owner confirmation), empty and error states, motion, accessibility and performance, Fusion parity review | Not started   |

## Hard limits (the backbone)

A UI change may not alter domain packages, API handlers, authentication, RLS, migrations, money or evidence semantics, permission checks, production gates, element `name` or `id` attributes, link destinations, form payloads or test hooks. Presentation only. Run the checks in `docs/verification-guide.md` and record the results in the work log.

## Verification for every UI change

`pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, and `test:operator` where a protected surface changed. Capture screenshots at 1440, 768 and 390 px before and after. Axe must stay clean. Record all of it, and what was not run, in `docs/agents/work-log.md`.
