# V3 controlled revamp

Document status: CURRENT.

The owner's bounded scope for a UX/UI-first revamp of the V3 product, executed in reviewable waves. Live state, receipts and the next action stay in the [V3 ledger](../V3_LEDGER.md); traced gaps stay in the [gap register](../qa/current-plan-gaps/README.md). The [V3 contract](../V3_CONTRACT.md), [product vision v2.1](../product/corridra-product-vision-v2.1.md), [UI direction](../agents/ui-direction.md) and the [AC/1 design system](../design-system/README.md) keep governing. This file adds scope, not new product meaning.

## Owner approval, 4 November 2026 (verbatim)

> I approve the Corridra V3 controlled revamp (docs/revamp/CONTRACT.md, Waves 0 to 8) as a bounded scope, executed by parallel Claude Code sessions with disjoint file ownership under the session plan. Sonnet track sessions use the lean route (authority script, in-session build, CI as verifier, Opus guardian review for sensitive diffs, Conductor as scribe) instead of the full squad. Auto-merge code-only revamp PRs after exact-head green CI, and after the Opus guardian's PASS where the PR touches auth, session, RLS, tenant scope, money, quotes, markup, consent, public unauthenticated routes, tokens or cookies. I merge myself any PR containing a migration or installer change. Launch language is English only; language gaps stay open, existing Bangla and Chinese code is kept, and no screen claims reviewed translations. Nothing here authorizes migrations in production, switch changes, provider activation, payments, outreach, AI, external sharing or deletion without the cleanup manifest and the guardian's PASS. Keep the branch count below 9.

The kickoff note that came with it names the wave order: Wave 0 (route, action and permission inventory and the cleanup manifest), then Wave 1 (truth-preserving fixes for false empty, error and partial states; one canonical customer Work view; task-specific Sell, Source and Organise experiences), then public intake, J1 China sourcing, J2 Europe buyer, J3 delegations, J4 cross-organisation access, staff, contributor and recipient experiences, the open verified gaps, documentation and code cleanup, and complete acceptance.

## What this approval changes, and what it does not

| Topic                     | Rule under this scope                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code-only revamp PRs      | Merge after exact-head green CI. A PR that touches auth, session, RLS, tenant scope, money, quotes, markup, consent, public unauthenticated routes, tokens or cookies also needs a recorded guardian PASS.                |
| Migrations and installers | The owner merges any PR that contains one. Production installs stay owner-approved protected runs.                                                                                                                        |
| Language                  | English only at launch. Bangla and Chinese code stays. No screen claims a reviewed translation. Language gaps stay OPEN.                                                                                                  |
| Still closed              | Production migrations, switch changes, provider activation, payments, outreach, AI inference, external sharing, and deletion without this manifest and a guardian PASS. D01 to D06 and D08 stay closed.                   |
| Branches                  | Fewer than nine, main included.                                                                                                                                                                                           |
| Preservation              | Every original authorised action, permission, RLS rule, MFA step, original value and currency, private markup, history, consent, link and route stays reachable. AC/1 tokens, type, icons and compositions are mandatory. |

## The contract file is not in the repository

The approval names `docs/revamp/CONTRACT.md` and the kickoff names an attached `Corridra_V3_Controlled_Revamp_Execution_Contract_2026-11-04.md`. Neither was in the repository or the session uploads on 4 Nov 2026 at `a1dbbc9`. Until the owner adds it here, waves are executed only as the kickoff note above describes them, and anything the contract would decide beyond that (wave acceptance lists, the session plan, file ownership between sessions) is not assumed.

## Session plan and file ownership

No shared session plan was supplied. Until one is added here, each session records the files it owns before editing, and never edits a file another open branch owns.

| Session branch                | Owns                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/zen-hopper-1iqtdn`    | E3b decision card (PR 262): `packages/auth/src/customer-decision-cards.ts`, `packages/db/customer-decision-card-migrations/`, its tests. Not part of this revamp. |
| `claude/vibrant-dirac-8osg5d` | Revamp Waves 0 and 1: `docs/revamp/`, `scripts/revamp-manifest.mjs`, the customer account surfaces each Wave 1 PR names.                                          |

The ledger, work log and gap register are shared. Each session appends its own entry and rebases before merge; nobody rewrites another session's entry.

## Wave 0: inventory and cleanup manifest

[`wave-0/manifest.json`](wave-0/manifest.json) is generated at the baseline commit by the existing static collector and a small read-only deriver:

```
node scripts/v3-inventory.mjs <sha> .cache/revamp-inventory
node scripts/revamp-manifest.mjs .cache/revamp-inventory/inventory.json
```

At `a1dbbc9` it lists 124 routes (53 customer, 27 staff, 19 public, 12 public intake and identity, 9 recipient or private link, 3 contributor, 1 shared), with each route's access rule, customer navigation home (Home, My Work, Companies, Results, More), control count, permission boundaries in its file and handler branches. Every customer page has a navigation home. The collector found 1,777 controls, 135 handler branches, 313 commands and 310 permission boundaries. Static reachability is not functional verification: every route stays `EXISTING (static); runtime acceptance NOT VERIFIED` until a test proves it.

Cleanup reference check: 19 tracked source files have no importer, CSS import, package script or config reference. 18 are KEEP (tool config files loaded by name, and operator or evidence CLIs run by path). One is REVIEW: `apps/web/components/ux/page-header.tsx` has no importer. **Nothing was deleted.** Deleting it needs an owner-approved PR with this reference check rerun, the file hash recorded and a rollback note. `docs/source`, ADRs, QA records, history and migrations are never cleanup candidates.
