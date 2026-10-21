# Customer and staff identity, setup and recovery

Current guidance as reconciled on 15 October 2026. See [access and administration](v2-access-and-launch.md), [ADR 020](../adr/0020-neon-auth-accounts-and-preserved-operator-mfa.md), [ADR 030](../adr/0030-explicit-staff-invitation-and-first-password.md) and [ADR 031](../adr/0031-operator-password-recovery-and-scoped-directory.md). The two identity systems are deliberately separate; matching email is not role authority.

## Choose the right flow

| Audience                                                      | Entry                                                      | Recovery and limits                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Customer                                                      | `/signup`, `/verify-email`, `/signin`, `/account`          | `/forgot-password` then received `/reset-password` link; no staff role granted                                                  |
| Newly invited staff/owner                                     | Verified matching customer session, then `/operator/setup` | Only an explicitly approved pending invitation can set the first staff password; sign in separately and enroll/verify real TOTP |
| Existing staff                                                | `/operator/signin`                                         | `/operator/forgot-password` and received `/operator/reset-password` link; password recovery retains MFA and memberships         |
| Lost authenticator, suspended staff or expired/new invitation | Reviewed support/owner procedure                           | No self-service MFA bypass, account resurrection or customer-to-admin conversion                                                |
| Contributor                                                   | Assigned workspace invitation and MFA                      | Exact assignee/task/capability scope; not general membership                                                                    |
| Buyer/client/programme recipient                              | Complete original private link                             | Ask its sender for a reviewed replacement if unavailable; customer signup cannot replace the capability                         |

Customer provider proxy is `/api/auth`; staff provider is `/api/operator-auth`. Forms use native POST before hydration, bounded same-origin callbacks, generic failure/recovery messages and duplicate submission guards where implemented. Never put credentials or reset material in URLs, logs, screenshots, traces or chat.

## Managed customer identity

