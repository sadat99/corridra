# CORRIDRA V3 — CONTROLLED END-TO-END REVAMP EXECUTION CONTRACT

**Version:** 1.0 — proposed owner handoff, 4 November 2026  
**Repository:** `sadat99/corridra`  
**Observed main:** `a1dbbc9af6e15470cddced85b834ac197bf27c36`, PR #261 merged.  
**Observed release:** Vercel production READY for the same SHA; main CI later completed successfully.  
**Agents:** Claude Code owns integration, implementation, release evidence and final reporting. Codex is a bounded independent reviewer/fixer on demand.  
**Status:** EXECUTION PROPOSAL — not an instruction to activate restricted capabilities or destroy records.

## 0. What success means

Reorganize the existing production product into **one comprehensible, reusable cross-border commercial work system**: clear public front door, a shared customer work list, Sell / Source / Organise / Other work contexts, focused engagement rooms, purpose-specific organiser/team/contributor views, and complete access to every approved existing capability. Finish demonstrated UX/reliability defects; close approved functional gaps and genuine acceptance gaps; consolidate current guidance and remove demonstrably obsolete material *without erasing immutable sources, historical evidence, data or audited behavior*.

**Must improve:** first-action comprehension, finding and resuming work, completion and error rate, time and steps per workflow, staff clarification/rework, clarity of commercial commitments and money, accessibility and response performance. Record a baseline; don't invent improvements or thresholds.

**Never compromise:** auth/RLS/MFA, tenant isolation, source/quote/evidence immutability, participant consent, operator/customer separation, version semantics, append-only event history, original language and currencies, confidential acquisition/markup fields, financial separation and the controlled release gates.

**Do not do:** new app per role or country, duplicate canonical company/mission databases, unneeded framework, broad backend rewrite, a general-purpose AI/chatbot feature, external API/provider activation, fake commercial statistics, unreviewed destructive migrations or removing existing authorized actions.

## 1. Freshness and authority gate — REQUIRED BEFORE EVERY WAVE

1. `git status --short`; `git fetch origin main`; inspect upstream SHA, active branches, PRs, CI and Vercel deployment. Don't trust the above recorded SHA if main has advanced.
2. Read root `AGENTS.md`, `CLAUDE.md`, nested instructions; `docs/START_HERE.md`; `docs/V3_LEDGER.md`; `docs/PLAN_STATUS.md`; `node scripts/v3-context.mjs`, `node scripts/v3-context.mjs verify`, `node scripts/authority.mjs`.
3. Once per product session read full `docs/V3_CONTRACT.md`, `docs/product/corridra-product-vision-v2.1.md`, `docs/agents/ui-direction.md`, `docs/source/ac1-design-system/MASTER_DESIGN_CONTRACT.md`, `docs/design-system/README.md` and relevant ADRs (32, 43, 44, 46, 47, 51, 56, 67–76). Don't load full archives/work logs indiscriminately; use targeted section/requirement helpers.
4. Later dated owner decisions supersede only their conflicting scope. The AC/1 design lock supersedes old green/ivory visual copy but does not supersede access controls. Implemented, tested, merged, deployed, schema-installed, enabled, accepted and commercially operating are distinct.
5. Preserve running/unmerged dependencies; complete or rebase them safely. Don't assume a PR description proves runtime capability.
6. Establish a **frozen baseline manifest**: SHA, commit CI, deployment, switches with unknown encrypted values marked UNKNOWN, SQL migration registry evidence, open PRs, active document statuses, current routes/actions and open findings. A new work branch must pass the branch-budget script; stay below 9 branches inclusive of main.

Readiness notes: PR #261 adds ADR acceptance plus decision-card DB module only. No application integration/public sharing is yet established. Programme projection migration `0002` **was installed**: protected workflow `41705868221` job log moves `customer_programme_projection_migrations` from 1 to 2 applied, regardless of stale ledger text. Confirm again from actual current registry before claiming production activation.

## 2. Locked product spine

