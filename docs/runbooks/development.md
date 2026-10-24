# Development environment

**Document status: CURRENT.** Commands apply today. See the [plan status register](../PLAN_STATUS.md).

Read [Start here](../START_HERE.md), [the current plan](../implementation/current-plan.md), root/nested `AGENTS.md` and applicable module contracts first. Use the existing checkout; no worktree unless requested. Pinned tools are Node 24.19.0 and pnpm 11.19.0.

## Install and start

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The Next.js app is `apps/web`; root scripts select it. `pnpm build` followed by `pnpm start` serves a local production build. Verify a real response and relevant page behavior; a listening port is insufficient. Processes must remain running in a managed session.

On this managed cloud machine, writable caches can live under `/workspace/.cache` or `/tmp`. Preserve inherited proxy/CA settings and never disable TLS verification. Normal developer machines can use normal caches. Do not redefine a system home variable or dump environment/credential files.

## Services and credentials

The public shell runs without application secrets. Persistent mission/research/commercial/delivery/governance features use PostgreSQL. Staff authentication uses the separate restricted auth role and actual TOTP. Customer identity uses an isolated Managed Neon Auth provider and signing configuration. Evidence tests use local ClamAV. AI/network production activation and outreach/payment/payout transports remain closed; fixtures are synthetic test transports.

There are **29 reviewed SQL migrations**, `0001_identity_tenancy.sql` through `0029_identity_password_audit.sql`, at this handoff baseline. Inspect `packages/db/migrations` and migration tracking for the current count. Earlier runbooks' part-specific migration counts describe those historical releases. Never use Drizzle push, rewrite an applied file or reset retained cloud data. Builds do not migrate.

Local scripts generate ignored synthetic loopback credentials/databases. The ambient `DATABASE_URL` is not trusted or automatically used for acceptance. For any remote operation verify project, branch, database, role, region and environment explicitly. Never copy production role/signing settings into previews. Follow [foundation infrastructure](part-03-foundations.md), [identity](neon-auth-accounts.md) and [evidence storage](evidence-storage.md) guidance for those specific boundaries.

## Validation

```sh
pnpm db:local
pnpm db:prepare-local
pnpm scanner:local
pnpm exec playwright install --with-deps chromium
pnpm check
```

Docker is required for PostgreSQL/ClamAV. In this managed environment, read its cloud runtime guidance before creating/restarting containers. If `/usr/bin/chromium` is the installed browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; otherwise use Playwright's verified browser install.

`pnpm check` runs format, lint, types, document/infrastructure, real database integration, build, public browser and protected operator suites sequentially. CI adds security/dependency checks. Use current runner results; old test counts are historical evidence. Tests include permissions/RLS, original evidence and money, idempotency, upgrade/recovery and scoped journeys; a passing suite does not exhaust the UX coverage ledger.

Public browsers start their isolated production server on 3100; protected tests use 3200 and a disposable loopback database. Run suites sequentially to avoid shared output collisions. **Do not set PLAYWRIGHT_BASE_URL to production for full suites:** mission submissions and other tests may persist data. Production routine checks must be explicitly read-only and bounded. Never reuse test authentication against production.

`PLAYWRIGHT_PROXY_SERVER` may select the approved proxy for a scoped remote check. Browser CA trust may differ from Node/Python; keep TLS verification and report the limit rather than ignore certificate errors. A TLS-valid request bridge is evidence for that path, not proof native browser trust was fixed.

## Sources and safe continuation

`pnpm test:docs` verifies byte-preserved originals, protected working copies, V2 owner packets, UX ledger consistency and handoff links. Do not regenerate hashes to hide drift. Dated release records and evidence manifests remain historical; update current guides/matrix with new evidence instead.

See [verification and continuation](../verification-guide.md) for a complete journey audit and [deployment](deployment.md) for exact-SHA release. Keep credentials, personal data, reset URLs and MFA material out of source and test artifacts.
