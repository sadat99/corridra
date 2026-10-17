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

## 2026-10-15, Claude Code, Production deployment of PR 48; workspace directory in five job areas

- Request: the owner connected Vercel and asked to keep moving, one task after another and in parallel where nothing can break.
- Deployment record (per `docs/runbooks/deployment.md`). PR sadat99/corridra#48. Tested head `96900bb`. CI `validate` passed on that head (`analyze` skipped). Merge commit `7f61217`, tree identical to the tested head. Vercel project `corridra` (`prj_0Hv40kOQqnIxc6YEifxTknbEfSny`) in team `sadat-os` (`team_Ke1aOfRssz8q4iYSlr7mJY3m`). Production deployment `dpl_Ff9g5ZCRBtWGxuxGeWQr5734cXWN` created from the Git source at the full merge SHA, target production, region `fra1`, state READY. Aliases bound: `corridra.vercel.app`, `c.obsidianglobal.studio`, `corridra-sadat-os.vercel.app`. A fetch of `https://corridra.vercel.app/` returned 200 with the new lead heading "Going to China? Know who is worth meeting." and the self-hosted Inter preload. Previous production deployment `dpl_vzzMjyp7QCyHBFr27xdRiN55JNZx` (commit `bbb7d71`) is the rollback target. Limits: this is an anonymous check of the public page. Signed-in and operator screens on the live site were not exercised, and no field Core Web Vitals were measured.
- What changed in code: `apps/web/components/role-navigation.tsx` groups "All workspace tools and settings" into five job areas: Mission work, Evidence and sources, Assistance and network, Operations and health, Settings and access. Every section is still listed once, with the same anchors and role filtering. A guard lists any future section that is not yet placed under "Other tools". The grid layout is in the token-only CSS layer.
- Preserved: section ids, labels, role rules, panels stay mounted, hash navigation.
- Next step: verify with the protected suite, then include in the next PR.

## 2026-10-15, Claude Code, Real two-corridor map; Spain/EU equal from the first screen

- Request: the owner said the home page map "is not probably correct", asked for both China and Spain "with different angle" with both corridors indicated from the beginning, and explained that the Spain/EU emphasis exists because external reviewers (funders and public authorities) will need to see that Corridra is a solid, provable business that matters to their economy.
- Why: the old atlas was a hand-drawn schematic with no geography. It put Spain and the EU in different places and implied a flight path. For a trade platform that costs credibility. The owner's reason makes the Spain/EU corridor a proof point, so it must look and be evidenced.
- What changed: `apps/web/components/corridor-geography.ts` holds real country outlines (Natural Earth 110m, public domain, via world-atlas 2.0.2, projected with d3-geo; generated outside the repo, no new dependency). `apps/web/components/corridor-map.tsx` draws Bangladesh, China, Spain and the other EU states with two curved commercial directions that leave Bangladesh at different angles. The selected direction is emphasised and the other stays visible. Two toggle buttons below the map switch between "Bangladesh and China" and "Bangladesh and Spain or the EU". Map colours are tokens in the design layer. Text facts, the corridor scope note and all existing selectors are unchanged.
- Rules recorded: (1) both corridors get equal prominence from the first screen. Build depth stays China first. (2) Any claim on either corridor must come from observed, evidenced records. Examples stay labelled as examples and must never be shown as traction. (3) The private details of the owner's funding and residency plans are not recorded in this repository. Only the product requirement is.
- Not done yet: the Spain/EU lead block next to the China lead block on the home page, and the measurement view that turns real missions into corridor-level evidence (later backend work). The legal and immigration side is not handled by this software and needs qualified advisers.
- Next step: verify with the public browser suite, then include in the next PR.

## 2026-10-15, Claude Code, Release of PR 49; atlas lower half simplified

- Request: the owner said the lower half of the Corridor Atlas card was cluttered with scattered text, and reported that Phase B CI passed.
- Release record. PR sadat99/corridra#49, tested head `7d03496`, `validate` passed (`analyze` skipped), merge commit `e7eb309` with a tree identical to the tested head. Production deployment `dpl_9fiiozNPLZF9yPTLX6iCuhcmhrex`, region `fra1`, READY, aliases `corridra.vercel.app` and `c.obsidianglobal.studio` bound. A fetch of the live home page returns the five situation cards. Rollback target: `dpl_Ff9g5ZCRBtWGxuxGeWQr5734cXWN` (PR 48, `7f61217`). Limits: anonymous public-page check only.
- What changed in the atlas: the lower half had seven separate text blocks with mixed alignment (toggle, stamp, two captions, a two-column facts grid, a note, a link). It is now one selected-direction block (route name, a "Customer operations: Not available" tag, the scope note, the link) followed by one footnote ("Built for any corridor. These two come first. Commercial directions only, not shipment routes or local coverage."). The "Explore possibilities. Verify reality." stamp was removed from the card because the hero already carries the message. All scope notes, route data and links are unchanged.
- Verification: public browser suite 82 of 82 on the new markup, protected suite 14 of 14 on the previous commit (map, directory grouping and contrast fix). Screenshots of both directions at desktop and mobile widths were inspected.
- Next step: ship the map, atlas and operator directory in the next PR, then the Spain/EU lead block on the home page.

## 2026-10-15, Claude Code, Home lead section covers both corridors

- Request: the owner asked for both corridors (Bangladesh with China, and Bangladesh with Spain or the EU) to be indicated from the beginning, at equal weight.
- What changed: the home lead section was China only. It now reads "Source from China. Sell to Spain and the EU." and has one card per corridor. China card: sourcing (primary), delegation, machinery. Spain and EU card: selling mission (primary), Enter Bangladesh, a link to the Spain and EU scope. A fix keeps the two card titles on the same line. The boundary line and four-step list are unchanged.
- Verification: public browser suite 82 of 82, lint, typecheck, build, docs and design tests pass. Desktop capture inspected. Mobile relies on the suite's overflow and axe checks at 390 px.
- Limits: the section describes what the example flow does today and makes no claim about orders, buyers or outcomes.
- Next step: Track V browser tests and the intake polish, then the corridor evidence view (later backend work).

