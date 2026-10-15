# Agent work log

Append-only, newest entry last. Template and rules: [README](README.md). Entries describe the revision they name, not today's state.

## 2026-10-15, Claude Code, UX10X coverage reconciliation

- Request: start from the UX10X handoff and verify the explicitly unfinished UX coverage, using the Fusion ZIP for visual comparison.
- Why: the UX-06 ledger records 773 of 777 rows as not yet verified, and its inventory predates PRs 45 and 46.
- What changed: added `docs/ux10x/reconciliation-2026-10-15/` (report, ledger drift, runtime coverage, accessibility sweep) and `scripts/ux10x-runtime-coverage/` (passive recorder, matcher, sweep). Registered the report in the documentation catalogue. No application, domain, API, migration, dependency or gate change.
- How it was verified: Node 24.19.0, local PostgreSQL 16.15 and ClamAV with a test signature. `format:check`, `lint`, `typecheck`, `test` pass. `test:integration` 203 of 204 (the one failure shells out to Docker, unavailable here). `build` passes. Public browser suite 80 of 80, protected operator suite 14 of 14. Accessibility and overflow sweep: 36 routes at six widths, 216 checks, no axe violations, no overflow, no writes. Not run: CI-only security jobs, hosted Neon Auth, real mail, the pinned Postgres image.
- Preserved: the UX-06 ledger and all earlier evidence are untouched.
- Decisions and trade-offs: runtime linking of controls to tests is heuristic, so "never rendered" (190 of 807) is an upper bound. "Interacted" does not mean allowed and denied outcomes were both asserted, so no row was promoted to VERIFIED.
- Open items and risks: customer sign-up, sign-in and account screens have no rendered browser coverage (0 of 39 controls interacted). Staff invitation acceptance, the operator error retry and the owner membership update form are also uncovered. The participant mission view differs structurally from the Fusion cockpit.
- Next step: browser tests for the customer account forms using the existing sign-in fixture.
- PR / commit: sadat99/corridra#48, head 4884632.

## 2026-10-15, Claude Code, Decision: UI and UX rebuild programme

- Request: the owner reports that the shipped UI delivers well under a fifth of the intended experience and asked for a premium, globally credible UI/UX across the whole system without touching the backbone, delivered economically, before any backend work. The owner also requires all work to be documented so Codex stays aligned.
- Why: `apps/web/app/globals.css` is one 2,765-line stylesheet appended phase by phase. It uses Arial as the base typeface, five colour tokens and no type, spacing, radius, elevation or motion scale, so every screen inherits an unfinished foundation. Fixing that layer upgrades all 49 routes at once without changing behaviour.
- What changed: this entry, `docs/agents/`, and the UI direction contract. No product code yet.
- How it was verified: documentation only; see the PR for gate results.
- Preserved: all behaviour, routes, element names, ids, link targets and test hooks.
- Decisions and trade-offs: build a token and component layer first, then recompose surfaces in four phases (see ui-direction.md). Rejected: rewriting components or adding a UI library, which costs more, risks the tested workflows and conflicts with the minimal-dependency rule.
- Open items and risks: Fusion is a visual reference only, its figures and names are fictional.
- Next step: Phase 1 (foundation, public and sign-in surfaces).
- PR / commit: see the PR that adds this file.

## 2026-10-15, Claude Code, UI Phase 1: design foundation and public shell

