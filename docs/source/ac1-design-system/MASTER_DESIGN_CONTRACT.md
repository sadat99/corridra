# CORRIDRA AC/1 — THE LOCKED PRODUCT DESIGN SYSTEM

**Status:** Owner-selected visual direction and implementation contract. **Approved brand:** Atlantic Cobalt. **Product:** existing Corridra V3. **Scope:** all public, customer, recipient, organiser, contributor, operator and founder views. **Agent-neutral:** Codex or Claude Code can implement the next bounded verified package. **Created:** 22 October 2026.

> **North star.** An international commercial instrument with editorial authority, excellent operational precision, and effortless task completion. It should feel authored rather than templated. Beautiful is necessary, but correctness, evidence, commercial usefulness, accessible interactions and disciplined restraint are non-negotiable.

> **Reality rule.** No text specification can guarantee a subjective result such as "0% AI-looking" or 100% human acceptance. AC/1 replaces those claims with explicit anti-template prohibitions, fixed recipes, whole-system inventories, visual references, a trained human approval gate and executable acceptance checks. A coding agent may not self-certify taste.

## 0. Authority, scope, and no-regression rule

**Owner decision:** Lock **Atlantic Cobalt** to replace forest green/ivory. Lock **Meridian Exchange** as the canonical design language and the four specialised compositions **SourceLedger, Encounter Grid, Commerce Atelier, Signal Desk** as contextual extensions of the *same* system. **Do not install five themes.** Do not revert to DSX.1/DSX.2, Concept 01–07 mockups or generic AI-styled SaaS pages as the master art direction.

Authority order for agent implementation:

1. Most recent explicit owner decisions, including this brand + composition lock, interpreted narrowly.
2. Existing product contract, authoritative domain/security/privacy/money requirements, ADRs, live-ledger reality and already-approved Guided UX interaction rules.
3. This AC/1 design contract for visual grammar and presentation behaviour. Where its visual guidance replaces old colours or aesthetic defaults, record a limited, reasoned supersession in `docs/agents/ui-direction.md`; **do not silently change other locked rules.**
4. Legacy visual mockups as historical references only; they are *not* acceptance proof.

At start of every development session, read `AGENTS.md`, `docs/START_HERE.md`, `docs/V3_LEDGER.md`, `docs/implementation/current-plan.md`, relevant ADRs and the existing `docs/agents/ui-direction.md`, then inspect current `main`, in-flight PRs and dirty changes. Read full `docs/V3_CONTRACT.md` and the governing product vision before substantive changes. Use `node scripts/v3-context.mjs` and the repository's existing branch limits and work-log process. **Do not infer installed features, activation or test completion from design screenshots.**

**Preserve:** the three business families; universal mission/requirements; buyer/supplier/manufacturer roles; programmes; evidence and five trust labels; canonical organisation identities; original documents and versions; source licences; RLS and tenant scopes; authorisation; independent customer/operator/contributor accounts; invitation consent/revocation; events, outbox, retries and audit; history; original currency and financial domains; controls, deep links and existing accessibility modes; feature flags; disabled and partial functions. Navigation never grants access. No destructive database migration, backend rewrite, unauthorised commerce or hidden feature deletion is design scope.

AC/1 must not turn "implemented", "enabled", "deployed", "provider accepted", "legally approved", "paid" and "commercially live" into synonyms. Customer intake admission was recorded enabled, while important production authenticated journeys, billing and other V3 work were still unverified or incomplete in the reviewed ledger. Re-check live state at execution time.

## 1. The five expressions, one exact design language

| Expression | Where | Hierarchy | Source of inspiration | What stays identical |
|---|---|---|---|---|
| **Meridian / Core** | Navigation, customer Home and My Work, mission overview, private recipient screens, guided flow shell | Goal → status → next task → people → evidence | JOOR continuity + NuORDER scoped handoff | Tokens, controls, semantics, identity, typography, field patterns, states |
| **SourceLedger / Inspect** | Companies and research, RFQs, quotations, machinery, comparison, evidence and commercial decisions | Comparable facts → exceptions → original evidence → action | Trademo source trails + NuORDER grid/table | All global contract elements; no unique button styles |
| **Encounter / Coordinate** | Delegations, visits, hosted buyer programmes, participant journeys, 1:1 meetings and scheduling | People and availability → meeting intent → conflict → decision → agenda | Grip organiser and meeting flows | All global contract elements; no arbitrary event colour theme |
| **Atelier / Discover** | Public homepage, service/corridor pages, qualified company dossiers, commercial discovery | Compelling message → precise offer → credible artefact → conversion | JOOR commercial storytelling + NuORDER composed presentation | All global contract elements; no fake photography/proof |
| **Signal / Operate** | Staff Today, case queue, all tools, access, audit, founder, delivery and controls | Exceptions → accountable owner → decision → evidence → actual outcome | Grip schedule exceptions + Trademo investigated facts | All global contract elements; no alternate dashboard UI kit |

