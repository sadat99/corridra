# UX-01 review packet

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

## Review and next action

Review UX-01 code, screenshots, test results and explicit coverage gaps. Merge and deployment require the owner's separate approval. The branch and main opt out of automatic Vercel Git deployments pending separate release approval. No production settings, real customer operation, outreach, provider activation, payment or payout changed.

After this PR is accepted and merged, switch to the owner's requested GPT 6.1 sol medium and execute **UX-02 — Editorial discovery, routes, job-first intake and account** from the complete handoff. Reconcile latest main and carry forward every NOT YET COVERED row; do not treat this PR's regression tests as whole-programme acceptance.
