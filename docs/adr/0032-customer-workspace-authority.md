# ADR-032: Customer workspace authority, preserved staff security

Status: proposed; not implemented. Synthetic-only. Migration acceptance conflict unresolved.

V3 requirements V3-06-002 through V3-06-006 need customer-owned workspaces, memberships, persistent missions and independent delegation administration. Existing customer identity remains Managed Neon Auth; staff identity remains self-managed Better Auth with TOTP. Neither email equality nor a customer account can create staff authority. This amends forward from ADR-003 and ADR-020 without replacing their staff permissions.

The intended model reuses app.tenant and canonical app.organisation. Customer memberships must be separate from app.membership, whose identities and authorisation require staff MFA. Do not add customer alternatives to app.actor_id, app.member_role or existing evidence/source/financial RLS. A trusted server checks the current provider session and verified email before issuing any bounded customer database proof. Runtime SQL cannot mint or inspect those proofs. Customer database access must independently enforce current membership and selected tenant; caller-supplied subject, email, organisation, role or tenant is never proof of authority.

First implementation packet is limited to synthetic workspace provisioning and owner listing. Additive tables/functions must enforce atomic provisioning and retry conflict semantics, reuse one organisation identity within its rights boundary, append audit/events, and grant no source, staff, financial or other tenant access. Do not expose creation controls until the API and restricted-role tests work. Production remains disabled behind a dedicated flag; real-data gates do not open with a passing test or deployment.

Subsequent separately verified packets add invitations/membership revocation, explicit mission ownership/access, programme administration and participant scope, and exact-currency organiser economics. Existing managed delivery links, publications, exports, cancellation, recovery and all expert routes remain valid. Existing mission/delegation domain services remain the commercial engine. No billing provider, new CRM or second mission backend is required by this decision.

Required acceptance includes fresh install and populated additive upgrade; original migration/source hashes; unverified, expired and revoked customer sessions; forged subject/tenant and cross-tenant denial; customer-to-staff denial even with matching email; last-owner protection; atomic duplicate/conflicting retries; pool context cleanup; and the full original integration and browser regressions. Actual received OTP, sign-in/out, reload and revocation are separate provider acceptance, not inferred from anonymous get-session200.

## Unresolved acceptance conflict

`tests/integration/foundations.test.ts:73` asserts exactly29 rows in migrations.applied after the current migration runner. Adding a required migration changes that count. The owner's V3 execution rules prohibit editing, skipping or weakening an original test to make it pass. No migration or test has been changed to circumvent this assertion. A separate migration stream, silently limiting old fixtures to old migrations, falsifying migration history or suppressing that suite solely to evade the assertion would not resolve the preservation requirement. This conflict blocks the additive-schema packet under the literal current instructions. Independent V3 work that requires no new migration can continue; no additional general release approval is needed.

## Rollback and blast radius

This proposed decision changes no auth implementation, RLS policy, migration or data. When implementation becomes possible, deploy schema additively before enabling the customer flag; disable the flag and redeploy the compatible application to roll back exposure. Retain new canonical records and audit/history, and leave all historic migrations immutable.