Composition switching is **by task and information type**, never by country, account, decorative preference, or the user's taste. One customer can enter a SourceLedger comparison inside their Meridian mission without losing context; one operator can open an Encounter programme inside Signal without a new application shell. A role governs **access**, not a separate visual brand.

## 2. Art-direction commandments (the anti-template filter)

**Use:** professionally directed typography, clear baselines, deliberately unequal proportions, restrained rules and frames, meaningful photography or diagrams only with source rights, left-to-right task progression where culturally appropriate, quiet numerical data, and one readily visible point of action. Allow controlled editorial asymmetry on public pages and systematic density in professional tools.

**Never:** hero gradient fog; glassmorphism; blur as primary structural device; floating abstract spheres; neon or rainbow icon bubbles; random hue per feature; identical coloured tiles for every action; a row of oversized vanity KPIs without questions they answer; repeated white cards nested in white cards; decorative map routes presented as actual trade routes; stock businesspeople shaking hands; invented logos, metrics, factories, customers, testimonials or verified statuses; auto-generated pseudophotography passed off as real; gradients as button defaults; arbitrary drop shadows; oversized rounded capsules everywhere; animations attached to every scroll; unearned confidence scores; five competing CTAs; tiny low-contrast table captions; standalone underlined links used as the sole navigation system.

**Rules for deliberate visual craft**
- Every page has one **primary visual thesis**: why this arrangement exists and what is uniquely useful about this information.
- Cards require semantic grouping. Lists need no card unless the group itself has meaningful boundaries.
- On ordinary work pages, permit no more than one prominent contrast surface in the initial viewport (excluding the persistent navigation). Not a law of aesthetics; deviations require a documented task justification.
- Do not alternate icon colours for visual rhythm. Icon colour follows function and semantics.
- No decorative illustration can carry a customer claim. Real images require provenance, permissions, relevance and responsive crops. If no genuine visual source exists, use editorial type + material details instead of a fake visual.
- Text must be commercially specific and naturally written. Every interactive label predicts its outcome.
- Use *repeatable rules*, not repeated-looking screens. Page layouts may be materially different if data and task warrant it.
- At 1440 px and 390 px, a reviewer must be able to distinguish each of the five compositions **without reading its name**, while recognising every control as Corridra.
- If a screen resembles an anonymous template, revert for a new composition review; do not camouflage with another gradient, icon set or colour accent.

## 3. Brand architecture: Atlantic Cobalt is locked

**Brand primitives** (exact): Midnight Navy `#142438`, International Cobalt `#2856C5`, Porcelain `#F6F8FB`, Copper `#BF7548`, Ink `#18283C`. Supporting colours live in `atlantic-cobalt.tokens.json` and are the controlled extension of these five primitives.

| Role | Token | Value | Meaning |
|---|---|---|---|
| Global chrome/dark editorial | `navy` | `#142438` | Depth, authority, operational orientation |
| Main interactive accent | `cobalt` | `#2856C5` | Selected, focused, primary action, active location |
| Page substrate | `porcelain` | `#F6F8FB` | Calm readable surface, not a beige consulting brochure |
| Selective editorial accent | `copper` | `#BF7548` | Brand ornament/section detail only; not verification or warnings |
| Primary body | `ink` | `#18283C` | Readable commercial records and narrative |
| Raised surface | `white` | `#FFFFFF` | Actual contrasted substructure only |
| Subtle surface | `muted` | `#EFF3F8` | Local grouping, selected support, fills |
| Default border | `border` | `#D8E0EA` | Dividers and table separators |
| Secondary type | `textSecondary` | `#4B5A6C` | Supporting copy |
| Hover / pressed | `cobaltHover` / `cobaltPressed` | `#234EB0` / `#1E4295` | Single predictable action state |

**Copper is not orange warning.** Do not use bare `#BF7548` on porcelain as small normal text; its calculated contrast is ~3.37:1. Use deeper `copperInk` `#85451E` for small editorial text if semantically relevant and verified on its actual surface. Do not use brand blue for "verified" unless the status is merely an informational navigation state. Semantic safety colours remain stable independent of brand colour.

**Verified contrast examples, computed from sRGB colours**: white on cobalt 6.51:1; white on navy 15.68:1; ink on porcelain 14.02:1; secondary on porcelain ~6.63:1. Each *actual* component/state combination must be tested: these samples are not universal certification.

