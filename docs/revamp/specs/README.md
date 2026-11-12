# Revamp specs

Document status: CURRENT.

Specs the revamp track sessions build to. Written by the Conductor and Guardian session (S1). A track starts a wave only after its spec is on main. A spec never overrides the [V3 contract](../../V3_CONTRACT.md), the [UI direction](../../agents/ui-direction.md), the [AC/1 design system](../../design-system/README.md) or an accepted ADR; where they conflict, the stronger control wins and the spec is corrected.

| Spec                                                                    | Track | Wave | What it fixes                                                                                                                                    |
| ----------------------------------------------------------------------- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Work-item adapter](work-items.md)                                      | S2    | 2    | One list of customer work, explicit classification only, required tests                                                                          |
| [Home and Work screens](home-work.md)                                   | S2    | 2    | Layout, states and widths for Home and Work inside the locked navigation                                                                         |
| [Public home and fast intake](public-home.md)                           | S3    | 3    | Parity tests first, then changes within the settled home concept                                                                                 |
| [Signal Desk map](signal-desk.md)                                       | S4    | 5    | Where each of the 18 staff sections lives in the locked team navigation                                                                          |
| [SourceLedger and money](sourceledger-money.md)                         | S2    | 4    | Quote comparison, money words and private markup confidentiality (M-01 to M-10)                                                                  |
| [Decision card screens](decision-card-ui.md)                            | S2    | 4    | Owner panel and bare public page for the built card (D-01 to D-10)                                                                               |
| [Organiser room consent](programme-consent.md)                          | S3    | 5    | What an organiser may see, consent and revocation (C-01 to C-10)                                                                                 |
| [Customer experience](customer-experience.md)                           | S2    | 6    | Owner 5 Nov: customer area redesign from screenshots, one desktop screen per page (CX-01 to CX-07)                                               |
| [Layout budget](layout-budget.md)                                       | all   | 6    | Owner 4 Nov: left navigation, page length at most 2 phone screens, 1 to 3 fields per form step (L-01 to L-06)                                    |
| [Navigation system v1](navigation-v1.md)                                | all   | 2    | Owner 6 Nov: menus and navigation for every shell per the owner's design (footer excluded), session ownership and order                          |
| [Staff command palette search](navigation-v1/command-palette-search.md) | all   | 2    | Owner 12 Nov: ranked, typo-tolerant, bounded palette search, honest states, recents, top-bar field (Phase 1, no migration)                       |
| [Customer search](navigation-v1/customer-search.md)                     | all   | 2    | Owner 12 Nov: customer and regular-user top-bar Search over own Requests, approved Companies and pages (POST route, bounded reads, no migration) |
| [Wave 6 quality](wave6-quality.md)                                      | all   | 6    | Keyboard, reflow, contrast, states, busy actions, performance (Q-01 to Q-08)                                                                     |
| [Wave 7 cleanup](wave7-cleanup.md)                                      | S4,S1 | 7    | Usage graph, candidate report, proven deletions, docs consolidation (K-01 to K-04)                                                               |
| [Wave 8 acceptance](wave8-acceptance.md)                                | all   | 8    | Journeys J1 to J7 on fixtures and the release memo                                                                                               |
| [Workflow intelligence](workflow-intelligence.md)                       | S17   | 6    | Owner 10 Nov: journey audit, tool decisions, reading-level measurement (W1), plain copy (W2)                                                     |
| [Company linking Phase 1](company-linking-phase1.md)                    | S31   | 6    | Owner 10 Nov (relayed): ADR-079 design, one provenance rule, rights record, combined search, redaction (design only)                             |
| [Report a Problem](problem-reports.md)                                  | S17   | 6    | Owner 10 Nov: real in-app problem reports with staff triage (ADR-078), addresses, words, states, PR split                                        |

## Rules for every track PR

1. Read the diff, not the description: the Guardian reviews code and receipts.
2. Each required test case in a spec is implemented with its case id in the test name (for example `W-07`). A missing case is a finding.
3. Keep every existing action, link destination, element `id` and `name`, form payload and test hook. Hide, never delete.
4. English only at launch. New words carry `lang="en"` where the surrounding region may be in another language; no catalogue entry claims a translation.
5. A PR that touches auth, session, RLS, tenant scope, `packages/**`, money, quotes, markup, consent, public unauthenticated routes, tokens or cookies says `Sensitive: yes` and waits for `Guardian: PASS <SHA>`.
6. Mark the PR `Ready for Conductor review: <SHA>`. Add only your own verification JSON under `docs/qa/current-plan-gaps/verification/`. The Conductor writes the ledger, gap register and work log.

## Open owner decision

The session plan names the staff navigation "Today, Work, Companies, Delivery, More". The owner-locked UI direction (Guided experience standard, 19 Oct 2026) names it "Today, Missions, Companies, Delivery, Outcomes" plus "All tools and settings", and changing it needs the owner's approval and a change to that file first. Until the owner decides, the [Signal Desk map](signal-desk.md) uses the locked names.
