# Working on Corridra

Unqualified Part 1, Part 2 and subsequent part numbers refer to the revised five-part V2 roadmap. The original twelve-part V1 plan is historical: V1 Parts 1–8 remain the accepted baseline. Follow the latest explicit V2 packet; do not resume V1 Parts 9–12 automatically. Revised V2 Part 4 combines governed AI and the Commercial Execution Network. All five V2 parts were subsequently implemented and merged. UX-01 through UX-05 are merged with bounded UX-06/access repairs; full programme coverage remains unverified. Use `docs/implementation/current-plan.md` for current status, not historical next-task prose.

For V2 work, read `docs/architecture/multi-corridor-v2.md` first. Reuse existing domain services and versioned data; never add country-specific forks, infer compliance approval, weaken RLS or historical money/evidence rules, or activate unapproved real customer-data flows.

Read `docs/START_HERE.md`, `docs/implementation/current-plan.md`, `docs/implementation/implementation-matrix.json`, `docs/verification-guide.md`, the relevant supplied documents, ADRs and module documentation before editing. The V1 plan is retained historical requirements, not the active execution sequence. The source uploads are reference material; follow the user's explicit task when it conflicts with them. Keep originals in `docs/source/` immutable. Working-copy edits require a documented amendment and corresponding integrity checks.

Build only the requested part or PR-sized task packet. Follow the canvas module boundaries, evidence distinctions, canonical states, tenant isolation, event/outbox and append-only money rules. Material changes to these contracts require an ADR. Do not infer a different architecture from nearby code.

New public copy must sound natural, use concrete wording and contain no em dashes. Do not invent coverage, buyers, claims, contact addresses, testimonials or verification. Describe upcoming capabilities as upcoming. Every link or form must perform the action it promises.

Never print credentials or production personal information. Use secure settings for values, separate production/preview credentials and sanitized non-production data. Never bypass authorization/RLS to make tests pass. AI cannot control permission, money, verified facts or legal decisions.

Use the existing isolated checkout. Do not create a Git worktree unless explicitly requested. Use short-lived PR branches and the release gates in the current plan. The owner authorizes correct checked merges and immediate deployment of their exact merged revisions without another approval. This does not authorize real operations, provider activation or bypassing checks. Main Git auto-deployment is disabled; verify an explicit deployment is READY and serves the intended revision. Do not bypass existing branch protection or force-push shared history.

The owner authorizes routine deletion of completed temporary Neon branches after required checks and sanitized evidence are preserved. Inspect exact project/branch IDs, parents, children, current PR status and environment bindings first. Remove only retired preview settings, verify deletion and production health, and preserve production/default branches, sterile parents, open-PR environments and branches needed for unfinished work. Clean up at the end of each task; this is not a background scheduler. Never infer disposal from age or a name alone.

The owner requires fewer than nine Git branches, including main (at most eight, tightened from ten on 2026-10-15), and wants branches deleted once they no longer affect the system (merged, no open PR, no environment binding). Before creating/publishing product Git branches, run `node scripts/check-git-branch-budget.mjs <branch>` and preserve all open dependency PRs as subsequently instructed. If those requirements conflict, report the actual count and resolve the constraint before publishing; complete and validate useful updates before merging; never discard open PRs or delete unfinished work to make the count pass. Managed Neon preview and recovery creation must also refuse an eleventh branch. Perform cleanup after each accepted task and retain the live synthetic environment and sterile template.

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e` for this public release. Add meaningful behavior tests when changing flows. Real database integration/RLS tests and the protected operator browser suite are mandatory for the existing database-backed application; do not add empty passing suites to imply readiness.

Report implemented behavior, actual test results, deployment evidence and concrete blockers. A built bundle is not a public deployment. Do not proceed to the next product part unless the user requests it.

## Two coding agents, one product

Claude Code and Codex both work in this repository and share no memory beyond it. Read [docs/agents/README.md](docs/agents/README.md), the [master plan](docs/agents/master-plan.md) and the governing [product vision v2.1](docs/product/corridra-product-vision-v2.1.md) with its [working summary](docs/agents/product-vision.md) (what Corridra is, for whom and why) before starting. Follow [docs/agents/ui-direction.md](docs/agents/ui-direction.md) for every visible change, and append an entry to [docs/agents/work-log.md](docs/agents/work-log.md) and update the master plan if the plan changed, in the same PR before finishing, stating what changed, why, how it was verified and what was not. Never rewrite the other agent's entries. If you disagree with an earlier decision, record both positions and leave the choice to the owner.

# V3 execution rules

- Source of truth: docs/V3_CONTRACT.md (spec) and docs/V3_LEDGER.md (state). Re-read the ledger at the start of every work chunk, update it at the end. Never rely on chat memory.
- Search before reading: use rg and targeted line ranges. Never cat large files or re-read unchanged ones.
- Never claim done without command output proving it (tests, typecheck, build, route check). Quote the result in the ledger.
- Never edit, skip or weaken a test to make it pass. Never fake data, KPIs, AI output or controls. A UI control without a working backend is marked MISSING, not shipped.
- Never change auth, RLS, migrations history, money or event records without stating the blast radius first. Migrations are additive only.
- Synthetic-only gates (D01-D06, D08) stay closed. No real outreach, payments or live data.
- Same mistake twice: add one line here.
- Use discovered file paths and navigation IDs in inventories and verification; never guess them.
- After a patch context mismatch, read the exact target lines before retrying.
- Before publishing, verify the Git author matches the authenticated repository owner and established accepted release identity; correct inherited local configuration forward without rewriting pushed history.
- After a missing path or unsupported CLI field, inspect available paths/fields before retrying; never substitute another guessed name.
- Verify rendered accessible names, including descriptive descendants, before writing exact navigation selectors; preserve every behavior and denial assertion when correcting a driver.
- Derive cleanup counts from the verified ID lists after all safety exclusions; never reuse pre-exclusion totals.
- Use `set -e` for multi-step verification and publishing commands; a later success must never mask an earlier failure.
- Use discovered database names and explicit project/branch/role IDs; never assume a provider's default database.
- Check `isError` and the parsed provider result before reporting a mutation as successful; an unparsed response is not proof.
- Preserve managed proxy/TLS settings and set `NODE_USE_ENV_PROXY=1` for Node network calls; do not retry direct DNS.
- Mount effects start external work; update React state from settled async callbacks or user events, not synchronous mount helpers.
- Discover read paths with `rg --files` before passing them to `sed` or `rg`; stop a read batch at a missing path instead of continuing with guessed names.