**Transition rule:** Existing CSS source `apps/web/app/globals.css` has multiple legacy roots, cascade sections, `--paper`, `--ink`, `--accent`, `--brand-deep`, `--brand`, `--on-brand`, `--surface-*`, `--line`, and `.primary-link`. Do not patch dozens of late overrides. Audit declarations and selector specificity; designate one canonical semantic token definition; align legacy aliases and migrate consumers systematically. `--brand-deep` historically styles CTAs as well as dark navigation; reassigning it globally to navy without correcting CTAs is a bug. Keep `--action` / primary action cobalt separate from `--brand-deep` / navy. Log every changed mapping and screenshot every impacted shared component. No raw hex in component CSS.

**Illustrative semantic mapping after audited reconciliation:**
```css
/* Integration sample, NOT drop-in code: resolve legacy cascade and aliases first. */
:root {
  --paper: #F6F8FB; --ink: #18283C; --accent: #2856C5;
  --brand-deep: #142438; --brand: #2856C5; --brand-hover: #234EB0;
  --on-brand: #FFFFFF; --surface-0: var(--paper);
  --surface-1: #FFFFFF; --surface-2: #EFF3F8;
  --text-1: var(--ink); --text-2: #4B5A6C;
  --line: #D8E0EA; --action: var(--brand);
}
/* CTA background uses var(--action), NOT an assumed var(--brand-deep). */
```

## 4. Typography as the primary brand artwork

A visual system is not a selection of font files. Typeface assignment, contrast, size, width, leading, tracking, line wrapping, relative scale and the relationship between narrative and numerical copy comprise the art direction.

- **Interface & commercial data:** keep existing **Inter**, with true medium / semibold weights when available. Ensure permitted local assets and fallbacks; do not distribute font binaries. Numeric columns use tabular numerals and unambiguous separators.
- **Editorial display:** proposed **Newsreader** for carefully selected public headings and large subject titles only; fallback Georgia. This is an approved *design intention*, subject to font licence, performance and actual multilingual specimen validation before adopting a new font. If not ready, retain the existing licensed editorial font with the same metrics/roles rather than shipping a broken import.
- **Bangla and Simplified Chinese:** preserve existing Noto Sans Bengali, Noto Sans SC and verified local fallbacks. Test glyph sizing, word wraps, numerals and baseline across all three languages. Never fake CJK/Bangla with Latin-only fonts. Keep original legal entity and source-language names intact.
- **Editorial display:** desktop clamp approximately 48–68 px, line-height 1.04–1.10, letter spacing adjusted optically not indiscriminately compressed; mobile ~36–46 px and 1.07–1.13. Copy maximum ~13–18 words over two to three lines; no forced broken lines that create mobile widows.
- **Page title:** 32–40 px on desktop and 28–34 px on mobile. Professional workspace page titles are **UI sans** by default; public editorial headings can be serif. Do not introduce serif to every table card heading.
- **Section:** 24–32 px; subsection 18–24; body 16 px; long-form reading 18 px; tables 14–16 px; helper 14 px; restrained metadata 12–13 px only at robust contrast. No essential instructions under 14 px. Existing approved guided flow body/readability constraints govern where stricter.
- **Label:** sentence case by default; upper-case compact overline only once per section, 11–12px, tracking ≤0.10em for Latin. Avoid letter-spaced Bangla/Han. Original trade codes/IDs exempt from decorative typography.
- **Measure:** readable text maximum 60–72ch; descriptive UI copy <= 48ch where possible. Long names wrap predictably. Data labels remain visible when values wrap.
- **Weights:** 400 reading; 500 labels; 600 primary. 700 sparingly. No endless 600-weight cards. Define line-height and paragraph spacing per semantic role, not element-by-element guesses.

## 5. Geometry, rhythm and surfaces

Grid: 4 px foundation. Approved spacing steps `0, 4, 8, 12, 16, 24, 32, 48, 64, 80, 96` px; **do not invent local values for aesthetics**. Optical adjustment exceptions must be documented in the component itself. Major public sections 64–96px, workspace sections 24–48px, panels 16–24px, rows 12–16px.

- Public max content 1280 px; application content 1560 px; readable text columns 60–72ch; phone gutters 16px; tablet 24px; desktop 40–48px.
- 12-column desktop underlying grid. Public Atelier can take asymmetrical spans (5/7, 7/5, 4/8), but align edges precisely. Signal workbenches can use 216 px navigation / flexible content / 336 px inspector when space permits.
- Compact row ~44px for desktop, comfortable row ~56px for touch-oriented views; guided choice **>=76px**; touch targets **>=44px**, guided primary **>=60px**. Do not shrink critical tasks to fit a screenshot.
- Radius: controls 8px; ordinary cards 12px; major panels 16px; badging can be capsule if semantically a badge. **Do not use huge pill buttons just to appear premium.**
- Borders: thin rules show structure, subtle depth only for actual overlays and floating menus. Base components use no perceptible shadow unless needed for layering. No nested elevated card inside elevated card.
- Navy left rail is only for complex staff views; public pages and simple customer views should not gain a dark rail for decoration. Use careful light/dark contrast, not giant navy blocks everywhere.
- No full-page horizontal overflow at 320 px. Large comparisons scroll **within a labelled table region**, optionally pin the identity column; do not squeeze financial semantics into illegible microtype.

