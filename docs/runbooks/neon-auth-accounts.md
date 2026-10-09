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

## Deferred signup release, 9 October 2026

The owner requested release of completed work with signup deferred so Part 07 can proceed. Production account routes retain their unavailable state; operator password/TOTP and no-account buyer responses remain usable. Keep `CORRIDRA_NEON_AUTH_ENABLED=false`, production readiness unset and Neon provider signup disabled. No account identities, memberships or schema need deleting.

Neon custom SMTP is configured with `smtp.resend.com`, port 465, user `resend`, sender name Corridra and sender `sadat@c.obsidianglobal.studio`. Its password stays in secure provider settings. Sadat's accessible inbox is `sadat@obsidianglobal.studio`; the sending address does not require a separate inbox. Resend uses Ireland (`eu-west-1`) and the TXT/MX format shown by its dashboard.

The owner supplied a Resend support check confirming DKIM, SPF TXT, sending MX and receiving MX match public Vercel DNS. That support report says the domain is partially verified, with both SPF records pending and no verified date. The current verification pass started at 12:03 PM Asia/Dhaka on 9 October 2026. The last SMTP test, at 12:11 PM, still returned 550 because the stored key's associated domain was not verified. This is provider-reported DNS evidence, not an independent Resend API inspection by this release.

Leave the verification pass running. Restarting it resets the pass. If it becomes Failed despite the matching DNS, escalate through Resend support. After Sending verifies, confirm the stored SMTP key has full access or access to `c.obsidianglobal.studio`; another domain's key can produce the same 550 error. Then test delivery to the accessible inbox and consume the actual received verification code and password-reset link. Only activate production accounts after D09 and the applicable activation gates above pass. See [the deferred controls register](../implementation/deferred-controls.md).

## Verified email release, 9 October 2026

The owner confirmed Resend domain and sending verification and requested deployment of production-ready work. Neon's saved custom SMTP passed its actual send test, and the owner confirmed receipt in the monitored `sadat@obsidianglobal.studio` inbox. The verification pass was not restarted and DNS was not changed.

One temporary customer identity was created in the previously empty live managed directory. The owner supplied its received verification code and recovery link. The real provider accepted the code, allowed verified password sign-in, consumed the reset link, rejected the old password, accepted the new password and rejected reuse of the reset token. Provider signup was restored disabled during these checks. Operator credentials, MFA and memberships were preserved.

The account notice identifies Sadat in Gulshan, Dhaka, the monitored support inbox, Frankfurt account storage, Resend identity mail, and actual manual account deletion. It does not invent a customer-brief retention policy. Mission briefs remain synthetic; account signup does not grant workspace membership, authorize outreach or close D08.

Release through the normal PR and CI gates. Read back the exact live branch URL, separate signing secret, mandatory email verification, custom SMTP, disabled localhost and trusted production origin. Enable `CORRIDRA_NEON_AUTH_PRODUCTION_READY=true` and `CORRIDRA_NEON_AUTH_ENABLED=true` only after email acceptance and release checks pass. Deploy the exact reviewed revision and verify the real browser account, reload, operator denial, signout and stale-cookie denial. Remove only the recorded temporary managed identity and its sessions after acceptance. Preserve the owner's separate operator account.

Production interactive pages on other deployment aliases redirect to the configured `APP_ORIGIN`, preserving receipt, capability and recovery query parameters. API mutations retain their original same-origin checks. Preview and local origins are unchanged. Redirects are private and suppress referrers; destinations come only from configured HTTPS origins.

Record the actual deployment SHA, READY state, received-email checks, browser results and cleanup in the release PR. Remove completed preview databases and exact retired preview settings at the end of release under the owner's standing cleanup authorization.
