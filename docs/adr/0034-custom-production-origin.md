# ADR-034: Use the owned Corridra subdomain as the production origin

Status: operational repair under verification, 17 October 2026. Owner reports that navigation from c.obsidianglobal.studio unexpectedly opens corridra.vercel.app. This amends the production front-door origin recorded with ADR020; identity and commercial activation authorities remain unchanged.

## Cause and decision

The current production APP_ORIGIN is https://corridra.vercel.app. apps/web/proxy.ts deliberately redirects account, staff and protected workflow pages to that one configured origin through canonicalPageRedirect. The relative navigation links are correct; their destination middleware canonicalizes to the hosting alias. Disabling that protection or accepting arbitrary request hosts would weaken the existing exact-origin cookie, callback and CSRF boundary.

Set the production APP_ORIGIN to https://c.obsidianglobal.studio and add that exact HTTPS origin to the existing production customer provider redirect allowlist before deployment. Retain the old exact hosting alias in the provider allowlist for existing issued callbacks. Existing hosting-alias page links redirect to the owned subdomain, preserving their path and query; POST bodies are never redirected between origins. Keep the isolated acceptance preview's exact origin and provider separate.

## Blast radius and preservation

This changes the production canonical page, staff auth base URL, accepted API Origin and recovery callback destination. Host-scoped cookies on the old hosting alias are not transferred; people may need to sign in again on the owned subdomain. Keep signing material, provider, verified accounts, staff principals, MFA, memberships, tenant/RLS rules, original capabilities and historical records. No wildcard origin, shared cross-domain cookie, staff/customer identity merge, migration, money/event rewrite or commercial-data activation is introduced.

The only planned live settings changes are one exact trusted-domain addition on the verified production auth branch and the existing production-only APP_ORIGIN value. Require a fresh project/branch/provider mapping and actual existing alias ownership before those writes. Build/deploy the exact already-tested merged source with the new setting. Do not change preview/development settings, admission or D01-D06/D08.

## Verification and rollback

Retain the original canonical-origin tests and all full exact-source CI results. Before rollout, run a direct 26-assertion custom-origin matrix covering the real page paths, query preservation, POST non-redirect and isolated preview. Capture actual before/after HTTP redirect chains with redirect following disabled, including signup/signin/account/operator/workspace and old-host compatibility. Verify both provider allowlist entries, production custom-origin public/auth routes, anonymous session, exact-origin denial, private API gating, source/region/aliases and the unchanged isolated preview. Do not send mail, create accounts, enter credentials or claim a private authenticated browser acceptance from these read-only checks.

Rollback availability by restoring the previous production APP_ORIGIN and redeploying the retained source. Keep both narrowly approved provider domains during rollback so previously issued callbacks remain valid. Do not rotate signing material, remove accounts, rewrite histories or revert migrations.
