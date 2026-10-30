# Working on Corridra

Unqualified Part 1, Part 2 and subsequent part numbers refer to the revised five-part V2 roadmap. The original twelve-part V1 plan is historical: V1 Parts 1–8 remain the accepted baseline. Follow the latest explicit V2 packet; do not resume V1 Parts 9–12 automatically. Revised V2 Part 4 combines governed AI and the Commercial Execution Network. All five V2 parts were subsequently implemented and merged. UX-01 through UX-05 are merged with bounded UX-06/access repairs; full programme coverage remains unverified. Use `docs/implementation/current-plan.md` for current status, not historical next-task prose.

For V2 work, read `docs/architecture/multi-corridor-v2.md` first. Reuse existing domain services and versioned data; never add country-specific forks, infer compliance approval, weaken RLS or historical money/evidence rules, or activate unapproved real customer-data flows.

Start with the existing shared `docs/START_HERE.md` and compact `docs/V3_LEDGER.md`. Read the full V3 contract and governing product vision once per session before substantive product implementation. Then inspect affected requirement IDs and relevant current-plan, matrix, verification, ADR and module sections before editing; do not load whole historical plans or unrelated logs merely to resume. The V1 plan is historical, not the active sequence. User instructions govern conflicts. Keep originals in `docs/source/` immutable; working-copy amendments require traceable preservation and integrity checks.

Build only the requested part or PR-sized task packet. Follow the canvas module boundaries, evidence distinctions, canonical states, tenant isolation, event/outbox and append-only money rules. Material changes to these contracts require an ADR. Do not infer a different architecture from nearby code.

New public copy must sound natural, use concrete wording and contain no em dashes. Do not invent coverage, buyers, claims, contact addresses, testimonials or verification. Describe upcoming capabilities as upcoming. Every link or form must perform the action it promises.

Never print credentials or production personal information. Use secure settings for values, separate production/preview credentials and sanitized non-production data. Never bypass authorization/RLS to make tests pass. AI cannot control permission, money, verified facts or legal decisions.

Use the existing isolated checkout. Do not create a Git worktree unless explicitly requested. Use short-lived PR branches and the release gates in the current plan. Open draft PRs only. The owner gives a merge command for each PR (owner decisions 2026-10-25 and 2026-10-29, which replaced the earlier standing authorization for agents to merge and deploy their own PRs). Without his command, do not merge, dispatch workflows, change production settings, call providers or redeploy. Nothing here authorizes real operations, provider activation or bypassing checks. Main Git auto-deployment is on (owner decision, 2026-10-20): a merge to main deploys itself, so do not deploy by hand. Verify the deployment for the merged SHA is READY and serves the intended revision; deploy the exact merged SHA explicitly only if a merge did not deploy. Do not bypass existing branch protection or force-push shared history.

The owner authorizes routine deletion of completed temporary Neon branches after required checks and sanitized evidence are preserved. Inspect exact project/branch IDs, parents, children, current PR status and environment bindings first. Remove only retired preview settings, verify deletion and production health, and preserve production/default branches, sterile parents, open-PR environments and branches needed for unfinished work. Clean up at the end of each task; this is not a background scheduler. Never infer disposal from age or a name alone.