## 2026-10-15, Claude Code, Track V: customer account form test

- Request: keep moving. Track V lists customer account forms as never exercised in a browser.
- What changed: one new protected-suite test in `tests/operator/z-ux02-access.spec.ts`. It runs the real customer account screens against a locally answered auth transport (no provider is reached, only synthetic addresses). It checks that sign-up refuses a short password before sending anything and then submits once and moves to email verification, that the reset request shows the same non-disclosing message and hides its button, and that email verification rejects a malformed code, lets the user request a new code, and verifies a six-digit code once. Axe finds no violations on the reset and verification states.
- Verification: the spec file passes (2 of 2). The full protected suite is run before the next merge.
- Still open in Track V: staff invitation acceptance, operator error retry, owner membership form submit, contributor signed-out page, rebuilt coverage ledger.

## 2026-10-15, Claude Code, Route pages rewritten on the shared page component

- Request: "Go" on the proposal to make `/sell` the Spain and EU page and fix the weaknesses found on it.
- Why: `/sell` never named Bangladesh, Spain or the EU, showed an active button beside "Coming soon", hid each card's text behind a "Read the scope" link and had a dangling "Corridra /" breadcrumb. The same component serves every route page, so the fix applies to all of them and keeps the platform consistent.
- What changed: `apps/web/components/public-page.tsx` now has a real breadcrumb ("Corridra / Sell in a new market"), the status "Example requests only" (the example intake is open, so "Coming soon" was wrong), an optional route line under the main action, section text shown in full, and an optional "what we record" block. `apps/web/content/public-pages.ts` gains two optional fields (`route`, `record`). `/sell` names Bangladesh to Spain and the EU and lists what is recorded for each introduction. `/source` names Bangladesh to China and lists what is recorded for each supplier. Headlines are unchanged. One browser test was updated because the disclosures it checked no longer exist.
- Verification: public suite 82 of 82, lint, typecheck, docs and design tests, build. Desktop and mobile captures of the cards were inspected after a missing card padding was found and fixed.
- Rules kept: nothing claims orders, buyers or outcomes. The record blocks describe what the product keeps, not what it has achieved.
- Next step: ship with the next PR after PR 50, then review `/enter-market` and `/trade-missions` with the same route line, and the intake polish.

## 2026-10-15, Claude Code, /sell covers the reverse direction; release of PR 50

- Request: the owner said /sell should also cover the other way round. Most missions sell in Spain and the EU, and Corridra also helps Spanish sellers with suitable items reach buyers in Bangladesh.
- What changed: `/sell` gets a section "It also works the other way." It states the main direction first, then says a Spanish or EU seller can reach suitable buyers in Bangladesh with products chosen to fit that market, and that Spain to Bangladesh work is set up and reviewed separately for each case (this matches the corridor scope note, which says that direction is selectively configurable). Actions: "Plan a mission from Spain or the EU" opens the example request with Spain as the company country, Bangladesh as the market and the buyers job preselected, and "Read the Spain to Bangladesh scope" opens the corridor scope. New optional `reverse` field in the shared page content type. One new public browser test checks the route line, the reverse section, both links, the evidence block and that the request opens preselected.
- Verification: public suite 84 of 84, lint, typecheck, docs and design tests, build. Protected suite 15 of 15 on the commit before this change.
- Release record. PR sadat99/corridra#50, head `a45fe0dfc2ce2b9172ccb8a09175dba72e5cfd4a`, `validate` passed (`analyze` skipped). Merge commit `35885e4b19f653962483b2d17ac3c3e3624fec80`, tree `4b0e5757c0e01e13f9da9fc783fb4a9d1f1c47ea`, identical to the tested head. Note: the merge call was given a mistyped head SHA and the tool did not reject it. The tree comparison above confirms the correct content merged. Full SHAs are now copied from git output. Production deployment `dpl_BaCVdGnuQpxPFXWBwR7AmgZTf25t` created from the merge commit; READY check recorded below when verified. Rollback target: `dpl_9fiiozNPLZF9yPTLX6iCuhcmhrex` (PR 49, `e7eb309`).

## 2026-10-15, Claude Code, Home first screen lifted; route lines; merged branches deleted

- Request: remove "Mission intake is open for example requests. Customer missions are not open yet." from the landing page hero and move the content about 50 percent closer to the header. The owner also asked where to delete the three merged branches and then deleted them.
- What changed: the availability line is now a small client component (`apps/web/components/availability-note.tsx`) that renders everywhere except the home page. The home page already states the same limit under its main action ("Explore with invented records. Real customer missions are not open yet."), so the limit is still shown. The hero columns now align to the top, so the headline block sits level with the atlas card. Measured at 1280 px: atlas top 122 px to 64 px below the header, headline block 209 px to 88 px. At 390 px the headline block moved from 109 px below the header area start to 32 px. The browser test that required the line on every route now requires it on every route except the home page, and checks the home page's own line instead. Also in this change: route lines and "what we record" blocks on `/enter-market` (Spain and the EU to Bangladesh) and `/trade-missions` (starting with Bangladesh to China), with one new public test.
- Verification: public suite 86 of 86, lint, typecheck, docs and design tests, build. Desktop capture inspected.
- Branches: the owner deleted `feat/ux-02-public-experience`, `feat/ux-03-participant-journeys` and `feat/ux-04-operator-experience`. The remote now has 4 branches (`main`, `claude/dazzling-hamilton-fe3jbc`, two Dependabot branches), under the cap of 9.
- Next step: ship after PR 51, then the intake polish and the remaining Track V tests.

## 2026-10-15, Claude Code, Brand name capitalised

- Request: the owner said the name is "Corridra", not "corridra".
- What changed: the header wordmark and the footer wordmark now read "Corridra". A search of the app source found no other visible lowercase use of the name. The content rules in `docs/agents/ui-direction.md` now say the name is always written with a capital C.
- Verification: lint, format and docs tests. Browser suites run with the next build.

