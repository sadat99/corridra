# CORRIDRA — UX10X MASTER IMPLEMENTATION HANDOFF

**Document status: HISTORICAL.** The UX10X programme was merged (UX-01 to UX-05 and bounded UX-06). This is a dated record, not a to-do list. See the [plan status register](../PLAN_STATUS.md).

**Version:** UX10X.1.0 | **Prepared:** 14 October 2026 | **Status:** Authorized implementation specification; NOT real-data/payment/outreach activation approval  
**Repository:** `sadat99/corridra` (private) | **Baseline Git commit:** `1e0dbea6f146265b256ca89b5482e789f97acdd9` | **Baseline Vercel production deployment:** `dpl_CrZgwvap4zB6e9qEvKZKfmVLrEN1` (`READY`, `main`, Frankfurt)  
**Design reference:** `Corridra_Fusion_01_High_Fidelity.zip`, specifically its `index.html`, `styles.css`, `app.js`, `DESIGN_HANDOFF.md`. **Use only as visual/interaction reference, never as domain/authorization/production specification.**  
**Business direction:** One global, configurable, multi-corridor platform; asymmetrical BD→CN sourcing/machinery and BD→ES/EU buyer/export access, with controlled reverse and other routes.  
**Authority of this document:** Implement a 10X, platform-wide UX replacement with **feature parity as a release gate**. This document does not certify that implementation is complete or 100% correct. Only exhaustive inventory, checks, test evidence, code review and accepted production proof establish release readiness.

---

# 0 — ONE-PASTE CODEX MASTER DIRECTIVE

> You are the lead frontend/product engineer, accessibility specialist, design-systems architect, integration engineer and adversarial QA reviewer for **Corridra**. Work against the actual `sadat99/corridra` repository, currently deployed from SHA `1e0dbea6f146265b256ca89b5482e789f97acdd9`, and treat this file as your primary UX10X change specification, subordinate to existing authoritative code and security/domain contracts. **Implement the UX10X programme; do not stop after producing a plan.** Start by completing Gate 0 and then **implement PR UX-01**, with tests and reviewable evidence. The remaining PR packages UX-02 to UX-06 below are the complete programme. Proceed sequentially only when predecessor changes are safely accepted and merged; never accumulate conflicting unmerged implementations, never auto-merge/release production on your own, and never violate the maximum ten-branch policy. At the end of each PR, report the exact state and hand the next PR's command forward. If existing code or `main` has advanced, discover actual changes and reconcile safely; do not check out stale code or overwrite newer work. No change to canonical backend behavior, permissions, financial history, evidence semantics, live provider integrations, legal data gates or customer-facing operational availability is permitted without separate approval. Full functionality means **100% of previously reachable, authorized flows remain reachable and correct**, not that every planned future product capability becomes active. Tests must run and results must be reported truthfully. Do not invent coverage, outcomes, payments or QA results. Do not spend time asking routine aesthetic questions: adopt the design system and constraints below, optimize for completeness, reliability, maintainability, and minimal dependencies. If blocked by actual unprovided credentials, account permissions or reviewer approval, finish all safe local work and return one precise blocker with evidence instead of bypassing it.

**Critical nuance:** This directive authorizes *building reviewable UX code and tests* in the linked repository. It does **not** authorize merging into `main`, publishing production, activating paid customer operations, transmitting real data, emailing counterparties, running monetary transactions, deleting retained records or approving policy changes.

---

# 1 — DECISIONS THAT ARE LOCKED

## 1.1 Unified design composition

- **V10 Quiet Intelligence = design grammar**: calm, highly legible, mission-first, intuitive workspace and discreet visual authority.
- **V07 SourceLab = technical rigor**: comparable quotations, requirements and revisions, evidence/source drill-down, precise units, technical uncertainty.
- **V01 Heritage Atlas = public/editorial credibility**: typographic quality, strong content hierarchy, distinctive corridor visual language and commercial narrative.
- **V02 Precision Ledger = operator efficiency**: keyboard friendly, high-information-density, state-aware queues, filters and sophisticated operational controls.
- Result must be **one coherent product identity**, not four themes, duplicated apps or country-specific code forks.

## 1.2 Non-negotiable product constraints

1. Design around **Mission → Counterparty/Evidence → Decisions/Activities → Outcomes**, but do not invent a new persistent mission engine or merge existing independent domain records.
2. Country of company, target market, demand origin, meeting location, supplier location and shipment origin/destination are **different concepts**. EU is a trade-bloc market scope, not a country or inferred jurisdiction approval.
3. No fabricated suppliers, source facts, verified badges, global network size, commercial outcomes, readiness, contact access, testimonials or buyer coverage. Public fictional walkthrough must clearly state **illustrative synthetic demonstration**.
4. Keep **original currency/amount, unit, quotation revision, original language, source, temporal validity and uncertainty** visible. No guessed FX, averaged prices, risk scores or match percentages.
5. Customer contracts/trade/invoices/cash must never be conflated with **Corridra service fee, service invoices, receipts, delivery costs, rewards and contribution margin**. Unknown/incomplete is not zero.
6. Private scope/revocation/expiry, customer vs operator identity, independently invited contributors, fresh MFA, roles and tenant isolation must remain server-enforced. UI visibility is not authorization.
7. Real-data intake, production file scanning/storage, production outreach, AI/provider live inference, contributor pilots, payments and payouts retain existing **BLOCKED/OFF** gates until actual separately accepted prerequisites. Do not create conversion funnels that imply available paid service where it is not approved.
8. Preserve existing working links and fragment/return destinations, import/export bytes, event history, receipts and idempotent retries, including special recovery behavior from PR #38.
9. **No schema migrations, RLS/policy/domain logic rewrites or new external provider dependencies by default.** If unavoidable, stop and present a scoped ADR/decision request; do not quietly make the change.
10. Prefer the current Next.js/React/Tailwind stack and internal services; use no heavy animation, new state-management framework, analytics SaaS, headless component suite or AI widget unless necessary, justified and reviewed.

