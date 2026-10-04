# Part 02 release record

Date: 4 October 2026

Status: Part 02 delivered, merged through PR and publicly deployed. Mission planning and accounts remain upcoming.

## Scope and acceptance

Expanded homepage, nine planned solution/information routes, shared responsive navigation, local typography and graphic assets, cards, actions, field styling and evidence-label explanations. `/plan` and `/signin` explain their upcoming status without collecting data. `/coming-soon` retains the Part 01 content. No database, identity, AI execution, outreach or network task system is introduced.

[Design system and route acceptance criteria](../design/public-experience.md) document the behavior. All supplied documents and approved working copies remain unchanged. New public copy uses the approved commercial framing, clearly identifies planned capabilities and contains no em dashes.

## Local validation

- Formatting, ESLint, strict TypeScript and static production build passed.
- All 7 document-integrity tests passed.
- All 44 production browser checks passed on desktop and mobile. They cover all routes, skip links, disclosure navigation, Escape/focus restoration, narrow menus, overflow, reduced motion, JavaScript errors, internal links, local asset requests, security headers, 404 behavior and evidence distinctions.
- Axe scans report zero tested WCAG A/AA violations through 2.2, including expanded navigation. This is automated evidence, not a claim of complete conformance.
- Desktop homepage, mobile homepage and sourcing-page screenshots were visually reviewed. Local SVG arrows replace unsupported font glyphs.
- Lighthouse mobile lab results and deployment identities are recorded in the release evidence below. Field Core Web Vitals and real-traffic INP remain unmeasured.

## Release controls and limitations

Use a short-lived PR branch, GitHub CI and a Vercel deployment of the exact pushed revision. GitHub repository and Actions APIs now work, but branch-protection inspection still returns integration HTTP 403. Protection is not claimed as configured or verified, and no bypass is requested.

Vercel deployment URLs require authentication. Preview readiness and exact Git source can be checked through the deployment API, but an unauthenticated preview visit redirects to login. No deployment protection is disabled. Public production checks use the production alias.

Remote Chromium HTTPS navigation previously failed at the cloud proxy certificate trust path. No global trust store changes or TLS-verification bypasses are made. The release relies on browser checks against the local production build and TLS-verified HTTP checks against the public deployment; remote browser flows are not claimed as passed.

The existing Vercel Git-triggered collaboration check remains an account prerequisite for automatic deployments. Explicit release uses the authenticated API and verified Git source. No production application secrets are needed by these public pages.

## Rollback

Restore Part 01 deployment `dpl_4RoBpLeKddNwGEuYsxP1AnrRKtzu` or redeploy its source `424d80a0adfdcbc2cbda89030df7db4eb4fb1962` using the documented Vercel release procedure. This release has no data migrations, submissions or mutable application state. Keep the previous deployment until the new production routes are verified.

## Mobile lab evidence

Lighthouse 13.5.0, Chromium 151, default simulated mobile throttling, local production build:

| Route     | Performance | Accessibility | LCP   | TBT    | CLS |
| --------- | ----------- | ------------- | ----- | ------ | --- |
| `/`       | 98          | 100           | 2.0 s | 110 ms | 0   |
| `/source` | 98          | 100           | 2.2 s | 140 ms | 0   |

[Machine-readable results](../design/public-lab-results.json) record timing, device settings and runtime. Final runs have no warnings. An intermediate sourcing audit is excluded because it reached a stale running server after a rebuild and its CSS assets were unavailable; restarting against the final build restored the intended page. Lab results are environment dependent and do not establish field INP.

## Verified release

- Implementation PR: https://github.com/sadat99/corridra/pull/1, merged after CI and Vercel checks passed.
- Application release commit on `main`: `0a5ac5e9e222461e1ea940e684ac3a2452bde008`.
- Preview source: `2af94e406575b2eb5c155e2af0ab5ce266a9c7e5`.
- Preview deployment: `dpl_GeBv9rv4NFwXeb4DYx3op6owWuFS`, READY; https://corridra-4n7mpzpf0-sadat-os.vercel.app. Unauthenticated visits redirect to Vercel login.
- Production deployment: `dpl_HD1EauY71XrcfMzMq4De4t6ifvcR`, READY, exact merged application commit verified through `gitSource`.
- Deployment URL: https://corridra-6zqzm1pf9-sadat-os.vercel.app (login protected).
- Public site: https://corridra.vercel.app. Vercel confirms this alias is assigned.
- PR CI: https://github.com/sadat99/corridra/actions/runs/37203178620, completed successfully.
- Main CI: https://github.com/sadat99/corridra/actions/runs/37203296467, completed successfully.

TLS-verified unauthenticated HTTP checks at 12:48:52 UTC on 4 October 2026 passed for all 13 public routes. Every response returned HTTP 200 with its expected heading, no em dashes in rendered copy, production CSP without `unsafe-eval` and the expected content-type security header. The homepage contains the new objective cards, and `/coming-soon` still serves the original launch content. [Recorded public checks](part-02-public-checks.json) preserve the route-level evidence.

This is an authenticated release of the merged Git revision. It does not establish that automatic Git deployments or branch-protection settings are configured correctly. Detailed GitHub log downloads are inaccessible through the current integration; successful run/job outcomes were verified through the Actions API.