Use an isolated Frankfurt Neon Auth branch, application name Corridra, mandatory verification and exact trusted origins. Secure settings include `CORRIDRA_NEON_AUTH_ENABLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (at least 32 random characters) and exact `APP_ORIGIN`; production additionally requires `CORRIDRA_NEON_AUTH_PRODUCTION_READY`. Preview uses its own branch and signing secret. Review actual provider settings; an app flag alone is insufficient.

Production customer signup/email recovery was activated and accepted in PR 26 on 9 October 2026. Custom SMTP stays configured in Neon; its saved password is not exposed to the app. Original troubleshooting/disabled-signup stages are historical, superseded by [the dated activation record](../implementation/neon-auth-production-activation.json). Do not replay those old activation steps or delete a populated managed directory. Identity email is distinct from mission outreach. Preserve the monitored account-support contact and accurate privacy notice without inventing retention/DSAR execution.

## Separate staff password recovery

Staff recovery uses the existing Better Auth token store and separate Resend HTTPS sending configuration. Set only through secure deployment settings: `CORRIDRA_OPERATOR_RECOVERY_ENABLED`, sensitive `OPERATOR_RECOVERY_EMAIL_KEY` and `OPERATOR_RECOVERY_EMAIL_FROM`. A saved Neon SMTP credential is not automatically available to this transport; never copy a management API key into runtime. Missing configuration disables recovery rather than collecting an unusable credential.

Only existing verified staff with enabled principals receive mail. Unknown, suspended, unverified and pending-invitation identities receive the same generic response without delivery. Tokens expire after 30 minutes and are one-use; callbacks must be exact same-origin destinations. Reset revokes sessions and preserves the staff principal, tenant memberships and TOTP. The next sign-in still requires the authenticator. The additive migration `0029_identity_password_audit.sql` records credential changes without storing password, hash or token in the event. Builds never apply migrations.

The verified customer invitation hint uses the existing protected setup status and no persistent storage. A pending invitation is setup, not an existing-staff password reset. The scoped member selector resolves only permitted existing workspace principals after `audit.read`; only owners with fresh MFA can change memberships, retaining last-owner protection and immutable history. It is not a provider-wide customer directory.

## Actual acceptance and how to diagnose

[PR 46 acceptance](../implementation/access-recovery-production-acceptance.json) records exact revision/CI/READY deployment, audit migration and read-only production observations. The owner privately completed staff password/MFA and confirmed workspace entry. Both actual customer and staff reset emails were confirmed received. The latest private reset-link consumption and resulting new-password sign-in were not observed; do not claim otherwise. PR 26 separately records its original managed-customer token-consumption acceptance.

For a reported failure, identify the audience and URL first. Check eligible active identity/invitation state through authorized tools, app/provider configuration and exact callback origin. Distinguish API request acceptance, provider delivery status, inbox receipt, private token consumption and session behavior. Use at most an explicitly scoped request; do not repeatedly send mail or enumerate accounts. A 200 response is intentionally not proof the identity exists or mail arrived.

Email deliverability depends on the actual verified sender/key/domain and provider state. Do not restart DNS verification or create a new sender unnecessarily. Inspect bounded sanitized errors; never return provider bodies or credentials to users. Ask the recipient only for outcome/error text, not codes, reset links, passwords or authenticator keys.

## Rollback and gates

Disable the affected existing auth/recovery flag and redeploy if necessary, preserving users, sessions/history as applicable, memberships, MFA and migration/audit records. Do not delete schemas or user accounts as rollback. Signing-key rotation requires a recovery plan.

These identity flows do not close D08, admit real mission data, fix production scanning/storage, authorize outreach, activate AI/network execution or enable payments/payouts. See [deferred controls](../implementation/deferred-controls.md) and [route readiness](../implementation/v2-part-05-readiness.md).

## V3 synthetic customer workspace authority

The isolated provider uses email OTP. Signup sends a six-digit code; a verification link is not required. The owner confirmed code delivery on 17 October 2026 and reported the form hiding its code field. The presentation repair exposes the input on arrival and keeps a separate code request/recovery action; deployment/verification status is in ledger chunk23. Email and code remain provider-verified; never read provider OTP stores or mark an account verified administratively to substitute for a received-code walkthrough. An invalid or expired code must remain on verification with a recoverable error. Keep passwords and codes out of shared evidence.

The independently gated customer module is described in [ADR032](../adr/0032-customer-workspace-authority.md). Its [bounded acceptance](../v3/phase-3/customer-authority/report.json) and [release receipt](../v3/phase-3/customer-authority/release.json) distinguish source implementation, tests, deployment, isolated schema installation and actual customer acceptance.

`migrateCustomerAuthority` explicitly runs the unchanged core migration runner and the separately hashed customer module. Core-only deployments continue to use the original runner. Never edit the original29 SQL files, filter an old fixture or conceal the new registry. Before application, verify the exact nonproduction project, child branch, endpoint, database and schema-owner role; inspect current records and hashes. Use a direct verified-TLS connection. The existing sterile parent, live synthetic environment and production remain outside this procedure. Builds never apply schema.

The first packet creates an explicitly synthetic tenant and immutable initial owner grant. It returns `organisationId:null`, not an invented canonical company. Customer authority is separate from staff identity and app memberships. An offline schema-owner may explicitly admit a verified controlled synthetic provider subject with a recorded reason and an active service executor. Never infer this from matching email or client input. Admission is not account verification; never read OTP stores, auto-verify an address or copy production identity/signing material to obtain a passing walkthrough.

`CORRIDRA_CUSTOMER_WORKSPACES_ENABLED` defaults off, requires synthetic data and is hard-disabled in Vercel production. API controls must stay gated until the actual isolated customer session, provider verification, reload and revocation walkthrough is accepted. Database fixtures and anonymous provider responses do not establish that acceptance. Customer creation UI is not part of the first backend release. Company linking, invitations, customer missions and independent delegation/participant/economics remain separate implementation work.

For controlled identity acceptance, use the dedicated isolated preview described in the ledger and its branch-scoped settings. Keep its signing key and database logins separate, use the exact provider-listed origin and retain mandatory email verification. A controlled tester completes signup and receives/consumes the OTP privately, then checks sign-in, account reload, sign-out and stale-cookie/revocation denial. Never ask for passwords, OTPs or reset links in chat. Record observed outcomes and the exact tested revision; keep unobserved stages marked NOT VERIFIED. Do not send test mail without a designated controlled recipient.

Roll back exposure by disabling the customer flag and deploying the retained compatible application. Retain additive schema, grants, canonical records and append-only history. Remove a preview's settings, alias, deployment and Git branch only after its acceptance work is finished and no current environment depends on it. None of this opens D01-D06/D08 or authorizes commercial data, outreach, inference or payments.

### Private customer requests (optional module3)

ADR033 and the bounded request report govern this separate capability. `CORRIDRA_CUSTOMER_REQUESTS_ENABLED` defaults off, requires synthetic data and is hard-disabled in production. Workspace admission is insufficient: a schema-owner must separately admit the controlled synthetic principal through the offline procedure. Source-only release does not install a cloud migration,configure an intake destination or admit a provider account. Verify all old hashes/records and exact isolated environment before any optional installation.

New submissions require active workspace membership; prior creator-owned progress stays private after departure under fresh proof, continuing request admission, independent resource revocation and original source retention. No workspace owner/organiser gets implicit access. The new API exposes receipt progress only,never full commercial/source scope or a receipt bearer secret. Existing publication routes remain independently authorized. Disabling flags/redeploying old compatible source rolls exposure back; keep additive schema and all original records/history. Private metadata holds identifiers/digests/provenance only; real retention/legal gates remain closed.

### Owner opt-in: synthetic customer modules on production ([ADR049](../adr/0049-synthetic-production-opt-in-and-open-admission.md))

The statements above that customer flags are hard-disabled in Vercel production describe the default. The owner can opt in with two exact Production settings: `CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK=synthetic-only` and, to admit every email-verified account automatically, `CORRIDRA_CUSTOMER_OPEN_ADMISSION=synthetic-only`. `DATA_ENVIRONMENT` must stay `synthetic`. Each module still needs its own `CORRIDRA_CUSTOMER_*_ENABLED=true` flag and its database installation, which the manual `Install customer modules` workflow performs (read-only report first, then `apply=yes`, each approved by the owner in the `customer-modules-install` environment). Order: install, then set the flags, then deploy the exact commit. Rollback is unsetting the two settings and redeploying. Scanning, legal and security controls are deferred by owner decision and must be closed before any real customer data. The sign-in issuer must also be set and pinned: set `CORRIDRA_CUSTOMER_ISSUER` to the exact Neon Auth base URL and run the install workflow with `apply=yes`, `customer_issuer` (the same URL) and `customer_executor_id` (an active service principal). The pin is written once and cannot be changed. The issuer is the Neon Auth base URL of the Neon branch the app database runs on (production: project corridra-nonprod, branch corridra-live-synthetic, `https://ep-tiny-forest-b199wxno.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth`). Read it from that branch's Neon Auth configuration and confirm a sign-up lands in that branch's `neon_auth.user`; never take it from another Neon project. Sign-up for an address that already has a verified account reports success and sends no code by design.