## 6. Navigation: preserve approved destinations, improve treatment

**Hierarchy:** global workspace → local domain/mission/programme → focused record/action. Only one level visually dominates. Breadcrumb is an orientation aid, not a second nav list.

- Public header retains **How it works · Routes · Sign in · Start a request** with language/Listen; supporting links in footer. Avoid unapproved new global primary destinations. Homepage product entry remains *Sell my products · Buy products or machines · Lead a group trip*.
- Customer retains **Home · My Work · Companies · Results · More** (Companies gated). Desktop top navigation; mobile bottom navigation. This is the source's binding set; no arbitrary fifth/sixth route substitution.
- Corridra team retains **Today · Missions · Companies · Delivery · Outcomes** and a complete **All tools and settings** destination. Preserve original 18 allowed operator section IDs, same href fragments and role filters.
- Founder retains **Business · Operations · Routes and settings · People and access · Ready to start?** under existing permissions.
- Private recipients, invited buyers, organisers and contributors see scoped actions only, no pretend role escalation.
- A local tab changes the local panel only. Navigation of an editable panel must preserve mounted draft data or warn with a plain, reversible choice. Back restores context/filters/search/sort/scroll where reasonable.

**Navigation components:**
- Global header: text navigation, active indication by underline or border as appropriate, one primary CTA, 72–80px tall desktop; narrow-screen menu preserves full link destinations.
- Work rail: icon optional, never alone except with accessible label; label 14–16px, 44px active row, cobalt selection **marker** or contained muted highlight, not both a giant coloured background and bubble.
- Context tabs: line-under active, exact state + aria-current/selected; same meaning across roles. Do not style filter chips as tabs.
- Record index: rows with primary title, secondary factual line, right-side status and directional affordance; whole row click only if no nested independent actions, else explicit link/button targets.
- Advanced tool directory: grouped disclosure with persistent plain terms, search where implemented, authorised hidden/disabled meanings; no loss of discoverability.
- Filters: compact squared tokens/buttons, removable with clear labels, persistent when navigating back. Chips denote selected filters, **not all navigation**.

## 7. Component catalogue and exact usage contracts

Every visual primitive has one API or canonical CSS implementation. Do not create local `FancyButton`, `PremiumCard`, `DarkCTA2`, `AIStatTile` alternatives. Respect existing control bindings and test selectors; refactor the underlying shared component only if all usages pass.

