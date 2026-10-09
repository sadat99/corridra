# Part 07 implementation and release status

Commercial follow-through is implemented on `feat/part-07-commercial-followthrough`; production release is pending validation. [The requirement baseline](part-07-scope.md), [ADR-021](../adr/0021-commercial-funnel-cash-and-outcome-projections.md) and [runbook](../runbooks/part-07-commercial-followthrough.md) define scope, accounting authority, complete operator operations and rollback.

The module links held meetings to owned opportunities and immutable RFQ/sample/proposal/commitment/contract/invoice/cash/recurrence records. Accounting confirmation is a separate fresh-MFA owner/admin action. SQL preserves tenant/purpose/country and relationship permissions, immutable financial history, parent currency, invoice caps, confirmed-payment limits and explicit compensations. Observed contracts, invoices, reported receipts and confirmed cash remain distinct.

Additive migrations 0011 to 0013 introduce typed canonical views, currency registry, ordinary-event outcome snapshots and versioned relational projections. Reports show actor-visible activity, access, historical funnel stages, currency-specific financial totals and attribution limits. Commands default off. Replay retains original events and records every rebuild's reason and audit entry.

Validation and deployment evidence will be recorded here after their gates complete. No production Part 07 acceptance is claimed by this pending record. Customer signup remains deferred under D09; the other recorded customer-data, outreach, scanner, retention and pilot/legal boundaries remain in force.
