# Corridra V2 master plan

The owner's V2 decision replaces the old geographic rollout sequence. Parts 01–08 of V1 remain implemented; identity email acceptance remains separate from synthetic mission operations. V2 does not reopen or waive deferred security/data controls.

| Part | Bounded outcome                                                             | Dependencies and status                                                                                                                                        |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 1 | Global market/route, alternate origin, money, reward and policy foundations | This implementation; release evidence in the Part 01 record                                                                                                    |
| V2 2 | Route-aware mission and stakeholder journeys                                | Released in PR #31; see the [Part 2 release](v2-part-02-release.md)                                                                                            |
| V2 3 | Multi-corridor product experience and institutional delivery                | Owner packet implemented and locally accepted; final release evidence in [Part 3 record](v2-part-03-release.md)                                                |
| V2 4 | Execution Network and commercial operating surfaces                         | Use contribution/reward obligations, scoped task disclosure, independent reconciliation; recruitment/UI/international payment integration remain unimplemented |
| V2 5 | Governed AI and integrations                                                | Use fail-closed task/provider/data-rights contracts; real providers and orchestration remain unimplemented                                                     |

Parts 2 and 3 have explicit owner packets. Parts 4–5 remain dependency planning; do not begin them without the owner's request.

V1 Part 09 governed AI moves to the V2 5 contract path. V1 Part 10 network/economics maps to V2 4, with its invariant ledger foundation in V2 1. V1 Part 11 administration/reliability is cross-cutting across these parts. V1 Part 12 independent assurance, recovery, privacy/legal, retention and pilot gates remains mandatory before real operational activation. D01–D06 and D08 are not silently closed; D07 and D09 retain their recorded acceptance.

Part 2 must use `CorridorService`, explicit unclassified legacy missions, `OpportunityService.registerOrigin/createFromOrigin`, exact currencies and version-aware outcome consumers. It must not infer compliance from status, classify route origins from country text, treat customer cash as service revenue, or allow AI-generated output to exercise authority.
