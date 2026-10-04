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

These exports affect only the task shell and its children. They contain no credentials and do not change a system home directory. Normal developer machines and Vercel can use their default caches. The workspace permits build scripts only for `sharp` and `unrs-resolver`.

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
pnpm check
```

On machines without Chromium, use `pnpm exec playwright install --with-deps chromium`, preserving TLS and download verification. The browser tests support `PLAYWRIGHT_BASE_URL` for an existing deployment. Use it only against the intended public release, not a protected preview that requires additional auth.

For networked checks, `PLAYWRIGHT_PROXY_SERVER` can select the configured HTTPS proxy. Chromium may still lack usable cloud-proxy CA trust even while Python and Node HTTP clients validate the public site. Do not set `ignoreHTTPSErrors`, disable certificate checks or modify a global trust store solely to force a passing result. Verify public HTTPS responses with the configured trust, keep local production browser evidence and report the remote-browser limitation separately.

Original source documents are excluded from formatting and Git line-ending conversion. Do not regenerate the manifest hashes to conceal an unintended source edit. `pnpm test:docs` compares the working copies to the preserved originals and permits only the requested constitution addition.

## Current services

Part 01 requires only the Next.js process. No database, AI, email, object storage or payment service is needed. Vercel authentication is required only for remote deployment. Add further runtime bindings and readiness checks when their implementation part begins.
