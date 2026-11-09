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

## The execution contract

[`CONTRACT.md`](CONTRACT.md) is the owner's `Corridra_V3_Controlled_Revamp_Execution_Contract_2026-11-04.md`, attached to this session on 4 Nov 2026 and recorded byte for byte: 36,064 bytes, sha256 `93230e4b05d7d0d52660e5f6944c1c5b98e2af3a2301680b1d00da29ff80d4ea`. It is excluded from formatting and `tests/documents.test.mjs` fails if one byte changes. Never edit it; amend forward here. The kickoff note that came with it is 3,191 bytes, sha256 `ed85e5c2e68cd0a9af09394184bfc6e35cdf4f82df6d607707503d19d0ca6def`, and its wave order is summarised in the section above.

### Later owner decisions that override the contract text

Latest wins only for the conflicting scope. Everything else in the contract stands.

| Contract text                                                                       | Later owner decision (4 Nov 2026)                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 7 and the kickoff: one primary Claude Code session, no parallel agents      | The approval above: parallel Claude Code sessions with disjoint file ownership under the session plan, Sonnet track sessions on the lean route, an Opus guardian and a Conductor.                                     |
| Sections 8.5 and 10: draft PRs until a scope and merge authorization is recorded    | Recorded: the approval above, and the merge line below.                                                                                                                                                               |
| Section 3 and Wave 5: staff navigation "Today / Work / Companies / Delivery / More" | Not yet decided. The locked UI direction says "Today, Missions, Companies, Delivery, Outcomes" plus "All tools and settings"; see the [specs index](specs/README.md). The locked names stand until the owner chooses. |
| Section 3: customer navigation "Home / Work / Companies / Results / Account"        | Not yet decided. The locked customer navigation (Home, My Work, Companies, Results, More, or the `CORRIDRA_UX_NAV` set) stands until the owner chooses.                                                               |

### Owner merge line, 4 Nov 2026 (verbatim)

> S1, you are the only session that merges revamp PRs. Build sessions mark PRs Ready for Conductor review. Merge after your review and exact-head green CI, in order; PRs with a migration or installer change wait for me.

S1 is session `session_0187kU9qz8GGVRjUCwT2Mtof` on `claude/vibrant-dirac-8osg5d`, which also holds the Guardian role (Opus) for this revamp.

## Session plan and file ownership

The session plan is the owner's private page `Corridra Revamp Session Plan` (claude.ai artifact 2J9XwudfoME1742EYEjnFJ, read 4 Nov 2026). Branch names below are as actually pushed or assigned; one branch per track.

| Session                          | Branch                        | Owns                                                                                                                                                                                            |
| -------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Conductor and Guardian (Opus) | `claude/vibrant-dirac-8osg5d` | `docs/revamp/**`, the ledger, PLAN_STATUS, START_HERE, the gap register, the work log, history snapshots; reviews and merges. No application code after PR 263.                                 |
| S2 Customer Work                 | `revamp/customer` (assigned)  | `apps/web/app/account/**` except delegations, `apps/web/lib/move-*`, `apps/web/lib/work-items/**`, customer navigation and shells, workspace chooser, compare lens, `apps/web/components/mr/**` |
| S3 Public, Intake, Organise      | `revamp/public`               | Public pages, `/plan`, first question, public shell, header and footer; after Wave 3, `apps/web/app/account/delegations/**` and `app/programme`                                                 |
| S4 Staff, Contributor, Recipient | `revamp/staff`                | `apps/web/app/operator/**`, contributor, network, mute, pulse, team sidebar, operator components, role navigation                                                                               |

Shared and frozen for every track: `globals.css`, tokens, `app/layout.tsx`, `packages/**` and middleware. A track that needs one opens a small separate PR titled `[shared]`; any `packages/**` change needs the Guardian's PASS. Track PRs add only their own verification file.

The ledger, work log and gap register are shared. Each session appends its own entry and rebases before merge; nobody rewrites another session's entry.