## 1.3 Authority precedence

1. Latest `main` code and existing server-side/domain/DB permission contracts.
2. `AGENTS.md`, `apps/web/AGENTS.md`, `docs/architecture/multi-corridor-v2.md`, `docs/architecture/v2-current-map.md`, `docs/adr/*`, established runbooks and accepted release records.
3. Current `docs/implementation/v2-part-05-traceability.md`, `v2-part-05-readiness.md`, `v2-part-05-controls.md`, `deferred-controls.md`, `v2-access-completion.md`.
4. This UX10X handoff for UX/product choices within existing boundaries.
5. Fusion reference prototype for visual direction only. It contains **fictional demonstrations** and does not enumerate every route, component or domain contract.

Where contradictory, preserve domain/security rules and record a documented implementation decision. Never modify original `docs/source/` documents.

---

# 2 — SOURCE-OF-TRUTH BASELINE, RECONCILIATION AND INVENTORY

## 2.1 Verified inspected baseline

- GitHub default `main` commit: `1e0dbea6f146265b256ca89b5482e789f97acdd9` (PR #38: operator startup recovery; `apps/web/app/operator/error.tsx`, `apps/web/lib/foundations.ts`, `apps/web/lib/recoverable-resource.ts`).
- Vercel production `READY`: same SHA, deployment `dpl_CrZgwvap4zB6e9qEvKZKfmVLrEN1`, aliases `corridra.vercel.app`, `c.obsidianglobal.studio`.
- V2 1–5 accepted feature baseline: PR #36 Part 5 operating controls; PR #37 workspace directory/onboarding/access; PR #38 startup/retry reliability. **Part 5 is implemented, not a future hypothetical module.**
- Stack from root `package.json`: Node 24.x, pnpm 11.19.0, Next.js 16.x, React 19.x, Tailwind CSS 4; scripts `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `build`, `test:e2e`, `test:operator`, `check`.
- Main repository had 503 git-tree entries at inspection. This is **not** an exhaustive code-level verification; Codex must inspect the actual checkout.

## 2.2 Gate 0 — mandatory discovery before implementation

1. Check branch, clean/dirty state, current SHA, open PRs, active work, branch count, existing affected pages; keep user work and do not overwrite other uncommitted changes.
2. Read `AGENTS.md` and `apps/web/AGENTS.md`; read installed Next.js 16 docs from the repository's `node_modules/next/dist/docs/` before Next.js API modifications.
3. Inspect all public and protected `apps/web/app/**/{page,error,layout,loading,not-found}.tsx`, `components`, client modules and `apps/web/app/api/**/route.ts`; examine invoked internal actions and corresponding packages. Also inspect every UX-relevant test and runbook.
4. Generate `docs/ux10x/inventory.md` plus machine-readable `docs/ux10x/coverage.json` enumerating **route, persona, access mechanism, all actions/forms, response states, API/domain dependencies, test IDs, planned redesigned component, exact acceptance status**. Do not hand-curate a partial route list; generate/check against repository traversal and append routes from tests and private capability entry points.
5. Distinguish existing deployed, code-implemented but gated, not implemented, and future concepts. Never present planned features as live.
6. Capture desktop 1440/1280, tablet 768 and mobile 390/360/320 baseline screenshots on an isolated synthetic test server; inspect actual interactive states using Playwright. Baseline existing accessibility and performance values are **measurements**, not guesses.
7. Run pre-change checks in an isolated environment and record baseline failures honestly. Preserve existing long-running workflow and shared fixture constraints; do not run tests concurrently against the same resettable DB.
8. Create a traceability mapping **baseline → implementation → automated acceptance**, with at least one meaningful positive and one negative/failure-path test per consequential action. All coverage gaps must be `BLOCKED` or `NOT YET COVERED` until resolved—not silently ticked.
9. Inventory the UI strings, typography/scripts, forms, tables, data units, files, native `<details>`, share links, role restrictions and keyboard access.
10. Save current `main` SHA and screenshots with report; if `main` advanced beyond the audited SHA, inspect the exact diff and update the matrix before coding. Never force-reset or erase new work.

## 2.3 Definition of 100% functional preservation

This is a **coverage constraint**, not a claim of mathematical proof. A row is complete ONLY when:

- Original authorized action remains reachable through valid navigation or an explicitly tested legacy alias.
- Payload/response, source/amount/version semantics, server authority and historic event record remain unchanged unless an approved compatible contract explicitly says otherwise.
- Loading, empty, error, invalid input, expired/revoked, offline/interrupted, retry, conflict, no-permission and confirmation states work where applicable.
- Keyboard and pointer/touch interaction work; WCAG failures are fixed or clearly reported.
- Positive success and negative denial tests run against real service boundaries for privileged work; no mocked authorization substituted.
- No permanent loaders, swallowed errors, duplicate submissions, stale tenant data or silent loss of unsaved drafts.
- Accessibility and performance regressions are measured on key devices.
- The PR's exact tested SHA matches the proposed change; actual deployment approval remains a separate step.

---

# 3 — WHOLE-SYSTEM SURFACE COVERAGE MATRIX

Every line is REQUIRED. The file path is the actual baseline integration anchor, not permission to bypass backend services. Codex must add finer-grained rows for every existing button/action and missing route discovered at Gate 0.

## A. Public acquisition, positioning and corridor discovery

| ID | Baseline entry/modules | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| P01 | `/` / `app/page.tsx` | Value proposition, jobs, evidence, stages, existing actual links and true test-only availability; compelling editorial hierarchy, one dominant next action; no fake metrics. |
| P02 | `components/site-header.tsx`, footer | Mobile/desktop navigation, disclosure, Escape/focus, all real destinations, Workspaces, sign-in; no inaccessible nav or dead links. |
| P03 | `/sell`, `/source`, `/machinery` | Job-specific requirements and actual corridor limitations; clear commercially relevant benefits and truthful CTAs. |
| P04 | `/enter-market`, `/business-trips`, `/trade-missions` | Role/job clarity, visits/delegation relevance, travel vs demand-location distinction. |
| P05 | `/how-it-works`, `/about`, `/trust`, `/network`, `/institutions`, `/privacy` | Evidence semantics, planned vs live distinction, private invitation pathways, legal/test notice, all valid links. |
| P06 | `/corridors`, `/corridors/[corridor]`, `components/market-selector.tsx`, `content/corridors.ts` | Directional BD→CN and BD→ES/EU with correctly limited reverse routes; non-country bloc scopes; no inferred global availability. |
| P07 | `/coming-soon`, 404 and metadata | Still reachable where retained; old redirects/canonical/query preservation, no outdated launch claims. |
| P08 | New illustrative Corridor Atlas / 90-second example | **No real source-data claim.** Select job + direction, show explicit synthetic scenario and verified *capability* boundaries; no new live intake or paid checkout. Optional demo must not replace existing pages. |

## B. Anonymous intake and identity lifecycle

| ID | Anchor | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| I01 | `/plan`, `app/plan/intake.tsx`, `/api/intake` | Five-step job-adaptive test brief, exact validation, country/market, dates, commercial specifics, original budget/currency, outcomes and notices. |
| I02 | same | 24h `sessionStorage` draft behavior, safe retry/duplicate key, cross-refresh resume, back/forward, focus, inline errors, test-only data constraints. Never auto-upload documents. |
| I03 | `/api/intake/receipt`, `/plan#receipt-check` | Private receipt, replies and status; no email promises; preserve recovery across aliases and safe token handling. |
| I04 | `/signup`, `/signin`, `/verify-email`, `/forgot-password`, `/reset-password` | Neon Auth customer verification, login, signout, expiry, recovery, and received-email flow; do not implement fake custom auth or remove fallback pages. |
| I05 | `/account`, `/api/account`, `/api/customer-missions` | Customer profile, signed-in identity, email-verification gate, permitted missions, invitation redemption and signout. Profile is **not** operator membership. |
| I06 | `/workspace` | Full public V2 tool directory and persona entry points introduced by PR #37; all V2 1–5 modules discoverable, no privileged data leak. |
| I07 | `/operator/signin`, `/operator/setup`, `/api/operator-setup`, `/api/operator-auth` | Owner-invited staff setup tied to verified customer identity, own operator password, independent authenticator/MFA; preserve sealed return paths, invitation expiry/consumption, suspension and no anonymous role creation. |
| I08 | `/operator/error.tsx`, `lib/recoverable-resource.ts`, `lib/foundations.ts` | PR #38 database startup failure and 15s cold connection policy; safe resource discard, bounded fresh-request retry, destination preservation, no stale cached failure or leaked auth state. |
| I09 | shared access and recoveries | Invalid/expired session, unauthorized tenant, no membership, unavailable foundations, signout, privacy-safe error messages; return to appropriate role destination. |

## C. Scoped buyer, supplier, participant, institution, contributor journeys

| ID | Anchor | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| C01 | `/buyer`, `/api/buyer`, `app/buyer/introduction.tsx` | Capability-scoped introduction, shared context, actual recipient role, uncertainty, interested/not relevant/need info, expiry/revocation and opt-out. |
| C02 | `app/buyer/recipient-response.tsx` | Supplier declaration and optional original quote/RFQ/visit interest only when enabled; self-declaration not verification or canonical action. |
| C03 | `/client`, `delivery-view.tsx`, `mission-experience-view.tsx` | Exact approved mission snapshot, pinned requirements, targets, quotes, visit/agenda, source status, version and stale comparison caveat. |
| C04 | `/programme`, `delivery-view.tsx`, `delivery-experience.tsx` | Private institution report, approved participants/denominators, group agenda, permissions, requested evidence, CSV/PDF export and meaningful recovery. |
| C05 | `/account`, `account/customer-missions.tsx` | Verified session redeemed invitation is separate from auth identity; never automatic discovery of other missions or confidential participant quotations. |
| C06 | `/contributor`, `app/contributor/task-board.tsx`, `/api/network/tasks` | Exact-assignee work, independently invited MFA, disclosure, acceptance, original submission, correction/review, dispute, reward obligations; no parent tenant access. |
| C07 | contributor offline and session recovery | Unacknowledged submissions remain visually pending; safe same-request retry, focus/reauth, no silent delivery or sensitive persistent local storage. |
| C08 | Customer/buyer/supplier/institution language | Original Chinese names and evidence unchanged; Bangla guidance/locale formatting not mistranslated into claim of fully translated UI. Source language distinguished from derived translation. |

## D. Operator mission, research, meetings and delivery

| ID | Anchor | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| O01 | `/operator`, `operator/workspace.tsx`, `lib/workspace-navigation.ts` | Role-aware tenant switch, closed fragment/return routes, MFA, workspace section reachability, drafts preserved, failure/retry, safe signout. |
| O02 | `operator/missions.tsx` | Mission review queue, all/open/overdue + owner/stage/route/job filters, qualification, source history, private receipt replies and paged results. |
| O03 | `operator/commercial-mission.tsx` | Progressive requirements and version history, assessments, RFQ, original quotation/revisions, selection, machinery parameters, typed visits, technical actions and source grounding. |
| O04 | `operator/counterparties.tsx` | Ingest sources, company identity ambiguity, private relationships/contacts, reversible attribution, entity matching, capabilities, factual publication review and mission shortlist. |
| O05 | same | Fit assessments and uncertainty/evidence gaps, original source limits, restricted contacts and expiry; do not invent match scores. |
| O06 | `operator/access.tsx` | Approved communication policies/templates, private introduction, opt-out, revocation, delivery/receipt status and authorized retry. |
| O07 | same | Proposed vs confirmed/held/cancelled/rescheduled meeting, itinerary, follow-up ownership, past change history, no invented attendance. |
| O08 | `operator/opportunities.tsx` | Opportunity created from recorded held meeting **or** typed alternate origin; original stage guard, progress, payments, accounting confirmation, exact reversal, replay and current mission counts. |
| O09 | same | Customer trade/contract/invoice/cash progression separate from Corridra service economics; source and currency provenance preserved. |
| O10 | `operator/delivery.tsx`, `operator/delivery-experience.tsx` | Participant imports, programme context, scoped invitations, original approved publications, agendas, evidence requests, report exports and confidential participant separation. |
| O11 | `operator/workspace.tsx` evidence controls | Sources/claims/facts, unscanned/quarantine, evidence scan/verify workflow, source rights, revocation and source/claim editing semantics. |
| O12 | `operator/workspace.tsx` membership/audit | Invited members, role/tenant management, authenticator/fresh MFA, access audits, feature flags. Accessible without collapsing complex permissions into one generic admin button. |

## E. V2 Part 4: Governed AI and restricted execution network

| ID | Anchor | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| A01 | `operator/intelligence.tsx` | Twelve registered tasks, reviewed public-source grounding, unverified draft statuses, original quotations, edit/accept/reject and manual fallback. |
| A02 | `operator/review-settings.tsx`, policies | Exact source rights, approved model/task/evaluation/processing location, budgets, tenant/deployment gates; no admin-entered arbitrary runnable prompt or provider URL. |
| A03 | `operator/network.tsx` | Reviewed contributor profiles, eligibility/suspension, exact task disclosure, conflicts, independent acceptance/review, quality/timeliness, dispute and correction. |
| A04 | same + ledger | Reward rule version, once-only approved obligation, independent accounting, exact negative compensation, manually reconciled observation **not** payout. |
| A05 | failure and authority states | Missing provider, expired model policy, source AI denial, processing region mismatch, budget exhaustion, unavailable network, suspended contributor; remain closed and legible. |

## F. V2 Part 5: Global Control Center, economics and reliability

| ID | Anchor | Preserved functionality + upgraded UX acceptance |
|---|---|---|
| G01 | `operator/operations.tsx`, `/api/workspace/operations-controls` | Global Operations scope by authorized workspace; corridor catalogue/config proposal preview, new version, independent reviewer decision, stale-base/conflict and source evidence. |
| G02 | same | **13 readiness dimensions**: offer, owner, qualification, research, communications, coverage, evidence, privacy, dependencies, support, quality, rollback, pilot. Evidence/owner/expiry; missing/expired remains blocked. |
| G03 | same | Direction/service/pack-specific UNPUBLISHED / SYNTHETIC_APPROVED / PAUSED; pause affects only new assignments to exact service; never claims real/public activation. |
| G04 | `/api/workspace/operations-dashboard` | Source-backed founder mission funnel, filters, denominators, all-matching totals, paging, reasons for losses, programme counts and unknown data warnings; no invented attribution or retention. |
| G05 | `operator/operations.tsx` + `packages/missions/src/operations.ts` | Corridra service fee ledger, original-currency invoices/receipts, delivery costs, effort/completeness, rewards and financial projections conditional on evidence. |
| G06 | same | No overcollection/cross-currency receipt, original invoice parentage, reverse receipts before invoices, append-only compensations, stale completeness invalidates margin; unknown must not render as zero. |
| G07 | same | Lifetime mission AI reservation ceilings plus task/daily budgets; no phantom provider invoice, missing real provider charges remain unknown. |
| G08 | `operations-health`, operations recovery | Retry/recovery, retained idempotent communication attempts, exact 3-failure DEAD state, bounded backoff, named cases with owner/due/source; request correlation ID. |
| G09 | `operations-controls`, `docs/implementation/v2-part-05-controls.md` | D01–D06/D08 external blocked, outreach, AI/network, restore and financial write acceptance; no cosmetic 'ready' badge. |
| G10 | `operator/review-settings.tsx` and operations | Route/pack/template versions, exact approved policies; only permitted reviewed types/adapters, no country-specific fork. |
| G11 | `operator/workspace.tsx`, `operator/error.tsx` | Database connection/timeouts, stale response, transient backend failure; meaningful recovery and no permanently spinning loading screen. |

## G. Cross-cutting surfaces

| ID | Boundary | Acceptance requirement |
|---|---|---|
| X01 | All identity and access classes | Anonymous, verified customer, buyer/supplier scoped link, institution scoped link, contributor, and owner/admin/operator/reviewer/viewer preserve distinctions and permission limits. |
| X02 | All routes | Mouse, touch, keyboard, screen reader, 320px mobile, reduced motion, zoom, error/empty states; no unsafe focus trap or hidden accessible actions. |
| X03 | All currencies/languages | Registered currency precision, original currency + original text, original Chinese glyphs, Bangla date/number presentation, explicit timezones and safe long text. |
| X04 | All protected data | Private token handling, no leak into URL queries/logs/browser analytics/screenshots, revocation, expiry, unrelated-tenant denial, stale publisher privileges. |
| X05 | All forms | Semantic labels, required/optional status, exact server validation, confirmation for destructive/consequential action, preserved draft on recoverable error, real success acknowledgment. |
| X06 | All role navigation | Deep links/legacy anchors/return-to survive, unavailable section recovery, correct permission-aware menu; no dead link or orphaned workspace. |
| X07 | All client transitions | Safe loading, cancellation/abort of stale requests when tenant changes, user-visible errors, optimistic UI only where supported and reversible, no duplicate command IDs. |
| X08 | Public + user-visible content | No unsupported real operations, invalid testimonials, logos, names, 'AI verified', real-time 'available now' or live market coverage without evidence. |
| X09 | Analytics | Consent/privacy-aware first-party measurement only after approved; clean separation of visits, qualified leads, submitted test briefs, real commitments, contracts, invoices and collected cash. No fabricated conversion. |
| X10 | International/global | Config-driven route/mission interfaces for BD→CN, BD→ES/EU, reverse directions, arbitrary third-country synthetic test, not separate hard-coded storefronts. |

---

# 4 — COMPOSABLE DESIGN SYSTEM CONTRACT

## 4.1 Preserve brand, raise craft

Current CSS contains `--paper: #f5f3ec`, `--ink: #222d29`, `--muted: #58635d`, `--accent: #526544`, `--line: #d6d9ce`. Keep this recognizable ivory/forest/ink character as baseline. Refine approved colors only after contrast calculations (AA for text) and snapshots; do not assume prototype hex codes pass accessibility. Avoid generic blue SaaS, excessive gradients, inconsistent pill buttons and fashion-only layouts.

- Define semantic tokens for surfaces, borders, text, action, positive, caution, critical, info, unknown, neutral; dark mode is NOT required unless user approves.
- Type hierarchy: editorial serif permitted only for public/hero/limited high-level headings; all dense data/forms must use highly legible sans; preserve Bangla and Han fallbacks.
- Component sizes: touch targets WCAG appropriate; fields/tables accessible at 320px, with explicit intentional local scrolling for wide technical comparisons.
- Motion: functional 120–220ms small transitions maximum as a starting design target; honor reduced motion; never block workflow on animation.
- Performance: server-render public by default, minimal client hydration, code-split heavy operator panels and charts, no expensive WebGL world visualization.
- Responsive: same permissions/actions on mobile; different information hierarchy, no crucial functionality hidden behind desktop-only UI.

## 4.2 Required shared components (adapt names if repository convention differs)

`PublicShell`, `WorkspaceShell`, `RoleNavigation`, `MissionHeader`, `MissionPassport`, `NextAction`, `EvidenceStatus`, `EvidenceDrawer`, `ReadinessState`, `CapabilityScopeNotice`, `VersionPill`, `SourceReference`, `DecisionTimeline`, `EventLedger`, `ComparisonMatrix`, `MoneyAmount`, `DateWithTimezone`, `StatusBadge`, `ActionQueue`, `ScopedEmptyState`, `RecoverableError`, `InlineValidation`, `ConfirmationDialog`, `ExportAction`, `ReviewDecision`, `DisclosurePanel`, `SensitiveActionMfaGate`.

**Important:** This is a component *capability list*, not an order to introduce unused abstractions. Build when used by two or more real screens. Keep domain-specific logic in domain packages; presentation adapters cannot derive new legal/commercial facts.

## 4.3 Visual UX across roles

- Public: commercial clarity and editorial authority, objective-first discovery, factual route availability, honest illustrated demonstrations.
- Customer: mission passport, one meaningful next action, relationship status, calendar/agenda, commercial timeline and approved evidence.
- Buyer/supplier: single scoped decision, original terms, simple disclosure, private reply and request clarification; no other party's contacts.
- Institution: actual denominators, participant scopes, approved agenda, post-meeting follow-through, export and evidence limits.
- Contributor: explicit terms, status, pending acknowledgment, review/dispute and reward record; never suggest paid/unpaid status unless recorded.
- Operator: highest relevant next action, dense tables with filters, reviewable source/claim/permission, audit and safe recovery.
- Owner/admin: independent review, readiness blockers, exact currency economics, complete risk/gate states, not decorative KPI dashboards.

## 4.4 Content rules

Use natural professional English, original user-supplied texts, meaningful microcopy and action-specific confirmation. Retain explicit 'test/synthetic' status, no fake urgency, no misleading free trial or checkout, no invented benchmark score. Existing public-copy rule prohibits em dashes. Use location/legal terminology cautiously; avoid conflating shipping routes with commercial corridors. Mobile CTA wording must be honest about availability.

---

# 5 — SIX SAFE, SEQUENTIAL IMPLEMENTATION PRS

**Gate 0 has no deployment.** Each PR needs its own bounded diff, tests and backout plan. The owner must approve merges/deployments separately. Never delete a needed branch to satisfy the count; use `scripts/check-git-branch-budget.mjs <branch>` and inspect open PRs first. If branch budget is exhausted, report the conflict and do not create an eleventh branch.

## UX-01 — Audit, foundations, access & failure-state vertical slice

**Primary task for the first Codex run.**

**Implement:** Gate 0 reports; token/type/geometry rules; limited shared components and responsive shells; `/workspace` persona directory, header/footer consistency, operator safe navigation and invitation/login/recovery shells; one representative end-to-end mission *read-only* vertical slice using existing scoped data; central state components for unknown, expired, revoked, empty, denied, transient outage; prevent stale tenant data on switching. Reuse PR #37 closed return-path and PR #38 fresh recovery. Route/page compatibility retained.

**Files likely touched:** `apps/web/app/globals.css`, `components/*` (new reusable UI primitives), `app/layout.tsx`, `app/workspace/page.tsx`, `app/operator/{page,error,workspace}.tsx`, `lib/workspace-navigation.ts`, relevant tests, `docs/ux10x/*`. Touch `lib/foundations.ts`/`recoverable-resource.ts` only if a proven UI-visible bug needs an approved narrow fix; do NOT replace their server contracts.

**Definition of done:** real authorized operator/customer read view + working denied/no-session/expired/error/retry controls on desktop/mobile, no loss of mounted V2 tool access; existing protected negative tests remain green. Freeze design tokens and navigation contracts for subsequent PRs. No speculative backend/auth rewrite.

## UX-02 — Editorial discovery, routes, job-first intake and account

**Implement:** premium homepage, accurate Corridor Atlas without false global coverage, selected role/job entry, progressively disclosed public routes, clearly synthetic demonstration, preserve five-step adaptive intake, 24-hour session draft, validation/date/original currency, receipt and actual error semantics, customer auth lifecycle/profile/My Missions and appropriate CTA. Preserve all canonical/redirect URLs and `/privacy` notice.

**Files:** public pages, `content/public-pages.ts`, `content/corridors.ts`, `components/site-header/footer/corridor/market-selector`, `app/plan/*`, `app/account/*`, auth entry pages and tests.

**Definition of done:** test-only user can discover, complete and recover a full synthetic brief, while all unauthorized real-data claims remain absent. Mobile form passes actual input/reload/duplicate/error tests. Do not add CRM, payment, signup requirement for demo or collect real leads under synthetic permission.

## UX-03 — Customer, buyer, supplier, institution and contributor journeys

**Implement:** Mission Passport/Cockpit, approved client mission detail, source/claim/evidence lens, original source-language quotation comparison, supplier response and private buyer introduction, individual delegation context, private programme reporting/exports, invitation redemption and contributor exact-assignee dashboard including offline retry/acknowledgment. All original capability checks remain on server.

**Files:** `app/delivery-view.tsx`, `app/mission-experience-view.tsx`, `app/{buyer,client,programme,contributor}/**`, `account/customer-missions.tsx`, relevant tests.

**Definition of done:** permissions tested across at least two tenants and unrelated/expired/revoked capabilities; actual original amount/source/version/report bytes preserved; no cross-participant leak; no invented availability.

## UX-04 — Operator's complete commercial execution experience

**Implement:** efficient mission review queue + filters and history, requirements, progressive assessment, machinery RFQ/technical details, counterparty identity resolution/publication/private relationships, fit shortlist, communications/opt-outs, introduction/meeting lifecycle, alternate origin and held-meeting opportunity workflows, commercial history/reversals, client/institution publication/import agenda/reporting, source/evidence review. Convert long page to deliberate contextual sections **without unmounting or discarding unsaved forms**; preserve safe deep links.

**Files:** `app/operator/{missions,commercial-mission,counterparties,access,opportunities,delivery,delivery-experience,workspace}.tsx`, supporting presentation components and tests.

**Definition of done:** every existing UI action is present in capability inventory and tested or faithfully reachable via preserved legacy section; confirmed vs proposed meeting, original quotes/currencies and compensation/record history unchanged; exports unaffected.

## UX-05 — Global Operations, AI, network, configuration, trust and audit

**Implement:** source-grounded founder dashboard, full Global Corridor Control Center, thirteen readiness controls, exact configuration proposal/review/pause, service economics with completeness/unknown states, operational documents/effort/cases and recovery, AI review/budget/model policy views, contributor eligibility/tasks/rewards/disputes, tenant/member/rights/audit controls and accurate blocked-control explanations. Introduce operator density mode only if no functionality degrades.

**Files:** `app/operator/{operations,intelligence,network,review-settings,workspace}.tsx`, documentation/runbooks, tests. Do **not** change `packages/missions/src/operations.ts` contracts or migration 0028; consult them for display mapping.

**Definition of done:** permission-negative tests and independently reviewed states preserved, exact original-currency service totals/warnings correct, missing evidence cannot display PASS, no real-data/AI/outreach/payout switches changed, cases/recovery remain effective. Owner and ordinary operator see different authorized slices.

## UX-06 — Full-system assurance, parity repair and launch-readiness UX

**Implement:** fix remaining traceability gaps, migrate any legacy surface not fully covered in UX-01–05, performance and accessibility audit, keyboard/zoom/mobile, i18n/source original text, visual regression, focus/error/retry/permission checks, security-negative test suite, performance budgets, truthful analytics instrumentation **only if approved**, code/docs cleanup. Do not delete legacy paths or domain flows just because they look old. Keep compatible aliases as needed.

**Definition of done:** `coverage.json` has 100% of **baseline implemented reachable actions** marked `VERIFIED`, with test links and evidence (not manual assertion); unresolved actions block UX programme completion. All mandatory tests and exact-head CI pass. Production launch requires a separate owner go/no-go with exact deployment and rollback plan.

---

# 6 — SPECIFIC SECURITY, MONEY AND EVIDENCE GUARDS

## 6.1 Contract preservation

Do not alter `packages/db/migrations/0001–0028`, `docs/source/`, PostgreSQL RLS, historical event/outbox, published artifact bytes, storage/fundamental identity or commercial domain transitions. No new server-side writable API in UX-only PR unless separately approved by owner and accompanied by independent ADR/tests. No client-derived authorization, implicit scope broadening or optimistic confirmation of financial/review actions.

## 6.2 Money semantics

- Customer trade cash and Corridra service receipts are separate database/business concepts and separate UI sections.
- All money values must preserve original currency, exact minor units and registered precision; avoid floating-point client arithmetic and cross-currency aggregation.
- Derived contribution margin may appear only when actual fee, cost and reward completeness permits it. Otherwise show 'Incomplete / unknown' and the recorded subtotals without implying profitability.
- No UI affordance that silently creates payments, executes payout, applies FX or approves accounting entries.
- Two-person review and fresh MFA never reduced to a click-away confirmation.

## 6.3 Trust and scope semantics

- `SELF_DECLARED`, actual source attached, independently verified, derived/translated, observed commercial outcome and AI unverified draft are distinct.
- A document being present ≠ scanned/clean ≠ independently verified ≠ commercially relevant.
- Superseded/expired version cannot be silently promoted; pin exact approved requirements, quotation, agenda and rights versions.
- Scope of private buyer/client/supplier/institution link remains server-enforced per capability, purpose, audience, expiry, publisher and opt-out.
- Contributor is exact assignment/tenant/task/disclosure only; customer and contributor identities do not gain operator workspace roles.
- AI generated text must remain `UNVERIFIED_DRAFT` and cannot mutate money, mission authority, legal clearance or verified facts.

## 6.4 Real operations and legal gates

Render D01 scanner, D02 ruleset, D03 secret scanning, D04 CodeQL, D05 production storage, D06 lifecycle, D08 real operational/legal/retention, outreach, provider and contributor-pilot conditions with their actual source/reason. No 'go live' switch or readiness claim because a synthetic gate passes. `SYNTHETIC_APPROVED` is not a public commercial service release. Retain unaffected route availability when one directional service is PAUSED.

## 6.5 Safe interactions and failures

Use exact existing command receipt/UUID idempotency. Do not generate new IDs on retries of unacknowledged consequential command. Preserve drafts and prevent accidental duplicate submissions. On tenant switch cancel/ignore stale reads and reset private view state before resolving new tenant. Show fail-closed reason without leaking sensitive details. Never expose invitation/MFA/customer/private capability tokens in telemetry, query logs, screenshots, console or error UI.

---

# 7 — TEST PLAN AND EVIDENCE REQUIREMENTS

## 7.1 Required local commands (actual project scripts)

```bash
node --version                     # 24.x
pnpm --version                     # 11.19.0
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm test:operator
# Equivalent aggregate (after required local services configured):
pnpm check
```

Setup follows `docs/runbooks/development.md` and project scripts `pnpm db:local`, `pnpm db:prepare-local`, `pnpm scanner:local`, plus supported Playwright browser installation. **Use isolated synthetic DB/auth/storage, never production secrets or identities.** Where environment lacks Docker/scanner, record which tests did not run; passing a subset is not full acceptance. Run integration tests serially when they operate on the same fixture DB.

## 7.2 Mandatory browser journeys

1. Public homepage → six job views → relevant corridor directions → honest availability → test-only plan, with keyboard/mobile.
2. Mission intake: five steps, adaptive fields, validation, dates, 24h saved draft, reload, error, retry, duplicate key and receipt.
3. Customer auth: signup/email verification/signin/password reset/signout, misconfigured auth recovery, separate operator identity; no bypass.
4. Workspaces directory → role selection → appropriate sign-in/return-to → valid and invalid hash, MFA, tenant switch, signout.
5. Approved buyer intro: interested/need info/not relevant/opt-out and revoked, wrong role, expired.
6. Supplier scoped original quotation and clarification: exact RFQ, permitted vs denied fields, review-only declarations.
7. Client/participant mission: requirements, target fit, original quotes, agenda, requests, version pinning and stale warning.
8. Institutional report: permitted programme denominators, confidentiality, participant isolation, approved CSV/PDF export bytes and revoked link.
9. Contributor: invite/MFA, read exact task, accept, offline unacknowledged submission/retry, review/correction, dispute, reward/reversal, suspension.
10. Operator research: source ingestion, matching/ambiguity, reversible attribution, private contact and publication rights negative cases.
11. Meetings and communications: opt-out, policy denial, retry/idempotency, proposed vs confirmed vs actual held, cancellation, follow-up.
12. Commercial outcomes: meeting/alternate origin, progression, original currency/quote/RFQ/samples, accounting denial, exact compensation and replay.
13. Global Operations: 13 readiness dimensions, expired/missing evidence, independent review, stale-base conflict, PAUSED route, restore status.
14. Finance: Corridra invoice/receipt/fee/cost/effort/completeness vs customer trade; cross-currency refusal, overcollection denial, unknown margins.
15. AI and network gates: no approved model/source/provider/budget, review-only draft, original quotation, exact assignee, policy denial.
16. Operator startup/DB timeout: recoverable error screen, fresh request retry, eventual success; persistent failures stay denied.
17. Invalid token, expired invitation, no membership, anonymous API reads, unrelated tenant access, revoked publisher, deleted/expired source; fail-closed.
18. All primary screens: 320/360/390/768/1280/1440 and full keyboard navigation, zoom/reduced-motion, contrast/axe, no page-wide unintended overflow.

**Add test rows for any additional live action discovered in Gate 0.** No hard-coded test count substitutes for actual contract/action parity.

## 7.3 Evidence outputs required per PR

- Baseline SHA, PR branch/head SHA, changed file list and `docs/ux10x/coverage.json` diff.
- Screenshot before/after for affected routes on desktop/mobile; no real data in captures.
- Actual positive and negative test names, real exit codes, warnings and failures; list untested gates.
- Accessibility violations, performance metrics, visual regressions, long text/Bangla/Han issues.
- API contract and RLS behavior notes, selected browser trace references sanitized of secrets.
- Exact feature-flag/gate state before/after; evidence no real services were activated.
- Deployment/merge status reported honestly; no claim of `READY` until inspected at exact SHA.

## 7.4 Quality targets (targets, NOT current measurements)

- WCAG 2.2 AA manual + automated target; keyboard, form/assistive UX tested.
- Core Web Vitals field targets: p75 LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1; lab Lighthouse mobile ≥ 90 performance / ≥ 95 accessibility where stable. Compare to baseline, never claim field INP from Lighthouse alone.
- No new critical/high known vulnerability, no unexpected secret/material output, no feature-parity regression.
- 100% of actual baseline user-visible action matrix `VERIFIED` before programme final acceptance; truthfully report gaps.
- User testing/commercial conversion results are separate future evidence, not part of source-code test assertions.

---

# 8 — PRODUCTION RELEASE AND ROLLBACK BOUNDARIES

- A PR passing locally is **not** a merged release or production deployment. Never auto-merge on the basis of this spec.
- Do not run migrations from frontend build or production rollout; normally no DB migration should occur for UX10X.
- Check ten-branch budget; preserve incomplete dependency PR branches, live synthetic/sterile Neon parents and owner-auth environment. No preview environment linked to live customer identity/production data.
- Use normal reviewed PR merge with exact-head CI. Protect history and keep existing V2-compatible fallback; never force-push or discard others' work.
- After explicit owner authorization to ship: inspect precise Vercel project/team, exact Git SHA, `READY` deployment, assigned production aliases, transient error logs and affected public/protected flows. Follow `docs/runbooks/deployment.md` and `v2-reliability-recovery.md`.
- Release UI behind compatible route/component-level rollout where possible. Roll back the application to the **latest compatible tested revision** and retain additive database history. `7a015101` is an old compatible baseline referenced in repo runbooks, not permission to roll back over later V2 Part 5 functionality; test downgrade compatibility before any real rollback.
- Never change `D01–D06`, `D08`, AI/network/outreach/payment gates to closed without actual separately reviewed external evidence. Avoid modifying production secrets or Vercel settings for purely cosmetic work.
- Only clean up completed and accepted branches/previews when the exact parent/child/binding and open-PR checks permit. Never delete unfinished PRs or live/default/sterile environments.

---

# 9 — REQUIRED CODEX REPORT STRUCTURE AND EXIT CONTRACT

At the completion of EACH PR return:

1. **PR number / branch / head commit SHA / base SHA / link; current main SHA.**
2. **What actually changed, with files.**
3. **Coverage:** rows added, VERIFIED vs PARTIAL vs BLOCKED, percentage computed only from discovered baseline actions, with denominator. Never write unqualified '100%' without test-backed denominator.
4. **Functionality preserved:** existing commands, redirects, role gates, version/amount/source behavior, error handling.
5. **Validation:** exact command/test outcomes, screenshots, axe/performance, security-negative tests; blockers/untested reasons.
6. **Gates:** real-data/outreach/provider/payout off, current D01–D06/D08 state, branch budget.
7. **Breaking changes:** NONE expected; if any, isolate and request approval.
8. **Next PR packet:** precise scope and prerequisites, not a generic request for broad further research.
9. **Operator action needed:** only exact necessary approvals such as merging a reviewed PR or resolving actual branch/CI/account limitation.
10. **Verdict:** READY FOR REVIEW / NOT READY / BLOCKED; NOT 'deployed' unless exact live deployment verified.

No PR is complete if any old action disappears, any admin scope is loosened, any unverified amount/status is portrayed as verified, or any cross-role information leaks.

---

# 10 — REFERENCE SOURCES TO READ IN CHECKOUT

**Core:** `AGENTS.md`, `apps/web/AGENTS.md`, `docs/README.md`, `docs/architecture/multi-corridor-v2.md`, `docs/architecture/v2-current-map.md`, `docs/implementation/v2-master-plan.md`, `docs/implementation/v2-part-05-traceability.md`, `docs/implementation/v2-part-05-readiness.md`, `docs/implementation/v2-part-05-controls.md`, `docs/implementation/v2-access-completion.md`, `docs/implementation/deferred-controls.md`, `docs/implementation/v2-ui-navigation-release.md`.

**ADRs:** 0003, 0004, 0005, 0015–0028, especially 0027/0028/0029 and 0030 (where present). Follow versioned canonical names as actually discovered; do not assume omitted numbers imply absent decisions.

**Runbooks:** `docs/runbooks/{development,deployment,neon-auth-accounts,v2-commercial-missions,v2-product-experience,v2-intelligence-network,v2-operations,v2-reliability-recovery,v2-access-and-launch}.md`.

**UI:** `apps/web/app/page.tsx`, `globals.css`, `components/*`, `app/plan/intake.tsx`, `app/account/*`, `app/buyer/*`, `app/contributor/*`, `app/delivery-view.tsx`, `app/mission-experience-view.tsx`, `app/operator/*`, `app/workspace/page.tsx`.

**API:** `apps/web/app/api/{workspace/[action],workspace/delivery,intake,intake/receipt,buyer,delivery,customer-missions,network/tasks,operator-setup}/route.ts` and exact auth routes; read actual route availability before edits.

**Domain/contracts:** `packages/domain/src/*`, `packages/missions/src/{commercial,operations,corridors}.ts`, `packages/counterparties/src/*`, `packages/opportunities/src/*`, `packages/delivery/src/*`, `packages/intelligence/src/*`, `packages/network/src/*`, `packages/auth/src/*`, `packages/db/migrations/0028_operations_control_center.sql` (READ ONLY).

**Tests:** `tests/browser/{public-experience,product-experience,access-navigation}.spec.ts`, `tests/operator/workspace.spec.ts`, all `tests/integration/*` affecting touched behavior, infra/doc tests, and CI workflow policies.

**Visual artifacts supplied with this handoff:** Fusion 01 screenshots and `index.html`/CSS/JS are references to recreate elegantly in actual Next.js screens, never to paste wholesale as an untested mock API replacement.

---

# 11 — FINAL PRODUCT STANDARD AND ECONOMIC RATIONALE

**Experience criterion:** Every audience knows what they are permitted to decide and do next; why it matters; what evidence supports it; what remains uncertain; who must act; and what actual commercial progress followed. Complexity should recede without erasing business/legal reality.

**Commercial criterion:** Prepare design for eventual qualified inquiry → proposal → commitment → contract → Corridra service invoice → cash collected, with independently approved real operations. A test brief is not a sales lead, an introduction is not a sale, customer contract/cash is not Corridra revenue, and attention is not market demand.

**Decision criterion:** A disciplined improvement to comprehension, task completion and action reliability outweighs decorative spectacle. Do not append more speculative product modules to this UX release.

**FINAL EXECUTION ORDER:** Gate 0 → UX-01 → review/merge authorization → UX-02 → review/merge authorization → UX-03 → review/merge authorization → UX-04 → review/merge authorization → UX-05 → review/merge authorization → UX-06 → final programme acceptance → separately authorized production release. Keep branch/CI/evidence budget under control. Deliver actual code and tests, not just a proposal.
