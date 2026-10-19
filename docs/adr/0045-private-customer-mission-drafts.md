# ADR-045: Private customer mission drafts

Status: bounded implementation. V3-06-004, V3-04-033 and V3-04-040 remain PARTIAL for the whole product.

The request form asks for the same facts every time and has no way to stop and resume. The V3 contract asks for the minimum questions that produce a meaningful next step, saved or reusable authorised information, draft continuation, safe retries and no unnecessary repeated input. This decision adds a private drafting layer in front of the existing request. It does not add a second mission backend.

## Decision

Add an optional additive module installed by `migrateCustomerMissionDrafts`. It first installs the core, customer authority, request and organisation-profile modules unchanged. It then adds four private tables in `customer_private` and four restricted functions in `customer`.

- A draft belongs to its creator inside one synthetic workspace. No owner, admin, member or organiser sees another person's draft. Workspace membership is required to write or read, so leaving the workspace ends draft access. A submitted request keeps its own unchanged creator-only rules.
- A draft is a chain of immutable revisions. Each save names the version it expects, so a stale tab fails and writes nothing. An exact retry returns the original revision. A command id reused with different content is rejected.
- A draft records which of the three product families it serves (buyers and partners, suppliers and products, delegation), or other. Requirements are labelled lines, so sourcing, machinery and delegation prompts can differ without a schema per family. Original wording is kept exactly. Nothing is inferred, translated or scored.
- A draft may pin the saved company profile version it was prefilled from. SQL checks that this version exists in the same workspace. The pin is provenance only; it grants no access to the profile and copies no profile content.
- Submission uses the unchanged private request path and its existing admission, attestation and receipt rules. A separate close command then records `SUBMITTED` against the creator's own non-revoked request, or `DISCARDED`. A closed draft accepts no further revisions. Closing is exact-retry safe.
- Each save and close records one existing event, audit and outbox chain with the service executor and the customer as explicit initiator. Payloads carry identifiers and version numbers only, never draft content.
- Tables are not directly readable or writable by the runtime or auth roles. All access goes through the four functions.

## Synthetic-only boundary

Titles and free text must begin with `Synthetic `, contact email must end in `@example.invalid`, and a website must use a reserved example, test or invalid host. The module needs the existing request admission, so a customer who cannot submit requests cannot draft. The route is off unless the workspace, request and profile flags and `CORRIDRA_CUSTOMER_MISSION_DRAFTS_ENABLED` are set, the environment is synthetic and Vercel production is not the target. D01 to D06 and D08 stay closed.

## Blast radius and rollback

New objects only. Core tables, staff identity, RLS policies, the request factory, money, history and every earlier customer module are unchanged, and the installer is verified to leave existing function definitions, policies and registries identical. Rollback is disabling the flag and redeploying the previous application. The additive schema and any drafts are retained and never dropped.

## Not included

Supplier or buyer targeting, shortlist authoring, quotations and any change to how staff run a request are unchanged. AI assistance with wording, document upload, sharing a draft with colleagues and organiser-side drafting for participants are not included. Real managed-provider acceptance remains NOT VERIFIED.

## Required acceptance

Populated upgrade preservation and repeat install, direct SQL denial for runtime and auth roles, creator-only isolation including from the workspace owner, missing request admission, revoked and disabled member denial, forged workspace and draft ids, stale version, exact and conflicting retries, concurrent writers, closed-draft immutability, submitted-link integrity (another creator's, another workspace's and revoked requests are refused), event privacy, expired proof, changed-account guard, private response headers, keyboard and axe checks at three widths, and the full original integration and browser suites on the exact merged head.
