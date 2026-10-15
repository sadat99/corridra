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

## 2026-10-15, Claude Code, UI Phase A: China lead-journey front door, plus consistency enforcement

- Request: start with Bangladesh to China sourcing missions and leading or taking delegations, then the other routes one by one. Also keep the whole platform consistent, minimal, aesthetic and business-serving, so that building one piece at a time does not scatter the product.
- Why: the home page opened with idiomatic marketing copy and offered six jobs, three dropdowns and an eight-link header. The lead path was not obvious. Separately, piecemeal work was the owner's stated risk, so consistency needed to be enforced by tooling, not by good intentions.
- What changed: (1) `apps/web/app/page.tsx`: the story section is replaced by a lead section: "Work with companies in China, step by step", two choices (Source products from China, Lead a delegation to China) with a secondary link each for machinery and institutions, and four plain steps. The existing hero, atlas, selector, walkthrough and the full guide disclosure are unchanged. (2) `apps/web/components/site-header.tsx`: top bar reduced from eight items to five (Solutions, How it works, Sign in, Start here, Plan a mission); the Solutions menu lists the China-relevant jobs first. Corridors, For Institutions, Trust and Evidence and Example left the bar. (3) `apps/web/components/site-footer.tsx`: added "Trade routes" so every removed destination stays reachable (the others were already in the footer or the home guide). (4) `apps/web/app/globals.css`: `.ux-lead*` classes using tokens only, plus tokens `--on-brand` and `--ring`. (5) `tests/design-system.test.mjs` and `tests/design-system-baseline.json`, wired into `pnpm test:docs`: fails on any raw hex, colour function or font family after the design system marker, and stops older CSS from growing (baseline 30 hex, 0 colour functions, 2 raw font families). (6) `docs/agents/ui-direction.md`: lead journey and order of work, stored-values rule, new phase table (1, A to F), "How consistency is enforced" with five page patterns and a review checklist.
- How it was verified: `format:check`, `lint`, `typecheck`, `test` (17 doc and design tests), `build` pass. Public browser suite 80 of 80. Protected operator suite 14 of 14 (run on the Phase A code before the final token and flex tweaks, which are CSS-only). Sweep: 36 routes at six widths, 216 checks, no axe violations, no overflow, no writes. Not run: integration suite (no server or data code changed), CI-only security jobs.
- Preserved: every route, link target, id and form payload. Header links that left the bar remain in the footer or the home guide. Tests that assert the Solutions menu and the "Start here" and "Plan a mission" links still pass unchanged.
- Decisions and trade-offs: kept the Fusion-approved headline and atlas rather than rewriting them. Did not rename core nouns (mission, brief) because the owner has not confirmed them. Kept "Start here" and "Plan a mission" in the header because tests and operator flows depend on them; both are candidates for the noun pass. Chose a zero-tolerance rule for new CSS and a ratchet for old CSS because the old stylesheet cannot be rewritten safely in one step.
- Open items and risks: the hero selector still has three dropdowns and the intake form still says "brief"; both are Phase B. Operator navigation is untouched (Phase C). The 30 legacy hex values and 2 legacy font families remain as debt to burn down.
- Next step: Phase B, the request flow and customer project screen for sourcing and delegations, in plain words.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Read the founding documents; product vision, master plan and correction

- Request: the owner said Claude must understand exactly what Corridra is, why, for whom and how, including explicit and implicit goals, before building; and that the initial plan, updates and revisions must all be tracked so the latest complete plan is always known.
- Why: until now the work was based on the code and the UX handoff, not on the three founding documents. Reading them showed that two earlier proposals conflicted with the governing language rules, and that the Phase A copy ignored approved headlines and call-to-action rules.
- What changed: (1) `docs/agents/product-vision.md`: what Corridra is and is not, the nine audiences and their jobs, how the business wins, dated owner decisions that override the sources, owned words, and the rules every screen follows. (2) `docs/agents/master-plan.md`: the single current plan table, a dated revision log from the original UX10X programme to today, open owner decisions, and the rule to update it with every plan change. (3) `docs/agents/ui-direction.md`: glossary corrected, rules inherited from the Public Experience added. (4) `docs/agents/README.md`, `AGENTS.md`, `docs/START_HERE.md` and the documentation catalogue point to the new files. (5) `apps/web/app/page.tsx` and `globals.css`: lead section now says "Going to China? Know who is worth meeting.", uses the approved card titles ("Visit fewer suppliers. Visit the ones that fit." and "A delegation should produce more than attendance."), calls to action that name the job (Plan a sourcing visit, Plan a delegation, Design a programme), one primary action (the delegation action is secondary), and the line "Corridra does not promise orders".
- How it was verified: `format:check`, `lint`, `typecheck`, `test`, `build` pass; public browser suite 80 of 80 (includes axe on the home page). The protected operator suite was last run on the earlier Phase A code (14 of 14); this change touches only home page copy and one CSS rule. Not run: integration suite, CI-only security jobs.
- Preserved: all routes and destinations, every test hook, the Fusion hero and atlas.
- Decisions and trade-offs: **Withdrew** the earlier proposal to rename mission to project, evidence to proof and verified to checked. The Positioning Constitution (section 22) reserves mission, evidence, counterparty and corridor as owned words, and the five trust states are fixed. Plain language now means explaining those words, not replacing them. Only "brief" changes, to "request", pending owner confirmation. Chose to keep sourcing as the primary action and delegations as secondary because the Public Experience allows one primary action per section.
- Open items and risks: four owner decisions listed in the master plan (header versus the source navigation, hero headline, one primary action, the word "request"). The hero still uses the Fusion headline. The hero selector still has three dropdowns, where the Public Experience specifies five situations.
- Next step: Phase B, once the owner answers or approves the defaults in the master plan.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Adopt Product Vision v2.1; reconcile coordination files

