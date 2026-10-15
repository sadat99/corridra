# Commercial follow-through

Read the [current programme](../../docs/implementation/current-plan.md), [module map](../README.md) and applicable ADRs before changing this module. Part references below describe its original release; later V2/UX amendments and current activation limits are linked from the developer handoff.

Owns opportunities, typed immutable RFQ/sample/proposal/commitment/contract/invoice/cash/recurrence records, separate accounting confirmations and event-based relational outcome projections. Uses domain validation and restricted tenant transactions. Existing relationship visibility applies to every read and write. Never changes mission/meeting tables, sends mail, invokes AI, imports real customers or treats an external reference as verified payment.

Read ADR-021, the Part 07 scope and runbook before changing funnel, attribution, currency, accounting or projection contracts. Commands default off through opportunities.commands. Owner/admin cash confirmation, compensation and projection rebuild require fresh MFA. Application services expose authenticated reads and idempotent commands only. SQL independently enforces permissions, evidence, immutable records and state prerequisites.
