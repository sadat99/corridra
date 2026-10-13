# V2 Part 01 scope

Baseline: local HEAD `54d9ba36d7f7be4e4c235b4a15d7af82d91f6d08`. This matches the supplied audit. Remote reconciliation succeeded after using approved network access. `origin/main` equals the starting commit. Existing legacy `country` and `corridor` registries are preserved; new tenant operating corridors use `corridor_definition`.

| Disposition | Existing components                                                          | Bounded change                                                                        |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| KEEP        | Neon Auth, operator MFA, principals, memberships, tenant RLS                 | Preserve identity and country/purpose/classification authorization                    |
| KEEP        | Intake, mission commands, provenance, source text                            | Preserve existing clients and historical payloads                                     |
| EXTEND      | Mission market, research organisation country, communication jurisdiction    | Controlled global identifiers with legacy OTHER compatibility                         |
| NEW         | Market scopes, directional corridors, immutable packs, assignments           | Tenant-scoped configuration and explicit unresolved legacy missions                   |
| EXTEND      | Held-meeting opportunity origin                                              | Evidence-backed sourcing, RFQ, supplier response and accepted introduction references |
| KEEP        | Commercial lifecycle, confirmations, compensation, outcome replay            | Reuse services and preserve customer financial truth                                  |
| NEW         | Service economics, contribution obligations, privacy and AI policy contracts | Append-only, separate from customer money; no payout/provider adapter                 |
| KEEP        | Publications, imports, institutional reporting, outbox                       | Existing scoping and deterministic totals                                             |
| DEFER       | UI for route administration, network recruitment, billing, AI execution      | Later V2 parts; no activation of real customer-data flows                             |

No applied migration or original source document may be edited. Existing operational country restrictions remain independent of commercial route configuration. Seeds describe configuration, never approved coverage. Production remains synthetic for mission operations; verified customer identity journeys remain separate.
