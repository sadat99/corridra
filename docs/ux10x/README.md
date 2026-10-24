# UX10X programme and evidence index

**Document status: HISTORICAL.** The UX10X programme was merged (UX-01 to UX-05 and bounded UX-06). This is a dated record, not a to-do list. See the [plan status register](../PLAN_STATUS.md).

Read [the current plan](../implementation/current-plan.md) and [developer handoff](../START_HERE.md). UX-01 through UX-05 were implemented and merged in PRs 39–43. Bounded UX-06 presentation, wayfinding and access repairs followed in PRs 44–46. Full UX10X functional acceptance remains incomplete. The complete [master handoff](master-handoff.md) is preserved; Fusion is the visual reference only.

| Phase | Packet                                                                                                                | Status                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| UX-01 | Original review packet below; [architecture](architecture.md), [validation](validation.md), [coverage](coverage.json) | PR 39 merged; bounded slice                    |
| UX-02 | [Discovery, intake and account](ux02/README.md)                                                                       | PR 40 merged                                   |
| UX-03 | [Participant journeys](ux03/README.md)                                                                                | PR 41 merged                                   |
| UX-04 | [Operator experience](ux04/README.md)                                                                                 | PR 42 merged                                   |
| UX-05 | [Governance experience](ux05/README.md)                                                                               | PR 43 merged                                   |
| UX-06 | [Repair packets and limits](ux06/README.md)                                                                           | PRs 44–46 merged; programme acceptance partial |

The [UX-06 ledger](ux06/coverage.json) still records 773 NOT_YET_VERIFIED, 3 VERIFIED and 1 PARTIAL rows, with allBaselineUserActionsFound=false. Those are recorded ledger counts, not exhaustive current runtime coverage. Inventories are frozen source-discovery evidence; package verification files report bounded executed scenarios. Do not rewrite frozen inventories or mark all actions covered based on merge status.

## Historical UX-01 review packet

The following records the original PR 39 scope and observations; baseline counts and limitations are historical. Current standing release authorization is in the current plan.

UX-01 implements shared workspace geometry, semantic tokens and typography, role navigation, access/recovery presentation, and a real scoped mission read slice. It retains the existing domain panels and routes. Subsequent UX packages require acceptance of their predecessor; this branch implements no UX-02 work.

## Authority and discovery

- [Immutable owner handoff](master-handoff.md): the complete UX10X programme and acceptance sequence. Source uploads and authoritative domain/security contracts retain their precedence.
- [Architecture](architecture.md): presentation boundaries, frozen token/navigation contracts and rollback.
- [Inventory](inventory.md) and [machine-readable ledger](coverage.json): 43 filesystem routes, 759 source controls, 69 API dispatch/condition entries and 209 baseline test declarations. These are discovery counts, not an exhaustive runtime action denominator.
- [Executed UX-01 traceability](verification.json): bounded positive and negative acceptance scenarios. Unlinked source-control rows remain NOT_YET_VERIFIED. Full role/state/action parity is not claimed by this PR.

The checkout was clean, reconciled from `5a5f6b7` to latest main `1e0dbea6f146265b256ca89b5482e789f97acdd9`, with the intervening recovery diff inspected. Five local and three remote branches were counted before publication; only previously merged local branches were removed. There were no open product PRs at discovery. The original supplied master and the bundle master were byte-identical. The nested Fusion prototype supplied visual direction only; fictional values and its historical implementation instructions were not adopted.

## Implemented behavior

- Shared `WorkspaceShell`, `AccessState`, `StatusBadge` and `RoleNavigation`; ivory/forest tokens, readable data typography, visible focus, responsive geometry and reduced motion.
- Public persona directory retains every existing V2 destination, private-link distinction and synthetic availability notice. Existing global header/footer remain shared.
- Operator section navigation uses the closed role registry and retains mounted forms. Invalid fragments show recovery guidance. Tenant changes isolate component state and abort initial requests; delayed old responses cannot populate the new tenant. Switching with edited form fields requires explicit discard confirmation.
- Invitation lookup can be retried without writing identity data. Existing verified invitation, password, MFA and return-path contracts remain authoritative. Sign-in focuses the MFA step.
- Full-document outage recovery retains both query and selected section. A real local PostgreSQL outage test verifies continued denial, fresh readiness and the subsequent sign-in requirement.
- Scoped mission read presentation retains original brief, claim status/version and existing amounts/history. Unknown owner/action values remain explicit; due dates use the canonical UTC formatter. Empty records never imply a zero outcome.

## Validation and evidence

See [validation report](validation.md) for final results and limitations. Before/after captures cover desktop 1440/1280, tablet 768 and mobile 390/360/320. Thirty public/access observations per stage have zero axe violations and zero horizontal document overflow. Authenticated mission captures and scoped accessibility checks are additional evidence.

Local median first-contentful paint was 90 ms before and 98 ms after (maximum 288 / 500 ms). Single local navigation samples under concurrent test load are not field Core Web Vitals, LCP or INP evidence. No production performance conclusion is asserted.

Baseline format check initially included newly generated audit/scratch files and failed; baseline public e2e initially collided with the screenshot server's port. The corrected baseline browser run passed all 60 tests. These failures are preserved in the baseline result manifest and explained here rather than silently removed.

## Current continuation

The original UX-01 through UX-05 sequence is merged. Follow the current plan to reconcile outstanding UX requirements, baseline/new actions, permissions and response states, then implement bounded verified repairs. Standing owner authorization allows correctly checked merges and immediate exact-revision deployment, not real operational activation. Preserve all NOT_YET_VERIFIED/PARTIAL rows and source evidence; this review packet never established whole-programme acceptance.