| Component | Appearance and dimensions | Behaviour + states | Use / avoidance |
|---|---|---|---|
| **Primary action** | Cobalt filled, white 600 label, 8px radius, 44px high default, 52px large, guided 60px; icon only when descriptive | Hover cobaltHover, active cobaltPressed, 2px focus ring/halo, loading locks repeat submission but announces status, disabled explanation where needed | One primary decision **per action region**; never every card |
| **Secondary** | White or transparent surface, 1px stronger border, navy label, same height/radius | Hover tinted, pressed, focus, disabled | Secondary real actions, not low-importance destinations |
| **Quiet/text action** | Unboxed text with meaningful underline on hover/focus, 44px hit area when standalone | Visible focus, purposeful label | Inside toolbars; contextual "View details"; not primary page navigation |
| **Destructive** | Confirmation semantics, critical label/border, never copper or cobalt | Confirm scope, reversibility and impact; permission enforced | Delete, revoke, remove |
| **Icon button** | 44px hit area, 20px icon; neutral unless active | Tooltip + accessible name, keyboard | Search/open detail/help; no gratuitous decoration |
| **Nav row** | Divider-led, 44–56px, aligned icon if it improves decoding, title + concise description | Hover/active/visited/focus/denied; safe exact href | Main directory and compact actions |
| **Feature choice** | 76px+ guided choice, icon + clear wording, genuine radio group | Selection check, accessible feedback, persists draft | First-time task selection; never for dense records |
| **Status badge** | Small, textual with optional icon, semantic fill/outline, not jewel colours | Unknown/empty/pending/verified etc mapped from backend | Status only; badge must not be primary navigation |
| **Fact/provenance label** | Trust name + glyph + supporting line, original source link | exact 5 existing trust labels; no inferred promotion | Evidence and derived commercial information |
| **Record row** | Name, relevant market, actionable status, metadata, trailing action only when needed | Empty/loading/denied, keyboard focus, preservation of selection | Missions, meetings, organisations, approvals |
| **Table** | Header 14px, fixed money alignment/tabular nums, rules, no excessive zebra | Sort, filter, pagination, selection only where supported; keyboard | SourceLedger/Signal data, never card-per-cell replacement |
| **Comparison matrix** | A stable specification column + supplier columns + evidence drill-down | Original currency, scope, missing, revisions, non-comparable value display | Technical offers; do not rank unsupported data |
| **Inspector panel** | ~336px desktop contextual area, mobile drawer or full page | Focus trapped only for modal, labelled close, restore focus; never trap nonmodal | Documents, evidence, technical terms, actions |
| **Timeline** | Event lines and dates with actual status, owner and source | Versioned history, relative + absolute times where useful | Commercial mission/progamme; no fake linear status |
| **Meeting slot** | Local date/time, timezone, participants, venue, meeting state | Conflict/response/approval/decline/override must be explicit | Encounter, not free floating colourful event tiles |
| **Form/field** | Label above 44px field, helper below, error inline, specific units/currency | Autosave only where supported, pending/complete/invalid/conflict/retry | No placeholder-only labels or unconfirmed success |
| **Disclosure** | Minimal bordered divider + chevron and clear summary | expanded/closed remembered where needed, keyboard, focus | Long complex tools; never hides a blocker silently |
| **Toast and inline notices** | Quiet success / clearly actionable warning/error, no celebratory gradient | live-region announcement, recoverable; preserve data | Make state explicit and truthful |
| **Empty/loading/offline** | meaningful sentence + next safe action; skeleton follows actual shape | Loading, empty, unavailable, denied, offline, expired, revoked distinct | Every data-dependent screen |
| **Search/command** | optional searchable index, bounded results, command names explicit | Permission filters on server; no hallucinated destination | Advanced operations only when implemented |

**No hover-only meaning.** Every state accessible on touch/keyboard. Every important value has a label, unit, source and/or date as appropriate.

## 8. Five full composition blueprints

### 8A. Meridian — mission/customer structure

1. Compact identity & global navigation.
2. Eyebrow or contextual breadcrumb (one line).
3. Strong H1: concrete objective, with one factual subtitle and visible state.
4. One dominant next-action band where there is an actionable next step. **Preserve the locked guided next-step card rule**: a dark contrast surface with one light button, *now navy*, first on Home/a piece of work. No extra fake alert banners.
5. Records/activity arranged as **rows or short sections**, not a collection of identical cards. The visible mission body answers "What has happened?", "What can I decide?", "What is missing?".
6. Evidence and history one interaction away. Same mission identity across tabs and roles.
7. Mobile one-column; bottom customer tabs, action above safe area and no information loss.

**Key failure:** presenting a polished CRM without clear customer decisions.

### 8B. SourceLedger — commercial comparison & investigation

1. Record title and version in compact, consistently aligned header.
2. Key procurement attributes and technical scope directly below.
3. Fixed table identity column, horizontally contained supplier comparisons where necessary.
4. Differences matter more than ubiquitous highlights. Missing/unclear/unsupported visibly distinguished; *not applicable* separate from *not known*.
5. Details open original supplier quotation, source document, revision, method, date and legitimate scope. No AI certainty disguised as fact.
6. Follow-up actions bind to specific fields and supplier; approved comments and revision history remain intact.
7. One meaningful final action, without implying purchase approval or verified equivalence.

**Key failure:** comparable-looking prices for offers with different Incoterms, currency, installation, shipping or warranty.

### 8C. Encounter — delegation and meetings

1. Programme name + organiser/participant context (same record, scoped data).
2. Meeting activity as time-oriented rows or calendar lanes.
3. Obvious transitions: requested → pending response → confirmed → completed/cancelled, preserving real backend states.
4. Conflicts inline with reason, participant and exact slots; no promise the schedule is conflict-free until the authoritative check passes.
5. Touch-friendly participant view shows "My next meeting" and relevant permitted itinerary; operator view adds conflict queue and delivery coordination.
6. Participation, consent, private notes, organiser reporting and economic events separated by role.
7. No participant is automatically given company records beyond their entitlement.

**Key failure:** pretty calendars that cannot resolve a reschedule or protect private participant business intent.

### 8D. Atelier — public / partner discovery

1. Editorial promise written in specific, uninflated language.
2. One primary call to action, one permissible secondary.
3. Asymmetrical grid with a credible operational artefact or original licensed image. No generated fictions passed off as evidence.
4. Three existing commercial paths: **Sell my products**, **Buy products or machines**, **Lead a group trip**; no additional product invented as top-level.
5. Method, routes, trust, evidence, and clear next step displayed progressively.
6. Company dossier pages prioritise actual capabilities, verified status and permissioned evidence, not glamour portraits.
7. Mobile reorders by task importance, not arbitrary responsive visual balance. Keep language/Listen/help accessible.

