# Bounded V3 context

The contract and release requirements remain authoritative. This workflow reduces repeated context, not verification.

- Before substantive product work, read the full contract and governing product vision once in the session. Then check for changes before rereading unchanged content; inspect affected sections as needed. Documentation maintenance preserves these sources and checks its relevant authorities.
- Start every work chunk with `node scripts/v3-context.mjs`. Update the active ledger at the end. Never infer state from chat memory.
- Keep the active ledger within 12 KiB: current source/deployment, active work, blockers, evidence links, next action and recent results. Archive older results forward with exact hashes and links before removing them from the active file.
- The complete current requirement register is `phase-0/requirements.json`. Query only affected IDs: `node scripts/v3-context.mjs requirement V3-02-046`.
- Historical evidence remains in [the archive](history/ledger-through-109.md). Read one entry with `node scripts/v3-context.mjs chunk 109`. Historical results never prove current acceptance.
- Run `node scripts/v3-context.mjs verify` to check archive bytes, contract identity, all 507 requirement identities/text and the active-ledger size limit. Status/evidence/next actions may advance with actual proof.
- Before each tool call, select fields and an output budget. Store full logs locally; return only failure context, process exit code, final totals and evidence paths. Never print full PR diffs, raw tool catalogues or whole historical ledgers for a status check.
- Batch independent reads. Use one CI watcher and compact updates; do not repeatedly invoke the model to poll unchanged stages. Reuse skills already read in this session unless their content changes.
- Run focused checks during implementation and every mandatory release gate on the frozen revision. Repeat after relevant changes or failures. No test, assertion, permission or release gate may be skipped or weakened to save tokens.
- Reserve deeper analysis for authority, auth/RLS, migrations, money, concurrency and preservation. Keep routine edits and progress reports concise.

The helper is read-only and refuses oversized output. It does not replace the original contract, inventories, tests, security controls or release procedure.

## Token playbook

Sizes come from `node scripts/v3-context.mjs budget` (tokens are an estimate of bytes divided by 4). None of this waives a contract read, a test or a release gate.

| Situation                      | Load                                                                                   | Approx. tokens |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------------- |
| Every session                  | CLAUDE.md, AGENTS.md, START_HERE, ledger (`verify` caps the four at 32 KiB)            | 7,000          |
| Product work, once per session | Full contract, product vision v2.1, working summary (owner rule, never skipped)        | 22,000         |
| Visible UI change              | The whole of docs/agents/ui-direction.md, every time (owner rule, 22 Oct 2026)         | 12,200         |
| Resume or catch up on history  | `outline docs/agents/work-log.md --last 5`, then `section` or `--tail` for one entry   | under 1,000    |
| Never load whole               | work-log (267 KB), documentation-map (45 KB), historical archive, requirement register | 0              |

Steps, in order:

1. Classify the task before reading. Documentation, tooling and status work uses the ledger and only its own authorities. Product work adds the contract and vision once. Do not preload guides the task does not touch.
2. Read by outline. `node scripts/v3-context.mjs outline PATH [--last N] [--max-level L]` lists headings with line numbers and byte sizes. `section PATH QUERY [--nth K] [--tail BYTES]` prints one section (a title fragment or a line number from the outline). Use `--tail` for the newest part of a large section. Both refuse paths outside docs/ and the three root guides.
3. For every visible UI change read the whole of docs/agents/ui-direction.md. This is an owner rule (22 Oct 2026); an outline or a few sections never stand in for it. Use `outline` only to find where a rule lives while you work.
4. Re-check the ledger with `status --since SHA8`, using the `ledger-sha8` printed by your last `status`. An unchanged ledger prints two lines instead of the whole index; a changed one prints in full.
5. Run every long command through the gate runner: `node scripts/gate.mjs NAME [--tail N] -- COMMAND ARGS`. It saves the full log and a receipt (exit code, log hash, Git head, changed-path count) under work/ and prints at most 6 KiB: the receipt, final totals, and on failure the first failure lines and the log tail. Its exit code is the command's exact exit code. Printed lines redact credentials; the raw log stays local and ignored. Use `bash -o pipefail -c '...'` when a pipeline is needed, and quote the receipt path in the ledger.
6. Search before reading: `rg -l`, then `rg -n` with a narrow pattern, then `sed -n 'A,Bp'`. Pass field lists and `minimal_output` to GitHub and provider tools. Batch independent calls in one turn.
7. Send broad sweeps (many files, naming conventions, inventories) to one read-only subagent and keep only its conclusion. Keep one writer per file. A subagent starts cold, so give it paths, the question and the output shape.
8. During implementation run focused checks on touched files (`prettier --check`, `eslint` on the file, one test file). Run every mandatory gate once on the frozen revision, and again only after a relevant change or failure.
9. Checkpoint the ledger and work log before long waits so a resumed session costs the 7,000-token start, not a re-read. Report outcomes in two lines: what was done and the next step.