### Team roles and leaving (optional module, ADR051)

Install with the `Install customer modules` workflow (it now includes `customer-member-role-migrations`), then set `CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED=true` and deploy. The owner can then make an invited member an admin or a regular member from the team screen, and any non-owner can leave from the workspace list. Admins can edit the company profile and plan delegations; only the owner manages the team. To withdraw an admin right before switching the flag off, demote the member first, because the role readers keep honouring recorded roles.

### Company links (optional module, ADR052)

Install with the `Install customer modules` workflow (it now includes `customer-organisation-link-migrations`, after profiles and team roles), then set `CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED=true` and deploy. Owners and admins then request a company link from the company profile page; staff with the owner, admin or reviewer role in the intake workspace decide from Companies and research in the operator console, with a fresh authenticator check. A link never writes to the company list: to add a new company, approve it for creation, create the record in the existing research screens, then link it. Roll back by unsetting the flag; recorded requests and links are kept.

### Pricing, series and exports (optional module, ADR054)

Install with the `Install customer modules` workflow (it now includes `customer-programme-pricing-migrations`, after programme templates), then set `CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED=true` next to the economics, coordination and templates flags and deploy. Owners and admins then see a Pricing, Series and Exports section on the planner page. Nothing is collected or sent; fees are the organiser's own records in the existing ledger. To stop, unset the flag; recorded schedules, editions and fees stay.
