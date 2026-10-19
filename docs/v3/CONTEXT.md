# Bounded V3 context

The contract and release requirements remain authoritative. This workflow reduces repeated context, not verification.

- Read the full contract at the start of a new session. Within that session, check for changes before rereading it; inspect affected sections when necessary.
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
