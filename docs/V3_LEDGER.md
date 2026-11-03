# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md), this live-state index and [gap register](qa/current-plan-gaps/README.md). Latest applicable owner decisions win. Prior full release details and recovery references are preserved exactly in the [hashed ledger snapshot](v3/history/ledger-through-gap012-2026-11-03.md); [manifest](v3/history/manifest.json).

## Resume immediately

- Owner, 2 Nov 2026: keep Codex lean; reuse existing work, requested changes only, no subagents unless asked, minimum necessary checks. Permanent rule: root AGENTS.md; overrides mandatory squad routing for Codex.
- Owner authorizes fixing GAP-001 through GAP-021 except language items GAP-008, GAP-013, GAP-014 and GAP-021. Work one item at a time, commit, merge after matching-head green CI, verify automatic main deployment, and update this handoff and the current findings register after each. This supersedes per-PR confirmation and last-PR-only records for this bounded sequence, not unrelated work or external controls.

- Deployed code: GAP001–007,009–012 and015–018. Engineering criteria RESOLVED:006/009/010/011/012/015.001–005/007 remain OPEN for private runtime, activation or provider acceptance; READY alone does not prove those stages. Exact PR/head/merge/CI/deployment records are in each gap's existing verification JSON and the snapshot above.
- Latest verified production: PR249 mergee184781cba511223f64e53fd73a70d42e7a14975, READY dpl_GyDhZ6L1DCeLv4tm6Zy5yduM3jJh at corridra.vercel.app.19 checks complete/no failures atf9bfccc (CI41606986240/CodeQL41606986091). Owner author/zero branch binding verified before retirement. PR249 passed19 exact-head checks atf9bfccc and reached the exact READY production alias ate184781. Complete40-case proof covers the canonical customer quote notice and failure isolation. GAP018 stays OPEN pending protected0008 installation. verification/2026-11-03-gap018-release.json.
- SQL installed: commercial0002–0005 (owner-approved41433412607 and41480437108); real-use0011/0012 via corrected41583942337 atd0d1a74. Actual job125744924754 advanced real-use10→12 on3 Nov05:52:05 UTC; activation unchanged. Prior41546213580 skipped the optional module despite success and is preserved. Do not duplicate installation. verification/2026-11-03-gap005-007-schema-install.json.
- Current branch fix/gap-019-reply-posted-notification, basee184781. All15 combined source hashes and saved log hashes match62 DB cases/full types/lint. Reply notices use the explicit owned-request bridge and canonical staff authority; anonymous/revoked ownership sends nothing. Corrected SAVEPOINT isolates notice failure while retaining the reply. Frozen CI/deployment and protected0009 installation pending; genuine provider delivery unverified. verification/2026-11-03-gap019-isolated-local.json.
- Next: release019 then020 separately.19 stashddb55f95a7c2d125f07e9ce4087fabd4fb53b8ab and work/gap019-isolated-source.patch match62 DB/full types/lint proof.20 isolated0394d713416a3460cc3d3e5b69c04b691fb20935 and work/gap020-source.patch match85 checks/16 browser/lint. Preserve existing producers and0006–0009 inventory. After reviewed main gates, install commercial0006–0009 together with the existing protected installer; optional activation inputs unchanged. SQL is still at5; real-use is12. Do not repeat0011/0012 installation.
- Preserve three open Dependabot PRs230–232 and historical unfinished branches. Budget at most8 distinct Git branches including main. Retire only exact merged heads with no open PR/environment binding; preserve stashes for unfinished work.

## Continuing constraints and owner steps

- Real admission is enabled under ADR056 with scanning deferred. Preserve customer/staff identity separation, MFA, RLS, resource revocation, immutable evidence/events and exact money. Gates D01–D06/D08 remain deferred/closed; outreach, inference, real payments and payouts retain independent prerequisites.
- Real UEN completed in install49. GST registration status/number, payment instructions and finance label remain marked made up; D3 refuses real invoices. No real payment provider exists.
- Production switch observations, accepted language reviews, earlier install runs, Pulse owner questions and other retained owner decisions are preserved verbatim in the [previous ledger](v3/history/ledger-before-gap-repairs-2026-11-02.md). The source audit is in the [immutable baseline](qa/current-plan-gaps/baselines/2026-11-01/README.md). No legacy broad absence claim is reinstated.
- No direct production database access or arbitrary provider activation. Additive SQL uses the existing reviewed installer; the owner's environment approval is separate from code deployment. Main deploys itself (ADR050); verify it before any manual deployment.

## Requirements and history

- [507 requirement identities](v3/phase-0/requirements.json), [history manifest](v3/history/manifest.json), [bounded context](v3/CONTEXT.md), [known issues](v3/KNOWN_ISSUES.md). The previous ledger links all older exact archives; nothing was discarded.

Live visibility: alias revision is verified; anonymous page probes hit a proxy CONNECT403 after redirect to c.obsidianglobal.studio. No signed-in live journey pass is claimed.
