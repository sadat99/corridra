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
