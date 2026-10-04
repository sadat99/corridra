# ADR-002: PostgreSQL is transactional truth

Status: implemented locally; EU Neon provisioning pending.

Use PostgreSQL 17, reviewed numbered SQL migrations and Drizzle for the identity adapter and typed schema. The checked SQL owns constraints, triggers and RLS. Migration hashes are immutable after application; a session advisory lock serializes runners. Each migration is transactional. Run migrations in a separate release job, never in a Vercel build or HTTP request.

A schema-owning migration identity performs offline provisioning. Separate `corridra_runtime` and `corridra_auth` groups own no tables and have neither superuser nor BYPASSRLS. Login roles inherit exactly one group. The application checks those properties at startup. Production migration credentials must never reach app runtime or preview.

Use two EU Neon projects, `corridra-prod` and `corridra-nonprod`. Frankfurt is the implementation default, subject to account region availability. Local Docker PostgreSQL validates SQL behavior; it does not prove Neon role permissions, EU residency or cloud recovery. The existing US East URL is not used by this implementation.

Raw parameterized SQL is deliberate for tenant transactions and database invariants; Drizzle does not replace database policies. This costs explicit SQL maintenance but keeps critical rules reviewable and testable with restricted roles. PostGIS and pgvector are deferred until an implemented query needs them. No customer, AI, mission or money tables are introduced in Part 03.

Recovery: verify the account's actual history window, retain a nonzero PITR setting, then perform a separate non-production restore before release. The project script defaults to the documented free-plan six-hour window; that is not an agreed production RPO/RTO. Larger windows and backup costs require an explicit operational decision.
