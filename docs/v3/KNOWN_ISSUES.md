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
- **Chromium cache (PR224, 31 Oct):** the Chromium download is cached, keyed on runner image, architecture and the exact Playwright version; apt is deliberately not cached, so `--with-deps` still installs fonts and system libraries through apt on every run.
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
- **Replaced, 25 Oct 2026 (chat, relayed):** no merge, Pulse opening, production setting or redeploy without his command. **Narrowed again, 29 Oct:** draft PRs only, and the owner gives a merge command for each PR. No agent acts on the 22 Oct decision. See the [ledger](../V3_LEDGER.md).

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
- **Path note (10 November 2026):** the paths above are dated history. On 10 November the container had `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` and no `chromium-1194`; `AGENTS.md` now names that path. Use whichever path exists.

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
- **The run rewrites tracked evidence images** under `docs/implementation/evidence`, `docs/v3/phase-4` and `docs/design-system/evidence/ux-repair-2026-10-29/after` (the last from `ux-first-question.spec.ts`, `specification-confirmation.spec.ts` and `v3-service-requests-ui.spec.ts`; seen during a local preflight on 31 October). Run `git checkout docs/implementation/evidence docs/v3/phase-4 docs/design-system/evidence/ux-repair-2026-10-29` before committing; never commit them.
- **Browser path:** on 31 October the container had no `chromium-1194`; the runs used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`. Use whichever path exists.
- **Path note (10 November 2026):** the paths above are dated history. On 10 November the container had `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` and no `chromium-1194`; `AGENTS.md` now names that path. Use whichever path exists.
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
- **Path note (10 November 2026):** the paths above are dated history. On 10 November the container had `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` and no `chromium-1194`; `AGENTS.md` now names that path. Use whichever path exists.

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
- **Public JSON identifiers can trigger the generic rule.** The archived audit metadata produced two demonstrated false positives. Its scoped `.gitleaks.toml` exception retains default rules and matches only the two exact public values AND that exact path. [Seven boundary controls](../qa/current-plan-gaps/verification/2026-11-02-security-controls.json) prove representative same-path/same-line credentials, other paths, changed values and another default rule remain detected (scanner exit 1). Never ignore the whole file or globally disable a rule; preserve the raw evidence and require new controls for a different exception.

### KI-24 Direct dependency pins do not cover vulnerable peer copies

- Seen on 28 Oct, PR210: the app used Better Auth 1.7.10, but Neon UI peers still resolved 1.6.23. CI correctly failed the dependency audit for GHSA-965c-763c-88jm, GHSA-q84f-53jg-9ppm and GHSA-r4xp-prcw-77qf. The bounded `better-auth@<1.7.7` override aligns those copies with the existing 1.7.10 dependency. Keep the audit gate; changing only the direct dependency does not establish that the lockfile is safe.
- Local release checks share a two-CPU quota. Running integration, compilation and multiple browser workers together produced SQL and browser timeouts. On disposable loopback PostgreSQL only, disabling optional JIT reduced the unchanged accounting suite from 453s/six failures to 215s/one timeout while browsers still overlapped. Its remaining private-opportunity closure case passed alone in 6.47s. This is diagnostic evidence, not a whole-suite pass. Keep accounting assertions, RLS, MFA and timeouts unchanged; run heavy local suites sequentially. CI uses separate jobs and serial integration/build/browser phases. Production configuration was not changed.
- Public country selectors must wait for hydration before accepting a choice. A fast native selection before React restored its state could reset Japan to the default country. PR210 disables those selectors until the existing hydration marker is ready; all four retained desktop/mobile corridor assertions passed after the fix.

### KI-25 Manual workflow input limit (29 October 2026)

- GitHub.com permits at most 25 top-level `workflow_dispatch` inputs ([GitHub documentation source](https://github.com/github/docs/blob/main/data/reusables/actions/inputs-vs-github-event-inputs.md), checked 29 October 2026). PR210 raised the installer from 24 to 26. Push run 40763273060 (39) failed at 20:26:17 UTC on 28 October, with zero jobs and matching start/end timestamps. The Actions API exposed no check runs or annotations, so the exact validator message could not be retrieved. The parsed count and GitHub's published limit independently identify the invalid workflow.
- Replace the two field-module inputs with `field_modules_action` (`unchanged`, `specification_confirmation`, `commercial_arrangements`, `both`). Each still maps to the existing installer value `install` or `unchanged`; the exact-head check includes the combined input. All 24 earlier inputs retain their definitions. No workflow was dispatched.
- `tests/workflow-inputs.test.mjs`, included in `test:docs`, parses every workflow and rejects more than 25 inputs, undeclared input references and duplicate YAML keys. The actual 26-input source failed before the repair. The repaired workflow has 25 inputs: zero headroom. The next optional module needs a restructure. OWNER decision proposed: replace the repeated `*_reason` inputs with one shared reason. Do not implement that proposal without the owner's decision. After merge, the owner checks that the next push has no workflow-validation failure.

### KI-26 Specimen replacement must wait for hydration

- Seen 29 October: the full UX suite lost both 1440px specimen nodes after its driver replaced the document while React was still hydrating `/how-it-works`. The same selectors passed at the narrower widths. Commit 8bb194f moved both specimen drivers (`tests/ux/specimen.spec.ts:89`, `tests/ux/mr-specimen.spec.ts:134`) from `/how-it-works` to `/plan` to get a hydration marker, and they now wait for its enabled Continue control before inserting their document. Widths, measurements and assertions are unchanged. Do not treat a pre-hydration document replacement as a product layout result. (Corrected 30 October: the first version of this entry said routes were unchanged and that the page was `/plan`.)

### KI-27 A mocked OTP response is not a server session

- Seen 29 October: `v3-code-signin` mocked a successful OTP response but then navigated to protected `/account`. The server correctly redirected the unauthenticated fixture. The test now uses `/plan` as its allowed return target and asserts that exact destination. It still checks unknown-account denial, rate limiting, keyboard and accessibility. Genuine managed-auth session acceptance remains a separate gate; never grant a fake server session to make this fixture pass.

### KI-28 Text that fits locally can be cut in CI's fonts (30 October 2026)

- **Seen (PR 215):** the closed job select test (`tests/operator/ux-plan-languages.spec.ts:915`, "at 390 every job fits the closed job select in every language") passed locally and failed in CI twice. CI run 41046574378 on `fe04dbb`: Spanish "Comprar productos o componentes" 3 px over, because the test measured the select's content box and ignored the room the native select keeps for its arrow (about 20 px). CI run 41051179440 on `7f124b1`, after that fix: Arabic "الاستفادة أكثر من المعارض التجارية" 21 px over and a second Arabic label 9 px over (both runs' annotations). As relayed, CI renders Arabic in a different system font, about 19 percent wider than the cloud container's, and its Chromium build is newer. The test stopped at the first language that failed, so each run named one language only.
- **Do:** measure each label with a hidden copy of the select that holds one option at its natural width, check every language before failing so one run lists every cut label and prints its width (`9c0eef2`), and leave headroom instead of fitting to the local pixel: after `9c45f04` every Arabic and Bangla label is at most 76.8 percent of the 254 px text box locally, and CI run 41058504369 on `cf6338e` passed. Shorten the words, and list them for the native review, rather than widening the control or weakening the check.
- **Do (PR224, 31 Oct):** before blaming fonts, compare the "Browser runtime fingerprint" notice (Playwright version, browsers, cache hit, font and font package hashes, image) across jobs; any difference between a cached and an uncached run blocks merge until explained.

### KI-29 Member roles test fails now and then in long local runs (31 October 2026)

- **Seen (PR 219 verifier, head `76df4b4`):** `tests/operator/v3-member-roles-ui.spec.ts:120` ("an owner changes a role only after confirming, with one exact request, and the list reflects the new role") failed once in `pnpm preflight` (1 of 740 affected operator tests; receipt `work/pf-operator-affected-2026-10-31T05-01-02-382Z.log.receipt.json`, so preflight exited 1). The panel showed "Team access could not be loaded. Try again." and the button "Make Synthetic Dhaka buyer lead an admin" was not found at spec line 151. The same test passed in the full `pnpm test:operator` run on the same head (825 passed, exit 0) and in 4 of 5 isolated repeats (`work/operator-member-roles-repeat-2026-10-31T05-52-05-579Z.log.receipt.json`). Its bundle imports none of PR 219's changed files.
- **Cause, inferred, not traced in a request log:** right after the helper clicks Manage team, the test removes and re-adds its mocked access route (lines 125 to 128). A request made in that gap can reach the fixture server, which answers 404, so the panel shows its load error.
- **Do:** rerun the test and compare with the full operator run before blaming a change. Do not edit the test without the owner. Print the access request's status before naming a cause (KI-04).

### KI-30 A soft return through operator sign-in doubles or keeps an old `#` (31 October 2026)

