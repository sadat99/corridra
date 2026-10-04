# ADR-005: Immutable domain events and transactional outbox

Status: implemented and tested locally.

Every implemented tenant business mutation writes its domain event, audit entry, outbox message and delivery checkpoint in the same PostgreSQL transaction through a trigger. Any failure rolls back all records. Immutable triggers reject event, audit, provenance and outbox rewriting even through the ordinary owner connection. Mutable delivery attempts/leases live separately; no dispatcher or external side effect is introduced in Part 03.

The version-1 envelope carries UUID event and tenant IDs, type, schema version, aggregate type/ID/version, actor, occurrence time, correlation and causation IDs, plus a minimal payload. Mutable memberships/relationships increment their versions. Evidence state uses optimistic version progression under a row lock. Configuration aggregates use the key and monotonically increasing version. Facts and other immutable records have version one.

Payloads contain identifiers, state/role/version and revocation status, not source text, credentials, filenames or contact details. Tenant owner/admin audit reads use RLS. Identity session and MFA changes have a separate immutable security audit with identity ID and action, never token contents.

Triggers avoid accidentally omitting an event in an application write path. The tradeoff is PostgreSQL-specific behavior that must remain in migration and integration review. Later delivery is at least once, with consumer idempotency keyed by event ID, explicit retries and dead-letter handling; no exactly-once transport claim is made. A future envelope change requires a new schema version and compatible consumers.
