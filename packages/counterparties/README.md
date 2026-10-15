# Counterparty research module

Read the [current programme](../../docs/implementation/current-plan.md), [module map](../README.md) and applicable ADRs before changing this module. Part references below describe its original release; later V2/UX amendments and current activation limits are linked from the developer handoff.

Owns manual public identity ingestion, relationship-scoped private contacts/notes, typed company attributes, deterministic entity candidates, reversible tenant attribution and evidence-aware mission target assessments. It has no AI, outbound email, crawler or object storage implementation.

The service accepts a server-derived session/tenant/purpose context and uses the restricted runtime pool. Reads enforce research.read and database RLS. Operators manage their allowed records; authorized owner/admin/reviewer entity decisions and actual independent reviewer fact publication require fresh MFA. Shared identity/fact inserts are narrowly validated database capabilities, not direct table grants. Originals retain their source identities after attribution merges.

Commands use UUID retry keys, a request hash, transactional lock and immutable result ledger. Assessment versions serialize per target without granting UPDATE on append-only target rows. SQL guards independently enforce source validity, cross-tenant references, contact/relationship binding, target attribution, active missions and entity decision invariants. Every private research table enables RLS and append-only writes; relationship policy retains its existing owner-managed mutable contract.

See [ADR-017](../../docs/adr/0017-counterparty-research-and-reversible-attribution.md) and [the runbook](../../docs/runbooks/part-05-counterparties.md). Manual research is usable with invented records; real customer/personal data stays gated. The appropriate read indexes and bounded pages precede a separate search service.
