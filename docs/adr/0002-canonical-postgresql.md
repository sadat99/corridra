# ADR-002: PostgreSQL is transactional truth

Status: implemented and validated locally; Frankfurt project isolation, PostgreSQL 18 and cloud recovery verified on 2026-10-05.

Use reviewed numbered SQL migrations and Drizzle for the identity adapter and typed schema. The checked SQL owns constraints, triggers and RLS. Migration hashes are immutable after application; a session advisory lock serializes runners. Each migration is transactional. Run migrations in a separate release job, never in a Vercel build or HTTP request.

A schema-owning migration identity performs offline provisioning. Separate `corridra_runtime` and `corridra_auth` groups own no tables and have neither superuser nor BYPASSRLS. Login roles inherit exactly one group. The application checks those properties at startup and rejects role/database creation privileges, replication privileges or membership in both application and identity groups. Production migration credentials must never reach app runtime or preview.

Use two distinct EU Neon projects. Reuse the owner-connected `neon-corridra` production project (`icy-math-12467795`) and the separate `corridra-nonprod` project (`odd-pond-26265871`) in Frankfurt. Both use PostgreSQL 18 and a six-hour history window. The production project is managed by Vercel, which blocks project creation through the Neon API; the non-production project therefore uses the existing console-managed Neon organization. No production data is copied. Explicit IDs and expected production name govern identity rather than renaming a connected resource. PostgreSQL 17 remains the pinned local regression runtime; actual cloud checks also validate PostgreSQL 18.6. Sessionful Neon WebSockets through the managed HTTPS proxy are an offline tooling transport, preserving transaction locks and RLS context without raw TCP grants. Application runtime retains native PostgreSQL with verified TLS. Production owner credentials are used only for read-only metadata checks in this task.

Raw parameterized SQL is deliberate for tenant transactions and database invariants; Drizzle does not replace database policies. This costs explicit SQL maintenance but keeps critical rules reviewable and testable with restricted roles. PostGIS and pgvector are deferred until an implemented query needs them. No customer, AI, mission or money tables are introduced in Part 03.

Recovery: verify the account's actual history window, retain a nonzero PITR setting, then perform a separate non-production restore before release. The project script defaults to the documented free-plan six-hour window; that is not an agreed production RPO/RTO. Larger windows and backup costs require an explicit operational decision.

## Amendment, 11 November 2026: which database is live

Owner request, 11 November 2026: remove the confusion between several Neon destinations. Facts read from the Neon and Vercel providers that day (metadata only, no SQL):

- The one live database is branch `live` (`br-lucky-darkness-b1ppj8en`, formerly `corridra-live-synthetic`) of project `corridra-nonprod` (`odd-pond-26265871`), database `corridra`, endpoint `ep-tiny-forest-b199wxno`, Postgres 18, Frankfurt. The application, customer sign-in (Neon Auth) and the installer all use it. The rename changed nothing but the display name: ID, endpoint, data and connection settings are the same.
- The branch `synthetic` (`br-lingering-sea-b1eob57e`) is the sterile primary parent. Its name is asserted by `scripts/neon-preview.ts`; keep it.
- The project name `corridra-nonprod` is asserted by `scripts/neon-preview.ts`, `scripts/cloud-validate.mjs` and `scripts/neon-projects.py`, so it is unchanged. Renaming the project needs a change to those scripts and a decision on the project's role, and is not part of this amendment.
- `neon-corridra` (`icy-math-12467795`) is the production-candidate project described above. Its release receipt of 20 October 2026 records that it has never held a user, and no application setting points at it. It is not a live destination. Retiring it is the owner's decision and is done through the Vercel integration, because Neon blocks deleting its Vercel production branch.
- Recovery on the live branch is the 6-hour history window; no restore drill has been done.

Where older receipts and runbooks say `corridra-live-synthetic`, read `live` with the branch ID above.
