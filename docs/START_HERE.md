# Developer handoff: start here

This is the existing shared entry for Claude Code and Codex. Use the repository and fresh remote evidence, not chat memory. Current source, deployment, PRs, blockers, results and next action live only in [V3_LEDGER.md](V3_LEDGER.md); other guides link there to avoid conflicting status copies.

## Start a session

1. Read root/nested agent instructions. Inspect working-tree changes, fetch latest main and inspect open PR metadata before editing. Preserve another agent's work and dependent PRs.
2. Run `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`. State output is capped at 12 KiB. A hash/identity failure needs investigation, not refreshed hashes to conceal drift. Then `node scripts/authority.mjs`: it applies the owner's rule that the latest decision wins a conflict and names any plan whose own status line the register contradicts; `doc PATH` gives the verdict for one document.
3. Before substantive V3 product implementation, read the full [contract](V3_CONTRACT.md), governing [product vision v2.1](product/corridra-product-vision-v2.1.md) and its [working summary](agents/product-vision.md) once in the session. Revisit affected or changed sections afterward. Documentation maintenance can inspect its relevant authorities while proving product/source text unchanged.
4. Query affected requirement IDs with `node scripts/v3-context.mjs requirement V3-02-046`. All 507 IDs remain in the [current register](v3/phase-0/requirements.json). Discovery states are not runtime acceptance.
5. Read applicable [ADRs](adr/README.md), module contracts,[verification guide](verification-guide.md), and [UI direction](agents/ui-direction.md) for visible work. For any AC/1 Atlantic Cobalt visual work, also read the [design-system index](design-system/README.md). Read only relevant historical/log entries;`node scripts/v3-context.mjs chunk 109` returns one ledger entry. Follow the [agent protocol](agents/README.md).

## Product and authority

Corridra is one globally configurable commercial platform: find buyers/business partners, find suppliers/source products, and operate delegations. Other international objectives remain supported. Shared companies, qualification, evidence, meetings, commercial progression and execution services retain their actual tenant/privacy boundaries. A manufacturer is an organisation's capability, not a separate identity or permission system.

Keep every original authorised action and expert/deep-link/recovery/export route reachable. Reuse domain services; do not rebuild the backend for navigation or duplicate mission/company engines. Customer identity is separate from staff/MFA authority. An organiser does not inherit participants' private offers, contacts, missions or values. Never merge authority by email similarity.

Keep immutable sources, evidence/quotation versions, append-only events and exact original currencies. Customer trade value, organiser finances, Corridra revenue/costs and contributor obligations are separate. State blast radius before auth/RLS/money/event changes; use ADRs and additive reviewed migrations. Builds never migrate.

V3 remains partial and commercially gated. Implemented, tested, deployed, enabled, externally approved and commercially live are different states. D01-D06/D08 stay closed until independently evidenced approval. Missing engineering is not excused by activation gates; controls require real backends. Never invent AI output, verification, KPIs, meetings, deals or money.

## Continue and release

Check the [plan status register](PLAN_STATUS.md) before trusting any plan: every plan, scope packet, proposal and audit starts with `Document status: WORD` (CURRENT, CURRENT DATED, DONE, PARTLY BUILT, WAITING OWNER, HISTORICAL, NOT VALID, FROZEN) and the register lists which is in force. Use the [current work sequence](implementation/current-plan.md),[agent plan pointer](agents/master-plan.md) and live ledger. The [implementation matrix](implementation/implementation-matrix.json) and UX coverage ledgers are dated baseline indexes, not exhaustive current V3 acceptance. V1 Parts 1-8 and revised V2/UX work are retained foundations; do not restart historical V1 Parts 9-12.

Run focused checks while editing and every mandatory frozen-revision gate from AGENTS and the [release runbook](runbooks/deployment.md). Never weaken a test to pass. Save full logs under work/ and report exact exits/totals/limits. Agents open draft PRs; the owner gives a merge command for each PR, and a merge to `main` deploys itself (owner decisions 2026-10-25 and 2026-10-29 replaced the earlier standing merge-and-deploy authorization). No force push, protection override, real-operation activation or unreviewed destructive action is ever authorized by an agent alone. Verify full merge tree, READY/source/region/aliases and actual scoped live observations.

Read-only runtime/environment guidance applies before network/container work; preserve proxy/TLS and scoped identities. Never print secrets, OTP/reset/session tokens or production personal data. Controlled testers complete private verification in the isolated preview; actual authenticated acceptance remains unknown until observed. Account identity alone grants no workspace or commercial admission.

Historical entry/plan snapshots are preserved exactly in [the history manifest](v3/history/manifest.json). Relative links in archived verbatim text belong to the recorded original sourcePath. Use current guides for navigation. [Bounded context workflow](v3/CONTEXT.md) explains output limits and history queries.
