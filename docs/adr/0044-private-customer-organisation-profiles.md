# ADR-044: Private customer organisation profiles

Status: bounded implementation. V3-06-002 and the customer organisation requirements remain PARTIAL for the whole product.

A customer workspace needs a reusable description of its own company before it can start missions without retyping the same facts. Today `organisationId` is returned as null because `app.organisation` is the globally readable canonical catalogue. Anything a customer types there would become visible across tenants and could be merged with another company by name. This decision keeps customer input private and links it to the canonical catalogue only later, through a rights-safe path that does not exist yet.

## Decision

Add an optional additive module installed by `migrateCustomerOrganisationProfiles`. It first installs the unchanged core and customer authority modules. It then adds two private append-only tables in `customer_private` and three restricted functions in `customer`.

- A revision stores one complete typed snapshot of the profile and a change reason. A new revision never rewrites an earlier one. History is immutable by trigger.
- Every revision is explicitly self-reported and unverified. The view states `provenance: SELF_REPORTED`, `verified: false` and `organisationId: null`. Nothing in this module creates, merges or reads `app.organisation`, source records, claims or evidence.
- Owners and admins write. An active member (not revoked, principal not disabled) reads the current profile. Only writers read history and change reasons. A member sees no reason text and no author.
- A write names the version it expects. A stale version fails with a reload message and writes nothing. An exact retry of a command returns the original recorded revision. A command id reused with different content is rejected.
- Authority comes only from the fresh provider proof and current membership. Caller-supplied subject, role, workspace or organisation is never trusted. The existing optional account-context headers remain rejection-only.
- Each real change records one existing domain event, audit and outbox chain with the service executor and the customer as explicit initiator. The event payload carries only the revision id and version, never profile content.
- No table is readable or writable by the runtime or auth roles directly. Access is through the three functions.

## Synthetic-only boundary

Free text must begin with `Synthetic ` and the website, when present, must use a reserved example, test or invalid host. This follows the programme-context rule and keeps the real-data gates (D01 to D06 and D08) closed. The route is off unless the existing workspace flags and `CORRIDRA_CUSTOMER_ORGANISATION_PROFILES_ENABLED` are set, the environment is synthetic and Vercel production is not the target.

## Fields

Legal name, country (an existing `app.market_scope` country), optional website, one to six commercial roles from buyer, seller, supplier, manufacturer, distributor and organiser, up to ten sectors, a size band and a short summary. Roles are contextual and not exclusive, following the one-identity rule in the V3 contract. Contacts, documents, certifications, financial data and any claim of verification are out of scope.

## Blast radius and rollback

New objects only. Core tables, staff identity, RLS policies, money, history, migrations and the other customer modules are unchanged, and the installer is verified to leave existing function definitions and policies identical. Exposure is rolled back by disabling the flag and redeploying the previous application. The additive schema and any revisions are retained and never dropped.

## Not included

Canonical organisation linking, deduplication, evidence-backed verification, per-mission profile snapshots, profile sharing with counterparties and delegation participant profiles stay unfinished and are tracked as PARTIAL. Real managed-provider acceptance remains NOT VERIFIED.

## Required acceptance

Populated upgrade preservation and repeat install, direct SQL denial for runtime and auth roles, owner write and member read split, revoked and disabled member denial, forged workspace denial, expired proof, stale version, exact and conflicting retries, concurrent writers, event content privacy, changed-account guard, private response headers, keyboard and axe checks at three widths, and the full original integration and browser suites on the exact merged head.
