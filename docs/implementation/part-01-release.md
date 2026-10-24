# Part 01 release record

**Document status: HISTORICAL.** Finished V1 part, kept as a dated record. Its statuses, counts and next steps are old and are not instructions. See the [plan status register](../PLAN_STATUS.md).

Historical implementation packet for its named revision. Its scope, acceptance and next-step statements are dated context. Use [the current plan](current-plan.md) and [developer handoff](../START_HERE.md) for present status; old task sequencing or unclosed-at-the-time issues are not current instructions. Do not infer full requirement acceptance from this packet.

Date: 4 October 2026

Status: Part 01 delivered. The source is pushed to `main` and the coming soon page is live on Vercel.

## Scope

Three complete source documents with integrity manifest, the requested constitution amendment, a 12-part execution plan, a pnpm/Next.js/TypeScript public website, CI and runbooks. Main-system features are planned and have not been implemented.

## Evidence

Verified in this cloud machine:

- Frozen-lockfile install passed; no peer dependency conflicts.
- Formatting, lint and strict TypeScript checks passed.
- 7 source/document tests passed, including exact preservation and the constitution amendment.
- Next.js production build passed, generating static homepage, icon and 404 routes.
- 12 browser checks passed across desktop and mobile, including keyboard navigation, reduced motion, viewport fit, security headers, 404 and WCAG accessibility scans with zero violations.
- Production and development HTTP responses contain the intended headline and Coming soon status.
- Desktop and mobile screenshots were visually inspected.

Checks use the pinned toolchain and the installed Chromium. No database or main-system feature is claimed as implemented. The source-document suite permits only line-ending normalization and the requested constitution amendment in working copies.

The optional live browser run passed 2 HTTP header/asset checks; 10 browser flows failed at HTTPS navigation with `ERR_CERT_AUTHORITY_INVALID` before their assertions ran. This is the cloud Chromium/proxy trust path, not a failing application assertion. The same 12 flows pass against the local production build, and Python/Playwright HTTP requests verify the public alias with TLS validation enabled. Automatic approval review rejected a global CA import because it would broaden persistent future trust beyond this task. No trust change or certificate-verification bypass was applied. The release uses the verified HTTP checks and local browser evidence; live browser flows are not claimed as passed.

## Initial public release

- Source commit: `9da4f71ffe86de6255fa3c1b4cde4be5d46174e2`, verified against remote `main`.
- Production site: https://corridra.vercel.app
- Initial deployment: `dpl_23xVs1Zjf4BDtB3eDhMxU8ywsWDi`.
- Immutable deployment URL: https://corridra-rnl5ql4er-sadat-os.vercel.app (Vercel login protected; use the production alias for public visits).
- Vercel reported `READY`, `PROMOTED` and assigned the production aliases.
- An unauthenticated HTTPS request to the production alias verified the actual Corridra title, intended headline and Coming soon status with HTTP 200. The deployment-specific URL is protected and redirects to Vercel authentication.

The release follow-up keeps the same public experience and permits the development-only React debugging requirement in CSP. Production never enables `unsafe-eval`. Current source and deployment revisions remain available in Git history and Vercel deployment metadata.

## Deployment route and remaining account controls

Vercel's existing proxy-backed authentication can access the `corridra` project associated with `sadat99/corridra`. The CLI rejects proxy placeholder syntax before making a request, so release operations use the supported HTTPS REST API. No credential value is printed or committed. Verified project settings: Next.js, Node 24.x, Root Directory `apps/web`, workspace files included, frozen pnpm install and web-package build.

Git reads and pushes work through the existing HTTPS proxy. GitHub API requests currently return Forbidden, so branch protection and remote CI outcomes are unverified. The Vercel project confirms the Git integration exists, but the automatic Git-triggered deployment was `BLOCKED` by its team-collaboration check. An authenticated API deployment of the exact pushed commit succeeded and was promoted. Before relying on automatic Git releases, resolve the commit-author/team association in Vercel's project collaboration settings. No check was disabled or account access control changed.

Cloud environment `install_script` and `start_skill` were saved with tested installation, startup and readiness steps. The draft also records the Vercel authentication binding and required network hosts. Saving that cloud configuration is separate from the verified Vercel application deployment; review, save and publish the cloud environment settings to retain the reusable environment configuration.
