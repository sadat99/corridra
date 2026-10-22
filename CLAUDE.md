# Corridra developer entry

Follow [AGENTS.md](AGENTS.md), applicable nested instructions and the existing shared [developer handoff](docs/START_HERE.md).

Start with `git status --short`, fetch current main/open PR metadata, then `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`. The compact ledger is current state; historical plans and old next-task prose are not.

Before substantive product work, read the full V3 contract and governing product vision once in the session. Query affected requirements and relevant ADR/module/UI instructions before editing. Preserve all original actions, authority, sources, exact money/history and closed real-operation gates. Never infer acceptance from a plan, deployed code or old test totals.

Record exact verification and next action in the shared ledger/work log. Do not load full archives, full PR diffs or unrelated logs merely to resume. All mandatory release checks remain required.

Token discipline: classify the task, then read by `node scripts/v3-context.mjs budget|outline|section` and run long checks through `node scripts/gate.mjs`, as in the [token playbook](docs/v3/CONTEXT.md). Never load the work log, documentation map, archives or requirement register whole.
