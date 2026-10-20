# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md) and this current-state index. Read this file before every chunk; update it at the end. Read the full contract once per new session and check for changes before rereading unchanged content. Never infer acceptance from chat memory.

## Resume immediately

- State: main 5a3e123 (PR103 over PR101 b8af3a9, PR100 3f7a70d, PR98 454b8b3 and PR99 73417de). Production serves 5a3e123 (PR103 How it works and headline fix, dpl_5w2n5XW4RMHCkHHYivRVyo8Tkebu, READY, fra1, four aliases), deployed after the customer unlock release. [Receipt](v3/cleanup/2026-10-20-pr103-release.json). Rollback dpl_DmDyG2SnGDRu2fMffeMYKzoGj5sw (b8af3a9, [PR101 receipt](v3/cleanup/2026-10-20-pr101-release.json)). Unlock receipt: [PR100](v3/cleanup/2026-10-20-customer-unlock-release.json).
- Synthetic customer modules are LIVE on production by owner decision ([ADR049](adr/0049-synthetic-production-opt-in-and-open-admission.md)): 16 module registries and the admission module are installed in Neon corridra-nonprod branch corridra-live-synthetic; the issuer and executor are pinned (verified by SQL: one configuration row, 19 identity principals, 0 customer principals); 19 Production settings added (unlock, open admission, issuer, 16 module flags). Probe: customer endpoints answer 401 or 400 instead of closed; no signed-in customer flow has been exercised yet. [Install receipt](v3/cleanup/2026-10-19-customer-modules-install.json).
- Scanning (D01), privacy and legal (D08) and security hardening are DEFERRED by owner decision and required before any real customer data or outside pilot user. Use invented data only.
- Next concrete action: owner signs up with a fresh verified email on the live site and tries the customer flows with invented data; fix what breaks. Then the deferred controls, billing and paid-service requests.
- Owner standing rules: correct checked merges and exact-commit deployments are pre-authorised; keep fewer than nine Git branches always; follow the V3 contract exactly; D01-D06 and D08 stay closed.
- Preview builds: the Ignored Build Step skips documentation-only fast-forward pushes (proven in a build log); two leftover previews (corridra-i30disroz, corridra-elppm5r4l) remain deletable; whether the Function Storage meter recovered is unverified.

## Current state

- Whole V3: PARTIAL. Phases 0–4 have bounded source acceptance; exhaustive runtime preservation, full customer organisation/authoring, independent organiser coordination/economics and full UX/security/usability remain unfinished.
- Original baseline: e9ed2e53d97f543c30bace29d9ef38d568a65236. Last fetched main: e760398 (merged PR94). Fetch current main/open PR metadata before continuing; this ledger records observations, not a live monitor.
- Production last verified: PR80 dpl_7s25EKF9z5vFHnpVWKn19XvPhtM3 READY at exact 383bb9ff8cc9ac651b0aba3a14a67ad7f2c310bd/fra1 with expected public aliases. All 51 read-only live checks pass, exit0; probe independently stopped. Isolated preview dpl_6xwpz2K5CHgC5U43FVc6KPDCTiiK READY at same source, four preview checks pass. [PR80 receipt](v3/cleanup/2026-10-19-pr80-release.json). PR82 production dpl_9MbSd2wCxAsosfVvFJGnvCv1nEtW and isolated preview dpl_8mU3VFwLBuaTRM17mLkLt14tNzXS READY at exact bb826896/fra1 with expected aliases; 51 live/four preview checks passed, probe stopped with independent readback. [PR82 receipt](v3/cleanup/2026-10-19-pr82-release.json).
- PR81 historical accepted release: merge3e081ae, tested head7aa9396/tree27963a95; successful CI40files392integration/124public/142protected, production51live and preview4 checks. [Exact receipt](v3/phase-3/customer-programme-context/release-pr81.json). CodeQL skipped, not passed.
- PR81 behavior: reason input requires three characters to match the unchanged backend. Local build/lint/web+package types/format/19 JS+7 Python/source guard passed;13component browsers passed(27.1s),one compiled closed-route passed(3.5s). All original tests/backend authority retained. Source CI and bounded production/preview observations accepted; full managed-provider/product acceptance remains unverified.
- Controlled auth: owner reported wrong password and no reset email. Scoped metadata-only lookup in the exact isolated auth branch found account_exists=false/email_verified=false for the designated identity. It must sign up in that isolated preview first; production identity is separate. This does not prove a reset defect or successful mail delivery. Registered-account reset and authenticated signup/verification/reload/sign-out/revocation remain NOT VERIFIED. Never retrieve passwords, OTPs or session tokens; account identifier stays out of this ledger.
- Phase5 GATED: D01–D06 and D08 stay closed. No real commercial mission data, outreach, payments, payouts or production inference. No optional cloud module/provider/admission/intake/flag changes in this cleanup.
- Branch budget last verified: local3/remote8/distinct8. Reuse this completed docs branch for the CodeQL follow-up after PR82; do not create a ninth branch. Open dependency PR10/32 remain preserved. PR80 merged; do not remove environment-bound or unfinished work without verified exclusions. Earlier cleanup recovery proof remains in history.
- PR82 MERGED: bb826896e4070d7eaece0c0fca6aa14b64765c67 exactly matches tested head b4df194b20fac417277170454ca2d48f2b09ecb2/full tree3ca46d472ad26f7d94f2fe57155c62f0ca3acd93. CI39199284234/job117888705267 SUCCESS: integrity507/archive/vision, 40files392integration/124public/142protected and every mandatory validate step. Earlier cancelled runs/heads are superseded, not accepted. Existing shared handoff updated, six guide originals and chunks through112 preserved exactly.
- PR80 MERGED: 383bb9ff8cc9ac651b0aba3a14a67ad7f2c310bd exactly matches tested head acf049a50b1928dbeae0848952ab363252a0237f/tree77199aa6772f2a3631edf22b1ab2a16e12c6d9b3. CI39198130022/job117885226396 SUCCESS: 40files392integration/124public/142protected and mandatory validate gates. Reviewed18 patch/minor upgrades, manifest/lockfile-only scope, exact Neon Auth patch/overrides retained. No auth policy, RLS, money/history or real-gate changes.

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