The owner requires fewer than nine Git branches, including main (at most eight, tightened from ten on 2026-10-15), and wants branches deleted once they no longer affect the system (merged, no open PR, no environment binding). Before creating/publishing product Git branches, run `node scripts/check-git-branch-budget.mjs <branch>` and preserve all open dependency PRs as subsequently instructed. If those requirements conflict, report the actual count and resolve the constraint before publishing; complete and validate useful updates before merging; never discard open PRs or delete unfinished work to make the count pass. Managed Neon preview and recovery creation must also refuse an eleventh branch. Perform cleanup after each accepted task and retain the live synthetic environment and sterile template.

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e` for this public release. Add meaningful behavior tests when changing flows. Real database integration/RLS tests and the protected operator browser suite are mandatory for the existing database-backed application; do not add empty passing suites to imply readiness.

Report implemented behavior, actual test results, deployment evidence and concrete blockers. A built bundle is not a public deployment. Do not proceed to the next product part unless the user requests it.

## Two coding agents, one product

Claude Code and Codex share repository memory. Use [the existing handoff](docs/START_HERE.md), [agent protocol](docs/agents/README.md) and compact ledger for continuation; [the master plan](docs/agents/master-plan.md) points to one current work sequence. The governing [product vision v2.1](docs/product/corridra-product-vision-v2.1.md) and [working summary](docs/agents/product-vision.md) retain product meaning. Follow [UI direction](docs/agents/ui-direction.md) for every visible change. Append your work-log entry and actual ledger results in the same PR, with preserved contracts, limits and next action. Never rewrite another agent's entries. Record both positions on a conflict and leave the choice to the owner. Dated plans remain exactly archived; they are not current acceptance.

# V3 execution rules

- Source of truth: docs/V3_CONTRACT.md (spec) and docs/V3_LEDGER.md (state). Re-read the ledger at the start of every work chunk, update it at the end. Never rely on chat memory.
- Search before reading: use rg and targeted line ranges. Never cat large files or re-read unchanged ones.
- Never claim done without command output proving it (tests, typecheck, build, route check). Quote the result in the ledger.
- Never edit, skip or weaken a test to make it pass. Never fake data, KPIs, AI output or controls. A UI control without a working backend is marked MISSING, not shipped.
- Never change auth, RLS, migrations history, money or event records without stating the blast radius first. Migrations are additive only.
- Synthetic-only gates (D01-D06, D08) stay closed. No real outreach, payments or live data.
- Same mistake twice: add one line here.
- Copy each new read path from discovery output; never expand a numbered migration prefix into a guessed filename.
- Run repository context/lint/type helpers from the repository root; run the Next application build from apps/web.
- Discover connector names with a bounded result first; shared description boilerplate can match every tool and defeat filtering.
- Use discovered file paths and navigation IDs in inventories and verification; never guess them.
- After a patch context mismatch, read the exact target lines before retrying.
- Identity: branch commits are authored as `Claude <noreply@anthropic.com>` (set once in the clone's local git config; the session stop hook requires it and previews deploy fine). What is published on main is the squash commit GitHub creates when the owner's account opens and merges the PR, so it carries the owner identity. Before publishing, verify that squash commit on main shows the owner; correct inherited local configuration forward without rewriting pushed history.
- After a missing path or unsupported CLI field, inspect available paths/fields before retrying; never substitute another guessed name.
- Verify rendered accessible names, including descriptive descendants, before writing exact navigation selectors; preserve every behavior and denial assertion when correcting a driver.
- Select country/workspace controls by the rendered combobox role/name; exact label text can include option descendants even when the computed accessible name does not.
- Select controlled textareas by rendered textbox role/name; exact label text can include the current textarea value.
- Derive cleanup counts from the verified ID lists after all safety exclusions; never reuse pre-exclusion totals.
- Use `set -e` for multi-step verification and publishing commands; a later success must never mask an earlier failure.
- Use discovered database names and explicit project/branch/role IDs; never assume a provider's default database.
- Check `isError` and the parsed provider result before reporting a mutation as successful; an unparsed response is not proof.
- Preserve managed proxy/TLS settings and set `NODE_USE_ENV_PROXY=1` for Node network calls; do not retry direct DNS.
- Mount effects start external work; update React state from settled async callbacks or user events, not synchronous mount helpers.
- Discover read paths with `rg --files` before passing them to `sed` or `rg`; stop a read batch at a missing path instead of continuing with guessed names.
- Use `set -euo pipefail` in batched commands with pipelines so a failed search producer cannot be concealed by a successful filter.
- Distinguish inventory entries from unique source files; compare against the stated baseline and inspect changed paths before claiming file preservation.
- Do not count connector/share-link authentication errors as application permission-denial evidence; verify the actual application response separately.
- Under pipefail, bound output with sed -n rather than head so SIGPIPE cannot abort a verification batch.
- Assert each scripted replacement matched before writing; a silent no-op must not start verification.
- Derive live API probe URLs from the actual handler/action inventory; a directory name alone is not an endpoint.
- Build live API probe paths from discovered route files before execution;verify header directives when production frameworks add stricter cache-control values.
- Rebuild after adding routes before production route checks; next start serves the prior compiled route manifest even when source files exist.
- Collect ephemeral sandbox command stdout before stopping it;nonpersistent stopped sessions cannot serve command logs.
- A filename mentioned only in a handoff summary is not a discovered path; confirm it with `rg --files` before opening it.
- Verification receipts must use each process exit code; a later successful command or an incomplete log excerpt cannot establish an earlier pass.
- Concurrent Playwright runs must use distinct --output paths; different server ports do not isolate their artifacts.
- Keep live-probe stdout compact and map indexed results to the versioned path inventory so connector string limits cannot truncate release evidence.
- Register each new private API in the framework private-header overrides before checking the compiled route; handler headers alone can be overridden.
- Discover customer migration directories with `rg --files packages/db`; never infer a directory from a module name.
- After pnpm metadata drift, use the explicit CLI warn option or pinned installed executables; an environment-only option did not suppress bootstrap in this managed runtime.
- Print the failing response status before naming a CI root cause; two guessed causes cost four CI cycles (docs/v3/KNOWN_ISSUES.md KI-01, KI-04).
- Check events carry a `head_sha`. If it is not the head you last pushed, the event is stale: ignore it silently and do not report it. CI now skips `validate` on cancelled runs (KI-03), so this should be rare.
- Run the UX gate against a production build, never `next dev` (KI-18): the dev server gives seven false failures.
- Operator browser tests share one auth rate limit (5 per 60 s on sign-in and two-factor); a test that signs in after many others clears `identity."rateLimit"` in the browser-test database. Never raise a limit.
- Use `get_check_runs` and `get_job_logs` with `tail_lines` near 130; `list_workflow_jobs` returns tens of thousands of tokens.
- In the cloud container set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` for e2e, ux and operator runs; hundreds of failures at a few milliseconds mean the browser did not launch. `next dev` rewrites `apps/web/AGENTS.md`, and the local operator suite rewrites tracked evidence images; restore them before committing. The suite runs locally on native PostgreSQL 16 (docs/v3/KNOWN_ISSUES.md KI-15).
- Read docs/v3/KNOWN_ISSUES.md before debugging CI and add an entry when a failure takes more than one run to explain.

