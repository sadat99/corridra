# Known issues and lessons

**Document status: CURRENT.** Read before debugging CI. Entries are lessons, newest last. See the [plan status register](../PLAN_STATUS.md).

Read this before debugging CI or deciding who may merge. Add an entry when a failure takes more than one run to explain. Each entry gives what was seen, the cause (proven or inferred), the fix and how to avoid a repeat. Dates are 2026, UTC.

## CI and test failures

### KI-01 Scoped delivery test red on about half of runs (fixed)

- **Seen (22 Oct):** `operator (3)`, `tests/operator/workspace.spec.ts`, scoped delivery test, a 180 s wait on the workspace read. Main CI39800962758 on the PR132 merge, then PR133 and PR134 heads.
- **Cause, proven in one run (39842482886):** the MFA verify returned `429 Too many requests`. Sign-in and `/two-factor/*` are limited to 5 per 60 s with database storage (`packages/auth/src/index.ts:59-69`), and the operator tests run serially, so counters from earlier sign-ins can still be live. **Inferred, not traced:** the shared test address is the counter key. Earlier failures had the same signature but did not print the status.
- **Fix:** PR134 (`becb052`). The test clears `identity."rateLimit"` in the browser-test database before its sign-in and throws the verify status and error body. Main CI was green on `becb052`, `c23ea62` and `62205d2`. The limiter is unchanged.
- **Avoid:** print the failing response status before naming a cause. If another test returns 429, give it the same reset. Never raise a limit or disable the limiter to pass a test.

### KI-02 `operator (2)` stalls in the browser runtime install (explained 23 Oct, mitigated)

- **Seen twice on 23 Oct and 22 Oct, both `operator (2)`:** (1) main run 39800962758, cancelled by the 30-minute job timeout: `playwright install --with-deps chromium` printed its last `apt-get update` line at 15:04:23 and nothing until the cancel at 15:32:10, while the same step took 22 to 38 seconds in the other jobs of that run. (2) PR146 run 39926542807: the same step reached the package download and crawled (a 3.5 MB package took 67 s and was ignored, later ones took minutes) until the 6-minute step timeout. No test ran either time.
- **Cause:** the Ubuntu package mirror on the hosted runner (`azure.archive.ubuntu.com`) is intermittently very slow, at the index step in the first case and at the package download in the second. It is runner infrastructure, not the application or the tests.
- **First mitigation was wrong:** a step timeout stops the step but not the root-owned `apt-get` it started, which kept the dpkg lock; the retry then failed with `Could not get lock /var/lib/dpkg/lock-frontend`. Lesson: never assume a step timeout cleans up a root child.
- **Current mitigation (`ci.yml`, `browser` and `operator` jobs):** a step writes `/etc/apt/apt.conf.d/99-ci-resilience` (15 s HTTP timeouts, 3 retries) so a stalled connection fails inside apt; the first install has `timeout-minutes: 4` and `continue-on-error`; the retry (12 minutes: on PR146 a slow mirror made the retry need almost 6) kills any leftover `apt-get` and `dpkg`, runs `dpkg --configure -a` and installs again. The `browser` and `operator` jobs have a 45-minute limit instead of 30: on PR146 the recovery worked (the retry installed after a stall) but the old 30-minute limit then cancelled the `browser` job, which normally needs about 19 minutes by itself. Not yet seen to pass end to end after a stall.
- **Seen working (23 Oct, PR146):** in the `browser` job the first install stalled to its limit, the retry killed the leftover apt, installed in about 5 minutes and the tests started; the old 30-minute job limit then cancelled that job, which is why the limit is now 45. Later the `operator (3)` retry timed out at 6 minutes one second before Chrome finished, which is why the retry now has 12. The final PR146 head passed every job; whether that run met a stall was not checked.
- **If it recurs:** read the step durations (`list_workflow_jobs`) and the last apt lines; if the retry also fails, the mirror is down and one re-run is the answer. Do not change tests for it.

### KI-03 `validate` red on a superseded head (fixed at source 23 Oct)

- **Seen:** PR134, PR144, PR146. `validate` ran with `if: always()`, so when a newer push cancelled the older run it still rolled up the cancelled jobs and went red on a head nobody cares about, and each report woke the session.
- **Fix:** `ci.yml` now uses `if: ${{ !cancelled() }}`. A cancelled (superseded) run skips the roll-up; a failed job, or a job cancelled by its own timeout, still fails it, so real failures stay red. This takes effect for runs started after the change reaches main.
- **Reading events:** a check event whose `head_sha` is not the PR's current head is stale. Compare it with the head you last pushed and ignore it without comment. Only the current head counts.

### KI-04 Two wrong causes written as facts (process)

