# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md), this live-state index and [gap register](qa/current-plan-gaps/README.md). Latest applicable owner decisions win. Prior full release details and recovery references are preserved exactly in the [hashed ledger snapshot](v3/history/ledger-through-gap012-2026-11-03.md); [manifest](v3/history/manifest.json).

## Resume immediately

- Owner, 2 Nov 2026: keep Codex lean; reuse existing work, requested changes only, no subagents unless asked, minimum necessary checks. Permanent rule: root AGENTS.md; overrides mandatory squad routing for Codex.
- Owner authorizes fixing GAP-001 through GAP-021 except language items GAP-008, GAP-013, GAP-014 and GAP-021. Work one item at a time, commit, merge after matching-head green CI, verify automatic main deployment, and update this handoff and the current findings register after each. This supersedes per-PR confirmation and last-PR-only records for this bounded sequence, not unrelated work or external controls.

- Deployed code: GAP001–007,009–012 and015. Engineering criteria RESOLVED:006/009/010/011/012/015.001–005/007 remain OPEN for private runtime, activation or provider acceptance; READY alone does not prove those stages. Exact PR/head/merge/CI/deployment records are in each gap's existing verification JSON and the snapshot above.
- Latest verified production: PR246 mergee5d3fc62b99121c40cfc1a8d8e359872a66b5b5a, READY dpl_Hkp5oYqXwu9jxqtjJRZkG79iQh4q at corridra.vercel.app.19 checks completed/no failures at24001a3 (CI41595381327/CodeQL41595381331). GAP015 RESOLVED; owner author/zero environment binding verified, merged branch retired. verification/2026-11-03-gap015-release.json.
- SQL installed: commercial0002–0005 (owner-approved41433412607 and41480437108); real-use0011/0012 via corrected41583942337 atd0d1a74. Actual job125744924754 advanced real-use10→12 on3 Nov05:52:05 UTC; activation unchanged. Prior41546213580 skipped the optional module despite success and is preserved. Do not duplicate installation. verification/2026-11-03-gap005-007-schema-install.json.
- Current branch fix/gap-016-team-owner-audit, basee5d3fc6. GAP016 prepared atop015: owner-attributed resend/reset audit; additive SQL0006, restricted auth EXECUTE, existing events unchanged.8 source/two log hashes match29 DB/handler/regression cases and full types. Missing schema returns audit unavailable. Saved stashd56667ff12bd15e3b581c0715ae1e1529ffbc6ee and earlier6808d87179634e5b1f5193b873e1c2abc5fce3e3; updated ledger/archive are part of the next preparation. verification/2026-11-03-gap016-local.json.
- Release016 now, then017/018/019/020 separately.17 originald85164907757adc1d0ad82f604c412bb63020e08;18 originalc07f8f8512e69a0a279852e00a1c63a9090792a3. Updated017–019 combined stash758c56a57f0555427817d9d8c45fd90c6d623ce2 passed62 DB cases/full types/lint; reply-notice failure isolation corrected after reproduced failure. Three-way extract each source slice; preserve parent changes and0006–0009 inventory.20 stash1177c853f8d218b98e6cb55ed17bd3cb58a721c7 passed85 checks/16 browser/lint. Protected commercial0006–0009 installation remains after release; no provider activation.
- Preserve three open Dependabot PRs230–232 and historical unfinished branches. Budget at most8 distinct Git branches including main. Retire only exact merged heads with no open PR/environment binding; preserve stashes for unfinished work.

## Continuing constraints and owner steps

- Real admission is enabled under ADR056 with scanning deferred. Preserve customer/staff identity separation, MFA, RLS, resource revocation, immutable evidence/events and exact money. Gates D01–D06/D08 remain deferred/closed; outreach, inference, real payments and payouts retain independent prerequisites.
- Real UEN completed in install49. GST registration status/number, payment instructions and finance label remain marked made up; D3 refuses real invoices. No real payment provider exists.
- Production switch observations, accepted language reviews, earlier install runs, Pulse owner questions and other retained owner decisions are preserved verbatim in the [previous ledger](v3/history/ledger-before-gap-repairs-2026-11-02.md). The source audit is in the [immutable baseline](qa/current-plan-gaps/baselines/2026-11-01/README.md). No legacy broad absence claim is reinstated.
- No direct production database access or arbitrary provider activation. Additive SQL uses the existing reviewed installer; the owner's environment approval is separate from code deployment. Main deploys itself (ADR050); verify it before any manual deployment.

## Requirements and history

- [507 requirement identities](v3/phase-0/requirements.json), [history manifest](v3/history/manifest.json), [bounded context](v3/CONTEXT.md), [known issues](v3/KNOWN_ISSUES.md). The previous ledger links all older exact archives; nothing was discarded.

Live visibility: alias revision is verified; anonymous page probes hit a proxy CONNECT403 after redirect to c.obsidianglobal.studio. No signed-in live journey pass is claimed.
