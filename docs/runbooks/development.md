# Development environment

## Tools and installation

Pinned runtime: Node 24.19.0. Pinned package manager: pnpm 11.19.0. Use the existing isolated `/workspace/corridra` checkout. Do not create a Git worktree unless requested.

The cloud filesystem permits writes under `/workspace` and `/tmp`. Keep dependency and package-manager caches there:

```sh
cd /workspace/corridra
export XDG_DATA_HOME=/workspace/.cache/xdg
export NPM_CONFIG_CACHE=/workspace/.cache/npm
export npm_config_store_dir=/workspace/.cache/pnpm/store
export NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
```

These exports affect only the task shell and its children. They contain no credentials and do not change a system home directory. Normal developer machines and Vercel can use their default caches. The workspace permits build scripts only for `sharp`, `unrs-resolver` and the pinned `esbuild` binary.

## Startup and readiness

```sh
cd /workspace/corridra
pnpm dev
```

For a production smoke check:

```sh
pnpm build
pnpm start
```

Keep the service in a managed shell session. A saved filesystem does not retain the process. Check the actual response locally, including status, title, headline and coming soon status; an open port alone is insufficient. The browser suite starts its own production server on port 3100 and refuses to reuse a development process. It can run while `pnpm dev` serves port 3000.

## Validation in this cloud machine

The installed Chromium is available at `/usr/bin/chromium`:

```sh
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
pnpm db:local
pnpm db:prepare-local
pnpm scanner:local
pnpm check
```

On machines without Chromium, use `pnpm exec playwright install --with-deps chromium`, preserving TLS and download verification. The browser tests support `PLAYWRIGHT_BASE_URL` for an existing deployment. Use it only against the intended public release, not a protected preview that requires additional auth.

For networked checks, `PLAYWRIGHT_PROXY_SERVER` can select the configured HTTPS proxy. Chromium may still lack usable cloud-proxy CA trust even while Python and Node HTTP clients validate the public site. Do not set `ignoreHTTPSErrors`, disable certificate checks or modify a global trust store solely to force a passing result. Verify public HTTPS responses with the configured trust, keep local production browser evidence and report the remote-browser limitation separately.

Original source documents are excluded from formatting and Git line-ending conversion. Do not regenerate the manifest hashes to conceal an unintended source edit. `pnpm test:docs` compares the working copies to the preserved originals and permits only the requested constitution addition.

## Current services

Parts 01 and 02 require only the Next.js process. No database, AI, email, object storage or payment service is needed. Vercel authentication is required only for remote deployment. Add further runtime bindings and readiness checks when their implementation part begins.

Part 03 tests also require the local Docker PostgreSQL and ClamAV services above. They use generated, ignored credentials and synthetic loopback databases; the existing remote `DATABASE_URL` is never used. The operator browser suite starts a separate production server on port 3200. Follow [the foundation runbook](part-03-foundations.md) for EU infrastructure and [ADR-015](../adr/0015-production-domain-and-explicit-unscanned-evidence.md) for the owner-authorized production-domain rollout and deferred scanner/account controls.

Parts 04 and 05 use the same services and now apply eight reviewed migrations. The live deployment supports test mission intake, operator commands and manual research/shortlists using invented identities and @example.invalid contacts. No AI, outreach, email, calendar or payment service is required for these parts. Real customer activation remains gated. Read [the Part 05 runbook](part-05-counterparties.md) and [release evidence](../implementation/part-05-production-rollout.json) before research or cloud database changes. Never reset the retained synthetic database, original owner accounts or private Blob store.

The Part 05 CI inventory has 124 tests: 7 document, 7 infrastructure, 62 integration, 46 public browser and 2 protected operator tests. Counts are evidence for that release; use the current runner result on later tasks. All tenant-ID tables require RLS, relationship visibility governs private contacts/notes, and entity review requires fresh MFA. A sourced identity or certificate is not an independently verified commercial fit.
