# ADR041: Programme-specific participant invitations and consent

Status: bounded local implementation and tests; full exact-head CI/source release and actual provider acceptance pending. Requirements V3-06-006 and participant portions of V3-02-048/V3-02-049/V3-02-059 remain MISSING/PARTIAL. This is synthetic-only engineering, not outreach or admission activation.

## Preservation boundary

Reuse canonical app.delivery_programme and the accepted customer programme ownership command. Original app.delivery_participant is a confirmed-import record, enforced by the original delivery guard and deferred import-acceptance constraint. Do not manufacture an import to represent independent customer onboarding, change that invariant, copy missions or grant organiser workspace membership to participants.

Add programme-specific private invitations, consented registrations and append-only revocations referencing the canonical programme. They represent a new customer entry authority alongside original staff imports. A participant retains their own account and independent commercial authorities. No organiser gains private mission requirements, contacts, offers, negotiations, quotations or values. Later mission attachment requires a separate explicit participant grant and canonical mission reference; it is not implemented here.

## New authority and blast radius

Separate optional additive installer after the programme module. New private tables/RLS/functions and scoped customer service/API/UI only. No existing function, ACL, RLS policy, approved migration, source, money or historical event changes. Reuse the original customer proof, workspace-access lock and private workspace_access_event helper for actual service/customer event attribution and atomic audit/outbox. Event payloads contain opaque programme/registration IDs and operation, not tokens, provider subjects, private profiles or commercial records. Recheck wall-clock proof and invitation expiry after waits; lock the active executor during mutation.

Only a current admitted verified workspace owner/admin may invite, inspect expressly consented registration labels or revoke programme access. Accepting a valid single-use invitation grants only registration in that programme. A code holder must first inspect the programme and explicitly consent to a fictional display label visible to its organisers. No email matching, account creation, workspace membership or staff impersonation. A user may organise and participate in different programmes under one account.

Tokens use the existing 32-byte base64url pattern; only a digest reaches PostgreSQL. The secret is returned once, held in page memory and never placed in a URL, storage, logs or events. An uncertain issuance retry returns the same invitation ID without recovering a secret; revoke/reissue explicitly. Exact accept/revoke retries recheck current proof, scope, expiry and revocation rather than replaying stale authorization. A revoked registration cannot silently rejoin with an old command or code. Future re-enrolment requires a separately reviewed policy.

## Bounded experience and acceptance

New gates default off, require synthetic programme/workspace mode and nonproduction. No automatic mail, notifications, provider changes, cloud module installation, real admission or D01–D06/D08 activation. Owner/admin programme controls and participant join/own-registration views remain contextual, relative and scoped. Loading, empty, malformed, conflict, denied, expired/revoked, interruption, retry and unavailable states are required. Private content clears on hide/account change and has a bounded display window; no paging extension of old authorization.

Mandatory database checks: populated old function/ACL/RLS/row/receipt equality, repeat/unknown installer history, true owner/admin and participant positives, colleague/other-tenant/provider/proof/private-SQL denials, single-use/concurrent retries, revocation and expiry after lock waits, exact immutable event/audit/outbox counts and rollback, no staff/workspace membership or private mission grant. Actual component/compiled-route tests and full exact-head CI/READY source deployment remain separate. Actual managed-provider acceptance remains NOT VERIFIED. Full Delegation OS, eligibility decisions, private missions, agendas/meetings and economics remain unfinished.

Rollback disables the independent flag and retains immutable invitations,consents,revocations and canonical events. No down migration or historical erasure.

Invitation expiry/revocation stops preview/new acceptance but does not silently revoke an already consented registration. Registration revocation or self-withdrawal ends that separate programme grant. Neither operation changes an independent commercial mission or report permission. Registration is self-declared REGISTERED,not eligibility confirmation,an accepted meeting or a commercial result.
