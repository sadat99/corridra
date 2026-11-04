# SourceLedger comparison and money confidentiality

Document status: CURRENT.

Track S2, Wave 4 (journeys J1 Source and J2 Sell). The work room's compare and quote views present existing quotes, specifications and service quotes. They add no ledger, no calculation that changes a stored amount and no export beyond what is already authorised. Governing: [ADR-073](../../adr/0073-commercial-arrangements-on-service-quotes.md), [ADR-072](../../adr/0072-pinned-customer-specification-confirmation.md), contract sections 2 and 8 ("Financial truth"), and revamp contract Wave 4.

## Money words that must never collapse

| Thing                                                     | What the screen calls it                                                                                | Never shown as                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| A supplier's quoted price, in its original currency       | Price quote, with the supplier's name as seller                                                         | Corridra revenue, an order, a payment |
| A bundled supply price (ADR-073)                          | Seller's quoted supply price, attributed to its actual seller                                           | A Corridra fee                        |
| A fixed Corridra service fee on an accepted service quote | Service fee                                                                                             | Supply value, commission              |
| A success commission (ADR-073)                            | Conditional commission; Estimated commission, with its trigger and "Not earned, invoiced or collected." | Earned, invoiced, collected or paid   |
| An invoice                                                | Invoice                                                                                                 | Confirmed payment                     |
| A confirmed payment                                       | Payment received (only from a payment record)                                                           | Anything derived from a quote         |

The words in this table follow the existing arrangement screen (decision 4 Nov 2026, PR 274 review: M-06 keeps them). Corridra is never shown as the seller unless the stored arrangement names it, and principal sales stay blocked (ADR-073).

## Private fields (staff only)

`internalSupplyEconomics` in `packages/domain/src/commercial-arrangements.ts`: `acquisitionCostMinor`, `markupBasisPoints`, `relationshipNote`, and anything derived from them. They never reach a customer service response, a customer page, a customer fingerprint, an export, an event or a log. Only the current handling staff team with fresh MFA reads them (ADR-073).

## Comparison rules

1. Every amount is shown exactly as stored, in its original currency and minor units. No sum or total across currencies. A converted figure appears only with a stated, dated rate and rounding rule from a stored source, and is labelled as derived.
2. A normalised view lists its assumptions on screen. Where specifications differ (capacity, power, scope, certification), the row says "Not comparable" and why, and is not ranked against the others.
3. A quote that leaves out a cost or obligation (installation, commissioning, warranty, spares, delivery terms, payment terms) shows "Not included" or "Not stated" for it. It is never ranked as cheaper because of that omission.
4. Original quote text, language, currency and every version stay reachable; the accepted version is marked and never edited.
5. Source proof and trust labels use the five fixed state names; nothing is shown as Verified without a verification record.

## Required tests (S2, named by id)

| Id   | Case                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01 | A fixture with acquisition cost, markup and relationship note set (distinctive values such as `987654321`, `4321`, `PRIVATE-NOTE-XYZ`): none appears in any customer API response body (deep key and substring search) or in the rendered customer HTML. |
| M-02 | The same fixture: the customer quote fingerprint equals the fingerprint computed without the private record.                                                                                                                                             |
| M-03 | Two quotes in different currencies are shown separately; no element sums them; no converted figure appears without a stated rate, date and rounding rule.                                                                                                |
| M-04 | A lower price whose installation or warranty is "not included" is not ranked or highlighted as the better offer; the omission is shown on its row.                                                                                                       |
| M-05 | Specifications that differ are marked "Not comparable" with the reason, and not ranked.                                                                                                                                                                  |
| M-06 | Supply price, service fee, possible commission, invoice and payment each render with their own label; a commission is labelled an estimate and never earned or paid.                                                                                     |
| M-07 | Corridra is never rendered as the seller unless the arrangement fixture names it.                                                                                                                                                                        |
| M-08 | A customer of workspace B requesting a quote of workspace A gets the existing uniform denial; nothing about A is in the response.                                                                                                                        |
| M-09 | The accepted quote version renders exactly as accepted; earlier versions are listed and unchanged; no edit control exists on the customer side.                                                                                                          |
| M-10 | No new export appears; an existing export or book contains no price, quote, markup or contact field (reuse the ADR-076 book exclusions).                                                                                                                 |

Any PR touching these screens is `Sensitive: yes` (money, quotes, markup) and needs `Guardian: PASS`.