## 2026-10-15, Claude Code, Release of PR 51

- Release record. PR sadat99/corridra#51, head `dfb6c76c216630f22153454246c28f12d9236012`, `validate` passed (`analyze` skipped). Merge commit `70fc0256131a423225f4575b48e658911802a573`, tree `22af41d77d34f2f170351c523ecc1ca4387c1a5b`, identical to the tested head. Production deployment `dpl_Hn8H4JLdgVwEkTbA8nN3gef8gK8C` (project `corridra`, team `sadat-os`), region `fra1`, READY, aliases `corridra.vercel.app` and `c.obsidianglobal.studio` bound. Rollback target: `dpl_BaCVdGnuQpxPFXWBwR7AmgZTf25t` (PR 50, `35885e4`). It carries the two-corridor home section, the route page rewrite and `/sell` in both directions.
- Process note: a protected-suite run was disturbed when I stopped a screenshot server with a broad process match and also stopped the suite's own server. The suite was rerun cleanly (15 of 15). Servers are now stopped by exact port or process id only.

## 2026-10-15, Claude Code, Release of PR 52; operator Today panel; corridors page

- Release record. PR sadat99/corridra#52, head `a725649202e99fd337321617321309b584535513`, `validate` passed (`analyze` skipped). Merge commit `25cf668a87f4fecb14853476c5ca7822fda9f462`, tree `b36b2b40ab5278685b58f61d0b5a5edb6325fb5f`, identical to the tested head. Production deployment `dpl_F8Pd1QG6fMKDe6mnwu83u3kyJMtE` (project `corridra`, team `sadat-os`), region `fra1`, READY, aliases `corridra.vercel.app` and `c.obsidianglobal.studio` bound. Rollback target: `dpl_Hn8H4JLdgVwEkTbA8nN3gef8gK8C` (PR 51, `70fc025`). It carries the lifted home first screen, route lines, the Corridra wordmark and the request intake polish.
- Request: build the operator landing view in the way that serves the platform most and is fully correct for its target group.
- Why: operators open the workspace to find out what needs a person first. The workspace had a clear start but no answer to that question.
- What changed: `apps/web/app/operator/today.tsx` adds a "Today" panel at the top of the operator workspace. It shows three counts (new requests to review, missions past their due date, open missions) and two short lists of up to five (new requests, past due) with company, objective, market, state and due date, plus a link to the mission list. It uses only the existing mission list read (`/api/workspace/missions` with the filters that already exist), so it needs no new route, no schema change and keeps the existing role and workspace checks. A failed read shows a message and never blocks the workspace. Also in this change: the corridors page atlas now uses the full width with the map beside the selected direction, and the market selector card is padded in two columns.
- Verification: protected suite 16 of 16, run twice (the new `tests/operator/zz-today.spec.ts` covers the real read, synthetic new and overdue lists, the failure state and accessibility, and saves a capture). Public suite 88 of 88 including the corridors page. Lint, typecheck, docs and design tests, build.
- Limits: the panel makes three small reads per page load. For very large workspaces a dedicated server-side summary would be lighter, and counts cover missions only. Meetings, buyer replies and evidence review are not yet in the panel. The isolated run of the new spec cannot sign in alone because, like the other workspace tests, it relies on state created earlier in the same run.
- Next step: add attention sources one at a time (held meetings, buyer replies, evidence awaiting review) from existing reads, then the remaining public pages and Track V tests.

## 2026-10-15, Claude Code, Availability declarations removed from the marketing site

- Request: remove "Mission intake is open for example requests. Customer missions are not open yet." from everywhere, and remove all such declarations across the site.
- What changed: the site-wide banner component is deleted and removed from the layout, so no page shows it. Also removed: the "Example requests only" chip beside the main action on route pages, the home hero line "Explore with invented records. Real customer missions are not open yet.", the atlas tag "Customer operations: Not available", the "Not open yet" text on the Help locally card and the network card, the "Real missions open after our checks are complete" sentence in the home lead, the "See the launch status" block on the home guide (now a plain "Plan a mission" link), the "not open yet" sentences in the How it works and Network page descriptions, "Coming soon" in the site description, and the About closing "Mission delivery is coming soon" (now "Start with one objective."). Tests that asserted these lines were updated.
- Kept on purpose, and why: (1) the notice and acknowledgement on the request page. People enter names, company and email there, email delivery is off and no real mission is accepted, so a person must be told at that point. (2) The privacy page. (3) The sign-in, account and workspace screens, where the text describes a function that really is unavailable. (4) Corridor scope pages and the "No operating offer is announced" feedback after choosing a non-initial direction, which describe scope. (5) API error messages and operator-only labels. Real customer operations, outreach, payments and payouts stay closed under the readiness gates in `AGENTS.md`, so the public site must not imply they are open. If the owner wants the request page notice softened or the sign-in "coming soon" wording changed, that is a separate decision.
- Verification: see the pull request for the suites run.

## 2026-10-15, Claude Code, Start page (/workspace) rewritten in plain words

- Request: the owner said the page at `/workspace` was full of jargon (customer, operator, administrator, workspace roles, synthetic mission operations, a 19-tool directory) that no one could understand.
- Why: the page is the destination of the "Start here" link and of every "back" link on the access screens, so it is the first page for returning customers, staff and invited participants. It had three disclosure sections, four persona cards with three links each, a directory of every operator tool with its role list, and a long availability section.
- What changed: `apps/web/app/workspace/page.tsx` now has two plain choices at the top (Plan a mission, See a sample mission) and one short list under "Already working with us?": Customer (Open my account), Corridra team (Team sign-in, Accept an invitation) and Supplier, programme member or local helper (three link-help links). A small footer row links back home, to How evidence works and to Privacy. The tool directory is removed from this public page because the team workspace has its own directory, now grouped into five areas. The availability section is removed under the owner's rule on declarations. The unused disclosure component is deleted. Three navigation tests were rewritten for the new page, including a check that none of the old jargon appears.
- Kept: every destination that was reachable before (account, team sign-in, invitation, programme, supplier and helper help, plan, sample mission, trust, privacy).
- Verification: see the pull request.

