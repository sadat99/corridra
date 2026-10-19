# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md) and this current-state index. Read this file before every chunk; update it at the end. Read the full contract once per new session and check for changes before rereading unchanged content. Never infer acceptance from chat memory.

## Resume immediately

- State: main e31566e (PR86 guided request drafts merged over PR85 7f699c8). Production serves 248884b (dpl_EdF8jdWxohcntZe93LBa5nU4hgMt, READY, fra1); PR85 and PR86 are not deployed. [Receipt](v3/cleanup/2026-10-19-pr83-pr84-release.json). The profile and draft flags are unset and neither module is installed in any cloud database.
- Open: PR87 (scripts/vercel-ignore-build.sh, draft until CI green) on `feat/v3-organisation-profiles` (remote has eight branches; never push the session branch under a new name). Chunk119 organiser economics (ADR046) is local source only, to follow PR87 on the same branch.
- Next concrete action: merge PR87 on green, set the Vercel project Ignored Build Step to `bash "$(git rev-parse --show-toplevel)/scripts/vercel-ignore-build.sh"` (record the prior value) and verify with one docs-only push; then push economics as its own PR with the acceptance record in docs/v3/phase-3/customer-programme-economics/bounded-plan.md.
- Owner standing rules: correct checked merges and exact-commit deployments are pre-authorised; keep fewer than nine Git branches always; follow the V3 contract exactly; D01-D06 and D08 stay closed.
- Preview builds: Vercel Function Storage hit 100 percent; the owner deleted five previews; two leftovers (corridra-i30disroz, corridra-elppm5r4l) remain deletable. Whether the meter recovered is unverified.

## Current state

- Whole V3: PARTIAL. Phases 0–4 have bounded source acceptance; exhaustive runtime preservation, full customer organisation/authoring, independent organiser coordination/economics and full UX/security/usability remain unfinished.
- Original baseline: e9ed2e53d97f543c30bace29d9ef38d568a65236. Last fetched main: e31566ed47a64c4d44fa7628830d1e247569412c (merged PR86). Fetch current main/open PR metadata before continuing; this ledger records observations, not a live monitor.
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

Chunks 116 (PR84 merge and production release) and 117 (guided request drafts) are archived: `node scripts/v3-context.mjs chunk 116`, `chunk 117`.

## Chunk118: PR86 merged

Guided request drafts (ADR045) merged as e31566e (squash) after CI run 39234573020 (validate success, 22 minutes) and CodeQL 39234573097 (three analyses success) at exact head 246f7a5; base was still 7f699c8 so the squash tree equals the tested tree. The four ClamAV-dependent integration tests that fail in this sandbox did not fail in CI. Not deployed: the flag is unset and the module is not installed in any cloud database. Opened PR87 for the Ignored Build Step script.

## Chunk119: organiser programme economics (source, local evidence)

Built ADR046: optional module customer-programme-economics-migrations (append-only ledger of fees, payments, planned or actual expenses, obligations and Corridra service fees; exact bigint amounts; compensating corrections; owner and admin only through the existing participant management check), service, /api/customer-programme-economics and a finance panel on each programme in the planner. Recorded money is the organiser's own and unverified; Corridra revenue and trade values are not touched, nothing is collected, nothing is converted. [Acceptance record](v3/phase-3/customer-programme-economics/bounded-plan.md).

Local results (PostgreSQL16): economics integration 20 passed; component spec 25 passed incl. axe at 320, 390, 768, 1440; typecheck clean. 11 requirements moved to PARTIAL with evidence (V3-06-007 from MISSING); V3-02-075 stays NOT VERIFIED; none marked verified. Exact-head CI, preview and real-user usability are unverified.