- **Seen:** for KI-01, tenant ordering (`tenants[0]`) was named as the cause and a ported fix changed nothing; then the cause was left open. Four CI cycles of about 15 minutes were spent.
- **Avoid:** state a root cause only after a run prints the evidence. Push a diagnostic first, then fix.

## Process and tooling

### KI-05 CI logs are hard to reach

- `gh run view --log-failed` returned 403 in the cloud session, and the failure artifact excludes `test-results/workspace-*`.
- Use the GitHub MCP `get_job_logs` with `tail_lines` near 130 so the failure message is included. The protected operator suite runs locally on a native PostgreSQL 16 (KI-15); CI stays the proof for the exact head.

### KI-06 Oversized tool output

- `list_workflow_jobs` returned tens of thousands of tokens for one run. Use `pull_request_read` with `get_check_runs` for status and `get_job_logs` for one job. Never list all jobs of a run. `actions_list list_workflow_runs` ignores `per_page` and the head_sha filter and returns about 25 full runs (tens of thousands of tokens): use `pull_request_read get_check_runs` instead. Never grep CSS or `apps/web` without excluding `.next`: the compiled stylesheet is one line of tens of thousands of tokens.

### KI-07 Two sessions on one area

- Two sessions fixed the same test and edited the same ledger and work-log lines at once, and the PR132 receipt branch cited only pre-merge CI.
- Fetch main and open PR metadata before editing and check other branches for the same file. Record main CI of the merge commit, not only the PR CI, before calling a change released.
- **Working beside another session (23 Oct, PR147 and PR148):** list the other PR's files before editing (`pull_request_read get_files`) and keep your set disjoint. The shared hot files are `docs/V3_LEDGER.md` (cap 12 KiB: change one line, never reflow), `docs/agents/work-log.md` (append-only, so two appenders always conflict at the end: whoever merges second merges main in and keeps both entries), `tests/ux/ux-baseline.json` and `docs/documentation-map.json` (add entries, never reorder). The session that merges first owns the main; the other merges main in, resolves, re-runs the checks and only then continues. Never push to or edit another session's branch.

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
- **Pitfalls found:** sorting controls by top before left made a row look like a negative gap (compare left edges within an 8 px band); running one test of the serial workspace file alone fails at MFA enrolment because it depends on the earlier test; fixture URLs are `/?mode=...`, not the real routes. `zz-operator-overview.spec.ts` (and others after `workspace.spec.ts`) also depend on state from earlier files, so a hand-picked subset fails at the MFA step with a 180 s timeout on "Six-digit code"; run the whole suite (CI does) before calling it a regression.
- **Real-frame view (found 23 Oct):** the fixtures mount a component inside `<main class="operator-page ux-workspace"><div id="fixture">`, but the real page renders it directly under `main.ux-customer`, and the customer kit styles `.ux-customer > section` as a card. For a faithful screenshot add `ux-customer` to `main`, drop its inline style and move the children of `#fixture` up one level for the screenshot only. Without that, rules written for the customer frame never apply and the view misleads (a first "no vertical rhythm" finding was partly this artefact). Running axe with the frame class also found a real bug: `.ux-customer button:not([class])` restyled the class-less tab buttons of the pricing and terms tabs, so hovering the selected tab gave white text on a pale surface (contrast 1.11).
- **Flags that are not defects (23 Oct):** the audit's width and stagger measures flag the operator home tool index (one navy featured tile beside four cards) and the phone area bar (the Overview link above two-column area links). Both are deliberate featured compositions. A uniform grid was built and compared (`docs/design-system/evidence/signal-tool-index/bento-vs-uniform-1440.png`): it orphaned the fifth tile on its own row at 1440 px and crowded the navy tile, so it was reverted. Do not flatten them to satisfy the measure.
- **Not committed:** the audit copy is a local tool. If it is wanted in CI, add it as an explicit work package with owner approval.

### KI-17 Reused branch after a squash merge hides CI

- **Seen (23 Oct):** after PR138 was squash-merged, new commits on the same branch had the old pre-squash commit in their history. The next PR conflicted with main in every file both touched, so GitHub created no `pull_request` CI run and `get_check_runs` showed only the Vercel comment check.
- **Avoid:** if a PR has no CI checks a minute after opening, check mergeability first (`git merge-tree --write-tree origin/main HEAD`). After any squash merge, restart the branch from main (`git checkout -B <branch> origin/main`) and cherry-pick only the new commit, then `git push --force-with-lease`.

### KI-18 Do not read the UX gate against `next dev`

