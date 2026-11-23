# UI/UX.v4.1 platform rollout and handoff

Document status: CURRENT. Execution plan for the owner-locked [UI/UX.v4.1 amendment](ui-ux-v4-1.md) (decisions L1 to L10). It adds no design rule. It says how to apply the locked rules to every page and how to prove it. Nothing here is built yet.

## Authority and read order

1. [AGENTS.md](../../../AGENTS.md), nested instructions, [CLAUDE.md](../../../CLAUDE.md), then `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`. The ledger is the current state. This file is not.
2. [ui-direction.md](../../agents/ui-direction.md) (UI/UX.v4 with the v4.1 section), [ui-ux-v4-1.md](ui-ux-v4-1.md), the [UI/UX.v4 visual grammar](../../agents/ui-direction.md) (state shapes, holder markers, Explain rule, flag policy).
3. The [conformance ledger](../v4-1-conformance.json) rows for the wave you take.
4. Run the squad as the repo requires: `corridra-authority` first, then the stamped brief.

Where they disagree, UI/UX.v4 and the real route and backend contracts win over this file. Copy stays exactly as live unless the owner approves wording. Keep every route, id, name, payload, permission and test hook.

## Where it stands

| Item                                | State                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| v4.1 design lock                    | Merged to `main` (PR 598, `43c2bbc`). Design only.                                                                                         |
| Built code                          | None. Flags appear in four components (home and `/corridors`). `CorridraIcon` is in 46 files.                                              |
| Pages                               | 84 `page.tsx` routes, all rows in the ledger. 6 carry a scoped v4.1 decision (L4 to L9), the rest are `not_assessed` for L1 to L3 and L10. |
| Enforcement added with this handoff | `scripts/v4-1-conformance.mjs`, `tests/v4-1-guard.test.mjs` with a frozen baseline, and the ledger.                                        |
| Not verified                        | Production switch values, any signed-in journey with the newer switches on, real-device checks. Do not infer them from code.               |

## Mechanical enforcement (in place; no screen is built yet)

- `node scripts/v4-1-conformance.mjs check` fails when a route has no ledger row, a row has no page, a status is outside `n/a, not_assessed, not_started, built, verified`, a scoped decision sits on the wrong route, or `built` and `verified` rows lack evidence. A new page cannot skip v4.1.
- `tests/v4-1-guard.test.mjs` (in `pnpm test:docs`): the ledger check, the nine-flag policy, a ratchet on place names written outside the flag component, and a ratchet on gradients or backdrop blur in stylesheets. A count may fall and never rise. Lower the baseline when you remove debt: `V41_WRITE_BASELINE=1 node --test tests/v4-1-guard.test.mjs`.
- It cannot judge meaning (does an icon fit, is there one primary action per region). Screenshots, axe and the ledger evidence carry that.

## Waves

Names V4.1-A to D avoid the older numbered revamp waves. One PR per slice, each behind its existing switch where the module is optional. Run `node scripts/v4-1-conformance.mjs summary` before and after.

| Wave   | Scope                        | Routes                                                                             | Notes                                                                                      |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| V4.1-0 | Shared pieces                | none                                                                               | Before any screen. See below.                                                              |
| V4.1-A | Public pages                 | home, routes, plan, start here, services, fairs, programmes, auth, legal           | The scoped decisions L4 to L7 live here first (`/`, `/corridors`, `/plan`, `/workspace`).  |
| V4.1-B | Customer account             | `/account/**`                                                                      | Owner has not yet reviewed these mockups against live screens. Review first.               |
| V4.1-C | Recipient links, contributor | `/buyer`, `/client`, `/decision-card`, `/programme`, mute pages, `/contributor/**` | L8 and L9 live here. Private links must leak nothing.                                      |
| V4.1-D | Operator and owner           | `/operator/**`                                                                     | Protected surface. Keep the 18 section ids, MFA and role checks. Run `pnpm test:operator`. |

### V4.1-0 shared pieces