## Bounded V3 context

- Keep the existing shared handoff continuously resumable: update the ledger at meaningful checkpoints, before long waits and before stopping or switching branches. Record exact branch/base, dirty files, implemented versus planned scope, running checks, blockers and the next concrete action. Push reviewable checkpoints; never claim a pending or unverified capability shipped. Do not create competing handoff documents.

- Start every work chunk with `node scripts/v3-context.mjs`; follow `docs/v3/CONTEXT.md`. Keep the active ledger within 12 KiB and preserve older evidence in linked, hashed archives before retiring it from the active index.
- Read the full contract once per new session; check its hash and reread changed or relevant sections afterward. Reuse unchanged skills already read in the session. This never waives governing instructions or required verification.
- Query only affected requirement IDs or one historical chunk. Never print full historical ledgers, PR diffs, raw provider configurations or tool catalogues for routine status work.
- Set tool output budgets and select fields before execution. Save full logs to work/; report exact exits, final totals, relevant failures and evidence paths. Use one `gh run watch RUN --exit-status --interval 60` process with output saved locally instead of repeated model-driven polling.
- Artifact downloads can return signed URLs. Keep them out of tool output; print only artifact IDs, file IDs, names and byte counts, then download through the file reference.
- Read by outline: `node scripts/v3-context.mjs outline|section|budget|status --since SHA8`, and run long checks with `node scripts/gate.mjs NAME -- COMMAND` (full log and receipt in work/, exact exit code). The playbook in `docs/v3/CONTEXT.md` has the order of steps and the cost table.
- Focus checks during implementation; run all mandatory gates on the frozen revision. Repeat only after relevant changes or failures. Token savings never authorize weakening tests, permissions, data fidelity or release gates.
- Signed-in layout work: fixtures mount components one level deeper than the real page, so use the real-frame audit in [known issues KI-16](docs/v3/KNOWN_ISSUES.md) before restyling; selector pitfalls are in the design-system README section 7a.