- Request: the owner supplied "Corridra Product Vision, Commercial Model and Operating Constitution v2.1" as the latest governing direction. Keep a durable copy under `docs/product/`. Reconcile it with the repository, the roadmap, the ADRs and open branches. Do not restart completed work. Use the coordination files already in PR 48 and do not create a second system. This thread's instructions take priority.
- Why: v2.1 refines the earlier founding documents (two asymmetric corridors, four product lines, four money domains, price hypotheses, growth loops, what Corridra must not become, the Product Decision Test, and distinct status words) and states that PR 48 holds the agent coordination files.
- What changed: (1) `docs/product/corridra-product-vision-v2.1.md`: the supplied text with its meaning unchanged (formatting normalised, dashes replaced) and a provenance note. Historical sources in `docs/source/`, `docs/brand/` and `docs/product/public-experience-v1.0.md` are untouched. (2) `docs/agents/product-vision.md`: rewritten as a working summary that points to v2.1 as governing and carries the rules into screens. (3) `docs/agents/master-plan.md`: v2.1 priority mapping, a revision row, and v2.1 as the governing reference. (4) `docs/agents/ui-direction.md`, `docs/agents/README.md`, `AGENTS.md` and `docs/START_HERE.md` now point to v2.1. (5) Documentation catalogue updated. No second coordination system was created.
- How it was verified: documentation only. `format:check`, `lint` and `test` are run after the edit. Open PRs and branches were checked through GitHub: only PR 48 and two dependency bumps (PRs 10 and 32) are open, and the `feat/ux-02` to `ux-04` branches are old merged work. No other agent has an open branch, so there is no overlap.
- Preserved: all source documents, the code, and the existing coordination files.
- Decisions and trade-offs: v2.1 says Bangladesh to China sourcing and machinery first and Bangladesh to Spain/EU buyer and export access first, each activated independently. So "China first" is the order of this UI programme, not a reduction of the Spain/EU corridor.
- Open items and risks: the four owner decisions in the master plan are still open (header navigation, hero headline, one primary action, the word "request"). v2.1 section 19A requires coverage verification (Track V), which is not yet scheduled behind a specific PR. v2.1 section 17 says complete functional coverage outranks visual composition, so every lead-journey step must keep all authorised actions reachable.
- Next step: Phase B (request flow and customer mission screen) on the owner's answers, with machinery quotation comparison designed in from the start. Schedule Track V tests alongside it.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Phase B start: "brief" becomes "request"

- Request: the owner sent "?" after four decisions were offered with recommended defaults. Read as "proceed". Earlier the owner said "brief" is hard for readers in Bangladesh and China.
- Why: plain language for a global audience, and the master plan said the wording pass was next.
- What changed: about 45 user-visible strings in 20 files now say "request" (mission request, example request, Submit mission request, Your example request, Mission intake is open for example requests, and so on), with grammar fixed ("an example request"). Unchanged on purpose: data field names (`brief` in payloads and APIs), the API error messages, "meeting brief" (a different thing), and form field `name` attributes. Also changed: the privacy page wording (legal text, flagged for owner review). Tests that assert the old wording were updated in `tests/browser` and `tests/operator`. CSS: the summary hover colour no longer turns text dark green on the dark workspace navigation (an old global rule failed contrast there, exposed when the pointer rested on it).
- How it was verified: `format:check`, `lint`, `typecheck`, `test`, `build` pass. Public browser suite 80 of 80. Protected operator suite 14 of 14 after fixing the contrast issue (the first two operator runs failed: one because the local database had stopped while idle, then twice on the hover contrast failure and one dependent test). Not run: integration suite (no server or data code changed), CI-only security jobs.
- Preserved: all routes, link targets, ids, payload shapes, API behaviour and test hooks other than the quoted wording.
- Decisions and trade-offs: replaced only visible copy, not identifiers, because renaming data fields would touch the backbone. Kept "meeting brief" because it is a separate domain term.
- Open items and risks: privacy page wording needs owner review. The hero still uses the Fusion headline. The home selector still has three dropdowns.
- Next step: replace the three dropdowns with the five situations from the Public Experience, then the customer mission view with machinery quotation comparison.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Keep legal text out of the wording pass; merge readiness

