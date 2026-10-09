# ADR-020: Neon Auth accounts and preserved operator MFA

Status: accepted for implementation; production account activation awaits configuration.

The owner selected Neon Auth for customer signup, email verification, sign-in, sign-out and password recovery. These flows use Managed Better Auth through the pinned official `@neondatabase/auth` Next.js SDK and a same-origin proxy. Operator identities continue to use the established Better Auth password/TOTP flow at `/api/operator-auth`: managed Neon MFA remains on the provider roadmap. Customer signup grants no tenant membership or operator access. Email equality never links these identity stores automatically. No-account buyer capabilities remain unchanged.

Only required account API paths are exposed. Mutation origins must match the application origin, request bodies are bounded, account responses are private and uncached, and the protected profile checks provider sessions and verified email. Password reset pages suppress referrers. SDK 0.5.0-beta incorrectly checks `disableCookieCache` only against the string `"true"`, although its public type accepts a boolean. A single-line pinned package patch also recognizes boolean `true`, allowing the protected account route to consult the provider after session revocation. Removing this patch requires the upstream fix and a stale-cookie revocation check.

Development uses an isolated Frankfurt Neon branch and separate cookie signing material. Production needs custom SMTP, tested inbox delivery, exact trusted origins, email verification and disabled localhost access. Shared Neon SMTP is for development. Neon Auth sends identity mail; it does not provide customer outreach or general transactional email. Credentials belong in Neon and deployment settings.

Sadat and Gulshan, Dhaka were supplied as owner and location. A monitored privacy/support contact and approved customer retention remain to be confirmed. The existing synthetic-only mission, source and outreach rules remain in force until the customer activation requirements are actually met. Production account activation must not imply paid-customer readiness.

The operator workspace now retains its selected tenant in a validated URL parameter. Selection is accepted only from the authenticated user's accessible tenants; PostgreSQL isolation remains authoritative.