## Current lanes, 9 November 2026

Snapshot for takeover at main `f62e093` (PR 356). Live state, merges and owner items are in the [ledger](../V3_LEDGER.md) under Resume immediately; G4/G5 decisions and the Guardian's answers are in the [CRUD gap plan](crud/summary.md#order). Merge rules (owner, after PR 337): exact-head green CI plus Guardian PASS; Codex blocks only for P1 or a real privacy, money or access risk; one fix round at most; the owner merges any migration or installer change unless they say "u merge" for that PR. G4/G5 (PR 355) is installed and enabled in production since install run 42364802587 (7 Nov); its follow-up fixes are not merged yet.

| Session                               | Now                                                                                                       | After                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| S1 `session_0187kU9qz8GGVRjUCwT2Mtof` | Post-merge Guardian review of PR 355; records                                                             | Merge lane PRs on green CI plus Guardian PASS                                       |
| S2 `session_0187kU9tbkCEfmkNwdPr8885` | G4/G5 follow-up PR: four Codex findings plus Guardian findings, red tests first, additive migrations only | The owner merges it, then an install run                                            |
| S3 `session_0187kU9qaRV8ZWz9qkj2YZ6g` | Q-02 200% text sweep on public pages (`revamp/public-q02`)                                                | `/plan` length proposal only (measured 3.48 and 2.25 viewports against 2.0 and 1.0) |
| S4 `session_0187kU9rwcEXxStUHuLAMok4` | Team header part 3 (`s4-header2`)                                                                         | Field helper; staff erasure queue route and page                                    |
| Unassigned                            | Trust words in the shipped footer; service requests and drafts not gated by an archived workspace         |                                                                                     |

## Wave 0: inventory and cleanup manifest

[`wave-0/manifest.json`](wave-0/manifest.json) is generated at the baseline commit by the existing static collector and a small read-only deriver:

```
node scripts/v3-inventory.mjs <sha> .cache/revamp-inventory
node scripts/revamp-manifest.mjs .cache/revamp-inventory/inventory.json
```

At `a1dbbc9` it lists 124 routes (53 customer, 27 staff, 19 public, 12 public intake and identity, 9 recipient or private link, 3 contributor, 1 shared), with each route's access rule, customer navigation home (Home, My Work, Companies, Results, More), control count, permission boundaries in its file and handler branches. Every customer page has a navigation home. The collector found 1,777 controls, 135 handler branches, 313 commands and 310 permission boundaries. Static reachability is not functional verification: every route stays `EXISTING (static); runtime acceptance NOT VERIFIED` until a test proves it.

Cleanup reference check: 19 tracked source files have no importer, CSS import, package script or config reference. 18 are KEEP (tool config files loaded by name, and operator or evidence CLIs run by path). One is REVIEW: `apps/web/components/ux/page-header.tsx` has no importer. **Nothing was deleted.** Deleting it needs an owner-approved PR with this reference check rerun, the file hash recorded and a rollback note. `docs/source`, ADRs, QA records, history and migrations are never cleanup candidates.

The contract (Wave 0 and section 11) names two machine-readable files, `docs/revamp/COVERAGE.json` (route, action, role and per-stage evidence state) and `docs/revamp/CLEANUP-MANIFEST.json` (keep, consolidate, archive or delete decisions with references, recovery and approval). Both are generated by the same script at main `4b7f83e` (126 routes): [`COVERAGE.json`](COVERAGE.json) gives each route its target experience from contract section 3 and a state: 78 IMPLEMENTED, 48 GATED (a negated switch or module check directly guards a not-found or 503), none VERIFIED; deployment and acceptance are UNKNOWN for every route. [`CLEANUP-MANIFEST.json`](CLEANUP-MANIFEST.json) lists 20 entries (19 KEEP, 1 REVIEW pending owner and Guardian) with a recovery command each, and `deleted` is empty. A test in `tests/documents.test.mjs` fails if either file claims VERIFIED, leaves a route unmapped or records a deletion.