**Key failure:** beautifully presented synthetic credibility or unsupported operating coverage.

### 8E. Signal — staff / founder / governance

1. Today defaults to **items requiring human attention**, not vanity totals.
2. Work queue columns: commercial task, underlying mission, source/status, owner, urgency, next approved action.
3. Numeric summaries only if reliable and directly decision-relevant. Explicit denominators and date window; unknown is unknown.
4. Drawer/detail inspection preserves list filter and scroll.
5. Founder distinguishes lead → opportunity → proposal → commitment → contract → invoice → collected cash → recurring income; trade volume never Corridra revenue.
6. Control Center, access/audit, AI governance, corridor gates, restoration, exceptions and advanced functions remain accessible through authorised directory.
7. More information density is permissible; smaller essential tap targets and inaccessible text are not.

**Key failure:** operational dashboard activity represented as commercial success.

## 9. Page-family mapping (real source routes, page ownership)

Source-discovery snapshot: 47 `apps/web/app/**/page.tsx` routes indexed by the repository code search **plus** the top-level `/`, and 18 protected operator navigation section IDs. This is **not** an exhaustive running page/action inventory. Agent MUST regenerate from the current tree (including dynamic routes, layout/error/not-found pages, modal states, flags and test fixtures); inventory cannot establish backend acceptance.

| Current route / family | Composition | Mandatory presentation behaviour |
|---|---|---|
| `/`, `/sell`, `/source`, `/machinery`, `/enter-market` | Atelier | Editorial product pathways; no unverified promise; route to real intake |
| `/trade-missions`, `/business-trips`, `/institutions` | Atelier + Encounter preview | Organiser story and accurate application path, not invented capacity |
| `/how-it-works`, `/about`, `/trust`, `/privacy`, `/network` | Atelier informational | Readable long-form, evidence/policy traceability, no glamour dashboard |
| `/corridors`, `/corridors/[corridor]` | Atelier geographic | Configured commercial direction and operational status, not fake physical shipping routes |
| `/workspace`, `/coming-soon` | Meridian gateway | Only valid access paths; no dead CTA, no premature live statements |
| `/plan`, `/account/drafts/[workspaceId]`, `/account/request/[workspaceId]` | Meridian guided | Preserve 8 locked guided rules, step + time-left, listen/help, answer retention, 60px primary |
| `/signin`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Meridian access | Same identity language, plain failure/recovery, real links, no cross-role assumption |
| `/operator/signin`, `/operator/setup`, `/operator/forgot-password`, `/operator/reset-password`, `/contributor/setup` | Meridian restricted access | Operator/contributor auth independent, safe invitation states |
| `/account`, `/account/requests/[requestId]`, `/account/missions/[resourceId]` | Meridian | Next-step first, clean mission history and results, full access control |
| `/account/companies`, `/account/profile`, `/account/profile/[workspaceId]` | Atelier dossiers + SourceLedger facts | Company identity, scoped versions, qualification and source labels |
| `/account/delegations`, `/account/delegations/organise`, `/account/delegations/[workspaceId]` | Encounter | Participant versus organiser context, agenda/conflicts/privacy/economics |
| `/account/service-requests`, `/account/service-requests/new`, `/account/service-requests/[workspaceId]`, `/account/service-requests/[workspaceId]/[requestId]` | Meridian commercial action | Clear scope, service state, exact work context, no invented billing |
| `/buyer`, `/client`, `/programme`, `/contributor` | Meridian private + Encounter/Signal context | Scoped view only; no unintended access; invitation/expiry/revocation paths |
| `/operator` | Signal with embedded SourceLedger/Encounter | All existing work panels retained and discoverable, hash deep links preserved |

**18 operator IDs preserved** (discover role filters): `workspace-missions`, `workspace-research`, `workspace-meetings`, `workspace-commercial`, `workspace-delivery`, `workspace-sources`, `workspace-evidence`, `workspace-ai`, `workspace-network`, `workspace-operations`, `ops-dashboard`, `ops-center`, `ops-health`, `ops-gates`, `workspace-settings`, `workspace-audit`, `workspace-authenticator`, `workspace-controls`.

**Operator mapping:** Today and overview = Signal; missions = Meridian + Signal; company research and sources/evidence = SourceLedger; meetings and programme coordination = Encounter; commercial progress = SourceLedger + Signal; delivery, reporting, network, audit, AI and recovery = Signal, with relevant embedded comparison/meeting features. All Tools directory includes every authorised original section.

## 10. Interaction and state machine standards