## 2026-10-15, Claude Code, Release of PR 53; plain wording for sample material

- Release record. PR sadat99/corridra#53, head `8bbf5c006ed9be1a34408bc1f3a6275dd57940c2`, `validate` passed (`analyze` skipped). Merge commit `e682369be5f12bea354418f21e110e7a7404dbb0`, tree `f3faae5d4c9761ddee66b3dbc1001f7d595f2997`, identical to the tested head. Production deployment `dpl_731ugUyT2v6KXBV43MYF5UbVJYoC` (project `corridra`, team `sadat-os`), region `fra1`. It carries the operator Today panel and the corridors page layout. Rollback target: `dpl_F8Pd1QG6fMKDe6mnwu83u3kyJMtE` (PR 52, `25cf668`). The READY check and aliases are recorded in the pull request.
- Request: the owner said the start page was full of words no one understands.
- What changed: public wording. "Synthetic mission example" is now "Sample mission", "See a synthetic mission example" is "See a sample mission", "Open the synthetic example" is "Open the sample mission", "Invented scenario" is "Sample scenario", "Continue with an invented request" is "Continue with a sample request", the footer link "Platform access and tools" is "Start here", and "Prepare an invented example request without an account" is "Prepare an example request without an account". The request page keeps "invented details" because it is an instruction to the person typing. The rule is in the content rules of `docs/agents/ui-direction.md`. Tests that used the old labels were updated.
- Next step: look for other public jargon page by page, starting with the account and sign-in screens.

## 2026-10-15, Claude Code, Start page links explained; account and sign-in screens in plain words

- Request: the owner looked at the start page and said some of its links were not clear (why, what, where), except "Team sign-in".
- What each link was, and the fix: "Accept an invitation" opened the team setup page and is now "Set up your team account", with the sentence "New team member? Open your invitation email, then set up your account." beside it. "Supplier link help" and "Programme link help" opened pages shown to someone who arrives without their private link, so nobody needs them from here. They are removed from the start page, and the row says "Open the private link we sent you." "Local helper tasks" is now "Local helper sign-in" and the row says helpers can sign in to see their tasks. "How evidence works" is removed from the start page footer, leaving "Back to Corridra" and "Privacy". Rule for new links: the link text says what happens, and the sentence next to it says who it is for.
- Account and sign-in screens: "Operator" becomes "team" throughout, "assigned-task" becomes "local helper", "Start a test mission request" becomes "Plan a mission", "Check an example request receipt" becomes "Check a request receipt", and the long sentences about workspace roles and real mission admission are replaced by one plain sentence each. Tests that asserted the old sentences were updated.
- Verification: see the pull request.

## 2026-10-15, Claude Code, Home routes read as two separate routes

- Request: the owner pointed out that "Source from China. Sell to Spain and the EU." reads as one chain, as if goods are bought in China and sold in Spain. The two corridors are separate.
- What changed: the home lead heading is now "Choose the route that fits your business." with the label "TWO SEPARATE ROUTES" and the line "Corridra works on two separate routes from Bangladesh. Each route works on its own, and you can use either one without the other." Each route card has a coloured top edge that matches its line on the map (green for China, gold for Spain and the EU). Rule for copy: never put the two routes in one sentence in a way that suggests one flows into the other.
- Verification: see the pull request.

## 2026-10-15, Claude Code, Release of PR 54

- Release record. PR sadat99/corridra#54, head `2d11156da485c3075f3324dc38c32cf93923f936`, `validate` passed (`analyze` skipped). Merge commit `71f6cb78fa839c01f231417b31503368368ed73c`, tree `b2089a6377a714ac6eb730d2aff09a0ff50d0e8c`, identical to the tested head. Deployment `dpl_6hNMSdkWpfUefvZfKcqbenUyR6uX`, target production, READY in fra1, aliases `corridra.vercel.app`, `c.obsidianglobal.studio`, `corridra-sadat-os.vercel.app`, `corridra-git-main-sadat-os.vercel.app`.
- Local checks on the tested head: public suite 86 of 86, protected operator suite 16 of 16.
- What shipped: the plain start page, availability declarations removed from marketing pages, the Today panel with meetings, sample wording and clearer links.

## 2026-10-15, Claude Code, Any route: pick any two countries on a world map

- Request: the owner approved showing that Corridra serves any country to any country, with two spotlight routes.
- What changed: the home page and the corridors page have a third card, "Any other route". The atlas has a disclosure, "Another route? Pick any two countries", with two labelled selects and a Clear button. Choosing a pair draws both countries on a world map with an arc. A pair that matches a configured corridor snaps to it. Any other pair says that no operating offer is announced for it yet and links to the request page with both countries filled in. The EU is drawn as its 27 members; Malta is too small at this scale and is shown as a marker.
- Data: `apps/web/components/world-geography.ts` is generated and checked in. Outlines are Natural Earth 110m (public domain) through world-atlas 2.0.2. Countries with no outline get a point from world-countries 5.1.0 (ODbL data, coordinates only). `tests/world-geography.test.mjs` fails if a supported country has neither an outline nor a point. Outlines are illustrative and not a statement on borders.
- Defects caught by the new browser tests: the select labels wrapped the whole select, so their accessible names included every option; country names from the browser's own locale data differed from the server and caused a hydration error (React 418), so the long lists show codes until the page has hydrated.
- Verification: public suite 94 of 94 and protected suite 16 of 16 on this branch. Lint, typecheck and docs tests pass.
- Limits: the world map is illustrative. A new corridor still needs its configuration; the map itself needs no change.
- Next step: a data-driven corridors list and a test that adds a corridor through configuration only.

## 2026-10-15, Claude Code, Release of PR 55

