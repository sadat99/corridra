# ADR-056: Real-use admission and progressive registration

Status: owner direction recorded; implementation in progress, not installed or enabled. The account return-path preparation does not admit real requests.

## Owner decision

On 21 October 2026 the owner explicitly requested real use, accepting deferral of scanning and additional security integrations. Visitors may use existing standalone signup options or start a request as a guest. At the final contact step, a new customer supplies contact details and a password, the existing identity provider creates their account, and activation leads back to the request. Existing customers sign in and continue. This refines the earlier anonymous-submission instruction. It is not a claim that deferred controls or external certification are complete.

## Existing behavior

Managed Neon Auth already handles customer signup, email verification, sign-in and recovery. Staff identity and MFA are separate. `/plan` currently sends a synthetic brief to the original mission engine and returns a receipt; it does not create a customer account. Synthetic admission is independently enforced by the form, domain schemas, server configuration and SQL. Customer modules also require synthetic workspace labels and return synthetic provenance. Removing copy or changing one flag cannot make those paths accept real use consistently.

## Decision and blast radius

1. Keep both entry paths. Carry only an allowed `/plan` destination through account access; reject external, executable, token-bearing and other destinations. Standalone access keeps `/account`. Navigation grants no request or workspace authority.
2. Keep passwords solely in form memory and the existing identity-provider transport. Never add them to mission JSON, pending requests, drafts, receipts, URLs, events or logs. Preserve verification, fresh session proofs, issuer pins, disabled-account checks, staff MFA, tenant isolation and current roles.
3. Save a guest request as a bounded pending handoff before canonical submission. Bind its later consumption to both an unguessable possession proof and the fresh email-verified provider identity. Email alone, a browser subject, a receipt identifier or a return URL cannot grant ownership. Reject mismatched accounts, expired handoffs and changed retries; consume atomically and retry safely. Reuse canonical mission preparation and private request submission rather than creating a second mission engine or transferring an old anonymous mission.
4. Add real admission through reviewed additive migrations and explicit application/database activation. Align UI, domain/service validation and SQL together. Keep existing synthetic records, migration hashes and history intact. Real records must carry real provenance and an appropriate processing purpose; never relabel historical synthetic records or represent real data as synthetic. Update existing module validation and projections consistently while preserving every permission, money, event and denial rule.
5. Reuse the explicit evidence bypass mechanism where applicable. Record unscanned evidence as `BYPASSED`, with integrity checks and the owner's recorded exception; never call it a clean scan. Deferral does not remove private storage, access checks, retention or independent evidence review. Do not activate outreach, inference, payments or payouts through this change.
6. Update the intake/privacy wording to describe actual request handling, account activation and account-based updates. Do not promise mission email delivery or integrations that are not implemented. Install and enable the four missing modules separately from source deployment. Keep billing and other absent capabilities explicitly unbuilt.

## Implementation boundaries

Real records use the existing `commercial_qualification` purpose and explicit non-synthetic tenant provenance. The optional installer retains the existing issuer and service executor, creates a separate real intake tenant, and carries active intake staff roles, classification and country limits forward to that new scope with this explicit purpose. It does not change old memberships or records. A schema-owner-only procedure pins that configuration; admission enable/pause controls append versions. Pausing admission leaves configuration and existing private access intact.

The real catalogue starts with three quote-only request types backed by the product scope: sourcing, market access and delegations. They assert no fixed fee, guaranteed coverage or external supplier capacity. Original financial calculations, exact minor amounts, quote version/digest acceptance and billing-disabled state remain unchanged. Catalogue keys cannot cross provenance. Scanning deferral uses the existing BYPASSED mechanism and an explicit configuration record, never CLEAN. Outreach, inference and payment integrations remain independently gated.

A pending handoff expires after 24 hours; expiry is not a claim of automatic deletion. Public build-time copy/validation and server admission settings must be enabled together in the checked deployment. Public settings grant no identity, workspace or database authority.

## Release and acceptance

Preserve legacy synthetic acceptance and denial tests. Add real-mode validation and database tests, populated before/after preservation, restricted-role denial, stale/revoked identity, handoff expiry, account mismatch, exact retry/concurrency and ownership isolation. Test account-first and submission-first browser journeys, activation/recovery continuation, password handling, accessibility and responsive layouts. Run every mandatory release gate and actual CodeQL analyses on the frozen head, then verify its exact merged deployment.

The `customer-modules-install` GitHub environment currently requires one reviewer. Prepare the tested versioned migration and concrete workflow run before requesting that external review. Provider-backed activation and signed-in acceptance require genuine provider outcomes; UI transport fixtures do not establish email delivery or production identity acceptance.

Rollback stops new real admission without deleting requests, identity, evidence, quotes, fees or history. Keep existing customer access and historical authority explicit; never clear data to make rollback appear successful.
