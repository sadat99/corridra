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
- Use the GitHub MCP `get_job_logs` with `tail_lines` near 130 so the failure message is included. The protected operator suite runs locally on a native PostgreSQL 16 (KI-15); CI stays the proof for the exact head.

### KI-06 Oversized tool output

- `list_workflow_jobs` returned tens of thousands of tokens for one run. Use `pull_request_read` with `get_check_runs` for status and `get_job_logs` for one job. Never list all jobs of a run. `actions_list list_workflow_runs` ignores `per_page` and the head_sha filter and returns about 25 full runs (tens of thousands of tokens): use `pull_request_read get_check_runs` instead.

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

### KI-11 Buttons and links badly spaced on phones (fixed for access pages)

- **Seen (owner screenshots, 22 Oct):** on `/contributor` and `/signin` at 390 px, stacked outlined links have different widths and almost no gap, and a wrapped row (`Team sign-in`, `Start page`, `Local helper tasks`, `Plan a mission`) is ragged.
- **Measured cause:** standalone actions were `inline-flex` with auto width. In a block parent they flow inline, so stacked ones sat 0 to 8 px apart at different widths, and the wrapped row mixed baselines (a 16 px stagger on `/signin`). The sign-in form also mixed a 310 px primary with 295 px links.
- **Fix (AC1-02, first slice):** one action-group block at the end of `globals.css`: forms and the "other ways in" grid use equal full-width cells, and page-level actions stack full width on phones with 12 px gaps and share a wrapping row from 640 px. After the fix every action in a group has one width and one edge.
- **Slice 2 (PR138, `7940135`):** the same rule for the gateway and state pages, with action-layout metrics added to the UX gate (stacked actions at least 8 px apart and equal width on phones, row members on one top edge). The gate reports 0 issues on all 42 static routes.
- **Slice 3 (in progress):** signed-in, private and staff pages. A generic rule for actions that share a parent (`main section/div/form/article/li > a|button` with `.text-link`, `.primary-link`, `.secondary-link`, `.button`, `.button-secondary`) makes them full width on phones and gives them a 12 px gap. Containers that already lay out their own row are excluded (`.guide-actions`, `.guide-actions-row`, `.ux-controls-section-heading`); without that exclusion the rule caused horizontal overflow at 390 px on `/plan` and in the controls panel, caught by the protected operator suite.
- **Lesson:** a presentation rule that touches a shared selector must run through the full operator suite before merge; the static UX gate cannot see signed-in layouts. The audit copy used for this (axe wrapper that also measures action geometry) is described in KI-16.

### KI-12 Browser gates fail in milliseconds in the cloud container

- **Seen:** `pnpm test:e2e` and `pnpm test:ux` reported 124 and 42 failures at 2 to 5 ms each. The pinned Playwright wants a Chromium build the container does not have (`chromium_headless_shell-1248`; the container has 1194).
- **Fix:** run with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Mass failures of a few milliseconds mean the browser did not launch, not that the product broke.

### KI-13 Local tooling side effects

- `next dev` rewrites the tracked `apps/web/AGENTS.md`; restore it with `git checkout apps/web/AGENTS.md` before committing, or use `next start` for layout checks.
- `pkill -f "next dev"` matches the shell that runs it; write the pattern as `[n]ext dev`.
- To see the real sign-in form without a database, run `next dev` with `CORRIDRA_NEON_AUTH_ENABLED=true`, a dummy `NEON_AUTH_BASE_URL` of the form `https://ep-x.neonauth.eu-central-1.aws.neon.tech/x/auth`, a 32 character `NEON_AUTH_COOKIE_SECRET` and `APP_ORIGIN` set to the local origin. These are layout-check values only.

### KI-14 Subscription notices are large

- Each "subscription created" PR notice carries about 5,000 tokens of boilerplate. Subscribe once per PR and do not re-subscribe.

### KI-15 Running the protected operator suite locally (no Docker daemon)

- The cloud container has the Docker client but no daemon, and `pnpm db:local` needs one. PostgreSQL 16 server binaries are installed natively and give the same result, about 17 minutes for all 380 tests.
- **Start the database:** run `initdb` as the `postgres` user into an empty directory such as `/tmp/pg54329` (`-U postgres`, a password file, `-A scram-sha-256`), start it with `pg_ctl ... -o "-p 54329 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp"`, and `createdb corridra_test`. Write `.cache/part03-local.json` with four random 32 to 48 byte hex values (`ownerPassword`, `runtimePassword`, `authPassword`, `authSecret`); the owner password must match the one used for `initdb`. Then `pnpm db:prepare-local`.
- **Run:** `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome UX06_EVIDENCE_STAGE=after pnpm test:operator` (the stage must be `baseline` or `after`; any other value captures nothing).
- **Two specs read old commits** (`git show <sha>:path`), so run `git fetch --unshallow` first or they fail with "Command failed: git show".
- **The run rewrites tracked evidence images** under `docs/implementation/evidence` and `docs/v3/phase-4`. Run `git checkout docs/implementation/evidence docs/v3/phase-4` before committing; never commit them.
- The ClamAV scanner tests are vitest integration tests, not part of this suite, and need the Docker scanner; they are not run locally.

### KI-16 Signed-in layouts are only visible through the operator suite

- **Seen (23 Oct):** the UX gate covers 42 static routes. Signed-in screens (customer, delegation, contributor, operator) are mounted as fixtures by `tests/operator/*.spec.ts`, so the static gate cannot measure them, and a real `/account` route cannot render without a session.
- **Method that worked:** a throwaway copy of the operator specs with the axe import swapped for a subclass that also measures action geometry (gap, width, stagger) and writes one line per page and width to `.cache/action-layout/report.jsonl`; run it on the local native PostgreSQL (KI-15). Optionally inject a draft stylesheet with `page.addStyleTag` to prove a rule before building. About 17 minutes for 380 tests.
- **Pitfalls found:** sorting controls by top before left made a row look like a negative gap (compare left edges within an 8 px band); running one test of the serial workspace file alone fails at MFA enrolment because it depends on the earlier test; fixture URLs are `/?mode=...`, not the real routes.
- **Not committed:** the audit copy is a local tool. If it is wanted in CI, add it as an explicit work package with owner approval.

### KI-17 Reused branch after a squash merge hides CI

- **Seen (23 Oct):** after PR138 was squash-merged, new commits on the same branch had the old pre-squash commit in their history. The next PR conflicted with main in every file both touched, so GitHub created no `pull_request` CI run and `get_check_runs` showed only the Vercel comment check.
- **Avoid:** if a PR has no CI checks a minute after opening, check mergeability first (`git merge-tree --write-tree origin/main HEAD`). After any squash merge, restart the branch from main (`git checkout -B <branch> origin/main`) and cherry-pick only the new commit, then `git push --force-with-lease`.
