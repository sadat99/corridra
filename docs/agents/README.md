# Shared agent protocol

Claude Code and Codex share this repository, not memory. Both start with the existing [developer handoff](../START_HERE.md) and compact [current ledger](../V3_LEDGER.md). The ledger owns live state; the [current plan](../implementation/current-plan.md) owns work order; the contract and governing product vision own requirements. Historical next-step prose is not current instruction.

1. Inspect current main, working changes and open PRs before editing. Read the latest ledger before each chunk and update it afterward. Consult relevant work-log/history entries for affected work or conflicts rather than loading the entire log or ten unrelated entries.
2. Read the full contract and product vision once per session before substantive product changes. Follow relevant ADR/module/nested instructions and [UI direction](ui-direction.md) for every visible change. Preserve original supplied documents.
3. Work in one bounded concern: files, risks, existing/new behavior, requirement IDs, positive/denial/recovery checks. Existing backend and authority are not UI scope. Never fabricate controls or outcomes.
4. Keep fewer than nine Git branches. Run the branch-budget script before publishing; preserve open dependencies, bound environments and unfinished work. Use the existing checkout; no worktree unless requested. Never overwrite another active branch or force shared history.
5. Append your own [work-log](work-log.md) entry and update the ledger in the same PR. When one run ships several PRs, only the last PR updates the ledger, with its records commit last. Never rewrite another agent's entries. Preserve exact dated documents when reorganising guides. When a plan or proposal is finished, replaced or approved, change its `Document status:` word in the same PR and update the [plan status register](../PLAN_STATUS.md). If decisions conflict, the latest decision wins among sources that can decide (`node scripts/authority.mjs`); only when the dates are equal or unknown, record both positions and leave the choice to the owner.
6. Report exact commands, process exits, source/environment and observed limits. Old tests, component fixtures and anonymous responses do not prove actual managed-provider acceptance. Keep designed, implemented, tested, deployed, enabled and commercially approved separate.
7. All required checks and security/privacy/money/readiness constraints remain binding. Read [deployment and rollback](../runbooks/deployment.md) before release. Use one saved-output CI watcher; never skip required checks to save tokens.

## Work-log entry

Record request, why, changed files/behavior, exact verification and omissions, preserved contracts, decisions/risks, next action, and PR/tested head. Append a correction if earlier evidence is superseded; do not silently replace failures or another agent's history.

The [master-plan pointer](master-plan.md),[working product summary](product-vision.md),[documentation catalogue](../documentation-map.md) and [bounded-context workflow](../v3/CONTEXT.md) provide targeted navigation. The original protocol is preserved in the history manifest.
