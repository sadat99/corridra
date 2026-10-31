# Commercial readiness program: baseline

Document status: CURRENT, DATED. Recorded by the lead in Wave 0 on 31 Oct 2026.

- Base: `main` at `1b09e89` (PR222). Integration branch: `claude/sleepy-mccarthy-lchg16` (see the owner override at the top of the program).
- The last `main` CI before this program was green on `validate` for PR221 and PR222 (ledger and Vercel status).
- Local checks on the Wave 0 tree, cloud container, Node 22 against the repository's Node 24 pin (engine warning only): `pnpm format:check`, `pnpm lint` and `pnpm typecheck` exit 0. New contract tests: `tests/integration/commercial-readiness-contracts.test.ts` 14 of 14 and `tests/integration/commercial-readiness-database.test.ts` 6 of 6 against native PostgreSQL 16 (KI-15).
- Browser suites (`pnpm test:e2e`, `pnpm test:operator`, `pnpm test:ux`) run in CI on the exact head; CI is the proof. Known intermittent failure: KI-29 (member roles test).
- Pre-existing failures streams are not responsible for: none known at `1b09e89` beyond KI-29.

Results of the full gate on the Wave 0 commit are added below by the lead once CI finishes.
