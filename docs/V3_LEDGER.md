# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md), this live-state index and [gap register](qa/current-plan-gaps/README.md). Latest applicable owner decisions win. Prior full release details and recovery references are preserved exactly in the [hashed ledger snapshot](v3/history/ledger-through-gap012-2026-11-03.md); [manifest](v3/history/manifest.json).

## Resume immediately

- Owner, 2 Nov 2026: keep Codex lean; reuse existing work, requested changes only, no subagents unless asked, minimum necessary checks. Permanent rule: root AGENTS.md; overrides mandatory squad routing for Codex.
- Owner authorizes fixing GAP-001 through GAP-021 except language items GAP-008, GAP-013, GAP-014 and GAP-021. Work one item at a time, commit, merge after matching-head green CI, verify automatic main deployment, and update this handoff and the current findings register after each. This supersedes per-PR confirmation and last-PR-only records for this bounded sequence, not unrelated work or external controls.

- Deployed code: GAP001–007,009–012 and015–016. Engineering criteria RESOLVED:006/009/010/011/012/015.001–005/007 remain OPEN for private runtime, activation or provider acceptance; READY alone does not prove those stages. Exact PR/head/merge/CI/deployment records are in each gap's existing verification JSON and the snapshot above.
- Latest verified production: PR247 mergea93d467095c4214d2d1e2e54db45c0c493138325, READY dpl_HMW4nKdcRiux8PMXY17rPkaJx4uJ at corridra.vercel.app.19 checks complete/no failures at33d5b41 (CI41598989254/CodeQL41598989150). Owner author/zero branch binding verified before retirement. GAP016 remains OPEN pending protected0006 installation. verification/2026-11-03-gap016-release.json.
- SQL installed: commercial0002–0005 (owner-approved41433412607 and41480437108); real-use0011/0012 via corrected41583942337 atd0d1a74. Actual job125744924754 advanced real-use10→12 on3 Nov05:52:05 UTC; activation unchanged. Prior41546213580 skipped the optional module despite success and is preserved. Do not duplicate installation. verification/2026-11-03-gap005-007-schema-install.json.
- Current branch fix/gap-017-task-assigned-notification, basea93d467. GAP017 source7 hashes match focused16-case DB proof; prior types/lint retained. Actual ASSIGN event selects the recipient; optional notice failure preserves assignment. SQL0007, frozen CI/deployment and protected installation pending. verification/2026-11-03-gap017-local.json.
- Next: release017/018/019/020 separately.17 isolated stashcd953f874ea6e55a153c9d6bb8b5fc5f97841dd7.18 complete17+18 stash4742f5f58631c616eb1cc9a28f3979314ca5604c:40 focused DB cases, including correction of incomplete extraction.19 full source stashddb55f95a7c2d125f07e9ce4087fabd4fb53b8ab:all15 source/log hashes match62 DB/full types/lint proof.20 isolated0394d713416a3460cc3d3e5b69c04b691fb20935:all original source/log hashes match85 checks/16 browser/lint. Minimal18/19 patches are in work/gap018-isolated-source.patch and work/gap019-isolated-source.patch; reconstruct from stash trees if needed. Three-way apply, preserve prior producers and0006–0009 inventory. Install commercial0006–0009 together from reviewed main using existing protected installer; activation stays unchanged.
- Preserve three open Dependabot PRs230–232 and historical unfinished branches. Budget at most8 distinct Git branches including main. Retire only exact merged heads with no open PR/environment binding; preserve stashes for unfinished work.

## Continuing constraints and owner steps

- Real admission is enabled under ADR056 with scanning deferred. Preserve customer/staff identity separation, MFA, RLS, resource revocation, immutable evidence/events and exact money. Gates D01–D06/D08 remain deferred/closed; outreach, inference, real payments and payouts retain independent prerequisites.
- Real UEN completed in install49. GST registration status/number, payment instructions and finance label remain marked made up; D3 refuses real invoices. No real payment provider exists.
- Production switch observations, accepted language reviews, earlier install runs, Pulse owner questions and other retained owner decisions are preserved verbatim in the [previous ledger](v3/history/ledger-before-gap-repairs-2026-11-02.md). The source audit is in the [immutable baseline](qa/current-plan-gaps/baselines/2026-11-01/README.md). No legacy broad absence claim is reinstated.
- No direct production database access or arbitrary provider activation. Additive SQL uses the existing reviewed installer; the owner's environment approval is separate from code deployment. Main deploys itself (ADR050); verify it before any manual deployment.

## Requirements and history

- [507 requirement identities](v3/phase-0/requirements.json), [history manifest](v3/history/manifest.json), [bounded context](v3/CONTEXT.md), [known issues](v3/KNOWN_ISSUES.md). The previous ledger links all older exact archives; nothing was discarded.

Live visibility: alias revision is verified; anonymous page probes hit a proxy CONNECT403 after redirect to c.obsidianglobal.studio. No signed-in live journey pass is claimed.
