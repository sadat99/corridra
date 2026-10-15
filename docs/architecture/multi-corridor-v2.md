# Multi-corridor V2 architecture contract

Read this contract before changing missions, research, commercial origins, corridor configuration, policy or money. It records V2 Part 1 contracts; later parts added UI, governed provider adapters and operations controls under ADRs 026–031. Read [the current map](v2-current-map.md) and [current plan](../implementation/current-plan.md) for the complete implemented scope. V2 supersedes geographic rollout order, not tenant isolation, historical truth or production-data gates.

## Global identities and distinct locations

`app.country` and the domain country registry contain ISO 3166-1 alpha-2 identifiers. EU is a TRADE_BLOC market scope with dated member-country records. Bloc membership never establishes a country-level legal basis. COUNTRY, TRADE_BLOC, REGION, SUBDIVISION, CITY and COMMERCIAL_CLUSTER are market kinds. Aliases and translations reference one stable scope key. Non-country scopes are controlled reference data administered by the migration owner; tenant operators configure routes between registered scopes.

Commercial demand origin and target market are directional route endpoints. They do not encode meeting location, supplier location or shipment origin/destination. Keep those facts in their own evidence-backed records. BD→CN sourcing does not assert BD→CN shipment. Companies are not assigned exclusively to a route. Known countries must not be mapped to OTHER; that value survives only as explicit legacy unclassified input. Historical source market text is unchanged.

Currency precision comes from the controlled registry, not formatting defaults. Minor-unit strings and BigInt remain authoritative. Historical currency codes can be retained after withdrawal. Unsupported monetary/non-monetary identifiers fail validation. FX observations retain source, time, rational rate and rounding method; conversions are derived and never replace source amounts. `numerator/denominator` in the FX contract is the ratio of target minor units to source minor units.

## Tenant configuration and precedence

The existing `app.corridor` reference table remains intact. `corridor_definition` relates two sorted market scopes inside a tenant. `corridor_route` gives that relation a direction. `corridor_pack_version` stores immutable effective-dated configuration and status. Reuse `CorridorService` for new routes, packs and assignments. All writes require existing configuration authority and fresh operator MFA; SQL independently enforces owner/admin, tenant, synthetic mode, author and append-only history. SQL never lets a route change membership, source rights, verification or financial authority.

The resolution order is global → corridor → route → mission type → mission. `resolveConfiguration` intersects permitted sets and unions obligations. A lower level cannot add allowed channels/currencies/tools, remove required capabilities/reviews, or replace root policy bindings. Resolve these typed inputs before publishing an approved pack; the resulting pack is the historical snapshot, not a live reference to mutable configuration. This part does not add an arbitrary expression/rules engine or an admin UI. Raw SQL also rejects unknown fields, unsupported channels/currencies, non-IANA zones, absent review gates and AI/pricing activation.

`mission_type_definition`, `requirement_definition` and `assessment_definition` are versioned relational definitions. Packs reference exact immutable requirement/assessment IDs; mission availability uses type keys and assignments pin the exact type version. Capability readiness checks require an available status, mission type, required operator capabilities and an explicit jurisdiction decision. Current readiness permits synthetic work only. A TESTING, LIMITED or ACTIVE status alone grants no legal approval or provider coverage.

`mission_route_assignment` pins a pack and mission-type version. Appending a newer pack never changes an accepted assignment. Only the currently effective, available pack can receive a new assignment. Reclassification appends another assignment with actor/reason/version, preserving all earlier rows. Existing missions receive LEGACY_UNRESOLVED without guessed demand origins. Newly created missions with no assignment are also unclassified until explicit assignment; existing intake remains usable.

Six initial directions are available through the idempotent `seedInitialRoutes` command: BD↔ES, BD↔CN and BD↔EU. They are DRAFT, have no claimed operator coverage and cannot be assigned until reviewed. Seeds do not run automatically in production. Japan→Kenya and Brazil→Mexico use exactly the same service and schema.

## Commercial provenance and event coexistence

