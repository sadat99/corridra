# Part 01 release record

Date: 4 October 2026

Status: local validation passed. Remote push and Vercel publication are being completed.

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

## Current external prerequisites

Vercel's existing proxy-backed authentication can access the `corridra` project associated with `sadat99/corridra`. The CLI rejects proxy placeholder syntax before making a request, so release operations use the supported HTTPS REST API. No credential value is printed or committed. The project uses Node 24.x; monorepo root settings are being verified before release.

Git reads work through the existing HTTPS proxy. GitHub API requests currently return Forbidden, so repository protection, remote CI status and Vercel Git integration cannot be inferred from CLI API queries. Test Git push separately before claiming write access.
