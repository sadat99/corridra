# Neon Auth accounts

The customer account routes are `/signup`, `/signin`, `/verify-email`, `/forgot-password`, `/reset-password` and `/account`. Invited operators use `/operator/signin` with their existing password and TOTP. Creating a customer account grants no workspace membership. See [ADR-020](../adr/0020-neon-auth-accounts-and-preserved-operator-mfa.md).

## Development and preview

Use an isolated Frankfurt branch with Managed Better Auth and the Corridra application name. Add only exact application origins to Neon trusted domains. Register local loopback origins explicitly; secure cookie checks need HTTPS. Configure `CORRIDRA_NEON_AUTH_ENABLED=true`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (at least 32 random characters) and exact `APP_ORIGIN` through secure settings. Preview uses its own branch and signing secret. Never copy the production database roles into a preview.

The legacy marketplace resource also automatically creates preview branches, even though the app uses separately configured roles. Its free branch limit blocked this preview before the build. The completed Part 06 non-default preview was reused by renaming it; its ID, parent and data were preserved. The live application branch and dedicated auth development branch were untouched. Resource connection scope should be maintained as production only when the owner-access configuration API is available; do not delete branches or purchase an upgrade merely to unblock a preview. Check integration-created variable scopes after each resource action.

Verify anonymous denial, real provider signup, unverified profile denial, password sign-in, reload, sign-out and denial when replaying the old cookie jar. Verify cross-origin rejection, body limits and unavailable administrative paths. A successful OTP or reset request is not proof of inbox delivery. Consume the actual received verification code and reset email link before claiming those journeys. Retain operator MFA, tenant isolation and public browser regression checks.

## Production activation

Neon's production checklist requires custom SMTP. The live branch is prepared with the Corridra name, mandatory verification, disabled localhost and disabled provider email signup. Its unused default Google configuration was removed after verifying the new managed directory was empty; existing operator identities were untouched. Configure the chosen SMTP service and sender securely in Neon; the app requires no SMTP password. Confirm sender ownership, successful delivery to the chosen monitored inbox, verification and recovery, trusted public origin, appropriate rate limits, controller/contact disclosure and approved retention before inviting real users. Then enable provider signup, set `CORRIDRA_NEON_AUTH_PRODUCTION_READY=true` and `CORRIDRA_NEON_AUTH_ENABLED=true` alongside production branch and signing settings and redeploy. Never use the isolated development branch for production accounts.

These account flows do not remove synthetic mission restrictions, supply a malware scanner, authorize outreach or implement later commercial opportunities. Review [the deferred controls](../implementation/deferred-controls.md) before claiming a regular paid-customer journey.

Rollback disables `CORRIDRA_NEON_AUTH_ENABLED` and redeploys, preserving existing identities and operator MFA. Do not delete the auth schema, users or branch as a rollback. Rotate signing material only with an explicit recovery plan.
