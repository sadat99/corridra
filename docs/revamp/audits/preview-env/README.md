# v4.1 audit preview environment (local, synthetic data only)

Copy this folder to `<repo>/.cache/audit/` (gitignored), then:

1. Recipe steps 1-3 (pnpm install, Postgres 16 on 127.0.0.1:54329 from /usr/lib/postgresql/16/bin, `.cache/part03-local.json`, `pnpm db:prepare-local`, `pnpm build`).
2. `.cache/audit/serve.sh on` (or `off`) in the background. Port 3200/3201 and DB corridra_browser are fixed: one preview at a time. Every start recreates the DB.
3. `node .cache/audit/prepare.mjs` (about 75 s): installs optional modules, seeds synthetic data, signs in 10 accounts, writes `.cache/audit/env.json` and `state-<role>.json`.
4. `node .cache/audit/check.mjs <role> [--shots]` smoke-loads the main screens.

Roles: owner, admin, operator (ordinary member), reviewer, viewer, helper (/contributor), customer, organiser, participant, seller (cookie-only via scripts/qa/fake-neon-auth.mjs; use lib.mjs cookieClient for API calls).
Fragile: start the server only through serve.sh (preload.mjs via NODE_OPTIONS keeps customer sign-in); sign-in limited to 5/min; extra switches in serve.sh (REPLY_PAGE, PROGRAMME_PAGES, HELPER_INTEREST, SOURCING_WORKFLOW, CUSTOMER_*_ENABLED) are on in both modes.
Still empty locally: helper interest register, supply candidates, real billing/invoicing, /account/notifications (NOTIFICATIONS_V2 off).
