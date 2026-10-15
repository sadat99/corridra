# Domain module map

Read [Start here](../docs/START_HERE.md), [current architecture](../docs/architecture/v2-current-map.md), [ADRs](../docs/adr/README.md) and [implementation matrix](../docs/implementation/implementation-matrix.json) before changing module contracts.

| Module           | Authority and responsibility                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain`         | Deterministic schemas, canonical states, permissions, countries/markets, currencies, policy and financial/evidence contracts; no network/database dependency |
| `db`             | Reviewed additive SQL migrations, scoped transactions and identity mappings; SQL owns RLS/constraints/security triggers                                      |
| `auth`           | Independent staff Better Auth/TOTP, invitation/setup/recovery and workspace authority; customer managed identity is composed by the app                      |
| `config`         | Fail-closed runtime/environment/TLS/role/activation validation; metadata validation does not admit real data                                                 |
| `evidence`       | Source/claim/evidence/review, storage/quarantine/scanner interfaces and provenance; no role grants                                                           |
| `missions`       | Intake/receipt/review, meetings, global directional route packs, commercial requirements/offers/visits and operations controls                               |
| `counterparties` | Sourced identities, dedupe, private relationships and mission targets; no autonomous URL fetch or outreach                                                   |
| `communications` | Reviewed introductions/capabilities, recipient responses and idempotent dispatch boundaries; real outreach remains gated                                     |
| `workflows`      | Existing durable workflow/outbox orchestration and recovery; no alternate canonical store                                                                    |
| `opportunities`  | Commercial origins/stages, original contract/invoice/cash and append-only compensation; no payment processor                                                 |
| `delivery`       | Scoped publication, imports, reproducible exports/reports and programme context; exact source/version/denominator/currency                                   |
| `intelligence`   | Registered governed draft tasks, provider boundary, grounding/review and budgets; production inference OFF                                                   |
| `network`        | Exact invited MFA task assignment, independent contribution review, rewards/reversals/disputes; production activation OFF, no payout transport               |

App Router handlers compose services; server-only `apps/web/lib/foundations.ts` owns runtime resources/secrets. Offline bootstrap/migration helpers must never enter routes or client bundles. Public `auth/client.ts` is the browser-facing staff auth boundary. No provider management credential belongs in runtime.

There are 29 reviewed SQL migrations at this handoff baseline. Do not use Drizzle push against a deployed database, rewrite migration hashes or bypass scoped roles. Preserve atomic events/outbox, originals, exact money, pinned historical versions, MFA/RLS and separate activation gates. Full current scope and remaining gaps are in the current plan; old module release descriptions are bounded historical context.
