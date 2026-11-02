# V3 execution ledger

Source of truth: [contract](V3_CONTRACT.md), this live-state index and [gap register](qa/current-plan-gaps/README.md). Latest applicable owner decisions win; dated reports alone do not establish current acceptance.

## Resume immediately

- Owner, 2 Nov 2026: keep Codex lean; reuse existing work, requested changes only, no subagents unless asked, minimum necessary checks. Permanent rule: root AGENTS.md; overrides mandatory squad routing for Codex.
- Owner authorizes fixing GAP-001 through GAP-021 except language items GAP-008, GAP-013, GAP-014 and GAP-021. Work one item at a time, commit, merge after matching-head green CI, verify automatic main deployment, and update this handoff and the current findings register after each. This supersedes per-PR confirmation and last-PR-only records for this bounded sequence, not unrelated work or external controls.
- PR229 merged as b336c9a; Vercel deployment dpl_2SCym9bScarxmrjWLvEf6MJGHMHD READY for that SHA. All PR229 checks passed. Baseline audit/raw evidence remains immutable; its observations are dated, not re-accepted product capabilities.
- Active branch: fix/gap-001-request-notifications, base b336c9a, [PR233](https://github.com/sadat99/corridra/pull/233). Implementation committed as 9669909; exact-head quick preflight passed, exit0 (work/gap001-preflight-2026-11-02T08-17-11-852Z.log.receipt.json). CI pending: inspect the current PR head and ignore superseded runs. No production repair released yet.
- GAP-001 implemented locally: additive commercial-readiness 0002 records an inbox receipt for the verified request owner in the submitting transaction; event keys deduplicate retries. Existing receipt mail is reused unchanged. Anonymous submissions do not supply an inbox recipient until verified claim. Savepoint isolation preserves submitted work if notification infrastructure is unavailable; replay can recover the inbox receipt. Protected installation and production acceptance remain pending.
- Verification: 23 PostgreSQL tests passed in three files, exit0 (work/gap001-database-final-2026-11-02T08-11-42-753Z.log.receipt.json); focused package typecheck and lint passed; document/context/squad tests passed, exit0. Details: [local evidence](qa/current-plan-gaps/verification/2026-11-02-gap001-local.json). Frozen CI, installation and release pending.
- Next: finish GAP-001 tests and CI, publish its focused PR (including this lean-rule record), merge when green, verify exact-SHA deployment, and start the protected installer only after main CI and CodeQL pass. The owner reviews the install environment. Then GAP-002. Do not mark GAP-001 resolved while installation/activation acceptance is missing.
- Branch budget: three open Dependabot PRs 230–232 preserved. Completed branches retired only after merge/history and no-environment checks; historical PR132 receipt and merged PR214 repair retained as archive tags. No production/Neon settings or data changed.

## Continuing constraints and owner steps

- Real admission is enabled under ADR056 with scanning deferred. Preserve customer/staff identity separation, MFA, RLS, resource revocation, immutable evidence/events and exact money. Gates D01–D06/D08 remain deferred/closed; outreach, inference, real payments and payouts retain independent prerequisites.
- Real UEN completed in install49. GST registration status/number, payment instructions and finance label remain marked made up; D3 refuses real invoices. No real payment provider exists.
- Production switch observations, accepted language reviews, earlier install runs, Pulse owner questions and other retained owner decisions are preserved verbatim in the [previous ledger](v3/history/ledger-before-gap-repairs-2026-11-02.md). The source audit is in the [immutable baseline](qa/current-plan-gaps/baselines/2026-11-01/README.md). No legacy broad absence claim is reinstated.
- No direct production database access or arbitrary provider activation. Additive SQL uses the existing reviewed installer; the owner's environment approval is separate from code deployment. Main deploys itself (ADR050); verify it before any manual deployment.

## Requirements and history

- [507 requirement identities](v3/phase-0/requirements.json), [history manifest](v3/history/manifest.json), [bounded context](v3/CONTEXT.md), [known issues](v3/KNOWN_ISSUES.md). The previous ledger links all older exact archives; nothing was discarded.