- Release record. PR sadat99/corridra#55, head `96154aa7c5a6c56b2ac5314f302d3fcd73b37f44`, `validate` passed (`analyze` skipped). Merge commit `f5e6384da22535c66e6d1a5d943f6f7dccef1a76`, tree `27b9a7174aa5bfb8bdff7a944c50aff03f29bfb6`, identical to the tested head. Deployment `dpl_Aqz6dLRGuj8ARTJe87CT8SsATeZZ`, target production, READY in fra1, aliases `corridra.vercel.app`, `c.obsidianglobal.studio`, `corridra-sadat-os.vercel.app`, `corridra-git-main-sadat-os.vercel.app`, no alias error.
- Live check: the production corridors page serves the "Any other route" card, the "Another route? Pick any two countries" disclosure and the "Pick two countries on the map" link.
- Local checks on the tested head: public suite 94 of 94, protected operator suite 16 of 16.
- Note for the next session: the cloud sandbox cannot reach the production host directly (curl returns no response), so live checks go through the Vercel fetch tool.

## 2026-10-15, Claude Code, SaaS readiness audit; documents reconciled to main

- Request: the owner asked for a read-only audit of whether Corridra can be sold as paid software (modules, self-service, institutions, enterprise corridors, tenancy, billing, white-label, infrastructure, AI, legal, launch order), then asked whether a visitor can already organise and lead a delegation to any country, then asked for the documents to be updated correctly.
- What the audit found: see [saas-readiness-audit.md](saas-readiness-audit.md). No module is activated for real customers; synthetic-only is enforced in code. There is no billing, no tenant provisioning and no white-label. Isolation design is sound but unproven at scale. The nearest route to revenue is a paid managed pilot, which needs real-data admission, tenant provisioning and the D08 legal gates first.
- Correction to an earlier answer: the audit first said institutions cannot self-serve. That stands for organising and managing a delegation, which is staff work, but a delegation request for any country pair can already be submitted through the request page, as a test request.
- Method: four read-only sub-reviews (billing and white-label, tenancy and institutions and corridors, infrastructure and legal, journeys and modules), then direct re-checks of the claims that matter most. No code, test, migration or setting was changed. Integration tests were not re-run.
- Documents changed in this entry: `docs/agents/master-plan.md` (last-updated line, statuses of steps A, B, C, E, F and V, a new audit row, five new revision-log rows, decision 2 marked superseded, owner decisions rewritten, "in progress" line corrected); `docs/agents/ui-direction.md` (programme phases table matched to the master plan, "sample" replaces "example" in the vocabulary table, new "Maps and the atlas" rules); `docs/agents/README.md` (two entries in "Where things live"); `docs/implementation/current-plan.md` (a "Changes since this reconciliation" section); `docs/START_HERE.md` (one pointer); `docs/documentation-map.md` and `.json` (the new audit document).
- Not changed on purpose: the owner's Product Vision v2.1. Its section 18 still describes a snapshot at `bbb7d71` with PR 48 as an open draft. That is the owner's governing document; the owner decides whether it is refreshed.
- Open items: the owner decisions listed in the master plan, section 4; the three Vercel variables flagged as readable secrets can only be changed by the owner.
- Next step: the owner chooses between the data-driven corridors list and institution accounts, and decides whether to authorise the audit's backbone roadmap.

## 2026-10-16, Codex, V3 execution rules

- Request: add the supplied V3 execution rules to repo-root `AGENTS.md` for Codex to load.
- Why: keep execution constraints in repository instructions across turns.
- What changed: appended the supplied heading and seven rules to `AGENTS.md`.
- How it was verified: Python exact-text assertion returned "PASS: V3 heading and all seven rules match the requested text."; `git diff --check` exited 0 with no output. `pnpm exec prettier --check AGENTS.md` was blocked by pnpm bootstrap (`ENOENT` creating `/home/agent/.local/share/pnpm`). Application tests, typecheck, build and route checks were not run for this instructions-only change.
- Open items: `docs/V3_CONTRACT.md` and `docs/V3_LEDGER.md` are absent in this checkout; no specification or ledger content was invented. Verification is recorded here until the V3 ledger exists.
- Next step: use the V3 contract and ledger when supplied.
- PR / commit: local working-tree change only.

## 2026-10-16, Codex, V3 Phase 0 baseline and preservation

- Request: execute the supplied V3 contract end to end, starting with Phase 0 and continuing without intermediate permission requests.
- Why: preserve authorized V2 capabilities while simplifying the product and identifying missing SaaS requirements.
- What changed: saved the supplied contract; created the execution ledger with 507 source-block IDs, a 49-family preservation matrix and all 18 operator sections; added reproducible AST inventory and one-time register initialization scripts. Added current V3 document catalogue entries and a forward amendment to the master plan.
- Verification: exact commands, discovered counts and pending baseline checks are tracked in `docs/V3_LEDGER.md`. No historical PASS is inherited; all runtime roles/states remain unverified until executed.
- Preserved: application behavior, auth/RLS, original migrations/source history and closed real-operation gates. Only local test fixtures and missing ignored workspace links repaired.
- Next step: finish baseline runtime evidence, commit Phase 0, then bounded Phase 1 UI changes.
- PR / commit: existing work checkout; no new published branch.

## 2026-10-16, Codex, V3 P1a unified product entry

- Request: continue V3 after the Phase 0 preservation commit (`d6b1f81`).
- What changed: three prominent buyer/partner, supplier/product and delegation request entries, plus other objective. Reuses existing `/plan` validation, draft priority and admission notice; all old routes and controls retained.
- Verification: lint/typecheck/build passed; Node 19 and infrastructure 7 passed; 24 preserved authority checks passed; full public browser suite `98 passed (2.9m)`; four screenshot observations, zero axe violations/overflow. Exact logs and source hashes in `docs/v3/phase-1/entry/`.
- Preserved: backend contracts, migration/source/event/money history and auth/RLS. No flags, dependencies or live operations changed.
- Gaps: Phase 1 overall partial, SaaS customer ownership/organiser self-service missing, V3 not deployed. Isolated customer identity environment unavailable; production auth cannot be reused as a preview.
- Rollback: revert presentation commit; no data migration needed.
- Next: founder clarity via retained protected operations, then resume SaaS work when correctly scoped isolated auth access is available.