**One authenticated identity** (customer, staff and contributor boundaries remain separate) → **one or more permitted company workspaces** → **active commercial context** (Sell, Source, Organise, Other) → **one selected work item** → **next useful action and the relevant tools**. A role is never equivalent to a commercial context or to permission.

A company may sell and source, a manufacturer is not a separate user type, a business trip or fair is a context/activity rather than a fourth business engine, and a delegation is a programme container whose participants retain separate and consented mission records.

**Presentation-only work-item adapter:** existing authorized records project into a normalized UI representation: source kind, authoritative ID, workspace/tenant scope, title, work family when *explicitly* known, stage, holder, next action if justified, last update, permitted destination and source-state completeness. For ambiguous classification use `Other/Unclassified`, never fabricate classification. Do not invent a cross-record join based on title, email, company name or country. Keep original record IDs. Any saved UX preference stores a view choice, not new authority.

**Engagement room:** an existing Room, saved mission, service request or programme record enriched by contextual presentation. Its first screen consistently answers: purpose; where this work stands; who owns the next step; one main action; relevant counterparties/quotes/meetings/evidence; how the result or decision is recorded. The status vocabulary must reflect actual source state, not an enforced imagined linear funnel.

**Always accessible:** 'All work' and 'All tools', a work-context switch, workspace switch only when more than one, search, recovery, previously authorized deep links, missing/partial/error states and notifications about urgent actions in other contexts.

## 3. Target IA and route-to-screen migration

This is a **target experience map**, not approval to rename URLs or erase code. Route changes must preserve existing addresses as safe aliases/redirects with their permission checks.

| Current interface/source | Target user meaning and UI | Work classification | Priority |
|---|---|---|---|
| Public `/` (AC1 Commerce Atelier: three CTAs, examples, routes, samples) | Clean three-path hero; one primary action; proof, corridors and trust as progressive sections; retain actual evidence labels | Public entry | P0 |
| `/sell`, `/source`, `/machinery`, `/enter-market` | Purpose-specific explainer and deep link to start the right work; no separate application | Public acquisition | P1 |
| `/business-trips`, `/fairs`, fair detail, `/trade-missions`, `/institutions`, `/corridors` | Programme or mission contexts, route/event details, no redundant top-level product mode | Public acquisition/support | P1 |
| `/plan`, `first-question.ts`, public 5-step intake | Choice → few essential fields → quick useful result/receipt → optional detail; preserve field validation, consent, original currencies, draft/resume | Universal intake | P0 |
| `/account/move` | **Home**: trustworthy priority actions, waiting on Corridra/others, recent work, start or resume | Customer Home | P0 |
| `/account?view=work` and customer workspaces | **Work**: permitted All/Sell/Source/Organise/Other view, selected company, existing requests/drafts/missions/programmes. Company-team management goes to Account where appropriate | Customer Work | P0 |
| `/account/drafts/[workspaceId]` and `/account/request/[workspaceId]` | One guided request experience across both existing persistence paths; preserve draft/submit/retry/history and old links; do not merge incompatible write commands | Work creation | P0 |
| `/account/requests/[requestId]`, `/account/rooms/[requestId]` | **Work Room**: next step, replies, progress, Compare/Evidence/Trip only when available and authorized | Work delivery | P0 |
| `/account/missions/[resourceId]` | **Results and decision workspace**: reviewed reports, quote/specification comparisons, permitted books, decisions | Work results | P0 |
| `/account/service-requests`, detail/new, billable services | **Services and quotations** within work or Account, without confusing service value with supplier purchase value | Commercial | P0 |
| `/account/companies`, `/account/profile/...` | **Companies** portfolio and permitted company profile/claims; evidence labels preserve distinctions | Shared company data | P1 |
| `/account/delegations`, `/organise`, programme room, participants | **Organise** work with programme overview → participants/eligibility → agenda/meetings → fees/terms → outcomes; no access to private participant deals | Delegation | P0/P1 |
| `/account/notifications`, `/account/billing`, invitation, team settings | **Updates / Account / More**, with backend states and access checks intact | Account/recovery | P1 |
| `/account/all-tools` | Preserved **All tools** fallback; every existing authorized page reachable | Discoverability safety | P0 |
| `/operator`, section pages, specific missions | **Signal Desk** staff shell: Today → Work → Companies → Delivery → More; keep every original operator section, audit and MFA function accessible by grouped navigation | Staff / execution | P1 |
| `/contributor`, task board, setup | **Assigned work** and secure contribution flow; no invented payout visibility | Contributor | P1 |
| Public supplier reply/status links and share-card future route | Restricted invitation/recipient experience; explicit disclosed fields, expiry, revocation, no cross-recipient privilege | Counterparty | P1 |
| Staff owner/access/settings pages | Permission-gated **Administration**, separated from commercial action surfaces | Owner/admin | P1 |

