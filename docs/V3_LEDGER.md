# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md), this live-state index and [gap register](qa/current-plan-gaps/README.md). Latest applicable owner decisions win. Prior full release details and recovery references are preserved exactly in the [hashed ledger snapshot](v3/history/ledger-through-gap012-2026-11-03.md); [manifest](v3/history/manifest.json).

## Resume immediately

- Owner, 2 Nov 2026: keep Codex lean; reuse existing work, requested changes only, no subagents unless asked, minimum necessary checks. Permanent rule: root AGENTS.md; overrides mandatory squad routing for Codex.
- Owner authorizes fixing GAP-001 through GAP-021 except language items GAP-008, GAP-013, GAP-014 and GAP-021. Work one item at a time, commit, merge after matching-head green CI, verify automatic main deployment, and update this handoff and the current findings register after each. This supersedes per-PR confirmation and last-PR-only records for this bounded sequence, not unrelated work or external controls.

- Deployed code: GAP001–007,009–012 and015–019. Engineering criteria RESOLVED:006/009/010/011/012/015.001–005/007 remain OPEN for private runtime, activation or provider acceptance; READY alone does not prove those stages. Exact PR/head/merge/CI/deployment records are in each gap's existing verification JSON and the snapshot above.
- Latest verified production: PR250 mergecc07f17de93b8920ec1a36d15b231653931e369e, READY dpl_4qGH5o82emrc9RUfUsuRW3DrFano at corridra.vercel.app.19 checks complete/no failures atddc1b55 (CI41611055047/CodeQL41611054995). Owner author/zero branch binding verified before retirement. PR250 passed19 exact-head checks atddc1b55 and reached the exact READY production alias atcc07f17. All15 combined source hashes match62 DB cases/full types/lint, including corrected reply persistence on notification failure. GAP019 stays OPEN pending protected0009 installation. verification/2026-11-03-gap019-release.json.
- SQL installed: commercial0002–0005 (owner-approved41433412607 and41480437108); real-use0011/0012 via corrected41583942337 atd0d1a74. Actual job125744924754 advanced real-use10→12 on3 Nov05:52:05 UTC; activation unchanged. Prior41546213580 skipped the optional module despite success and is preserved. Do not duplicate installation. verification/2026-11-03-gap005-007-schema-install.json.
- Current branch fix/gap-020-scoped-email-off-copy, basecc07f17. GAP020 behavior source unchanged from85 integration/16 browser-case proof. Operator test formatting corrected; semantic TypeScript AST identical. Original proof/current3 source hashes in verification/2026-11-03-gap020-local.json. Frozen CI/deployment pending; mail policy/settings unchanged.
- Next: release020, then merge a final documentation-only records update with its actual deployment evidence and installer result.20 source/proof stash0394d713416a3460cc3d3e5b69c04b691fb20935 and work/gap020-source.patch. Maincc07f17 gates CI41614597818/CodeQL41614597819 are running; watch work/gap019-main-ci-watch.log. After those exact-main gates pass, dispatch existing install-customer-modules.yml apply=yes with optional actions unchanged for commercial0006–0009. Owner environment review remains mandatory. Verify actual registry5→9; real-use stays12. Do not duplicate0011/0012 or activate providers.
- Preserve three open Dependabot PRs230–232 and historical unfinished branches. Budget at most8 distinct Git branches including main. Retire only exact merged heads with no open PR/environment binding; preserve stashes for unfinished work.

## Continuing constraints and owner steps

- Real admission is enabled under ADR056 with scanning deferred. Preserve customer/staff identity separation, MFA, RLS, resource revocation, immutable evidence/events and exact money. Gates D01–D06/D08 remain deferred/closed; outreach, inference, real payments and payouts retain independent prerequisites.
- Real UEN completed in install49. GST registration status/number, payment instructions and finance label remain marked made up; D3 refuses real invoices. No real payment provider exists.
- Production switch observations, accepted language reviews, earlier install runs, Pulse owner questions and other retained owner decisions are preserved verbatim in the [previous ledger](v3/history/ledger-before-gap-repairs-2026-11-02.md). The source audit is in the [immutable baseline](qa/current-plan-gaps/baselines/2026-11-01/README.md). No legacy broad absence claim is reinstated.
- No direct production database access or arbitrary provider activation. Additive SQL uses the existing reviewed installer; the owner's environment approval is separate from code deployment. Main deploys itself (ADR050); verify it before any manual deployment.

## Requirements and history

- [507 requirement identities](v3/phase-0/requirements.json), [history manifest](v3/history/manifest.json), [bounded context](v3/CONTEXT.md), [known issues](v3/KNOWN_ISSUES.md). The previous ledger links all older exact archives; nothing was discarded.

Live visibility: alias revision is verified; anonymous page probes hit a proxy CONNECT403 after redirect to c.obsidianglobal.studio. No signed-in live journey pass is claimed.
