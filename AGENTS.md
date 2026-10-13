# Working on Corridra

For V2 work, read `docs/architecture/multi-corridor-v2.md` first. Reuse existing domain services and versioned data; never add country-specific forks, infer compliance approval, weaken RLS or historical money/evidence rules, or activate unapproved real customer-data flows.

Read `docs/README.md`, the relevant supplied documents, `docs/implementation/plan-v1.0.md`, relevant ADRs and module documentation before editing. The source uploads are reference material; follow the user's explicit task when it conflicts with them. Keep originals in `docs/source/` immutable. Working-copy edits require a documented amendment and corresponding integrity checks.

Build only the requested part or PR-sized task packet. Follow the canvas module boundaries, evidence distinctions, canonical states, tenant isolation, event/outbox and append-only money rules. Material changes to these contracts require an ADR. Do not infer a different architecture from nearby code.

New public copy must sound natural, use concrete wording and contain no em dashes. Do not invent coverage, buyers, claims, contact addresses, testimonials or verification. Describe upcoming capabilities as upcoming. Every link or form must perform the action it promises.

Never print credentials or production personal information. Use secure settings for values, separate production/preview credentials and sanitized non-production data. Never bypass authorization/RLS to make tests pass. AI cannot control permission, money, verified facts or legal decisions.

Use the existing isolated checkout. Do not create a Git worktree unless explicitly requested. Following the explicitly authorized public bootstrap, use short-lived PR branches and the release gates in the plan. Do not bypass existing branch protection or force-push shared history.

The owner authorizes routine deletion of completed temporary Neon branches after required checks and sanitized evidence are preserved. Inspect exact project/branch IDs, parents, children, current PR status and environment bindings first. Remove only retired preview settings, verify deletion and production health, and preserve production/default branches, sterile parents, open-PR environments and branches needed for unfinished work. Clean up at the end of each task; this is not a background scheduler. Never infer disposal from age or a name alone.

The owner requests fewer than ten branches. Before creating/publishing product Git branches, run `node scripts/check-git-branch-budget.mjs <branch>` and preserve all open dependency PRs as subsequently instructed. If those requirements conflict, report the actual count and resolve the constraint before publishing; do not close open PRs or delete unfinished work to make the count pass. Managed Neon preview and recovery creation must also refuse a tenth branch. Perform cleanup after each accepted task and retain the live synthetic environment and sterile template.

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e` for this public release. Add meaningful behavior tests when changing flows. Real database integration/RLS tests become mandatory when Part 03 introduces a database; do not add empty passing suites to imply readiness.

Report implemented behavior, actual test results, deployment evidence and concrete blockers. A built bundle is not a public deployment. Do not proceed to the next product part unless the user requests it.