**Customer persistent navigation:** Home / Work / Companies / Results / Account (where Companies or Results are not enabled, retain accessibility of other tools). On Work, the context selector is **All | Sell | Source | Organise**; Other belongs in All and search and may appear when work exists. Never hide action due in another context: keep a global urgent-actions summary and accessible All work.

**Staff persistent navigation:** Today / Work / Companies / Delivery / More. Under Work/More group old sections: missions, meetings, quotes, sources, evidence, network, audit, policy, access, AI gates, operations. The grouping is not a grant of access; server checks remain.

**Small-screen:** responsive navigation and hierarchy at 390 px, not a desktop UI squeezed into a phone. Preserve touch target and keyboard behavior. On 1440 px show an anchored work-context header, restrained list, work detail; no decorative bento grid.

## 4. Four flagship acceptance journeys

### J1 Source — Bangladesh → China (FIRST)
A Bangladesh business needs machinery or products. Capture/use a technical requirement; allow uncertain fields and clarification. Assign permitted Corridra staff/operator action; discover and compare supplier/manufacturer/trader options; preserve original quotes and currencies, quantities, MOQ, lead time, delivery terms, technical incompatibilities and missing evidence; allow site/factory visit and trip context without forcing a meeting; let buyer decide and confirm scope. Record actual follow-through and commercial outcomes separately. Existing commercial arrangements can capture seller's bundled selling price/markup, separately charged fee, conditional commission or hybrid terms. Costs/markup remain staff-only. Do not make Corridra principal seller by interface convention.

### J2 Sell — Bangladesh → Spain / EU
Manufacturer wants commercially relevant foreign buyers and additional meetings around a fair or business visit. Capture offer, target buyer and meeting criteria; qualify leads; provide approved shortlist and introduction/meeting actions; distinguish proposed/confirmed/held meetings; allow RFQ, sample, negotiation, signed agreement, recorded repeat. Event is context, not a restriction; participant still owns confidential customer contacts and quotes.

### J3 Organise — commercial delegation
An approved organiser creates programme objectives, places/terms, eligibility and fees; invitations, participant-owned data and consent; schedule, meetings, conflicts and attendance; separately count scheduled, held and qualified meetings; show programme outcomes without exposing participant quotes or private financial data. Preserve profitability/economics distinctions; do not book or promise services beyond approved operators.

### J4 Multi-context & access
One user participates in two authorized organizations: can sell in one and source in another. Switch work, resume drafts, keep action notifications across contexts, view only authorized records. A revoked member cannot access old deep links; a programme organiser cannot read participant-only costs. Verify signed-out/expired and denied states.

Additional journeys: supplier-response invitation, staff execution and contributor review; billed service/quote acceptance with no real payment claim; unread reports / notification; expired/share-card links; failed network/no-internet and 429 retry.

## 5. Visual and interaction contract — AC/1 exact

Brand tokens remain: **Midnight Navy `#142438`, International Cobalt `#2856C5`, Porcelain `#F6F8FB`, Copper `#BF7548`, Ink `#18283C`**. Cobalt for actions and selection; navy for chrome/dark contrast; copper purely editorial; green/amber/red only semantic states. Fonts already locked: Newsreader display, Geist UI, Geist Mono metadata, Noto Serif/Noto Sans Bengali as specified in current tokens. Use the actual `apps/web/app/globals.css` tokens, existing Corridra icons and documented AC1 source assets; no new visual brand, no generic AI gradients/glows, pill-button forests, random icon mosaics, dashboard bento or decorative graphs.