Reuse before creating. Read first: `components/ux/flag.tsx` (`Flag`, `RegionMark`, `Flagged`, `RouteLine`), `components/ux/choice-chip.tsx` (`ChoiceRow`, `ChoiceButton`), `door-card.tsx`, `open-card.tsx`, `page-frame.tsx`.

1. Give the choice row an optional owned icon in a 42 to 44 px soft square and the L3 chosen state, without changing its API for existing callers.
2. Route every place name through `Flagged`, with the compass for regions and nothing for contested places. No new flag without an owner decision.
3. A small source stamp (L10) only if no peer exists, then add it to the UI/UX.v4 shared components table.
4. Do not use the two light-on-navy colours from the mockups. They are not tokens yet. Use `--on-brand` white on navy until the owner decides.

## What every PR must show

The UI/UX.v4 definition of done, plus:

- The ledger rows for the touched routes moved to `built` with evidence, and to `verified` only after the screenshots and checks below exist.
- Screenshots before and after at 320, 390, 768, 1024, 1440 and 1920, with the live page for comparison.
- `node --test tests/design-system.test.mjs tests/design-system-guard.test.mjs tests/v4-1-guard.test.mjs tests/documents.test.mjs`, `pnpm test:ux` counts not above the baseline, axe clean, `pnpm format:check`.
- A visible word beside every symbol, Explain on lone symbols, no copper text, no gradient or glow, 44 px touch targets, reduced motion respected.
- The exact checks run and not run in the work log.

## Working beside other agents

- Fetch `main` and the open PR list first. List another PR's files before editing and keep file sets disjoint (known issue KI-07).
- Touch it, convert it: a V4.1 wave PR that changes a visible file also updates that route's conformance row. A visible change in a wave PR with no row update is incomplete. (Guardian, 23 Nov 2026, after review of PR 599: a PR that is not a V4.1 wave PR, such as a copy or defect fix, does not edit `docs/revamp/v4-1-conformance.json`; it only keeps the guard counts at or below the baseline.)
- Regenerating `tests/v4-1-guard-baseline.json` is allowed only to lower counts; the PR shows the baseline diff and it may contain no increase. The `v4.1-prose` line escape is not owner-approved as a rule exception: do not add new uses without the owner's word.
- Known guard limits (review of PR 599, to fix in the first wave): a place-name line is only counted when it also holds a quote or `>`, so rewrapping multi-line JSX text can change counts; only `.tsx` files are scanned, so words files under `lib/` are not enforced.
- Only the scribe edits the shared ledger (`docs/V3_LEDGER.md`) and work-log lines. Builders edit the conformance ledger rows of their own routes only.
- Rollback is the existing switch or a revert of the squash commit. Never delete data to match a screenshot.

## Decisions only the owner can take

- Tokens for light text on navy (two colours are in the mockups, none is in `globals.css`).
- Whether the Decision Record view, the data-true sphere, a read-only status link, currency chips, time zone strips and holder markers beyond the existing grammar join the lock.
- A Singapore flag (the repo has none).
- Review of the signed-in screens (V4.1-B and D) against the live screens before they are built. The mockups were not compared with live signed-in pages.

## Handoff brief (paste to the implementing agent)

> Implement UI/UX.v4.1 across the Corridra platform. Authority: `docs/revamp/specs/ui-ux-v4-1.md` (L1 to L10) and `docs/revamp/specs/ui-ux-v4-1-rollout.md`. Start with `corridra-authority`, `node scripts/v3-context.mjs verify` and the conformance ledger. Take one slice at a time in the order V4.1-0, A, B, C, D. For each slice: read the ledger rows, reuse the shared components, change presentation only (routes, ids, payloads, permissions, copy and flags stay), update the ledger rows with evidence, run the checks in the rollout file, open a draft PR and wait for the owner's merge command. Stop the slice and report when a rule conflicts or an owner decision is missing. Never mark a decision `verified` without screenshots and green checks on the exact head.
