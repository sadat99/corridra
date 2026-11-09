# Corridra developer entry

Follow [AGENTS.md](AGENTS.md), applicable nested instructions and the shared [developer handoff](docs/START_HERE.md).

Start with `git status --short`, fetch main and open PR metadata, then `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`. The ledger is current state; historical plans and old next-task prose are not.

Before substantive product work, read the full V3 contract and governing product vision once in the session. Query affected requirements and relevant ADR/module/UI instructions before editing. Preserve all original actions, authority, sources, exact money/history and closed real-operation gates. Never infer acceptance from a plan, deployed code or old test totals.

Record exact verification and next action in the ledger/work log. Do not load full archives, PR diffs or unrelated logs to resume. All release checks remain required.

Token discipline: classify the task, then read by `node scripts/v3-context.mjs budget|outline|section` and run long checks through `node scripts/gate.mjs`, as in the [token playbook](docs/v3/CONTEXT.md). Never load the work log, documentation map, archives or requirement register whole. Before debugging CI read [known issues](docs/v3/KNOWN_ISSUES.md).

Session rotation: follow [session rotation](docs/agents/session-rotation.md); rotate at 250k tokens, or 150k after a finished unit of work.

Agent squad: for build, fix, review or record work use the `corridra-squad` skill. Every run starts with the `corridra-authority` agent and carries its stamped brief; no agent acts on a plan the brief does not list under FOLLOW. **Codex follows the owner's later lean-work exception in `AGENTS.md`: no subagents unless explicitly requested.**

Owner,3 Nov2026: continue approved batches sequentially; merge after checks, verify release and update docs after each merge. AGENTS.md records this bounded exception and unchanged disclosure, protected review, activation/provider and payment controls.
