# Accessing the revised V2 platform and completing launch

The public entry is `/workspace`, linked from the main menu, footer, account and operator workspace. This directory maps revised V2 Parts 1–5 to actual registered tools and states the permissions and activation limits. It does not reveal tenant records or grant membership.

## Which identity to use

- Customers sign in at `/signin` and open `/account`. Email verification is required. An operator must share the relevant mission with that identity or provide the existing scoped private link.
- Operators, founders and administrators sign in at `/operator/signin`, using their invited operator identity, authenticator and active tenant membership. For an explicitly prepared first invitation, first open `/operator/setup` while signed in to the matching verified customer account, choose your own separate operator password, then sign in as an operator and enroll/verify your authenticator. Customer registration alone cannot create an operator membership.
- Contributors open `/contributor` with the workspace invitation supplied by the operator. Invitations grant assigned tasks, not general workspace membership.
- Client, buyer/supplier and institution recipients use their complete private links. Public `/client`, `/buyer` and `/programme` pages explain missing-link recovery; they cannot enumerate confidential records.

The directory's tool links carry an allowlisted `next` destination through password, authenticator enrollment/verification and workspace selection. External URLs, arbitrary actions and unknown fragments are rejected. If a destination is not mounted for the current role, the workspace explains the restriction and offers available tools. Switching tenants retains the destination and rechecks available tools.

## What is interactive now

In the operator workspace, the V2 shortcuts lead to missions/requirements, research, introductions/meetings, commercial progress, client/institution delivery, source/evidence, AI/network tools, route policies and Global Operations. Owner/admin controls are role-dependent; operational overview is owner/admin/operator. Financial observations retain narrower permission checks. Root controls remain owner-only.

The live mission environment is synthetic. Use invented records. Customer signup is separately enabled and does not permit real mission activation. AI/network execution remains off in production until accepted credentials/policies and pilots exist. An empty dashboard is not an invented zero and is not permission to populate real data.

## GitHub owner setup

Use an administrator account for `sadat99/corridra`:

1. Open <https://github.com/sadat99/corridra/settings/rules>. Configure an active rule for `main` with PR review appropriate to the team, required CI `validate`, and restrictions on force pushes/deletion. Verify the rule is actually enforced for the private repository. Do not invent a second independent reviewer or bypass a rule to release.
2. Open <https://github.com/sadat99/corridra/settings/security_analysis>. Inspect actual secret scanning, push protection and code-scanning availability. Upgrade only if the actual account entitlement requires it. The latest rulesets response explicitly requires GitHub Pro for this private repository. Other 403 responses do not establish their exact entitlement requirements.
3. Inspect <https://github.com/sadat99/corridra/actions/workflows/security.yml>. Enable `CODEQL_ENABLED` only after actual entitlement/setup is confirmed, then inspect a successful analysis. A skipped CodeQL job is not a passed scan. Pinned Gitleaks and five local Semgrep rules already run in CI; their limits remain documented.
4. Inspect <https://github.com/sadat99/corridra/pulls>. Integrate compatible upgrades through accepted PRs. Never delete unfinished heads just to reduce the count. The maximum is ten Git branches including `main`; run `node scripts/check-git-branch-budget.mjs <branch>` before creating/publishing a product branch. After accepted merge and production verification, remove only proven completed Git/Neon preview branches, preserving production, sterile parents and other PRs.

Save dated settings/review evidence as a source and update the appropriate readiness observation. A guide or status label cannot replace actual server enforcement.

## Remaining real launch prerequisites

The exact register is [Part 5 controls](../implementation/v2-part-05-controls.md); direction-specific delivery is in [route readiness](../implementation/v2-part-05-readiness.md). The owner must supply approved offers, named delivery/support/QA owners, privacy/source/outreach decisions and pilot acceptance. Infrastructure must supply approved private EU evidence storage/scanning and recovery, separate candidate/real-data resources and verified bindings. Actual real-data admission remains a separately validated implementation/activation step; metadata environment validation does not activate it.

The original live browser attempt failed before sign-in because native cloud Chromium did not trust the environment proxy certificate. The follow-up synthetic acceptance used same-origin Playwright request routing through the environment's TLS-validated Node transport, with redirects rechecked and TLS verification retained. Password/TOTP, unrelated-tenant denial, a new imported synthetic mission in the existing test workspace, invoice/receipt/fee/cost/completeness writes, idempotency, exact receipt compensation and sign-out revocation passed on accepted Part 5 production. No roles, MFA settings, activation flags, real customer data or money were changed. This is operations-record acceptance, not the original full customer contract/invoice/cash production acceptance; that separate deferred journey remains open. Native Chromium trust is not claimed repaired.

AI provider setup requires accepted terms/regions, live evaluation, budgets and actual credentials. Contributor activation additionally needs eligibility/privacy/reward pilot acceptance; actual payouts still require a payout integration. Every directional service remains independently gated and can be paused without deleting its historical missions.

## Staff invitation boundaries

See [ADR 030](../adr/0030-explicit-staff-invitation-and-first-password.md). Ordinary offline invitations require fresh owner MFA. The exceptional first-human-owner procedure is restricted to the exact synthetic intake workspace, privileged schema-owner administration, independently verified customer identity, explicit owner approval and no historical human owner. It preserves all technical owners and their MFA. A pending staff principal remains disabled until the matching verified customer completes first-password setup; password-only sign-in still cannot open a workspace. Expired or existing-account recovery is separately owner-reviewed. No automatic customer-to-admin conversion, emailed secret or shared test password is used.