`OpportunityService.registerOrigin` records a current accessible source and its exact claim, mission, target, typed kind, actor and reason. Supported alternate kinds are qualified sourcing requirement, documented RFQ, supplier response and accepted introduction. Accepted introductions additionally require the matching Interested buyer response. These are human commercial observations, not independent fact verification. They cannot be arbitrary strings or cross-tenant references.

Existing `create` with `meetingId` stays intact. `createFromOrigin` takes the typed record ID. Every opportunity has exactly one meeting or alternate origin. Composite foreign keys, target relationship access and immutable identity checks apply at the database boundary. The same commercial commands, stage prerequisites, accounting review, record parentage, currency equality and compensation remain authoritative. Qualified alternate-origin missions may move from ACTIVE/TARGETING directly to COMMERCIAL_PIPELINE without a fabricated meeting; qualification-history and whole-mission closure guards still apply.

Old outcome snapshots remain byte-for-byte version 1. Alternate-origin opportunity snapshots use version 2 with `originId`; replay accepts both. Existing financial snapshots and projection version remain unchanged. No event payload is rewritten or backfilled. Null `meetingId` is deliberate for alternate origins. Consumers must not infer a meeting from commercial opportunity existence.

## Financial and privacy boundaries

Customer commercial records, supplier-origin claims and quotations remain separate from Corridra service economics. `service_ledger` records earned service fees, accepted delivery costs and contributor reward obligations. `service_margin` groups by tenant, mission and currency. It never reads customer cash/contract tables or combines currencies. No billing processor or automated payout exists.

Reward rules are effective-dated and nonoverlapping. Contributions retain mission, source, contributor and relationship disclosure. Independent owner/admin approval credits the exact rule amount once per contribution. The contributor/submitting actor cannot approve the reward. Reversals are exact append-only compensations. Reconciliation requires a third authorized actor with fresh MFA and current evidence, and cannot operate on compensated/closed obligations. A MANUALLY_RECONCILED status records an observation, not an outgoing transfer. Historical entries cannot be rewritten; duplicate IDs/business keys cannot double-credit.

`data_rights_policy` versions bind an existing source to licence/reuse, role, purpose/classification, jurisdictions, subject/processing locations, retention/hold, AI permission and transfer review. Policies cannot extend source retention or override its AI denial. An approved transfer requires a recorded mechanism. EU hosting is not a legal decision. No automatic retention/deletion executor or legal approval engine is introduced.

The AI policy contract permits only reviewed public-source summarization/extraction/drafting and scoped read/draft tools. Unknown consequential tasks/tools fail schema validation. Cross-tenant data, personal data, unreviewed transfers, missing human/provider approval and expired rights deny execution. Provider output is always UNVERIFIED_DRAFT. The inputs are trusted server policy decisions, never model-supplied booleans. No LLM/provider transport is installed, and corridor AI binding remains disabled. Contributor access is exact-assignee/tenant/task/expiry/disclosure scoped. Outreach still uses the existing communication policy and opt-out checks; real email remains gated.

## Release and rollback

Apply migrations 0019–0022 only after a populated isolated upgrade, restricted-role negative tests and full release checks. Migration files 0001–0018 and `docs/source/` remain immutable. Deployment builds never migrate a database. Verify the exact approved synthetic Neon branch before a separate migration job. Preserve verified Neon customer identity and independent operator MFA.

Application rollback preserves additive tables and immutable history. Old clients keep the held-meeting path; rollback must not delete alternate origins or rewards. Disable new entry points, use compatible forward fixes and replay retained events. A historical old application version may not understand alternate-origin UI details, so retain the tested V2-compatible build for operational reads. Real customer mission flows remain blocked under the deferred controls register.

## Later implementation amendments

Part 1 exclusions describe its own release, not absent current capabilities. V2 Parts 2–5 subsequently added commercial execution, product UI, governed AI provider adapters (production inference OFF), restricted task execution (production activation OFF) and operational controls. See ADRs 026–029. PR 46 added existing-staff password recovery without changing MFA, role or source-rights authority (ADR 031). No amendment waives exact money, pinned versions, RLS or real-data gates.