**Five compositions:** Commerce Atelier for public discovery; Meridian for customer work; SourceLedger for technical/quote/evidence comparisons; Encounter for programmes/meetings; Signal Desk for team/admin. These are compositions of ONE system, not themes or dedicated backend products. Verify approved artwork/typographic hierarchy and seven pending art-review areas in `docs/design-system/ART_REVIEW.md`; require named human review for art, not agent self-approval.

Design every target screen in these states: first use, empty, populated, busy/loading, partial-data, unavailable, permission denied, stale/concurrent update, offline/fail/retry, gated/disabled; the selected EN/BN/ZH localization where supported. Never claim all multilingual content reviewed; native copy review remains separate. Use one main action per focal context and progressive disclosure; this is a heuristic, not a magical cognitive-load percentage.

## 6. Execution waves and exact acceptance

**Each wave consists of one or more small PRs split by meaningful responsibility/rollback. Never a huge single PR and never multiple agents editing the same files at once. Each PR contains source change, focused tests, parity proof, and succinct ledger/gap update.**

### Wave 0 — BASELINE & AUTHORITY (Claude Code; no customer changes)
- Fresh repository/deployment/switch/install and PR status; run context/authority scripts.
- Inventory: every customer/staff/contributor route, action, permission, switch, ADR, evidence, 60 gap IDs, 507 requirements, pending owner-gated capability and AC1 art review status.
- Create a *small* current revamp authority under `docs/revamp/CONTRACT.md`, plus machine-readable `COVERAGE.json` and `CLEANUP-MANIFEST.json`; link them from `docs/START_HERE.md` and `docs/PLAN_STATUS.md` without replacing the original V3 contract.
- Map current screens to target and assign each an evidence state: VERIFIED/IMPLEMENTED/PARTIAL/MISSING/GATED/UNKNOWN. Zero inferred completion percentages. Document operational baseline tests.
- **Gate:** 100% known route/action inventory accounted for, no duplicate authority, frozen SHA recorded.

### Wave 1 — RELIABILITY FIRST (Claude Code; Codex reviews only if auth/data boundaries change)
- Fix `apps/web/lib/move-loader.ts` and Move UI: distinguish truly empty from provider/session/workspace read failure, partial page/read and skipped workspaces. Do not silently render 'nothing pending' when work could not be loaded. Never leak source data in error detail.
- Clarify loading/permission/expired/retry flows, unread and stale states; verify session and workspace changes with real signed-in fixtures.
- Fix staff sidebar interim `role === null` link presentation, if reproduced, without replacing authoritative API checks.
- Reconcile protected install run 41705868221 (`programme_projection_migrations` count 2) against stale ledger; verify current install registry and deployment before editing any status.
- Correct inaccurate or duplicated label/copy where confirmed, especially public footer in signed-in workspaces.
- **Gate:** zero falsely 'empty' from read failures; all affected access-denial tests pass; no broken legacy link.

### Wave 2 — UNIFIED WORK + CONTEXT SELECTOR (Claude Code, highest UX priority)
- Add a pure, tested, permission-respecting work-item presentation adapter over existing services. No new DB just for navigation. Distinguish `All, Sell, Source, Organise, Other/Unclassified`; do not guess classification. Current allowed workspace IDs only.
- Replace confusing mixed request/workspace index with comprehensible Home and Work screens; narrow company selector; contextual filter; preserve urgent actions across contexts and preserved All tools.
- Introduce clear progressive views; don't persist or infer authority from a client mode. Add stable back/forward/deep-link behavior and a visible route to older tools.
- **Gate:** same user can resume Sell, Source and Programme in one workspace; two-workspace isolation and revoked-access tests; all-tools parity; first use/partial/failure states; keyboard and 390/768/1440 checks.