For **every** action, define: trigger, context, input, authority, async state, observable result, failure, safe retry, return path, audit effect. No dead controls. Never confirm before server authority and saved state. For actions with irreversible effects, show object, consequence and relevant scope. Any AI-generated text is an *unverified suggestion* until explicit human review and authoritative write.

- **Form saving:** preserve edit state, pending state and version conflicts. Auto-save claims only where actual; drafts must survive navigation per existing contract. No clearing unsaved state when an accordion or unrelated tab opens. When network fails, preserve unsent content locally if allowed, say it is *not sent*, and offer retry.
- **Navigation:** retain hash/deep links and filters; no open redirects. Focus moves to newly opened/changed content appropriately; dismissing a modal returns focus to the invoker.
- **Accessibility:** WCAG 2.2 AA target as minimum; 44px touch targets (product standard), visible consistent keyboard focus, labels and error associations, no colour-only status, English/Bangla/Chinese readability and original record language preserved. Reduced motion obeyed. Existing guided language-first, Listen, Help and accessibility preferences remain required.
- **Performance budget proposals (not observed):** interaction feedback visible <=100ms for local input; no large blocking animation; avoid layout shifts, keep images appropriately compressed; route LCP target <=2.5s at 75th percentile where applicable, INP <=200ms, CLS <=0.1 after real-user measurement. Do not claim these are met without data.
- **Motion:** 120ms direct state, 160ms standard, 200ms contextual overlays, max 220ms. Ease out; preserve spatial mapping; disable nonessential transforms in `prefers-reduced-motion`.
- **Responsive:** test 320, 360, 390, 768, 1024, 1440, 1920px, zoom 200/400%; in RTL or future locales test separately. No page-wide overflow, keyboard traps, sticky footer obscuring focus, or table miniaturisation.
- **Truth-state contract:** `Self-declared`, `Evidence available`, `Verified`, `Derived`, `Outcome observed` (exact verified backend naming/wording where applicable) never interchangeable. Unknown is not zero. Revoked/expired/private/redacted are distinct from unavailable/empty.

## 11. Brand, photography, illustration and motion assets

**Logo:** retain current Corridra wordmark and mark initially; change colours under semantic tokens only. Do not invent a new geometric logo from an AI generator and declare it the final mark. A visual-identity revision requires separate human review, trademark check and legal/technical handoff.

**Photos:** editorial real cross-border trade, manufacturing, meetings, verified scenes or authentic permitted company assets; avoid clichéd suit handshakes, random globe images and fake factory dashboards. Every asset must have owner/licence/source/permission, alt text, relevant route/use, responsive rendition and known crop behaviour. No image from external platforms or competitor sites may be copied into Corridra without rights. Never represent a demo image as a confirmed partner or customer.

**Illustration:** bespoke crisp trade systems (commercial path, counterparties, evidence relationships, programme movement) only when a diagram teaches something actual; build from approved brand geometry rather than generic isometric vectors. Diagrams are not substitutes for data records.

**Icons:** one consistent 1.75–2px outline family, standard size 20px, small 16px / large 24px; consistent cap/corner optical adjustments. Replace mixed handcrafted and third-party icons only through a semantic named mapping to preserve accessible labels/tests. Avoid separate pastel square behind every icon. Prefer text where text is faster.

## 12. Anti-regression engineering protocol: either coding agent

1. **Reconcile:** inspect current `main`/open PRs/dirty checkout, the ledger, 507-requirement register and source code; regenerate route/action inventory including hidden/advanced cases; take baseline screenshots for authenticated roles and public pages; detect frozen guidance conflicts. Avoid rewriting old docs or creating a parallel handoff.
2. **Publish addendum:** modify existing `docs/agents/ui-direction.md` once with an explicit dated AC/1 owner-brand and composition decision, while preserving locked guided interaction rules, fixed trust wording and architecture. Add `docs/design-system/atlantic-cobalt.tokens.json` and this specification, link from the existing handoff. Do not make the design-system doc into an alternate product authority.
3. **Token PR only:** migrate primitive/semantic tokens with exact crosswalk and test. No arbitrary component palette patches. Capture side-by-side visual diffs and contrast report, including nav/CTA semantic separation. Roll back on unreadable states.
4. **Shared primitives:** consolidate primary/secondary/quiet/destructive buttons, nav, tabs, rows, status/provenance, fields, panels, notice states. Preserve element semantics, selectors/IDs and existing tests. Create story/examples with hover/focus/disabled/loading/selected/error/long copy/Chinese/Bangla, not one "happy path" fixture.
5. **Three canonical end-to-end references:** public `/` (Atelier), customer `/account` + a mission (Meridian), `/operator` work queue (Signal); add SourceLedger quotation and Encounter organiser as the fourth/fifth reference. **No platform-wide page restyling before independent visual and task review.**
6. **Migrate by page family:** only after the first five composition references are accepted. Maintain an action->route->component->service->permission->test parity matrix. Mark available/partial/disabled/unverified accurately. Preserve existing testable deep links and source documents.
7. **Verification:** project-native format/lint/typecheck/tests/build/E2E, DB/RLS and operator/customer browser suites for affected paths; aria/keyboard/high-contrast/reduced-motion, no overflow; screenshot comparisons at designated sizes; failure/recovery proof. Run mandated CI and CodeQL; do not weaken tests to pass.
8. **Agent handover:** one bounded PR, source branch, tested SHA, environment/flags, changed files, evidence, outstanding deficiencies, exact next action, rollback steps in `docs/V3_LEDGER.md` and append-only work log. Second agent independently resumes without assuming another agent's success. Preserve branch budget, closed-dependency rules and deployment receipts.

