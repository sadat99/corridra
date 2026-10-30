# Verification and continuation guide

**Document status: CURRENT.** How to reproduce the checks. See the [plan status register](PLAN_STATUS.md).

Use this with [the current plan](implementation/current-plan.md). It lets Claude Code or another developer check the implementation rather than infer completion from planning prose.

## Establish the baseline

Fetch `origin/main`; record the exact SHA, clean/dirty state and open PRs. Read root and nested `AGENTS.md`, [Start here](START_HERE.md), the relevant ADRs and [implementation matrix](implementation/implementation-matrix.json). Compare later commits with the documented baseline. Inspect each matrix code/test path before making a status claim. Test names and release snapshots show where to investigate; they do not prove the current checkout passes.

Use the full immutable source requirements and UX master handoff to identify requirements missing from the matrix. The matrix intentionally groups requirement families. Expand the phase ledger for new routes/actions, audiences, permissions and response states; retain the frozen Gate 0 inventory and its evidence. Review unfinished ledger rows even where the corresponding feature is implemented.

## Reproduce checks safely

Use pinned Node 24.19.0 and pnpm 11.19.0. Follow [development](runbooks/development.md) for loopback PostgreSQL/ClamAV and isolated credentials. Never use an ambient `DATABASE_URL` without verifying its project, branch and role. Do not point mutating browser suites at production.

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm db:prepare-local
pnpm scanner:local
pnpm exec playwright install --with-deps chromium
pnpm check
```

`pnpm check` covers formatting, lint, types, document/infrastructure checks, real database integration, build, public browser and protected operator browser suites. CI also runs security/dependency controls; inspect the actual job outcomes. A skipped or unavailable control remains a limitation. Run browser suites sequentially because they share output directories. Check the configured web-server origins before invoking either suite.

Add focused behavior tests for a substantive change: tenant/role/capability denial, MFA freshness, idempotency, failed response/retry, mounted draft preservation, stale async response, reload and expiry/revocation as relevant. Screenshots alone cannot establish those behaviors. Browser evidence must use invented records and omit passwords, tokens, reset links, authenticator setup and production personal data.

## Inspect the whole journey

| Layer                    | Evidence to collect                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Discovery and navigation | A newcomer finds the right entry; only valid destinations are accepted; back/reload/mobile recovery works           |
| Identity and authority   | Correct audience, verified identity, separate staff MFA, current tenant/permission or exact private capability      |
| UI action and API        | Actual submitted command, duplicate guard, validation, pending/error/success states and honest next action          |
| Domain and database      | Existing service called, RLS/constraints enforced, original records retained, atomic history/outbox and idempotency |
| Projection and recipient | Pinned version, original names/currency/source and permitted disclosure; no invented progress or coverage           |
| Deployment               | Passing exact revision, merged tree, READY deployment/aliases and bounded read-only live observation                |

For signup/reset, distinguish provider response, delivered email, recipient confirmation, private token consumption and subsequent session behavior. PR 46 confirms both reset emails arrived and owner MFA workspace entry; it does not record private completion of those latest reset links. Never request or log a user's credential, code or reset URL to manufacture acceptance.

## Safe change workflow

Select a bounded requirement and write its current behavior/gap before editing. Reuse module boundaries, append-only contracts and versioned configuration. Do not remove an old action because its new panel is inconvenient. Keep permissions in APIs/SQL, preserve last-owner and source-rights checks, and isolate drafts/data by tenant and identity. Record a material contract change in an ADR; UI refactoring alone cannot change domain authority.

Additive migrations require fresh install and populated upgrade tests using the restricted application roles. Check prior migration hashes and original data; never rewrite a deployed migration. Builds do not apply migrations. Use the branch budget and preserve open dependency PRs and unrelated work. No worktree is required or authorized by this guide.

After relevant local checks and full required CI, prepare a reviewable PR with evidence and explicit remaining limits. The owner gives a merge command for each PR (25 Oct 2026, narrowed 29 Oct; this replaced the 22 Oct standing authorization for agents to merge and deploy their own PRs). Agents open draft PRs and do not merge, dispatch workflows, change production settings or redeploy without his command. A merge to `main` deploys itself ([ADR050](adr/0050-main-deploys-itself.md)). Verify production before reporting it. See [deployment](runbooks/deployment.md); this release authority does not activate real operations or providers.

## Reusable developer task

> Read AGENTS.md and docs/START_HERE.md. Fetch the latest main and compare it with the handoff baseline. Audit the requested journey against current-plan.md, implementation-matrix.json, source requirements, applicable ADRs and the full UX10X handoff/ledgers. Report implemented, missing and unverified behavior separately with code/test evidence. Implement only the bounded requested gap using existing domain services and authorization. Preserve originals, exact money, evidence/history, MFA, RLS, configurable corridors and readiness gates. Use isolated synthetic test data; do not activate real operations, outreach, AI, payments or payouts. Run applicable checks, capture sanitized browser evidence and prepare a PR. Do not resume original V1 Parts 9–12 automatically. Follow the current user's release authority and record the exact deployed revision if authorized.