### Wave 3 — PUBLIC FRONT DOORS AND FAST INTAKE (Claude Code)
- Refine existing AC1 public home: clearer job-first value proposition, three paths, concise proof and one obvious CTA. Reuse existing sections and image/icon assets. No fake customers, claimed availability or verified quotes.
- Refine first-question and `/plan`: minimum useful first action; adaptive technical questions per job; optional detail later; transparent work summary before submit; preserved validation/consent/guest-to-account and both private/public draft paths; never drop a captured field or unsupported variation.
- Business trips and fairs enter the right commercial mission; delegation activity remains a programme when a group organiser is involved.
- **Gate:** all 15 existing mission jobs remain reachable; all original fields captured when relevant; deep links preserve job selection; draft/retry/receipt/old URLs work; negative validation tests pass.

### Wave 4 — WORK ROOMS: SOURCE + SELL + DECISIONS (Claude Code; Codex red-team commercial and sensitive boundaries)
- Refine request Room, saved mission and service request into coherent entry/action/state/detail pattern; compare/evidence/trip are task lenses only. Reuse immutable quotes and original technical terms.
- SourceLedger comparisons: original currency/value/spec; normalized analytical view with explicit assumptions and warning for non-comparable specs; source proof and missing terms; owner decision; export where authorized.
- Preserve all four ADR073 commercial arrangements and private markup data; supply value ≠ Corridra service fee ≠ possible commission ≠ collected cash. Do not change legal principal status or real invoicing gates.
- Complete only already-approved Decision Card remainder (routes/service/UI) behind off switch per ADR076. PR #261 only supplies DB; schema install, permission, real public page, expiry/revocation, signed-out cookie behavior and activation are independent gates. Handle Book/Trip view as separate gated capabilities.
- **Gate:** J1/J2 with technical mismatch and fee separation; exact stored quote versions and confidentiality; off/failed/disabled link paths safe; old deep links preserved.

### Wave 5 — ENCOUNTER + SIGNAL + CONTRIBUTOR (Claude Code; Codex only reviews high-risk access/data changes)
- Consolidate the organiser Room into Overview / Participants / Programme & meetings / Terms & fees / Results, with sparse first view and progressive detail. Reuse existing programme, projection and coordination services.
- Validate PR254 projection fixes and 0002 installed, then independently check programme switch, consent, stale schedule/retention, counts, qualification, no private participant data leakage.
- Regroup staff operator 8+ visible navigation areas into 5 job groups, retaining exact 18 operator section IDs and all functions under More; preserve MFA, tenant switching, audit, AI/outreach gates and operator mission pages. The contributor view displays only permitted tasks/submissions.
- Supplier and counterparty recipient surfaces stay scoped links, not broad customer role grants. No company name/email identity merges.
- **Gate:** J3/J4, staff/contributor denial, live tenant switch, stale schedule conflict, invitation acceptance, mobile controls and full action parity.

### Wave 6 — ACTIVE GAP CLOSURE, LANGUAGE, ACCESSIBILITY, PERFORMANCE (Claude Code; Codex focused QA red-team)
- Re-read all 60 stable gap IDs and source closures; close only evidenced criteria. Avoid duplicate implementation of issues fixed by PRs 238–261.
- 001–005/007: genuine scoped notification, recipient email, inbox and 30-minute private view behavior; provider receipt or owner's controlled test still required.
- 023–032: true auth/report/mail/switch/live performance acceptance; bind 507 requirements incrementally to current evidence and independent reviewer; bindings are not acceptance.
- 034/035/037–042: trip/books/decision sharing/programme projections depend on installed schemas, effective flags, native copy, authorized audiences, manual/product review and real browser tests.
- 008/013/014/021 and 027/028: only approved language work and qualified reviewer proof; existing exclusion must be explicitly superseded before implementation.
- 033/036/040/043–048: OWNER_DEPENDENT, not an invitation to build. May be incorporated only following explicit bounded ADR/scope approval. Keep real payment processor 047 held.
- 049/050: inspect rendered organiser design and signed-in busy states before claiming defect; fix only proven issues.
- 051–060: deferred controls (scanner, branch/security enforcement, EU production object storage, cleanup assurance, legal/DSAR, restore drill, automated outreach, production AI, external pen test, WAF) remain OPEN/DEFERRED until their actual prerequisites; no silent switch changes.
- Accessibility: keyboard, semantic HTML, contrast, focus management, 200% zoom, screen reader, RTL, genuine offline/error states; native reviewed language where necessary. Performance: collect real field/browser observations (avoid made-up scores) and remove visible bottlenecks.
- **Gate:** coverage matrix with status & evidence on every affected action/gap; no false closures; no disabled security checks.