## 2026-10-16, Codex, V3 founder clarity and concrete SaaS blocker

- Request: execute V3 through authorized phases while preserving backend authority and stopping only at true blockers.
- What changed: admin-only five-question Business overview in the retained Control Center, explicit MISSING/GATED capability labels, links to existing source-backed operations/economics/readiness and labelled synthetic explorer. Reconciled all 36 flagship journey steps and recorded per-phase scope/blockers in `docs/v3/`.
- Verification: lint/typecheck/unit/build passed; operations/navigation/environment denial 15 tests passed; all original 16 protected browser cases passed. Corrected new test driver to await the exact authenticated workspace heading; focused founder case `1 passed (1.1m)` on the same unchanged application build, including actual ordinary-operator HTTP 403 and zero mobile/desktop axe violations/overflow. Do not equate separate runs with a single clean 17-case suite command. Full failed-run history retained.
- Root cause corrections: distinct new link label preserves original navigation; exact MFA setup locator prevents the test driver from mistaking the sign-in heading for authenticated workspace entry. All original tests and all founder/denial assertions retained. No auth implementation changed.
- Concrete blocker: documented EU Corridra Neon project `odd-pond-26265871` lookup is unauthorized/404 via current connector, runtime API is proxy-denied/403, and no isolated customer-auth base URL/signing binding is available. Production auth is not a valid preview substitute. No unrelated resources changed.
- Preserved: all original route/control/backend/history/financial authorities. Flags/production settings unchanged; no deployment claimed. Whole V3 remains partial; independent organiser SaaS is missing and activation gates stay closed.
- Rollback: revert the entry/founder UI files while retaining ledger/evidence; no data/schema rollback needed.
- Next: restore correct project/isolated identity access, then resume the authorized Phase 3 ADR/additive ownership and permission-denial work.

### 2026-10-16 — V3 bounded foundation release evidence

- PR58 normal merge f5815ef has the full tree tested by successful exact-head CI38937305833 (20m34s); preview READY. Explicit production deployment dpl_HmrXkqKxggFHwJCaksSdPRkDwe4Z READY, correct Git SHA/fra1/public alias verified.
- Read-only production browser verifies three entries, prefill, two viewport layouts, sign-in and anonymous401; no mutation requests. Full local regression17 protected/98 public/204 integration plus unit/security/build evidence retained. No backend/auth/RLS/migration/money/history/activation setting changed.
- Ledger and docs/v3/release/report.json contain per-phase partial/blocked/gated results, rollback and cleanup. Full V3 remains unaccepted; isolated customer identity environment is the true next blocker. Live gates remain closed; CodeQL skipped is not passed.

## 2026-10-17, Codex, owner access fix and isolated customer identity preparation

- Request: check the owner's environment fix and resume V3; preserve fewer than nine Git branches, merge/deploy verified work without another general permission request.
- Why: customer-owned SaaS cannot safely use production customer identity as its development substitute.
- What changed: forward environment receipt, ledger and plans; one sterile Frankfurt synthetic Neon branch with managed auth, application name Corridra and mandatory email verification. No application or migration change in this packet.
- Verification: PR59 full CI38942627188 success; merge tree equals tested head; explicit exact-SHA production deployment c96420e READY/fra1. Seven read-only browser observations passed with anonymous401, zero overflow and no mutation requests. Neon ADMIN access verified;25 non-reference tables empty before auth provisioning; verification PATCH HTTP200 independently read back true. Branch preflight passed; seven distinct names after new branch creation.
- Preserved: all production settings/secrets, original identities/staff MFA, RLS, migrations, money/events, default/template/live-synthetic branches, open dependency PRs10/32 and unfinished work.
- Decisions: account-required compute defaults after rejected timeout override; no partial branch remained. Shared development mail is not production acceptance. No credentials in committed evidence.
- Open items: isolated signing/origin bindings and provider/session acceptance; customer authority ADR, new organisation/membership/mission and organiser capabilities. These remain unverified/missing. No live activation.
- Next: finish isolated development configuration, then review additive authority design and restricted-role acceptance before exposing self-service controls.
- Base commit: c96420e58e3c096293c3c5600ce89903942ec90d; unfinished work branch feat/v3-customer-workspaces.

## 2026-10-17, Codex, Git branch ceiling and customer-authority preservation

- Owner requests autonomous V3 execution and fewer than nine branches. Tightened the Git guard across distinct local/remote/intended names, preserving CI ephemeral checkout handling and separate Neon limit10. Added five policy tests; no original tests edited.
- Proposed ADR032 records separate customer authority, reuse of existing canonical/domain infrastructure and the unresolved conflict between additive migrations and original exact29 assertion. No auth/RLS/schema implementation or fake controls added.
- Checks:20 focused policy/permission tests passed; lint/typecheck/build passed. Fixed missing ADR catalogue entry at root cause; original documentation13/design4/geography2 checks passed directly. Branch count7; immutable preservation guard PASS. Full exact-head CI, merge and deployment for this packet remain pending.
- Existing customer auth isolation proof and production release c96420e remain valid. Full V3 partial; live gates closed. Next: connected-tool publication and exact-head release checks; retain unfinished resources and dependency PRs.

## 2026-10-17, Codex, verified resource retirement and PR60 release

