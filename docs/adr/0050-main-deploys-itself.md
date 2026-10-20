# ADR-050: A merge to main deploys itself

Status: accepted by the owner on 20 October 2026. It supersedes the restriction in ADR-014 that kept Git auto-deployment held, and the manual-release steps that earlier runbooks derived from it. It does not change any data, consent or gate decision: D01 to D06 and D08 stay closed and the product stays PARTIAL.

## Context

ADR-014 held Git auto-deployment while account controls were unverified, so each release was an explicit deployment of the exact merged SHA. Two working sessions (UX and V3 implementation) now merge to main continuously, and production lagged main after merges. The owner decided that main is production.

## Decision

- `apps/web/vercel.json` no longer sets `"main": false` under `git.deploymentEnabled`. The listed historical feature branches stay off. This is the only switch.
- The Ignored Build Step never skips a production build, so every merge to main, including a documentation-only one, builds and deploys.
- After a merge nobody deploys by hand. Verify the deployment of the merged SHA: READY, region fra1, the four aliases, no alias error, then bounded live checks. Deploy the exact SHA explicitly only when a merge produced no deployment.
- Merging still requires CI and CodeQL success on the exact head. CI is now the only gate between a merge and the live site.

## Consequences

- Main and production stay identical; every merge ships to the live synthetic customer settings.
- Each deployment adds stored function output. The ledger tracks that meter as unverified.
- Rollback of this decision: restore `"main": false`. Rollback of a release: the listed rollback deployments in the ledger.