### Wave 7 — SAFE CODE + DOCUMENTATION CONSOLIDATION (Claude Code; Codex adversarial delete review)
- Build usage graph first (`git ls-files`, `rg` import+route+docs references, build/test manifests, runtime flags, deep link aliases, privacy links, ADR hashes) and document each candidate in `CLEANUP-MANIFEST.json` (`path`, `classification`, `reason`, `incomingReferences`, `replacement`, `recovery`, `proof`, `approval`).
- **KEEP IMMUTABLE:** `docs/source/`, original locked AC1 assets+hashes, `docs/v3/history/` and manifest, ADR history, statutory/legal/privacy disclosures, frozen QA baseline/receipts, original requirements IDs, production migrations, signed quote/evidence/event records, originals and signed disclosures.
- **CONSOLIDATE:** duplicate active directions/status summaries, contradictory nav wording, obsolete current plan pointers, repeated README prose, legacy CSS overrides after visual reference parity; archive status in current `PLAN_STATUS` and compact latest ledger. Do not rewrite historical evidence to match new status.
- **DELETE ONLY AFTER PROOF:** genuinely unreferenced generated duplicates, cancelled scratch proposals which have no historical/legal/requirement dependency, dead code behind permanently retired flags after proving route/deep-link/feature parity, unused assets and one-off scripts proved neither part of CI nor referenced. Use `git rm` in reviewable PRs; retain Git recoverability and references. Never delete because a file 'looks old'.
- Preserve working archives but **remove them from normal agent context/retrieval** through a short index and bounded context helpers: reducing read noise often matters more than file count.
- **Gate:** `node scripts/v3-context.mjs verify`, `node scripts/authority.mjs`, `pnpm test:docs`, hash/source/doc tests, route coverage, full old action parity, no broken docs links, no unauthorized schema deletion.

### Wave 8 — FINAL ACCEPTANCE & CONTROLLED RELEASE (Claude Code, selective Codex final review)
- Execute flagship journeys J1–J4 and recipient/staff/contributor/billing cases on representative real-like sanitized fixtures, then eligible controlled authenticated production validation by authorized tester.
- Verify every approved active route/action against current source, original behavior, denial, expiry, race, mobile, screen reader, locale, offline and money/evidence constraints. Compare baseline user-comprehension/task/operational metrics; no claimed uplift without evidence.
- Verify exact-head CI, security, release build, browser/e2e/operator suites and production deployment same SHA; separately verify schema installation, effective flags and genuine providers. Art direction receives named human review. Keep restricted switches off until approval.
- Deliver one short release memo: new user capabilities, retained features, removed items with manifest, 60-gap and 507-requirement statuses, tested journeys, SHA/CI/deployment receipts, remaining blocked decisions, and owner review items.
- **Gate:** all approved software fixes and all critical journey tests accepted; owner-dependent/deferred items explicitly outstanding, no hidden failures. Release is not declared fully commercially live until real obligations are proven.

## 7. Claude Code / Codex cost and concurrency policy