- Owner asked to resume V3 after increasing Actions budget and delete proven-unused resources. CI now passed209 integration/98 public/17 protected tests. PR60 merged fe1344a,exact source/tree deployed READY/fra1;live200/401 checks passed.
- Removed116 retired/duplicate deployments,33 generated aliases,14 successful duplicate artifact bundles (253027542 bytes),and2 merged remote refs. Preserved one canonical successful artifact per tree,failure evidence,production/rollback/legacy previews,active/dependency/unfinished work and all required Neon branches. No original source,money,evidence,events or migrations deleted. Detailed reviewed plans/provenance/absence receipts under docs/v3/cleanup.
- Canceled a redundant main run only with full-tree equality and successful required PR CI proof. Existing test/check execution unchanged. Generated UX retention now3 days;failure retention7 and committed acceptance evidence unchanged. No future billing saving measured.
- Current phase3 is partial:isolated auth environment restored;customer authority/mission/delegation SaaS remains missing/unverified. Next packet evaluates an independently gated customer namespace/history while retaining all original tests and core security. No real activation.

## 2026-10-17, Codex, synthetic customer authority backend

- Request: continue V3 autonomously, preserve original functions/tests/privacy/history, keep fewer than nine Git branches and bound GitHub/Vercel resource costs.
- Why: verified customer identity alone provides no customer-owned tenant or membership. Customer authority needs its own explicit admission/rollout lifecycle while staff-only core installations continue unchanged.
- What changed: additive optional customer schema/registry, offline synthetic allowlist and pinned issuer, bounded provider proofs, immutable owner grants, atomic retry-safe tenant creation and owner listing. Added a default-off API using actual fresh Managed Neon sessions and the existing restricted pools; reused canonical tenant/event/audit/outbox. No UI creation control or fake organisation record. ADR032 records both initial count-conflict assessment and forward modular resolution.
- Verification: full local integration27 files225 tests before final provider-error normalization; final new customer suite17 passed. Final source typecheck/build passed; unit19/infrastructure7 passed. API gate2 passed; actual isolated provider anonymous/origin/content/forged-input checks401/403/415/400/401 with zero identity/workspace writes or email. Original core rows, functions, ACLs, policies and migration receipts unchanged across extension install. Final documentation checks and exact-head CI remain pending.
- Preserved: every original test,29 core migration hashes,45 route files,six source hashes,18 expert IDs; existing staff MFA and all core RLS. No cloud schema, money or historical record changed. Customer initiator remains distinct from the accurately labelled service executor.
- Decisions: use an independently deployed customer module, fully inventoried/hashed/tested; never conceal history or change old fixtures. Initial owner only, explicit organisationId:null; invitation/collaborative mission/programme authority remains subsequent work.
- Open items: actual authenticated provider OTP/reload/revocation, canonical organisation linking, invitations, mission access, independent delegations, participant privacy/economics. Production customer authority hard-disabled, all real-operation gates closed.
- Next step: exact-head full CI and default-off release, then isolated schema/provider acceptance before creation UI. Resource PR61 merged/deployed9029669; finished preview cleanup recorded forward.

## 2026-10-17, Codex, verified customer foundation release and isolated schema

- Request: continue V3 correctly without repeated approval and report visible versus backend progress honestly.
- What changed: no new runtime source in this receipt; records PR62,exact deployment,cloud migration/role acceptance,actual three-day artifact expiry and finished resource retirement.
- Verification: required CI39016523849 passed27 integration files226 tests,100 public and17 protected browsers. Normal merge2add73c has identical full tree to tested a7cf939;production dpl_12CB9CTH3EBFMsvzpiWpc1zGEJtb READY/fra1. Live public200/operations401/customer API503,zero product mutations.
- Cloud scope: only empty isolated customer-auth child in corridra-nonprod. Verified25 tables empty,five original migration hashes;unchanged core runner upgraded to29 plus independent module and repeat install passed. Two actual restricted logins passed least-privilege startup and42501 denials. No customer/provider account,workspace,email,production credential/flag or historical financial/event change.
- Preservation: source/history/test hashes,all original routes/actions/staff permissions;sterile/default/live-synthetic/production resources and dependency/unfinished work. Completed PR62 preview/alias/ref retired;full cleanup receipts retained. Original provider production D09 remains separate.
- Open items: actual isolated authenticated OTP/reload/revocation acceptance needs a controlled inbox/test session;do not manufacture verification or ask for codes/passwords in chat. Organisation linking,invitations,mission ownership and independent delegation/participant/economics still need implementation. Customer UI is not shipped by a backend release.
- Next:check/merge durable receipt,then continue bounded SaaS additions with gated customer UI acceptance. D01-D06/D08 remain closed. Whole V3 remains partial.

## 2026-10-17, Codex, delivered OTP input repair

- Request: owner reports signup sends a code but the verification field appears only after asking for another code.
- Why: the form initialized verification in the request-code stage, although the configured provider already sends a code at signup.
- Changed: existing client account form opens the code-entry stage immediately and retains it while editing email; a send-code button validates email independently of code validity. Existing resend/recovery and original SDK payloads remain. Mode key prevents transient signup state carrying into verification. Added a new browser regression; original tests unchanged. Added the missing status document catalogue entry to resolve the real documentation unit failure.
- Blast radius/preservation: presentation only; provider verification, sessions, auth server, staff identity/MFA, RLS, migrations, money/events and all activation gates unchanged. No email/code in URL or browser storage. No provider OTP read or auto-verification.
- Verification: local checks and exact-head release acceptance pending; no new deployment claimed. Owner-received OTP is delivery evidence, not observed successful verification/session restoration. Browser before/after and exact outputs will be appended to the ledger.
- Next: finish checks, normal merge, exact production and isolated preview deployments under standing release authorization, then continue SaaS work. Keep all unfinished/dependency/environment-bound branches and fewer than nine distinct Git names.

- Fresh local result: formatting/lint/typecheck/build passed; unit19 Node/7 Python; full integration27 files226 tests; three customer browser regressions passed, including both unchanged legacy tests. Three responsive before/after views retained; axe/overflow zero. Hard Release Conditions self-audit4 maps two intentional form binding changes; no unaccounted legacy action loss. Publication scanner initially failed on direct DNS, before push; corrected the invocation to honor the managed Node proxy. CI/merge/deployment still pending at this recorded commit.