- Request: fix the UI and UX across the whole system to a premium global standard, economically, without touching the backbone; document everything so Codex stays aligned.
- Why: the shipped UI used Arial, five colour tokens and no spacing, radius, elevation or motion scale. Buttons were square, 12 px, and sat flush against text. Fields were unrounded with no state styling. The availability note was an unstyled grey line. One layer fixes all 49 routes.
- What changed: (1) `apps/web/app/fonts/inter-latin-variable.woff2` plus `INTER-LICENSE.txt`: self-hosted variable Inter (SIL OFL, 48 KB, Latin subset), loaded in `apps/web/app/layout.tsx` with `next/font/local` as `--font-inter`. Bangla and Han keep system fallbacks. (2) `apps/web/app/globals.css`: appended section "Design system layer (Phase 1)" with tokens (`--font-ui`, `--brand*`, `--accent-gold`, `--surface-0..2`, `--text-1..3`, type scale, radius, three shadows, easing, duration) and restyled shared classes: `.primary-link`, `.button`, `.button-secondary`, `.secondary-link`, `.text-link`, `.field` controls, `.detail-card`, `.workspace-panel`, `.label`, `.availability-note` (now a status pill), `details > summary`, tables, focus ring, header (sticky blur on screens wider than 1000 px only), reduced motion. (3) `docs/agents/*`: protocol, this log, the UI contract; `AGENTS.md`, `docs/START_HERE.md` and the documentation catalogue now point to them.
- How it was verified: Node 24.19.0, local PostgreSQL 16.15 and ClamAV test signature. `format:check`, `lint`, `typecheck`, `test`, `build` pass. Public browser suite 80 of 80. Protected operator suite 14 of 14. Accessibility and overflow sweep: 36 routes at 1440, 1280, 768, 390, 360, 320 (216 checks), no axe violations, no overflow, no non-GET requests. Screenshots: `docs/agents/evidence/ui-phase1/` (before and after, 1440 px, plus 390 px after). Not run: `test:integration` (no server or data code changed), CI-only security jobs.
- Preserved: every class name, element `name` and `id`, link destination, form payload, handler and test hook; no domain, API, auth, migration, dependency or gate change. The only added asset is the font file.
- Decisions and trade-offs: restyled existing classes instead of rewriting components, which is cheapest and cannot break tested workflows. Chose self-hosted Inter over `next/font/google` because the build must not depend on a network font fetch and CSP allows only same-origin fonts. Rejected a UI library. Two regressions were found and fixed during verification: colour overrides on the mobile menu links and on `.label` inside dark cards failed axe contrast, so those colours apply only where the background is known; the sticky header is desktop only because a fixed-height sticky header broke the open mobile menu.
- Open items and risks: this is the foundation, not the finished experience. Page-level composition is still plain in places: the participant mission view has no section rail or progression strip, the operator workspace has no queue-style table, and empty, loading and error states are unchanged apart from tokens. Heading weight on application pages is still heavy. Fusion parity is not claimed.
- Next step: Phase 2, participant and customer surfaces (mission passport with progression strip and section rail, quotation comparison with missing-data and difference filters, programme report, contributor board, account).
- PR / commit: sadat99/corridra#48 (this branch now carries the docs reconciliation and Phase 1).

## 2026-10-15, Claude Code, Owner directive: cut cognitive load, tie UI to business outcomes

- Request: the owner states this is a startup, so everything must lead to business wins, and that the current UI and UX is so complex that even its builder understands a small fraction of it. Cognitive load is far too high.
- Why: measured at `bbb7d71`: 45 routes, 807 source controls, a public header with 8 links plus 6 job pages, and one operator page carrying 19 workspace sections across about 10,300 lines of panels (roughly 540 controls). Navigation follows how the system is built (sources, claims, evidence, execution network, control center), not what each user is trying to do. Phase 1 made the UI look consistent but did not change this.
- What changed: added the section "Business objective and cognitive load" to `docs/agents/ui-direction.md` as a binding rule for both agents. No product code.
- How it was verified: documentation only.
- Preserved: all panels, routes and actions; the rule says hide, never delete.
- Decisions and trade-offs: the next UI phase becomes simplification of information architecture (role landing screens, job-based grouping, plain language) ahead of further visual polish. Phase 2 to 4 in the contract are re-ordered accordingly once the owner confirms the lead revenue path.
- Open items and risks: which single revenue path to optimise first is an owner decision. Real customer admission remains gated by the readiness controls; simplification does not open it.
- Next step: owner confirms the lead path; then build the role landing screens and the five-area operator navigation.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Owner directive: plain language for a global audience

- Request: "brief" is not easy to understand. Use the easiest, standard business English that people in Bangladesh, China and other non-English countries understand at once. Keep words like "evidence" simple too, without lowering the standard or the vision.
- Why: the interface uses internal and consultant vocabulary (brief, mission, evidence, claims, corridor, qualification, execution network). It raises reading effort and breaks under machine translation, which adds to the cognitive load the owner reported.
- What changed: added the section "Plain language for a global audience" with nine rules and a glossary to `docs/agents/ui-direction.md`. No product code or copy yet.
- How it was verified: documentation only.
- Preserved: all current copy, tests and legal text. Exact trade terms (price quote, payment terms, lead time) are kept on purpose.
- Decisions and trade-offs: renaming core nouns touches many strings and the tests that assert them, and it changes product vocabulary, so those four rows (request, project, proof, trade route) are marked proposed and need owner confirmation before any rename. The other rules apply immediately.
- Open items and risks: the homepage headline ("The right market. The right people. The next move.") is idiomatic and may not translate well; a plain alternative needs owner choice. Legal and privacy text needs owner review.
- Next step: owner confirms the four core nouns; then one copy pass over public pages and landing screens, updating asserting tests in the same change.
- PR / commit: sadat99/corridra#48.