### Required automated lint/audit policies (initially report-only until baseline is categorised)

- Raw `#[0-9A-Fa-f]{3,8}` outside approved token/asset files: report exact path/intent; do not blindly rewrite SVG/dataviz constants.
- Unapproved duplicate primitive button CSS / shadow / border radius definitions: report new violations as blocking; document legacy exceptions with removal owner.
- Hardcoded old green/ivory palette values in current UI implementation: inventory and migrate by usage; do not remove historical evidence files.
- Accessible name, semantic element, focus visibility, table label and form error associations: fail new violations.
- Unsupported success/verification/revenue copy, fake metrics/imagery, nonworking call-to-action: fail.
- Missing empty/error/offline and denial treatment on new data-dependent pages: fail.
- Unjustified new global navigation destination or a missing existing destination: fail.
- More than one competing primary action per **decision context**, artificial dashboard metrics, empty card-on-card structures: human review flag, not a naïve token-count test.

## 13. Acceptance, governance and explicit rejection rights

**Hard engineering gates:** exact role/action parity; server permission and tenant denial; idempotency/history/source/money preservation; original currency and source language; no broken links; back/focus/keyboard/reduced-motion/offline recovery; WCAG 2.2 AA target; responsive widths; no material functional regression; all existing test gates pass; verified safe rollback. The new palette is *not* permission to alter backend security contracts.

**Human visual art-direction gate** (per reference screen and each subsequent page family): evaluate at matching breakpoints, realistic dense and empty states, three languages, content quality, typography hierarchy, purposeful imagery, calibration of whitespace, real interactions. Reject if: could be mistaken for an anonymous template, obvious AI-generated imagery, excessive repetitive cards/pills/shadows, inconsistent primary-action appearance, ornamental statuses, cropped data, missing evidence, fake company credibility, semantic drift, or poor mobile reading. Decisions must include annotated evidence and a nominated human reviewer. An agent cannot mark this gate PASSED alone.

**Usability gates:** test representative inexperienced customers, experienced buyers, suppliers, delegation organisers and operators on real tasks with synthetic records. Suggested *targets* (not current performance): ≥8/10 unaided journey completion, no critical misinterpretation of verification/money, correct explanation of next step, no destructive task error, operator workload lower than baseline. Record actual task data and failure reasons; no "zero cognitive load" claim.

**Production state:** Only call AC/1 **designed** when this contract exists; **implemented** when merged; **verified** when tests/screenshots pass; **accepted** after human evaluation; **deployed** when serving exact SHA; **enabled** after flags/config/real auth confirmed; **commercially ready** after separate legal and operations checks. Report each separately.

### Required PR report, every time

```
Design system: Corridra AC/1; bounded package: <name>
Source: <branch / base SHA / checked head SHA>
Existing source rechecked: <files, role inventory, flags, in-flight PRs>
Visual composition(s): <Meridian | SourceLedger | Encounter | Atelier | Signal>
Changed files, semantic aliases and visual effect: <...>
Authorised actions before/after, added/removed/unchanged: <...>
Actual tests: command + environment + exit + count + artefact URL
Responsive, keyboard, a11y, contrast & screenshot evidence: <...>
Open issues, risk, rollback location: <...>
Human art-direction review: PENDING / ACCEPTED by <reviewer+evidence>
Deployment/activation/commercial status: distinct; no inference
One next action for either Codex or Claude Code: <...>
```

## 14. The final non-negotiable product rule

**Corridra is an authored international commercial instrument.** Public pages communicate opportunity precisely. Customer pages make next decisions effortless. Sourcing pages make information comparable and evidence inspectable. Delegations turn meetings into manageable programmes. Operators and founders see accountable work and commercial truth. **One identical control system and record semantics everywhere.** The design works because it is unusually appropriate to each job, not because it looks expensive.