- **Claude Code:** one primary session as conductor+implementer, owns the current plan, UI, tests, PRs, docs and release verification; no unnecessary multi-agent orchestration. Each PR/wave reads ONLY relevant files after the once-per-session full contract read.
- **Codex:** optional independent bounded read-only review for (a) Wave 1/2 context leakage, (b) Wave 4 financial/quote/decision-card security, (c) Wave 5 programme consent, (d) Wave 7 deletion manifest, (e) final security release if scope warrants. Codex may implement isolated fixes **only on a non-conflicting branch/file scope**, and Claude then integrates them after same-head tests. No parallel edits of common files, ledger or deployment settings.
- Use existing `scripts/v3-context.mjs budget|outline|section|requirement`, `scripts/authority.mjs`, and `scripts/gate.mjs`; grep/read precise slices; retain test receipts not all log output in prompt. Existing owner 2 Nov rule: Codex no subagents unless requested.
- Keep **single writer** for `AGENTS.md`, `CLAUDE.md`, `V3_LEDGER.md`, `PLAN_STATUS.md`, UI direction, design tokens and shared components. Codex review findings should be compact: file:line, reproducible mechanism, severity, minimal change and missing test. Reject stylistic speculation and irreproducible blockers.
- Minimize cost by not repeating full repo scans after the baseline, do not run entire CI on every local edit, use targeted tests during development and required exact-head full gates before release. Zero relaxation of mandated security tests.

## 8. PR/release protocol

1. Keep changes scoped and reviewable. Begin PR description with user-visible outcome, current source state, affected IDs/routes, preservation contract, blast radius, switch-off/rollback strategy and exact tests.
2. Add RED failing targeted test (where testable), implement, run focused tests, typecheck/lint as applicable, and required frozen-head CI/gates. Avoid silently updating snapshots to excuse regressions.
3. On operator/customer auth, money, SQL, event, shared-data or disclosure changes: separate Codex safety review where warranted; use additive migrations and explicit owner-approved protected installer. Never run migration as a side effect of web build or ordinary merge.
4. Use one current branch at a time under the branch budget; preserve open unrelated Dependabot PRs 230–232. No force push, worktree fork or deletion of another agent's work without explicit approval.
5. New revamp scope is **proposed here**, not automatically included in the older 3 Nov bounded auto-merge approval. Obtain an explicit scope/batch merge authorization before automatic sequential merges; otherwise draft PRs await the owner. Main auto-deploys—verify exact READY deployment rather than manually redeploying.
6. Close/refresh `docs/V3_LEDGER.md` and `docs/qa/current-plan-gaps/findings.json` after each accepted merge, keeping snapshots truthful. After release verify tests from main, runtime, provider and schema states separately.
7. No activation of real payments/payouts, outreach, AI, external sharing, scanner bypass changes or increased disclosure without their distinct recorded approval and proofs.

## 9. What to measure

Quantities are measured, not invented. First capture a baseline per representative role/task; with five target users per flagship journey as an initial qualitative discovery sample (not a statistically precise threshold), record first-action choice, completion/failures, steps, time, recoverability, usefulness of error state, specific terminology confusions, staff minutes per fulfilled request, spec rework, original/comparable quote mistakes, and commercial evidence to actual collected cash. Preserve source and timestamp of each result. Decide target thresholds after initial baseline and realistic task difficulty.

## 10. Pause/stop rules and owner inputs

- **Stop immediately:** authorization regression, cross-tenant exposure, missing original quotes/evidence, payment or revenue misstatement, failed required check, absent trusted issuer, broken hidden action, unapproved destructive deletion, unsafe external disclosure, migration mismatch.
- **Do not halt harmless independent work:** an external mail/provider check or owner tax/bank info is blocked. Record it as BLOCKED and continue independent UX/test/cleanup work; never manufacture success.
- **Owner-controlled:** real bank/GST details, external scanner/storage/privacy/legal decisions, outreach/payment/AI activation, user-facing sharing activation, language native review, visual art approval and any new production data disclosure.
- **One-time owner decision recommended:** approve this bounded product-revamp scope and state precise merge delegation (automatically merge approved code-only PRs after exact-head green CI and independent safety gates, or require owner per PR). This does not grant independent provider/migration/data activation.

## 11. Nonnegotiable artifacts

