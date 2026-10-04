# ADR-003: Global entities, tenant-private records and database authorization

Status: implemented and tested locally; protected cloud preview pending.

Global organisation and country primitives are separate from tenant-private relationships. Tenant records use composite `(tenant_id, id)` references. Membership carries role, permitted purposes, classifications and operating countries. Applications authorize commands; PostgreSQL independently enforces RLS. Relationship notes additionally require ownership or an owner/admin/reviewer role.

A transaction sets the selected tenant, purpose and SHA-256 session token hash, never a caller-supplied actor ID. Fixed-search-path SECURITY DEFINER functions resolve the private identity session, enrolled MFA, recent assurance, active principal and membership. Transaction-local settings are cleared on pool return. Runtime identities cannot read the session tokens, switch to the identity group or become table owners. Schema owners remain trusted administrators; RLS is not forced on the owner because the tightly scoped membership lookup must avoid recursive policies. This trust boundary is tested and explicit.

Better Auth sits behind an identity-provider adapter. Invite-only password accounts require TOTP enrollment before any tenant access. Sessions last at most 24 hours; strong MFA assurance lasts 12 hours. Membership changes, configuration and verification require a check within five minutes. Server-side session lookups and database-backed throttling avoid cached revocation. Signup is disabled. All auth POST requests require the exact configured origin. Cookies are HTTP-only, SameSite Lax and secure on HTTPS. Backup codes or trusted devices alone do not establish the workspace MFA assurance.

TOTP is the initial privileged MFA choice. Passkeys are not implemented or claimed. A hosted provider would reduce authentication maintenance but add a vendor and region/contract dependency; the adapter permits a later replacement. Password recovery and privilege recovery are offline, audited administrator procedures during this synthetic preview. Do not open production identities until recovery, invitation delivery and contractual review are ready.

Operating country is administratively assigned, not inferred from an IP address. This enforces recorded access policy; it does not prove a person's physical location or a lawful international transfer.
