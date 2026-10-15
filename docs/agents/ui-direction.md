# UI direction: the single design contract

Every visible change in Corridra follows this file. It turns the locked UX10X decisions (`docs/ux10x/master-handoff.md`, section 1.1) into concrete rules so that Claude Code and Codex produce one product, not two styles. The Fusion 01 prototype is a visual reference only. Its names, figures and statuses are fictional and carry no domain authority.

## Business objective and cognitive load (owner directive, 2026-10-15)

Corridra is a startup. Every screen must move a real person toward a business outcome: a qualified mission, an introduction, a commercial result or a Corridra service fee. The owner reports that the current product is too complex to understand, even for its builder. Treat cognitive load as a defect with the same weight as a bug.

Rules for every visible change:

1. **One job per screen.** A screen answers one question: what should I do next, why does it matter, who owns it. Everything else is behind a clearly named "More" or a disclosure.
2. **At most five primary choices** in any navigation level. Group by the user's job, not by how the system is built.
3. **One landing screen per audience** that shows the next action first. Do not show a directory of every tool before the person knows what they came to do.
4. **Say it in the user's words.** No internal programme names (V2 parts, UX phases), module names or system vocabulary in the interface. Prefer a verb and a result ("Review new briefs", not "Missions and requirements").
5. **Hide, never delete.** Reduce load by ordering, grouping, collapsing and role-based defaults. Keep every existing panel mounted and every action reachable, because tests, history and permissions depend on them.
6. **Money path first.** Order content by the path visitor, brief, qualified mission, introduction, meeting, commercial outcome, service fee. Gated or unavailable capabilities are shown honestly and briefly, never as the headline.

## Intent

Quiet Intelligence (V10) is the grammar: calm, legible, mission first. SourceLab (V07) sets technical rigour for quotations and evidence. Heritage Atlas (V01) sets public editorial authority. Precision Ledger (V02) sets operator density. The result must read as one company: confident, precise, unhurried, never decorative for its own sake.

A person should always know what they may do next, why, what evidence supports it, what is uncertain and who owns it. Complexity recedes; it is never hidden or invented.

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

| Phase | Scope                                                                                                                   | Status                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1     | Design foundation (tokens, type, controls, forms, tables, notices) plus public pages, sign-in and recovery shells       | Foundation layer and public shell done; page-level recomposition continues in phases 2 to 4 |
| 2     | Participant and customer surfaces: mission passport, quotation comparison, programme report, contributor board, account | Not started                                                                                 |
| 3     | Operator and governance workspace: navigation, queues, dense tables, forms, control centre                              | Not started                                                                                 |
| 4     | Microcopy, empty and error states, motion, accessibility and performance pass, Fusion parity review                     | Not started                                                                                 |

## Hard limits (the backbone)

A UI change may not alter domain packages, API handlers, authentication, RLS, migrations, money or evidence semantics, permission checks, production gates, element `name` or `id` attributes, link destinations, form payloads or test hooks. Presentation only. Run the checks in `docs/verification-guide.md` and record the results in the work log.

## Verification for every UI change

`pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, and `test:operator` where a protected surface changed. Capture screenshots at 1440, 768 and 390 px before and after. Axe must stay clean. Record all of it, and what was not run, in `docs/agents/work-log.md`.
