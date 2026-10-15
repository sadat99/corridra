# Deployment and rollback

Use the [current plan](../implementation/current-plan.md) for release scope and [verification guide](../verification-guide.md) for evidence. Standing owner authorization permits correctly tested merges and immediate deployment without another approval. It does not waive checks, readiness gates or the prohibition on real operations/providers.

## Exact project and configuration

Repository `sadat99/corridra`; Vercel project `corridra` in the owner-selected team. Confirm account/project IDs before acting. Next.js Root Directory is `apps/web`, with workspace files outside that directory included, Node 24.x, frozen pnpm install, existing package build and Frankfurt `fra1` runtime. The public shell alone needs no secrets; persistent/authenticated features require their existing secure bindings.

`apps/web/vercel.json` explicitly disables automatic Git deployments for `main` and the listed UX branches. **A merge does not deploy itself.** The old commit-author association issue was closed within D07; do not repeat its historical failure as the current cause. Inspect current Git settings before depending on automatic releases.

Never place Vercel/Neon management credentials in application runtime. Keep production, previews and development isolated. Do not log tokens, app environment values, cookies, received links/codes or personal data. Managed proxy credentials may require the supported HTTPS API rather than a CLI that rejects placeholder characters; preserve the inherited proxy and TLS verification.

## Release procedure

1. Verify clean scope, current remote `main`, branch budget and preserved open PRs. Run applicable local checks and inspect full required CI/security/dependency results on the exact reviewed head. Skipped CodeQL is not passed; account-level enforcement remains independently tracked.
2. Prepare a concrete PR containing behavior/docs changes, tests, evidence and limitations. Do not bypass branch protection, force-push shared history or claim an independent review that did not occur.
3. Merge the checked head under current owner authorization. Fetch the merge SHA and verify its full tree matches the tested head, or run checks on the changed merge tree before release.
4. For a migration-bearing release, verify the exact project/branch/roles, prior hashes and populated upgrade checks. Apply only the separately reviewed additive migration with offline administration. **Builds never migrate.** A documentation-only release needs no migration or environment change.
5. Create an explicit production deployment of the exact pushed merge SHA in the verified project/team, using the current supported Vercel tool/CLI/API. With the API, use the repository Git source and full SHA; do not deploy an uncommitted working directory. Inspect current API schemas rather than copying obsolete fields.
6. Wait for actual READY state; verify the deployment's Git SHA, production target, expected region and alias bindings. Confirm `https://corridra.vercel.app` serves the intended release. A build URL or request acceptance is not deployment success.
7. Perform bounded read-only production checks on applicable routes and permission denials. Full browser suites create synthetic records and must stay on disposable loopback/isolated test servers. Any live mutating acceptance must have explicit scope, exact identities/records and safe evidence handling; routine release authority does not authorize real customer operations.
8. Record PR, tested head, CI outcomes, merge SHA, deployment ID/URL/READY, actual observations, limits and precise next action. A prior health/log snapshot is not an ongoing availability guarantee.

Use runtime logs only within a bounded deployment/time query and sanitize them. Capture no personal auth screens, reset URLs, credentials or MFA setup. Current UI/auth entry is documented in [the access guide](v2-access-and-launch.md). Identity mail acceptance is separate from outreach, AI, payments and payouts; leave those operations closed.

## Rollback and cleanup

Disable the affected feature only where that is an existing reviewed control, and promote/redeploy a known compatible revision. Verify alias and behavior afterward. Preserve identities, MFA, original data, histories and additive migrations. A pre-migration application may need a reviewed forward fix; do not down-migrate or drop audit/evidence/financial history.

At task completion, inspect current PR state and exact bindings before retiring only completed temporary Git/Neon previews under `AGENTS.md`. Preserve production/default resources, sterile parents, open dependency PRs and unfinished work. Cleanup is not authorized solely by age or a familiar name.
