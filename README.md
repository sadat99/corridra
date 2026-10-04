# Corridra

Cross-border market access, starting with Bangladesh and Spain/EU.

This repository contains the complete supplied product documents, a 12-part implementation plan and Part 02's public website, with the original coming soon page retained. The main system will be built one requested part at a time.

## Documents

- [Documentation index and amendment record](docs/README.md)
- [Positioning & Messaging Constitution v1.0](docs/brand/positioning-messaging-constitution-v1.0.md)
- [Public Experience v1.0](docs/product/public-experience-v1.0.md)
- [Implementation Canvas v1.0](docs/architecture/implementation-canvas-v1.0.md)
- [12-part implementation plan](docs/implementation/plan-v1.0.md)
- [Public-launch decision](docs/adr/0001-public-launch-and-platform-boundaries.md)

Original uploads are preserved byte for byte in `docs/source/`. The constitution working copy includes the requested writing rule under section 21.

## Development

Use Node 24.19.0 and pnpm 11.19.0. The current public site needs no application secrets or external services.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The Next.js app lives in `apps/web`. Root scripts run it from the correct workspace. For the restricted cloud machine, follow [the development runbook](docs/runbooks/development.md) to keep tool caches in writable paths.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Browser tests run against the production build and cover public content, navigation, keyboard access, responsive layout, reduced motion, WCAG checks, security headers and 404 behavior. `pnpm test` verifies the supplied documents and requested amendment. Database tests begin when the database is implemented; the current site stores no submissions.

## Release

Deploy on Vercel with project Root Directory `apps/web`, Node 24.x and workspace files outside the root included. See [the deployment runbook](docs/runbooks/deployment.md) for authentication, build, public verification and rollback. See [Part 02's release record](docs/implementation/part-02-release.md) for current validation, deployment and limitations.

GitHub Actions runs the checks on PRs and pushes to `main`. Repository protection and Vercel Git integration are separate account-level settings that must be verified before the main-system work begins.
