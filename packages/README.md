# Foundation modules

`domain` contains deterministic input schemas, permissions and canonical evidence transitions. It has no network or database dependency.

`db` owns reviewed SQL migrations, Drizzle identity mappings and scoped PostgreSQL transactions. `migrations/` is the authority for SQL policy, constraints, indexes and events. Do not run Drizzle push against a deployed database: a generated diff cannot preserve unmodeled RLS/security triggers. Migration hashes, fresh install and upgrade behavior are covered by integration tests.

`auth` owns the Better Auth adapter, MFA assurance and tenant access/configuration services. `bootstrap.ts` is an offline schema-owner operation for synthetic identities; never import it into a route handler or client bundle. `client.ts` is the only browser-facing auth entry point.

`evidence` owns source/claim/evidence/review services and storage/scanner interfaces. It uses scoped transactions and preserves provenance. It cannot grant identity or tenant membership. SQL guards independently enforce state transitions and inherited policy.

`config` rejects unsafe preview activation, database locations, role sharing and weak TLS before services are created. Configuration does not replace live account verification.

App Router handlers compose these modules. Secrets and pools stay in server-only `apps/web/lib/foundations.ts`. No module implements future mission, money, DCG or AI workflows. See the [architecture decisions](../docs/adr/) and [security contracts](../docs/security/part-03-foundations.md).