- **Seen (23 Oct, PR153):** `PLAYWRIGHT_BASE_URL=<dev server> pnpm test:ux` failed 7 cases (`invisibleFocus` on `/client`, `/plan`, `/programme`, and the four specimen widths with `getComputedStyle ... not of type 'Element'`). The same cases passed on a production build. The dev server mounts a focusable dev indicator and re-renders the body, so the gate and the specimen fixture misread it.
- **Do:** build (`pnpm build`), run `next start --port 3100` and point the gate at it. Use the dev server only for screenshots.
- **Organiser views without a session (23 Oct):** the fixture dumps hold only the component, so a faithful render rebuilds the real frame around it: `div.site-shell > main.operator-page.ux-workspace.ux-customer` with `header.ux-page-heading`, `p.ux-testmode`, `nav.guide-tabs`, then the fixture children. Replace the dump's inlined CSS with the current `.next/static/chunks/*.css` (the dumps age as rules change) and add `<meta charset>` (file loads show mojibake otherwise). A small script that lists framed boxes inside framed boxes (border, radius, height over 40 px) finds nested frames across all views in seconds.
- **Fast iteration on signed-in views:** the audit copy (KI-16) can dump each view's DOM with all CSS inlined (`DOMS=<dir>`). Load a dump from disk with the fonts re-attached and add a draft stylesheet to test a rule in seconds instead of the 21 minute run. Dumps without the frame classes lack the customer shell; add `operator-page ux-workspace ux-customer` to `main` first for fixture pages.

### KI-19 Operator test 8 fails in the cloud container, also on clean main

- **Seen (23 Oct):** `tests/operator/workspace.spec.ts:2403` (governed SDK fixture review) fails here at the first of four large claims with `claim: The record or policy changed` (a 409 from a database limit error). It fails the same way on `origin/main` `7a4613a`, with and without the Phase 0 changes, while CI passes it. Cause not found; suspected difference in the local PostgreSQL. The other 13 cases in `workspace.spec.ts`, `zzz-owner-page.spec.ts` and `zzz-view-as.spec.ts` pass.
- **Do:** compare with a clean `origin/main` run before blaming a change. The `zzz-*` specs need the authenticator that `workspace.spec.ts` enrols in the same run (the database is rebuilt every run), so run them together with it. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.

### KI-20 Two clean ledger edits can exceed the 12 KiB cap when both merge

- **Seen (23 Oct, PR160 after PR161):** each PR passed `verify` alone, git merged both ledger edits without a conflict, and `main` ended at 12,357 bytes, over the cap, so `node scripts/v3-context.mjs verify` failed on `main` and would have failed every later PR.
- **Do:** after merging main into a branch, and straight after your own merge, run `node scripts/v3-context.mjs verify` and `wc -c docs/V3_LEDGER.md`. Edit the ledger lines in place and condense old history instead of adding lines; keep the ledger under about 12,000 bytes: `status` prints it plus a 23 byte footer and `tests/context-tools.test.mjs` runs it, so the real cap is about 12,265 bytes, not 12,288 (PR164 failed `checks` at 12,279). Fixed by removing a repeated action-group sentence and the two CI failure details already kept in this file.

### KI-21 Red marks that are not code failures, and a stacked-PR routine (24 Oct 2026)