## 2026-10-17, Codex, customer UI context rejection boundary

- Request: continue the accepted V3 customer workspace packet while preserving identity/privacy and the priority OTP repair release.
- Why: a mounted draft must not be submitted under a switched provider account. The server already authenticates each request; it now additionally rejects an optional stale expected subject before minting proofs or writing records.
- Changed: customer service list/provision optional context check, API header forwarding, forward ADR032 and six new restricted-role integration cases. Caller scope cannot establish identity, admission, tenant or staff authority. Existing clients and all original tests unchanged. No schema/RLS/money/events/provider/activation changes.
- Verification: lint/typecheck/unit/build passed; Node19/Python7; focused real integration4 files28 tests passed, including unchanged original customer authority/permission/navigation suites; desktop/mobile default-off API2 passed; preservation guard45 routes/29 migration hashes/six sources/18 expert IDs passed.
- Unverified: actual private provider verification/session and UI walkthrough, full new packet CI/release. Customer creation remains flag-off. PR63 exact-head checks and deployment stay first priority; this change is on its separate bounded branch.
- Next: implement list/create/retry with subject-scoped draft storage and denial recovery over the unchanged commercial backend, then full checked release. Fewer than nine distinct Git names retained.

## 2026-10-17, Codex, OTP repair exact release and resumed gated UI

- PR63 passed required CI39025982598:27 files226 integration,100 public and18 protected browser tests plus all required source/security/build checks. CodeQL skipped, not passed. Normal merged35ab920 has the exact tested d7336cd full tree6193ee6. Explicit production dpl_DyrwUFnBaNfenJ1eQ6qF13ncC2aE and existing-branch automatic preview dpl_2XYkdkGzpZ7gLK1aUTVqB4nMSXNr are READY/fra1 at that source; canonical and stable acceptance aliases verified.
- Both actual verification pages return200 with the code input and request action present on arrival. Production public200/staff operations401/customer API503; actual preview anonymous session200/null and API503; zero product mutation requests. No provider/signing configuration or account recreation. Private received-code consumption/session restoration/revocation remain unverified. Receipt:docs/v3/phase-1/customer-verification/release.json.
- Separate ongoing UI work is not part of that deployed revision: test-only workspace list/create/retry behind the existing off flag, preserving original private mission controls. No real operations, new dependency or backend rebuild. Full V3 remains partial.

### 17 October 2026: gated customer workspace UI and self-audit (Codex)

Added an account list/create/retry interface over the existing synthetic customer workspace API, preserving private mission invitations. Optional expected-subject checking rejects account switches without granting authority; saved retry intents are scoped to issuer and subject and reuse their command ID. Customer exposure stays default-off and production-hard-disabled. Direct format/lint/type/unit checks and preservation audit pass; full exact-head database/build/browser CI remains pending. New component fixtures are explicitly protocol tests, not actual provider OTP/session acceptance. Evidence:docs/v3/phase-3/customer-workspace-ui/report.json and docs/v3/self-audit-5.json. No dependency, schema, RLS, money, history or activation changes. Whole V3 remains partial.

### 17 October 2026: PR64 bounded release verification (Codex)

PR64 merged 5e2c095331b392f590315d595f89e9055c19f175 after required CI39034554160 passed the exact head. Full production build,real restricted-database/denial tests and public/protected browsers passed;CodeQL remains skipped,D04 open. Exact-source production and the existing isolated identity preview are READY. Workspace list/create/retry and issuer/subject rejection are implemented/tested/deployed while exposure stays off;actual private OTP/session acceptance and company/team/mission/delegation gaps remain unverified/missing. No provider/schema/history/money/gate change. Forward evidence:docs/v3/phase-3/customer-workspace-ui/release.json and self-audit6.

## 2026-10-17, Codex, synthetic customer collaboration backend

- Request: continue the remaining V3 plan autonomously, preserving fewer than nine branches and all legacy authority.
- Why: initial owner provisioning alone cannot support V3-06-003 collaboration. Reuse the existing customer service and optional migration lifecycle.
- What changed: additive customer module0002, existing auth service, new gated access API, new restricted-database and route-denial tests; forward ADR032 and report. No UI control in this backend packet.
- Verification: direct full format,lint,web/package types exit0;JS19pass/0fail,Python7OK;preservation45routes/29migration hashes/6sources/18expert IDs PASS. Real database/build/public/protected browsers pending required exact-head GitHub CI because local Docker/process operations are denied. No acceptance claimed for unrun tests.
- Preserved: core29/customer0001 migrations,all old functions/policies/grants,initial owners,staff identity/MFA/source/financial authority and original tests. New authority is synthetic shell listing only. No dependencies or cloud settings changed.
- Decisions:256-bit token hash only,first-response secret,24-hour expiry;single-use admitted recipient;immutable grants/revocations;original owner protected;bounded no-contact owner history;command/workspace locks and proof recheck. Lost token requires cancellation and fresh issue.
- Open: collaboration UI,organisation linking,persistent missions,independent delegation/participant/economics,actual private provider acceptance and D01-D06/D08. Feature off,production disabled;module2 required before exposure. No new deletion.
- Next: required CI,root-cause fixes if necessary,normal checked merge and exact-source deployment. Report:docs/v3/phase-3/customer-collaboration/report.json.

### 17 October 2026: PR65 privacy-header root repair and audit7 (Codex)

Required CI39039863896 proved30 integration files/249 tests,including13 new collaboration cases,and production build;public browsers100passed/2failed because global Next headers overwrote the new API no-referrer policy. Protected tests skipped. Kept every test unchanged. Added a narrow later no-referrer/no-store rule for both customer workspace APIs;local lint and web/package types pass. Audit7 freshly accounts for all806 legacy controls against827 current,all119 command files/70 dispatch files unchanged,45routes/29migration hashes/6sources/18expertIDs retained. Full required new-head CI still pending;no merge,deploy,cloud migration,provider or flag change. Whole V3 partial.
