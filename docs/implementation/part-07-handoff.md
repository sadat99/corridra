# Part 07 handoff: commercial follow-through

Status: implemented following the owner's 9 October 2026 instruction to proceed. See [the requirement baseline](part-07-scope.md), [runbook](../runbooks/part-07-commercial-followthrough.md) and [release status](part-07-release.md). Customer signup remains deferred.

## Objective and existing journey

Corridra turns market-access work into evidence of commercial progress. Parts 03 to 06 already provide protected operators, mission intake, provenance-aware targets, controlled buyer responses, meetings and owned follow-up. Part 07 connects a held meeting to an opportunity and reports what became a proposal, contract, invoice, confirmed cash or repeat order. Buyer registration is not required. Customer signup stays disabled under D09 while this packet proceeds.

Read the complete [implementation plan](plan-v1.0.md), [architecture canvas](../architecture/implementation-canvas-v1.0.md), [constitution](../brand/positioning-messaging-constitution-v1.0.md), [public-experience requirements](../product/public-experience-v1.0.md), relevant module documentation and ADRs before implementation. The preserved source documents remain authoritative requirements; this handoff does not replace them.

## Required implementation

- Add qualified opportunity, RFQ, sample, proposal, commitment, contract, invoice, cash receipt and recurrence records with tenant isolation, mission/meeting attribution, owners and follow-up.
- Enforce the canonical funnel through server commands: LEAD, QUALIFIED_OPPORTUNITY, PROPOSAL, COMMITMENT, CONTRACT, INVOICE, CASH_COLLECTED and RECURRING_REVENUE. Define permitted LOST transitions and mandatory loss reasons. RFQs and samples are supporting commercial records, not invented funnel states.
- Keep signed contracts, invoiced amounts and received cash distinct. Store integer minor units, ISO currency, dates, evidence and external references. A sales assertion or external reference is not accounting confirmation. Record corrections through compensating records rather than overwriting financial history.
- Atomically write versioned domain events and outbox records with mutations. Build relational Outcome Graph projections with deterministic replay, versioning and rebuild tooling; retain original events and attribution scope.
- Ship an operator mission-yield dashboard and overdue follow-up queue. Distinguish activity, access, pipeline, contracts, invoices, confirmed cash and recurrence. Show denominators and attribution scope; keep mixed currencies separate unless an explicit recorded conversion basis exists.
- Record canvas ADR topic 006 and projection, currency, accounting permission and attribution decisions before committing schema contracts. Do not guess revenue, FX rates or causal attribution.

## Acceptance and release

Demonstrate a synthetic mission from intake through confirmed cash evidence in a real browser and restricted-role PostgreSQL. Test tenant/non-member denial, invalid transitions, missing loss reasons, unauthorized cash mutations, transaction/event atomicity, duplicate commands, corrections, replay/rebuild and no double counting. Include mixed currencies and evidence/confirmation distinctions. Preserve operator MFA, stale-session denial, existing no-account buyer behavior and public regressions.

Run document integrity, format, lint, typecheck, integration/RLS, production build and public/protected browser gates. Review additive migrations and upgrade compatibility, then verify exact Git SHA, deployment identity, functional production acceptance and cleanup. Rollback disables new transitions and rebuilds projections from retained events; financial corrections remain traceable.

D01 to D06, D08 and D09 remain open under [the deferred controls register](deferred-controls.md). Part 07's minimum sellable mission milestone still requires the applicable legal, customer-data and pilot gates. Do not enable signup or real outreach as a side effect of this packet.
