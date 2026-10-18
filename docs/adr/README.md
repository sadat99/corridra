# Architecture decision index

Read [Start here](../START_HERE.md), [current plan](../implementation/current-plan.md) and [current architecture](../architecture/v2-current-map.md). ADR numbers have intentional gaps; do not renumber accepted decisions. These are contracts/dated decisions, not an implementation queue. Later explicit amendments supersede only the identified restriction.

ADR 014 preview-only deployment was amended by ADR 015 for the retained synthetic production-domain exception. ADR 019/D07 records the historical Git association repair; current main Git auto-deployment is deliberately disabled. ADR 020 customer identity remains separate from staff TOTP. ADRs 023–029 add the revised multi-corridor/commercial/intelligence/network/operations scope. ADR 031 supersedes only ADR 030 offline existing-staff password recovery; first invitations, lost MFA and suspended/expired recovery remain reviewed.

| Decision                                                          | Subject                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](0001-public-launch-and-platform-boundaries.md)             | ADR-001: Public launch and platform boundaries                                            |
| [0002](0002-canonical-postgresql.md)                              | ADR-002: PostgreSQL is transactional truth                                                |
| [0003](0003-tenancy-and-identity.md)                              | ADR-003: Global entities, tenant-private records and database authorization               |
| [0004](0004-evidence-semantics.md)                                | ADR-004: Claims, evidence and verification stay distinct                                  |
| [0005](0005-events-and-outbox.md)                                 | ADR-005: Immutable domain events and transactional outbox                                 |
| [0010](0010-eu-data-and-access.md)                                | ADR-010: EU-primary storage and explicit access purpose                                   |
| [0012](0012-synthetic-preview-lifecycle.md)                       | ADR-012: Preview branches only from a sterile non-production parent                       |
| [0013](0013-blob-storage-and-s3-migration.md)                     | ADR-013: Temporary private EU Blob storage with an S3 migration path                      |
| [0014](0014-live-synthetic-preview-with-deferred-controls.md)     | ADR-014: Live synthetic preview with deferred operational controls                        |
| [0015](0015-production-domain-and-explicit-unscanned-evidence.md) | ADR-015: Production-domain rollout with explicit unscanned evidence                       |
| [0016](0016-mission-intake-and-operator-commands.md)              | ADR-016: Mission intake and operator commands                                             |
| [0017](0017-counterparty-research-and-reversible-attribution.md)  | ADR-017: Counterparty research and reversible attribution                                 |
| [0018](0018-controlled-introductions-and-meeting-truth.md)        | ADR-018: Controlled introductions and meeting truth                                       |
| [0019](0019-part-06-production-release-and-customer-readiness.md) | ADR-019: Part 06 production release and customer readiness                                |
| [0020](0020-neon-auth-accounts-and-preserved-operator-mfa.md)     | ADR-020: Neon Auth accounts and preserved operator MFA                                    |
| [0021](0021-commercial-funnel-cash-and-outcome-projections.md)    | ADR-021: Commercial funnel, cash and outcome projections                                  |
| [0022](0022-scoped-client-and-institutional-delivery.md)          | ADR-022: Scoped client and institutional delivery                                         |
| [0023](0023-global-markets-and-versioned-routes.md)               | ADR-023: Global markets and pinned route versions                                         |
| [0024](0024-commercial-origin-and-event-coexistence.md)           | ADR-024: Evidence-backed commercial origins                                               |
| [0025](0025-service-economics-rewards-and-privacy-boundaries.md)  | ADR-025: Separate service economics, reward obligations and policy authority              |
| [0026](0026-commercial-mission-execution.md)                      | ADR-026: Versioned commercial mission execution                                           |
| [0027](0027-scoped-multi-corridor-product-experience.md)          | ADR-027: Scoped multi-corridor product experience                                         |
| [0028](0028-governed-tasks-and-restricted-execution-network.md)   | ADR 028: Governed tasks and restricted execution work                                     |
| [0029](0029-operational-readiness-and-observed-economics.md)      | ADR 029: Evidenced route readiness and observed operations                                |
| [0030](0030-explicit-staff-invitation-and-first-password.md)      | ADR 030: Explicit staff invitation and first-password setup                               |
| [0031](0031-operator-password-recovery-and-scoped-directory.md)   | ADR 031: Operator password recovery and a scoped member directory                         |
| [0032](0032-customer-workspace-authority.md)                      | ADR 032: Proposed customer workspace authority; migration test-policy conflict unresolved |
| [0033](0033-private-customer-request-authority.md)                | ADR 033: Private customer request design; canonical engine reuse, implementation missing  |

Forward status, 17 October 2026: ADR032's original test-policy conflict was resolved by its documented independently optional customer module, with full original core tests retained. Synthetic provisioning/collaboration backends are verified; exposure and private provider acceptance remain gated. Read its forward amendments and the V3 ledger instead of treating the historical index label as current implementation state.

[ADR034](0034-custom-production-origin.md) records the owner-reported navigation repair:owned production subdomain as the exact canonical origin,provider allowlist preservation,host-scoped cookie implications and rollback. This is an origin configuration change,not a new identity or commercial activation.

| [0035](0035-private-original-request-details.md) | Creator-only original submitted request details;separate opt-in module |

| [0036](0036-account-saved-commercial-reports.md) | Private saved commercial reports,capability preservation and self-declared replies |

| [0038](0038-approved-customer-company-portfolios.md) | Canonical company continuity within original approved customer scopes |
