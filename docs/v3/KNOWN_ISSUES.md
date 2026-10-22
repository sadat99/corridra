# Known issues and lessons

Read this before debugging CI or deciding who may merge. Add an entry when a failure takes more than one run to explain. Each entry gives what was seen, the cause (proven or inferred), the fix and how to avoid a repeat. Dates are 2026, UTC.

## CI and test failures

### KI-01 Scoped delivery test red on about half of runs (fixed)

- **Seen (22 Oct):** `operator (3)`, `tests/operator/workspace.spec.ts`, scoped delivery test, a 180 s wait on the workspace read. Main CI39800962758 on the PR132 merge, then PR133 and PR134 heads.
- **Cause, proven in one run (39842482886):** the MFA verify returned `429 Too many requests`. Sign-in and `/two-factor/*` are limited to 5 per 60 s with database storage (`packages/auth/src/index.ts:59-69`), and the operator tests run serially, so counters from earlier sign-ins can still be live. **Inferred, not traced:** the shared test address is the counter key. Earlier failures had the same signature but did not print the status.
- **Fix:** PR134 (`becb052`). The test clears `identity."rateLimit"` in the browser-test database before its sign-in and throws the verify status and error body. Main CI was green on `becb052`, `c23ea62` and `62205d2`. The limiter is unchanged.
- **Avoid:** print the failing response status before naming a cause. If another test returns 429, give it the same reset. Never raise a limit or disable the limiter to pass a test.

### KI-02 `operator (2)` cancelled on main (open, unexplained)

- **Seen (22 Oct):** main CI39800962758, cancelled after about 28 minutes in its Browser runtime step; no test ran. Not seen again in any run read since.
- **If it recurs:** record the step timings and re-run the job once. Do not change tests for it.

### KI-03 `validate` red right after a push (not a failure)

- **Seen:** PR134 heads `e2c485f` and `40803ce`. `validate` rolls up every job, and a newer push cancels the older run, so the roll-up shows red.
- **Avoid:** read the run conclusion first. `cancelled` on a superseded head needs no action; only the current head matters.

### KI-04 Two wrong causes written as facts (process)

- **Seen:** for KI-01, tenant ordering (`tenants[0]`) was named as the cause and a ported fix changed nothing; then the cause was left open. Four CI cycles of about 15 minutes were spent.
- **Avoid:** state a root cause only after a run prints the evidence. Push a diagnostic first, then fix.

## Process and tooling

### KI-05 CI logs are hard to reach

- `gh run view --log-failed` returned 403 in the cloud session, and the failure artifact excludes `test-results/workspace-*`.
- Use the GitHub MCP `get_job_logs` with `tail_lines` near 130 so the failure message is included. The operator suite needs Docker, which the cloud container lacks, so CI is the proof; push a diagnostic instead of guessing.

### KI-06 Oversized tool output

- `list_workflow_jobs` returned tens of thousands of tokens for one run. Use `pull_request_read` with `get_check_runs` for status and `get_job_logs` for one job. Never list all jobs of a run.

### KI-07 Two sessions on one area

- Two sessions fixed the same test and edited the same ledger and work-log lines at once, and the PR132 receipt branch cited only pre-merge CI.
- Fetch main and open PR metadata before editing and check other branches for the same file. Record main CI of the merge commit, not only the PR CI, before calling a change released.

### KI-08 Merge authority

- An agent merged its own PR without a human review and the auto-mode classifier then blocked the next command.
- **Owner decision, 22 Oct 2026 (chat):** agents commit, merge and deploy their own PRs without asking once required checks are green on the exact head. This never covers real operations, provider activation, or bypassing a check or gate.

### KI-09 Always-read cap

- CLAUDE.md, AGENTS.md, START_HERE and the ledger had 1.5 KB of headroom under a 32 KiB cap. The owner raised the cap to 36 KiB on 22 Oct 2026. Condense or archive before raising it again. The ledger keeps its own 12 KiB cap.

### KI-10 Connector disconnects

- MCP connectors disconnect and reconnect during a session and tool schemas must be loaded again. Reload with `ToolSearch select:` after a reconnect notice; do not search for tools while the server is disconnected.

### KI-11 Buttons and links badly spaced on phones (open)

- **Seen (owner screenshots, 22 Oct):** on `/contributor` and `/signin` at 390 px, stacked outlined links have different widths and almost no gap, and a wrapped row (`Team sign-in`, `Start page`, `Local helper tasks`, `Plan a mission`) is ragged.
- **Cause:** action groups have no shared layout rule; each link sizes to its text.
- **Fix:** AC1-02 shared action primitives. See the ledger for the package status.