- **A pull request with no CI runs at all** is usually conflicted ("dirty") against `main`: GitHub does not start `pull_request` workflows on a conflicted PR. Merge `origin/main` into the branch, push, and the runs start. Do not push an empty commit.
- **Vercel preview "Resource is limited ... api-deployments-free-per-day"** is the owner's account limit, not a code failure and not a required check. It counts deployments created (more than 100 in a day on the free plan), so deleting old previews is not shown to clear it; on 25 Oct the API answered 402 with `retryAfter` 86400. In the PR it shows as a `Vercel` status that fails within about a second with `BUILD_FAILED: Resource provisioning failed` and an empty build log, while other previews and production may still be READY because they were created before the limit was reached. Wait for the window or have the owner change the plan; a redeploy attempt is refused the same way.
- **A main run shown "cancelled"** was superseded by a newer push to `main` (main CI cancels older in-flight runs). Look at the newest main run, not the cancelled one.
- **Local container only (CI passes):** `customer-mission-shares.test.ts` fails alone (database locale); `y-ux05-governance.spec.ts` alone fails at "Six-digit code"; `workspace.spec.ts:2403` is KI-19. Postgres stops when the container restarts: start it again with the command in KI-15 before any database test or `pnpm preflight`.
- **Stacked PRs:** after each squash merge, merge `origin/main` into each remaining branch. Expected conflicts: `docs/agents/work-log.md` and `docs/adr/README.md` (keep both sides), `docs/documentation-map.json` (keep both entries) and the audit table in `docs/product/real-use-audit-2026-10-24.md` (take main's version, then re-apply your row edits by line prefix, because prettier pads tables).
- **Preflight:** start it detached (`setsid nohup node scripts/preflight.mjs quick < /dev/null &`), do not switch branches or run database tests while it runs, stop it by process id, and once your own work is committed run `git status`; generated files under `docs/design-system/evidence` or `docs/v3` that you did not write can be dropped with `git checkout -- <path>`. Never run that command on paths you edited and have not committed.

### KI-22 Two local traps while building stacked lanes (25 Oct 2026)

- **Never `git add -A` in a tree where `node_modules` is a symlink** (for example a second worktree that links the first one's dependencies). `.gitignore` says `node_modules/`, which does not match a symlink, so it is committed, and checking that commit out in the real tree replaces the real `node_modules` directories with links to themselves. Recovery: `git rm --cached` the links, delete them, amend, then `CI=true pnpm install --frozen-lockfile --prefer-offline` (about 20 seconds from the store). Better: run tools in the one real tree and switch branches there.
- **Database tests share one database.** Two `vitest` runs at once (for example the full suite and one file) clobber each other and make dozens of tests fail at 7 ms. Run them one at a time, and do not switch branches while a background run is going.

### KI-23 The secret scan reads every commit of a pull request (25 Oct 2026)

- **CI's `checks` job runs gitleaks over the whole history of the pull request.** A line that looks like a key in any commit fails it, even if a later commit removes the line. The usual cause in tests is one line that holds a word such as `secret`, `token` or `key` and a quoted high-entropy value (a UUID, 43 characters of base64). Build the value in a variable on its own line instead (`const another = id.replace(...)`).
- **Preflight used to hide findings.** Its security step was `a && b || echo skipped`, so a finding (exit 1) printed the skip message and passed. It now fails on a finding. Before pushing a branch with many commits you can also run `node scripts/security-scan.mjs` (all local history, which can include old local-only branches) or `.cache/security/gitleaks git . --log-opts='origin/main..HEAD'` (this branch only).
- **If a commit already has a finding:** on your own pull request branch, rebuild the branch with the line fixed in the commit that introduced it (cherry-pick `-n`, edit, `commit -C`), and force-push with a lease on the old head. Adding the commit to `.gitleaksignore` only works for a commit that will keep its hash, which a squash merge does not.

### KI-24 Direct dependency pins do not cover vulnerable peer copies

- Seen on 28 Oct, PR210: the app used Better Auth 1.7.10, but Neon UI peers still resolved 1.6.23. CI correctly failed the dependency audit for GHSA-965c-763c-88jm, GHSA-q84f-53jg-9ppm and GHSA-r4xp-prcw-77qf. The bounded `better-auth@<1.7.7` override aligns those copies with the existing 1.7.10 dependency. Keep the audit gate; changing only the direct dependency does not establish that the lockfile is safe.
- Local release checks share a two-CPU quota. Running integration, compilation and multiple browser workers together produced SQL and browser timeouts. On disposable loopback PostgreSQL only, disabling optional JIT reduced the unchanged accounting suite from 453s/six failures to 215s/one timeout while browsers still overlapped. Its remaining private-opportunity closure case passed alone in 6.47s. This is diagnostic evidence, not a whole-suite pass. Keep accounting assertions, RLS, MFA and timeouts unchanged; run heavy local suites sequentially. CI uses separate jobs and serial integration/build/browser phases. Production configuration was not changed.
- Public country selectors must wait for hydration before accepting a choice. A fast native selection before React restored its state could reset Japan to the default country. PR210 disables those selectors until the existing hydration marker is ready; all four retained desktop/mobile corridor assertions passed after the fix.

### KI-25 Manual workflow input limit (29 October 2026)

- GitHub.com permits at most 25 top-level `workflow_dispatch` inputs ([GitHub documentation source](https://github.com/github/docs/blob/main/data/reusables/actions/inputs-vs-github-event-inputs.md), checked 29 October 2026). PR210 raised the installer from 24 to 26. Push run 40763273060 (39) failed at 20:26:17 UTC on 28 October, with zero jobs and matching start/end timestamps. The Actions API exposed no check runs or annotations, so the exact validator message could not be retrieved. The parsed count and GitHub's published limit independently identify the invalid workflow.
- Replace the two field-module inputs with `field_modules_action` (`unchanged`, `specification_confirmation`, `commercial_arrangements`, `both`). Each still maps to the existing installer value `install` or `unchanged`; the exact-head check includes the combined input. All 24 earlier inputs retain their definitions. No workflow was dispatched.
- `tests/workflow-inputs.test.mjs`, included in `test:docs`, parses every workflow and rejects more than 25 inputs, undeclared input references and duplicate YAML keys. The actual 26-input source failed before the repair. The repaired workflow has 25 inputs: zero headroom. The next optional module needs a restructure. OWNER decision proposed: replace the repeated `*_reason` inputs with one shared reason. Do not implement that proposal without the owner's decision. After merge, the owner checks that the next push has no workflow-validation failure.