Maintain few files only:
- `docs/revamp/CONTRACT.md` — this approved contract and affected decision overrides, short and current.
- `docs/revamp/COVERAGE.json` — route/action/role/permission/flow/source/test mapping and per-stage status; no invented acceptance.
- `docs/revamp/CLEANUP-MANIFEST.json` — evidenced keep/consolidate/archive/delete decisions, no speculative removal.
- Existing `docs/V3_LEDGER.md`, `docs/qa/current-plan-gaps/findings.json`, `docs/PLAN_STATUS.md`, AC1 art-review and source integrity indexes updated rather than copied.

No second shadow ledger, no parallel design system, no newly required engineering framework.

---

## 12. READY-TO-PASTE MASTER PROMPT FOR CLAUDE CODE

> **Task: execute Corridra's controlled end-to-end revamp, using `Corridra_V3_Controlled_Revamp_Execution_Contract_2026-11-04.md` as the proposed scope. Claude Code is the primary builder; Codex is a limited, independent reviewer/fixer only for high-risk or hard-to-prove slices.**
>
> Confirm fresh `main`, PRs, CI, deployment, installed modules and existing owner decisions before acting; PR #261 was merged/deployed as `a1dbbc9af6e1` during this plan, but the revamp baseline may have advanced. Read required current authority and AC1 source in the repository; use existing bounded context helpers and verify SHA/hashes.
>
> Start with Wave 0, produce a compact route/action/permission inventory and baseline truth table, then execute Waves 1–8 in order through small coherent PRs. Prioritize UX/UI and J1 Bangladesh–China sourcing, then J2 sell, J3 organise, J4 multi-workspace, followed by staff, contributor, recipient and administrative interfaces. Preserve 100% previously authorized functionality; keep existing URLs working, strong auth/RLS/MFA boundaries, original sources, prices/markup confidentiality, company identity and consent. Reuse existing modules; no three-app rewrite or redundant backend. Fix code-proven defects; never infer that source files or green CI establish live acceptance.
>
> Build current → target IA with Home / Work / Companies / Results / Account plus in-Work contexts All / Sell / Source / Organise / Other; contextual work rooms and predictable next actions. Follow locked Atlantic Cobalt tokens/fonts/icons/assets; design for 390, 768 and 1440 px, keyboard/RTL/reviewed locales, error/partial/empty/permission/recovery states. Keep every original authorized action reachable via contextual links or All tools. Avoid generic AI-styled UI.
>
> Consolidate documentation safely: use `PLAN_STATUS`, authority scripts and a deletion manifest. Never delete hash-protected source, ADR/history, migration, consent/privacy, requirement identities or QA receipts. Delete only unused/replaced items with usage graph, tests and reversible PR proof. Reconcile stale programme-projection 0002 state with workflow 41705868221 actual two-applied receipt.
>
> Use the existing 60-gap register and 507-requirement binding framework; close by actual acceptance evidence, not percentages. Respect all owner-dependent, closed, deferred, payment, outreach, AI, scanner, external disclosure and privacy gates. Additive production SQL only via explicitly authorized protected review. Existing 3 November batch-merge delegation does not automatically extend to unrelated revamp scope; prepare draft PRs until authorized, then merge only within that authorization after exact-head gates and verify READY deployment. Keep branch count below 9 and avoid simultaneous shared-file edits.
>
> Codex is invited only for a specific file/claim/security question; ask it for concise file:line, reason, minimal change, reproduction and test. Claude integrates. Minimize model cost using targeted reads and tests, one conductor, short state checkpoint and the existing ledger. At each wave report **SHIPPED / NOT SHIPPED / EVIDENCE / BLOCKERS / NEXT PR**. Do not ask for routine confirmations already authorized; stop only at genuinely protected gates or impossible-to-prove choices. No unsupported 100%-complete claims.
>
> **Immediate first action:** verify fresh main, open PRs, 60-gap status and authority; create Wave 0 inventory and manifest; then begin Wave 1's false-empty read-state correction. Do not change production settings as part of the initial planning step.