- **Seen (PR 220):** "Verify workspace access", when it was a Next `<Link>` with a return address, failed its own round trip. After sign-in and the authenticator code the page landed on `/operator?workspace=T#workspace-sources#workspace-sources`, which is not a listed section, so the person saw "This section is unavailable…" instead of Sources (`tests/operator/zz-workspace-access-return.spec.ts:195`, `work/operator-3-2026-10-31T08-34-45-664Z.log.receipt.json`; local repros `work/repro-hash-2026-10-31T08-46-04-799Z` and `work/repro-hash2-2026-10-31T08-49-08-844Z`). The same href opened with a full page load returned once. PR219's "Sign in again" link had the same fault after a fresh load of `#workspace-authenticator` (`#workspace-authenticator#workspace-authenticator`, `work/signin-again-link-2026-10-31T08-56-37-578Z`). Signing out with `router.replace` plus `router.refresh` brought back the old section: the next sign-in, with no return address, landed on `/operator#workspace-sources` instead of the overview (`work/signout-old-2026-10-31T09-15-16-419Z`). Receipts are local under `work/`, not committed.
- **Cause, traced in the installed code:** Next 16.4.3 `next/dist/client/components/app-router-state.js:204` builds `canonicalUrl = route.canonicalUrl + url.hash` from a cached route entry. If that entry was first loaded with a `#`, the sign-in form's unchanged `router.replace(next)` adds the `#` again, or a bare `/operator` return gets the old one back. `router.refresh()` clears the cache for the current route only, so the signed-in session's entries survive a soft sign-out. The old bare sign-in links never showed it because they returned to a different address.
- **Rule:** every link into operator sign-in, and signing out, is a full page load: a plain `<a>` (with `operatorSignInPage` or `operatorSignInPath(...)` from `apps/web/lib/workspace-navigation.ts`) or `window.location.replace`. Never a Next `<Link>` or `router.push`/`router.replace`. `tests/integration/ux-operator-urls.test.ts` pins each link and scans every `<Link>` in `apps/web`; a `target="_blank"` Link is exempt because a new tab is a fresh document. Since PR 221 the guard in `tests/integration/sign-in-navigation-guard.ts` reads the syntax tree: it sees a sign-in path held in a variable in the same file, `operatorSignIn*` helpers, spread props, an aliased `next/link` import and `push` or `replace` on a router from `useRouter()`. It does not follow a constant or helper imported or renamed from another file, a path built in pieces, a wrapper component that passes `href` on to `Link`, or a server `redirect()`, so read new sign-in links by eye too.
- **Root fix (PR 221, `855d350`, approved by the owner as "approve item 1"):** the sign-in form leaves with `window.location.replace(destination)` once the authenticator code is accepted, so the page after sign-in is always a fresh document, whichever way the person reached the form. Contributor sign-out is a full page load too (`0b0fb5d`). Some entries into sign-in can still be soft: the server `redirect()`s in `apps/web/app/operator/operator-entry.tsx`, `apps/web/app/operator/owner/page.tsx`, `apps/web/app/signin/page.tsx` (only where customer sign-in is not configured) and `apps/web/app/contributor/page.tsx`, and the `accountAccessPath('/signin', ...)` Links in `apps/web/app/plan/intake.tsx` (they reach operator sign-in only through that `/signin` redirect). They are safe because the form now always leaves with a full page load. The four redirects stayed byte-identical, as in the blast radius the owner approved.
- **Open gap:** if the person stops the navigation after a successful sign-in (the browser's Stop button), the form stays busy until the page is reloaded. The owner approved this behaviour with item 1.

### KI-31 A future-meeting fixture became past on 2 November

- **Observed:** main CI41416900700, job125182931636: meetings.test.ts ran at09:10:03 UTC on2 November2026; its rescheduling fixture hard-coded `2026-11-02T10:00:00+01:00` (09:00 UTC). The final HELD command correctly succeeded for that now-past meeting, so the unchanged `rejects.toThrow('future meeting')` assertion failed. The integration log reported1 failed/1865 passed/1 skipped. PR233's earlier pre-merge run passed before that instant.
- **Fix in PR234:** construct the rescheduled meeting one day ahead with matching Madrid wall times; preserve every assertion and the application's meeting guards. Do not rerun an expired immutable fixture expecting a different result. No application meeting code changed.

### KI-32 Fee rows accepted edits before their draft restored

- **Observed:** PR241 CI41516407408, operator job125522118971, lost the edited second fee label after row removal/reload. A paused-timer browser case reproduces enabled fields before the new editor storage key finishes restoring, even though title controls already waited.
- **Fix:** expose the fee form only when both its keyed draft and initial row restoration have settled. Track the restored editor in state so the readiness transition renders atomically with its restored rows. Preserve the original row-removal/version/money assertions and add the delayed-restoration regression; do not hide the race with test sleeps.

### KI-33 Shared field grid overflow needs the preceding workspace state

- **Observed:** PR242 CI41546518647/operator125623398842 failed UX-01 page width (139 other shard cases passed). Bootstrap plus the isolated mission case passed locally. Adding the existing preceding SDK scenario reproduced a320px viewport with330px document width: a shared field's label/row/input occupied a256px implicit grid column.
- **Fix:** constrain the existing field grid to `minmax(0, 1fr)`; keep the original viewport/axe/permission assertions and add bounded geometry to failure messages. The identical4-case sequence now passes all six widths after a fresh build. Do not hide overflow or substitute the isolated passing case for this reproduction. Evidence: [layout verification](../qa/current-plan-gaps/verification/2026-11-03-gap009-layout-local.json).

- KI-33 diagnostic follow-up: use `Array.from` for DOM node lists under the repository test TypeScript library. The app-only build does not typecheck operator test sources; full root `pnpm typecheck` verifies this path.

### KI-34 Startup-recovery operator test timed out once on a slow runner (4 November 2026)

- **Observed:** PR257 head 4309ec5, operator shard (6): `tests/operator/z-startup-recovery.spec.ts` (UX-01 startup outage) failed once with "Test timeout of 180000ms exceeded". In the same run operator (2) and browser took about 15 and 18 minutes against about 5 for the other jobs. One re-run of operator (6) passed with no code change.
- **Cause:** inferred (runner slowness), not proven. The test starts its own `next start` and normally needs about 120 s.
- **If it recurs:** on a normal-speed run, reproduce it locally before changing anything. Do not raise the timeout blindly.

### KI-35 Local database preparation lost its connection once on a fresh runner (4 November 2026)

- **Observed:** main push CI run 41775257221 (PR258 merge, 4f2870e), attempt 1: only job `ux (2)` failed. `pnpm db:prepare-local` ended with `Error: read ECONNRESET` (pg-pool, `packages/db/src/migrate.ts`) at 04:48:02Z, two seconds after the runner's Postgres container reported started and before any test ran. `validate` was red only as the roll-up. One re-run of the failed jobs passed (attempt 2 success).
- **Recurred (5 November 2026):** PR 295's browser job (run 41980734589) died at `pnpm db:prepare-local` with `ECONNRESET` about 1 s after the container started, and PR 294's `ux (3)` (run 41969707752) died at the same step with `error: the database system is starting up` (code 57P03). Both ended before any test ran, and both passed on one re-run of the failed job.
- **Cause (now understood):** `scripts/local-database.mjs` waited with `pg_isready` run inside the container. The Postgres image first starts a temporary server for its init scripts, and that one answers `pg_isready` inside the container before the real server listens on the published port. The first connections from the host then fail with a reset or "starting up".
- **Fix (5 November 2026):** `scripts/prepare-local.ts` waits until a query over the real connection (`SELECT 1` on port 54329) is answered, up to 30 tries one second apart, logs each try ("Waiting for local PostgreSQL, try N of 30: ...") and the try that succeeded, and then fails with a clear message. No workflow or test changed. Checked locally by stopping the database, starting the script, and starting the database a few seconds later: the script waited and then migrated; with the database down for the whole time it failed after 31 s.
- **If it recurs after this:** the job log will now say "Local PostgreSQL did not answer a query on port 54329 after 30 tries (...)" with the last error. That means the container did not come up at all, which is a runner problem; re-run the failed job once and report it.

### KI-36 Two parallel runs shared one local database and one lost its results (4 November 2026)

- **Observed:** on the decision card database work (E3b, 4 November) two builders ran in parallel and both used the KI-15 sandbox at `/tmp/pg54329` and port 54329. One changed the other's password, stopped its server and deleted its data directory, so that builder's first test results were lost and no result came from it.
- **Cause:** a fixed data directory and a fixed port shared by two processes; KI-15 describes one run, not two.
- **Fix used by the later runs:** give each run a private network namespace (`unshare -n`, loopback only; the container has no `ip` binary, so raise loopback with a small Python ioctl script), a data directory unique to that run, and port 54329 inside the namespace (the tests need that port). Run every database test through `nsenter -t <pid> -n`.
- **Rule:** when running database suites in parallel always isolate them this way, and never share `/tmp/pg54329`. A run whose database was touched by another run proves nothing; rerun it in its own namespace.

### KI-37 Local preflight e2e lost a trace file while the ux gate ran at the same time (4 November 2026)

- **Observed:** S3's local `node scripts/preflight.mjs` run on 4 November reported an ENOENT for a Playwright trace file in the e2e step while the ux-gate step ran alongside it. Run on its own, the same e2e step passed 198 of 198, and exact-head CI was green.
- **Likely cause, not proven:** two Playwright runs in one container wrote under the same output directory, and one cleaned files the other still needed.
- **Rule:** before treating a local trace ENOENT as a failure, rerun the e2e step alone. Do not change a test because of it. CI on the exact head is the verifier.

### KI-38 Preflight operator-affected selection ran a spec without its setup spec (5 November 2026)

- **Observed:** S3's local `node scripts/preflight.mjs` selected `y-ux05-governance.spec.ts` as affected, but not `workspace.spec.ts`, which creates the user it signs in as. The spec failed in the preflight, and passed when both ran in order (11 of 11) and in CI, which runs the whole operator suite in order.
- **Cause:** the affected-spec selection does not follow the order dependencies between operator specs.
- **Rule:** before treating a preflight-only operator failure as real, rerun the spec together with its setup spec in suite order. CI on the exact head is the verifier. Do not change a test because of it.

### KI-39 A CI job's PostgreSQL service container did not start (5 November 2026)

- **Observed:** on PR 310 one CI job failed before any test ran: "PostgreSQL container could not start". The other jobs on the same head passed. Re-running only the failed jobs on the same head turned them green, with no code change.
- **Cause:** a transient runner or service-container start failure, not the change under test.
- **Rule:** when a job fails at service start-up with no test output, re-run the failed jobs once on the exact head (`gh api -X POST repos/<owner>/<repo>/actions/runs/<run>/rerun-failed-jobs`) and say so in one PR comment. A second failure is treated as real. Never change a test because of it.

### KI-40 The team sidebar had an Account stopgap group, a known deviation from Navigation v1 (6 November 2026, resolved the same day)

- **What:** the Navigation v1 board gives the team sidebar five first-level items and an Admin group for owner and admin, and no door for the Authenticator; Health and Readiness (which an operator may open) sat only in Admin, which an operator is not shown. The first team PR (#341) therefore carried a small Account group in the sidebar (Authenticator for every role; Health and Readiness for a role that may open them and is not shown Admin), so an owner saw seven first-level entries.
- **Resolved:** the team header's avatar menu (Navigation v1 part 3, after S2's shared utility menus) now carries those places (`teamAccountPlaces` in `apps/web/lib/ux/team-map.ts`), and the Account group, its map entry and its tests are removed. The reachability walk (NAV-06) includes the avatar menu's links and proves each place is still reachable for every role.
- **Rule kept:** a place a role could reach before must stay reachable from the new navigation; when a menu is removed, the test that walks the navigation is what proves it.

### KI-41 G4/G5 enabled in production before its post-merge fixes and privacy review (9 November 2026, follow-up installed the same day)

- **What:** PR 355 (G4 workspace lifecycle, G5 account close and erasure request) merged on 7 Nov without a Guardian review, and install run 42364802587 the same day installed both modules and enabled both controls (the 7 Nov enable stands and was not changed since). The post-merge review (9 Nov, stamp auth-c8b26adfa5f2) was FIXES-NEEDED.
- **Fixed and installed 9 Nov:** the follow-up PR 362 (merged as cd341229) was installed by run 42654373889 (input `lifecycle_install` only). It holds B1 (Undo and the staff erasure steps for a person removed from their only workspace), B2 (a former owner demoted by transfer), B3 (the unreviewed privacy words), Codex 1 and 3 (the close dialog identity headers; close and provisioning serialized), `file_erasure` while the control is closed, the sample and real erasure queue split, the late re-run guard and the sign-in recency check.
- **B4, merged but not reachable:** the staff erasure queue is merged (PR 366), but real staff cannot reach the page, because every staff route in the web layer uses the purpose `synthetic_validation`. Real requests need another path before any real legal deadline (30 days from filing).
- **B4 correction (S15, 10 November 2026): inaccurate as written.** With `CORRIDRA_REAL_USE_ENABLED=true`, `withTenant` (`packages/db/src/index.ts:69-77`) maps `synthetic_validation` to the tenant's processing purpose, so a real owner or admin with fresh MFA reaches the erasure queue and can move a real request. Only with the switch not `'true'` is it refused. It also needs the lifecycle switch and `real_use_configuration.enabled`. The production switch values have NOT been observed. Proof: the new tests in `tests/integration/revamp-g5-staff-erasure-route-database.test.ts` (commit b3d00e4) passed 9/9, and two bite proofs failed when the mapping or the switch was broken.
- **Still open:**
  - The privacy wording review (drafts A and B in the PR 355 body). **Update, 10 November 2026:** the owner answered S15 directly, "Approve both as live (Recommended)", for wording A (close dialog) and B (erasure dialog), exactly as live (`closeBody` and `erasureBody` in `apps/web/app/account/account-lifecycle-words.ts`). Still pending the owner's named review: the typed phrase, the section heading and rows, and the privacy contact line.
  - A preview check that the live provider returns `session.createdAt` (the recency check fails closed without it). **Traced 10 November 2026 (S15):** `signedInAt` comes from `apps/web/lib/foundations.ts:233-241` (`new Date(data.session.createdAt)` from Neon Auth `getSession`). If it is missing, the date is invalid, the age is NaN and the action is refused (`packages/auth/src/customer-session.ts:166-170`), so it fails closed for everyone. Not seen on a preview. Owner step: try Close Account once in a private window after signing in.
  - A former owner stays admin until a step-down change (now refused honestly).
  - A sole owner may close while the workspace is archived, and after day 30 nobody can restore or transfer it.
- **Safe pause:** the install workflow input `lifecycle_pause`. A closed account stays closed while paused and Undo still works; turning the app flag off instead would give closed accounts full access again.
- **Removal trigger:** the wording review is recorded, the `createdAt` check is seen on a preview, and real staff have an erasure path.
- **Trigger status, 10 November 2026:** still holds. Wording A and B are approved, the rest is pending; the `createdAt` check is not seen on a preview; real staff now have a proven code path, but the production switch values are not observed. Both lifecycle controls stay open; `lifecycle_pause` was not run.

### KI-42 GitHub-hosted runners abandoned or never started CI shards (9 November 2026)

- **Observed:** on main cfa22c2a, attempt 1 had abandoned shards: the runners dropped operator 1, 2, 3 and 5, ux 1 and 2, and verification, and the `validate` aggregate said "abandoned". Attempt 2 of the failed jobs passed (run 42674117115). On ff51afb4, run 42673037794 ran only the `checks` job and failed with 0 test jobs; cfa22c2a superseded that head.
- **Cause:** a runner problem on the provider side, not the change under test. It differs from KI-39, where a job started and its service container did not.
- **Rule:** rerun the failed jobs once on the exact head, never push an empty commit, and record the run id. A second failure is treated as real.

### KI-43 The receipt-memory "older than thirty days" browser test can read storage before the page drops the value (9 November 2026)

- **Seen (S13, PR 374):** `tests/browser/receipt-memory.spec.ts:72` ("a request that is older than thirty days, or a bad value, is not shown") failed in 3 of 3 full `pnpm test:e2e` runs on the PR's branch after main was merged in (twice on mobile, once on desktop; 538 other tests passed each time), and in none of the two full runs before the merge. It failed 1 of 80 on clean main 15637875 under 8 workers, and 0 of 160 on the PR's build under 8 workers. Main's own single full run passed (529). The PR may make the race more likely in full runs; that is not settled.
- **Cause, inferred, not traced:** the test seeds an expired receipt in `localStorage`, waits for the Commercial job select, then reads storage once and expects it empty. The select is in the server-rendered HTML, so it is visible before the page's mount effect runs. That effect calls `readReceipt` (`apps/web/lib/receipt-memory.ts`, from `apps/web/app/plan/intake.tsx`), which drops an expired value. Under load the single read can come first.
- **Fix in PR 374:** the test polls the same assertion (storage is empty) instead of reading it once. It still fails if the value is never dropped.

### KI-44 The step bar on /plan overflows at 320 px with text at 200 percent (found 9 November 2026, resolved by PR 376 on 10 November 2026)

- **Seen (S13, PR 374):** adding `/plan` to the whole-page guard in `tests/browser/public-large-text.spec.ts` failed at 320 px: `Error: /plan at 320`, offender `li. 1Goal`. That guard measures the whole page, header and footer included, so it found something the form's own guard (`#main` only, English, German and Arabic) did not report.
- **Cause, inferred from the CSS, not traced:** the step bar (`apps/web/components/journey-bar.tsx`, `.guide-journey-bar` in `apps/web/app/globals.css`, around lines 4193 to 4260) is five columns of `minmax(0, 1fr)`; at 200 percent text on a 320 px phone a column is about 52 px, and the step label ("Goal") in `--text-sm` is wider. PR 374 does not change the journey bar or its CSS, so this is not new in that PR; it was not separately measured on main.
- **Why `/plan` is not in `public-large-text.spec.ts` yet:** adding it fails until this is fixed. The compact `/plan` footer has its own 320 px, 200 percent test in `tests/browser/layout-budget-plan.spec.ts`.
- **Repro:** open `/plan` at 320 x 800, add `html { font-size: 200% !important; }`, wait for fonts, and list boxes whose right edge is past the window (the guard's `problems` helper in `public-large-text.spec.ts`).
- **Do:** fix it in its own pull request (shorter labels under the dots, or let the step labels wrap or stack at that size), then add `/plan` to the guard's page list.
- **Resolved (10 November 2026):** PR 376, squash-merged as 2bc003b3 (Guardian PASS at bc69a201, stamp auth-e40f1504ea5f; CI 18 success and 1 neutral): the step bar and choice cards fit at 200 percent text, and `/plan` is in the `public-large-text.spec.ts` page list. Reviewer's follow-up notes: (1) `public-large-text.spec.ts:147` `toHaveText` reads `textContent`, not the accessibility tree (use `toHaveAccessibleName` or an aria snapshot); (2) `globals.css:4273` the bar is compact at 320 and 360 px at 100 percent text (agreed boundary, owner awareness); (3) `globals.css:4349` the cards are 190 px wide at 320 px and 200 percent and break every few characters because the form padding is 128 px; a follow-up could reduce the form padding on narrow screens. Not checked by the review: real translated pages (`CORRIDRA_LANGUAGES_FORM` unset), Safari and Firefox. A new failure in the same guard is KI-45.

### KI-45 The /plan receipt disclosure fails the whole-page 200 percent guard at 320 px, seen only on one local machine (10 November 2026, cause not traced)

- **Seen (S16's local machine, native PostgreSQL, chromium-1243):** on clean main 2bc003b, `tests/browser/public-large-text.spec.ts:97` fails at "/plan where step at 320" with offender `details.receipt-disclosure Check a Mission Request.Receip`. It failed 1/1 there and 3/3 on S16's branch.
- **Seen only on S16's local machine:** it passes in CI on main 2bc003b3 (18 success, none failed, the e2e shards included) and in PR 376's CI on bc69a201.
- **Cause:** not traced; a font difference is suspected (compare KI-28).
- **Do:** the conductor owns a fix PR. Until then, a failure at this exact place on a local run is this issue, not the change under test; compare with clean main first.
