# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md) and this current-state index. Read this file before every chunk; update it at the end. Read the full contract once per new session and check for changes before rereading unchanged content. Never infer acceptance from chat memory.

## Resume immediately

- Owner direction (21 Oct): finish PR114, then PR115 and PR116. Latest feedback adds `/plan` receipt/confirmation consistency to PR114. Owner explicitly authorizes real use with scanning and additional security integrations deferred and confirms guest drafting followed by contact details and a password at the final step, automatic customer-account creation, activation and access to the submitted request. Implement that real-use admission as a separate additive packet after the stack, with matching UI/server/SQL validation and an ADR. Preserve sign-in, RLS, permissions and immutable history; do not claim missing billing functional. Current source still enforces test-only admission until the packet is built/installed. Deferral is not external certification.
- Main `13c745f` (PR113); production `dpl_52C2L688Czk42crEShbHqaQC9FWw` READY, fra1, production aliases. Main auto-deploys. PR114 branch `claude/happy-feynman-i66amw`, published head `a4a616a`; local receipt-card/field/button/copy-fallback changes and tests are uncommitted. Conflict resolution preserves customer CSS, terms tabs and both agents' logs; workspace-team selectors fixed; tablet footer regression proved fail-before/pass-after. PR114 changes no backend/API behavior.
- a4a616a CI `39534003098` passed all six jobs; CodeQL `39534003257` passed actual JS/TS, Python and Actions analyses. Local public 152/152, focused team 5/5 and footer 2/2; build/typecheck/static/docs/infrastructure/audit/context pass; secret scan 0 findings. Local DB 582/583: read timing 10111 ms versus unchanged 10000 ms limit under concurrent load; isolated retry passed. Local operator interrupted after 328 passes by the new receipt scope; nine not run. None of this verifies the new receipt edits. Next: finish their build/tests, push, inspect final-head CI/review, merge checked tree and verify automatic production before PR115.
- Live baseline: home/How it works/Routes/Trust 200; workspace and staff APIs 401/no-store; disabled terms 503/no-store. Account redirects to the owned custom domain, blocked to this executor. Signed-in managed-provider customer acceptance remains unverified.
- PR115 `feat/programme-pricing` at `fb0939c`; PR116 `feat/service-requests` at `6c5d82e` contains pricing. Earlier heads passed CI and CodeQL; preview provisioning failed independently. After PR114, update PR115 from main and verify; after its squash merge, update PR116 from the tested pricing predecessor tip then main. Preserve shared docs/CSS/registries. Reminder-cap and staff-refresh fixes exist; verify and resolve their old threads.
- Owner-run install [39524758195](https://github.com/sadat99/corridra/actions/runs/39524758195), main `b6a483a`, apply=yes: member-role registry one applied migration; request admission current. No later install run found. Links, terms, pricing and service requests still need reviewed installation/flags; source release alone enables nothing. Current DB/flags not independently queried. Earlier [install](v3/cleanup/2026-10-19-customer-modules-install.json), [unlock](v3/cleanup/2026-10-20-customer-unlock-release.json), [ADR049](adr/0049-synthetic-production-opt-in-and-open-admission.md); historical principal counts are not live observations.
- Whole V3 PARTIAL; billing V3-06-013 MISSING. No outreach, inference, payment or payout activation implied. Seven remote branches; preserve PR10/PR32 and unfinished work, maximum eight. Nine completed inherited local branches retired with commits preserved under refs/archive/completed-local; no remote deletion.

## Current state

- Whole V3: PARTIAL. Phases 0–4 have bounded source acceptance; exhaustive runtime preservation, full customer organisation/authoring, independent organiser coordination/economics and full UX/security/usability remain unfinished.
- Original baseline: e9ed2e53d97f543c30bace29d9ef38d568a65236. Last fetched main: `13c745f` (PR113). Fetch current main and open PR metadata before continuing; this ledger records observations, not a live monitor.
- Production last verified: see the exact SHA and deployment in the first Resume bullet. Older release receipts: [PR80](v3/cleanup/2026-10-19-pr80-release.json), [PR92](v3/cleanup/2026-10-19-pr92-release.json). Earlier PR81, PR82 and PR80 merge details are in the archived history.
- Controlled auth: owner reported wrong password and no reset email. Scoped metadata-only lookup in the exact isolated auth branch found account_exists=false/email_verified=false for the designated identity. It must sign up in that isolated preview first; production identity is separate. This does not prove a reset defect or successful mail delivery. Registered-account reset and authenticated signup/verification/reload/sign-out/revocation remain NOT VERIFIED. Never retrieve passwords, OTPs or session tokens; account identifier stays out of this ledger.
- External controls remain unclosed. The latest owner real-use deferral and implementation scope are in Resume above; current deployed admission remains test-only until that separate packet is installed. Outreach, payments, payouts and inference require their own implementation/activation.
- Branch budget observed 21 Oct: seven remote branches of eight allowed. Preserve open dependencies PR10/PR32 and unfinished PR114/PR115/PR116; inspect environment bindings before retiring completed branches.

## Requirements, history and evidence

- [Complete current register: 507 requirements](v3/phase-0/requirements.json). Status definitions: EXISTING is inspected implementation; PARTIAL is incomplete capability; MISSING is absent; GATED requires an independent prerequisite; DEFERRED is explicit contract priority; NOT VERIFIED lacks proof. Even EXISTING needs current runtime acceptance.
- [Exact historical ledger through chunk109](v3/history/ledger-through-109.md), including every prior register snapshot, command result, failure/correction, plan, limitation and audit. Its superseded current-state prose is historical only.
- [Archive and requirement identity manifest](v3/history/manifest.json). [Bounded context workflow](v3/CONTEXT.md).
- Use `node scripts/v3-context.mjs requirement V3-02-046` for affected requirements and `node scripts/v3-context.mjs chunk 109` for one historical entry. Do not load the whole archive for ordinary continuation.
- Baseline preservation: 45 route files,29 core migration hashes,six immutable sources,18 expert destinations; original806 controls. Use current source/action inventories and fresh permission/runtime evidence before claiming preservation. Original source,money,history and independent authorities remain binding.

Chunks 116 to 119 (PR84 release, guided drafts, PR86 merge, organiser economics) are archived: `node scripts/v3-context.mjs chunk 116` to `chunk 119`.

## Chunk120: PR86 to PR88 merged and released

Squash merges e31566e, 8bbbca2 and aebb527 after exact-head CI and CodeQL; production dpl_9ZxfddkTcqhPoMexsCeUvgu1pVqH, 64 of 64 live checks. Ignored Build Step set to scripts/vercel-ignore-build.sh. Gap fixed: PR86 and PR87 had been left undeployed. [Receipt](v3/cleanup/2026-10-19-pr86-pr88-release.json).

## Chunk121: programme coordination, reporting and templates (released)

ADR047 and ADR048 as optional additive modules (tasks, capacity, attendance, participant-shared feedback, organiser report; versioned templates applied only to an empty programme). PR90 squash d19e4c8 after CI and CodeQL at 4355c2d, base unchanged, merge tree equal to tested tree; production dpl_BwunTCzxWSk6trofUqTrvrUsutVP, 71 of 71 live checks. The first docs-only push built because a force-push removed the previous built commit; the next fast-forward docs-only push was skipped by the Ignored Build Step (proven; rule: do not force-push a branch whose previous preview you want compared). [Receipt](v3/cleanup/2026-10-19-pr90-release.json), [coordination](v3/phase-3/customer-programme-coordination/bounded-plan.md), [templates](v3/phase-3/customer-programme-templates/bounded-plan.md). Participant messaging stays unbuilt (outreach gated).

## Chunk122: founder activation view (released)

Staff-only table in the Business overview showing which of 16 customer modules a deployment serves and why (configuration only, no query, secret or live figure; database install state not inferred). My first push added role=status text that broke the governance spec's single-status expectation and its founder follow-on; fixed with aria-live and a component assertion, then full CI green at c81b0b1. PR92 squash 58ac24d, production dpl_BsKPfaEVuwqGzZzUk37BLDJdjB1T, 72 of 72 live checks. V3-04-089, V3-09-035, V3-09-036 PARTIAL, none verified. [Plan](v3/phase-4/founder/activation-plan.md). Unverified: real-user usability, role-state acceptance.

## Chunk123: plain-language front door (source, local evidence)

Home headline, intro and request page heading rewritten without idioms. Copy only; no behavior, route, flag or gate changed. Local: format, lint, typecheck clean, build exit 0, 74 browser specs passed including axe. Unverified: CI, deployment, reader comprehension. Published after the owner deleted a merged branch to meet the branch budget. [Work log](agents/work-log.md).

## Chunk124: Guided experience standard locked (documentation)

Owner approved and locked the Guided UX v2 style in docs/agents/ui-direction.md (eight rules, locked navigation, 36-screen map, ship conditions, open decisions). No code or behavior change. All 36 screens are design only; ease-of-use and blind-access claims stay unproven until real-user and screen-reader tests. Next: owner chooses the first build PR. [Work log](agents/work-log.md).

## Chunk125: Guided public site (UI only)

Public front door rebuilt to the approved mockups: home, header, footer, how it works, routes, trust and the ways-to-work pages (about, network, institutions share them). Copy cut to short blocks. Listen is a small icon in a new corner dock beside Help. Old Solutions menu, route explorer clutter, market selector and about 115 more dead CSS rules removed; legacy hex baseline 25 to 15. Every destination kept (footer, `/corridors`, `/trust`; `/#mission-example` redirects). No flag, gate, schema or money change. Not proven: real-user and screen-reader ease. Open: Help contact channel. Next: owner review, then the request flow. [Work log](agents/work-log.md).

## Chunk126: team roles and leaving (source, local evidence)

Phase 1 of the unfinished customer organisation work, after an audit showed invitations, acceptance and revocation already exist with UI and tests. New optional module `customer-member-role-migrations` ([ADR051](adr/0051-member-roles-and-leaving.md)): append-only admin and member roles chosen by the workspace owner with a stale-safe check, and a member leaving their own membership; flag `CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED`, default off. Only three role readers are replaced (same text but the role expression) and tests compare every function, table, digest, ACL and policy before and after on a populated database. Local: new database tests 12, browser protocol specs 8, all 25 customer integration suites 316 plus related specs green, format, lint, typecheck clean. Not done: CI, merge, install, flag, release, managed-provider acceptance. V3-06-003 stays PARTIAL. Later phases: canonical organisation linking and verification, coordination (eligibility, capacity, terms, account-linked tasks, in-app reminders), economics (pricing templates, series, repeat revenue, exports).
