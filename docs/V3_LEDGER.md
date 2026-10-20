# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md) and this current-state index. Read this file before every chunk; update it at the end. Read the full contract once per new session and check for changes before rereading unchanged content. Never infer acceptance from chat memory.

## Resume immediately

- State: main 3f7a70d (PR98 Guided public site and PR100 release record over PR99 73417de). Production serves 3f7a70d (dpl_4MqMDJkgAn2FBpE5yvrL2GkbRcbb, READY, fra1, four aliases; smoke: Guided pages 200 with new headings, /account redirects to sign-in, customer endpoints 401 or 400, security headers set). [Receipt](v3/cleanup/2026-10-20-customer-unlock-release.json). Rollback dpl_GwBtFnE5M7iHgpaHKf9qaGKwbVgg (73417de, correct issuer variable); never dpl_Cjk5Zp44f7D5PuKxsANQawAMiSNz.
- Synthetic customer modules are LIVE on production by owner decision ([ADR049](adr/0049-synthetic-production-opt-in-and-open-admission.md)): 16 module registries and the admission module are installed in Neon corridra-nonprod branch corridra-live-synthetic; the issuer and executor are pinned (the first pin named the wrong auth service and was corrected on 20 Oct with the owner's approval; now the app's real auth https://ep-tiny-forest-b199wxno.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth; SQL-verified, 0 customer principals); 19 Production settings added (unlock, open admission, issuer, 16 module flags). Probe: customer endpoints answer 401 or 400 instead of closed; no signed-in customer flow has been exercised yet. [Install receipt](v3/cleanup/2026-10-19-customer-modules-install.json).
- Scanning (D01), privacy and legal (D08) and security hardening are DEFERRED by owner decision and required before any real customer data or outside pilot user. Use invented data only.
- Next concrete action: owner signs up with a fresh verified email on the live site and tries the customer flows with invented data; fix what breaks. Then the deferred controls, billing and paid-service requests.
- Owner standing rules: correct checked merges and exact-commit deployments are pre-authorised; keep fewer than nine Git branches always; follow the V3 contract exactly; D01-D06 and D08 stay closed.
- Preview builds: the Ignored Build Step skips documentation-only fast-forward pushes (proven in a build log); two leftover previews (corridra-i30disroz, corridra-elppm5r4l) remain deletable; whether the Function Storage meter recovered is unverified.

## Current state

- Whole V3: PARTIAL. Phases 0–4 have bounded source acceptance; exhaustive runtime preservation, full customer organisation/authoring, independent organiser coordination/economics and full UX/security/usability remain unfinished.
- Original baseline: e9ed2e53d97f543c30bace29d9ef38d568a65236. Last fetched main: 3f7a70d (PR100). Fetch current main and open PR metadata before continuing; this ledger records observations, not a live monitor.
- Production last verified: see the first bullet (3f7a70d). Older release receipts: [PR80](v3/cleanup/2026-10-19-pr80-release.json), [PR92](v3/cleanup/2026-10-19-pr92-release.json). Earlier PR81, PR82 and PR80 merge details are in the archived history.
- Controlled auth: owner reported wrong password and no reset email. Scoped metadata-only lookup in the exact isolated auth branch found account_exists=false/email_verified=false for the designated identity. It must sign up in that isolated preview first; production identity is separate. This does not prove a reset defect or successful mail delivery. Registered-account reset and authenticated signup/verification/reload/sign-out/revocation remain NOT VERIFIED. Never retrieve passwords, OTPs or session tokens; account identifier stays out of this ledger.
- Phase5 GATED: D01–D06 and D08 stay closed. No real commercial mission data, outreach, payments, payouts or production inference. No optional cloud module/provider/admission/intake/flag changes in this cleanup.
- Branch budget (20 Oct): remote 7 of 8 allowed, plus open work branches; Git proxy refuses branch deletes in cloud sessions, so the owner deletes merged branches in GitHub. Open dependency PR10 and PR32 stay preserved. PR101 belongs to another session.

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