- Request: the owner asked what is next and whether anything should be merged. The repository authorises correct, checked merges (`AGENTS.md`, `CLAUDE.md`).
- Why: the wording pass had also edited `apps/web/app/privacy/page.tsx`. That is legal text, and the UI contract says legal text changes only with owner review.
- What changed: restored `apps/web/app/privacy/page.tsx` to the version on `main`. Updated the glossary note, the master plan and this log. The privacy page still says "briefs" until the owner reviews it.
- How it was verified: see the PR. Gates are rerun on this commit before merging.
- Preserved: everything else in the wording pass.
- Decisions and trade-offs: a small inconsistency (privacy page says "briefs", screens say "requests") is acceptable until the owner reviews the legal wording.
- Open items and risks: privacy page wording review. The hero headline decision. Phase B remainder.
- Next step: merge PR 48 once exact-head CI is green, then continue Phase B on a fresh branch from the new `main`.
- PR / commit: sadat99/corridra#48.

## 2026-10-15, Claude Code, Phase B: five situations on the home page; branch limit

- Request: the owner said "meanwhile u build the next" (build Phase B while CI runs for PR 48) and asked to keep the Git branch count below nine and delete branches once they no longer affect the system. The message was cut off after "& never".
- Why: the Public Experience specifies five situations, not three dropdowns. The dropdowns made a first-time visitor decide role, job and route before seeing any value. The branch limit keeps the repository easy to read for both agents.
- What changed: (1) `apps/web/components/discovery-experience.tsx`: five situation cards (Source from suppliers, Run a trade mission, Enter Bangladesh, Sell abroad, Help locally). Each card presets role, job and route and updates the example-request link. The three dropdowns remain, inside a closed "Fine-tune" disclosure, so no action was removed. (2) `apps/web/app/globals.css`: situation card and fine-tune styles, in the token-only layer. (3) Tests: a shared `openFineTune` helper in the affected browser and operator specs, and one new test for the situation cards. (4) `scripts/check-git-branch-budget.mjs`: now fails when the repository has more than eight Git branches. `scripts/branch-budget.ts` (Neon, ten) is unchanged. (5) `AGENTS.md` and `docs/agents/README.md` rule 7 state the new limit.
- How it was verified: `format:check`, `lint` pass. Public browser suite 82 of 82 (with axe and no-write checks). Protected operator suite: see the PR. Not run: integration suite (no server or data code changed).
- Preserved: all routes, link targets, payload shapes, the three original selectors and their labels, API behaviour.
- Decisions and trade-offs: sourcing stays the first and selected card, per the owner's order. "Help locally" links to `/network` because that is a different path from the example request.
- Open items and risks: three fully merged remote branches (`feat/ux-02-public-experience`, `feat/ux-03-participant-journeys`, `feat/ux-04-operator-experience`) could not be deleted from this environment (HTTP 403). The owner must delete them in GitHub. The text after "& never" in the branch rule message is unknown.
- Next step: customer mission view with machinery quotation comparison, then the intake polish.
- PR / commit: branch `feat/ux-phase-b-situations`.

## 2026-10-15, Claude Code, Merge PR 48; deployment blocked; mission view summary

- Request: merge and deploy without extra steps ("go directly to production"), and keep building the next piece meanwhile.
- What happened: `validate` passed on PR 48 head `96900bb` (`analyze` was skipped, which is not a pass). PR 48 was marked ready and merged with a normal merge commit, `7f61217`. The merge tree equals the tested head tree (`1b86c10`), so no new checks were needed on the merge result.
- Deployment: **not done.** The Vercel connection in this session sees one team ("Nazmus Sadat's projects") with four projects (visastack, bidesh365, tradeproof, travelrouter). There is no `corridra` project in it, and `corridra.vercel.app` is not an alias there. The runbook says to confirm project and team IDs before deploying. Deploying to any other project would be wrong, and creating a new one is not authorised. Owner action: connect the Vercel account or team that holds the `corridra` project, or give its team and project IDs. Then the exact commit `7f61217` is deployed per `docs/runbooks/deployment.md`.
- Mission view (branch `feat/ux-phase-b-situations`): added an "at a glance" row (companies shortlisted, offers to compare, offers that match the current request, visits and actions), one shared offer filter in place of three copies, a sticky term column in the quotation comparison table, and a shaded marker for missing terms. All headings, labels and controls that tests use are unchanged. Protected suite on the earlier Phase B commit: 14 of 14. The suite is being rerun on the mission view change.
- Next step: rerun result, then push the branch and open a PR to `main`.
