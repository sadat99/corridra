# Corridra V3 AC/1 — Locked Atlantic Cobalt Design System

**This is a handoff package, not production deployment. No Corridra repository files were modified.**

## Read / implement in this order

1. `MASTER_DESIGN_CONTRACT.md` — binding style, five compositions, components, page mapping, security and implementation rules.
2. `atlantic-cobalt.tokens.json` — primitive + semantic tokens in an agent-friendly structured file.
3. `EXISTING_TOKEN_MIGRATION_CROSSWALK.md` — why legacy CSS cannot be blindly recoloured, and exact migration guardrails.
4. `AC1-visual-reference.html` — browser-visible reference: Atelier, Meridian, SourceLedger, Encounter, Signal and Components. Synthetic data only. Includes controlled interactive specimen navigation, no production backend.
5. `QUALITY_GATE_AND_CONTINUITY.md` — rejection criteria, gate owners, breakpoints, handover rules.
6. `ONE_PASTE_AGENT_INSTRUCTION.md` — copy/paste to whichever development agent can execute the next bounded task.
7. `verification.json` + screenshots — observed 24 specimen render states, not system-wide product tests.
8. `contrast-checks.json` — illustrative colour-pair checks only, not WCAG product certification.

## Brand lock

Midnight Navy `#142438` · International Cobalt `#2856C5` · Porcelain `#F6F8FB` · Copper `#BF7548` · Ink `#18283C`.

## Architecture lock

**One foundation: Meridian.** Four specialist work compositions: **SourceLedger, Encounter, Commerce Atelier, Signal Desk**. Unified controls and meanings across all. No new domain engine, DB, auth, permissions or country forks. Existing V3 Guided UX accessibility and work preservation remain binding.

## Reviewed source snapshot

Repository: `sadat99/corridra`. At review: `main` most recent commit `bc044991210d66175d62eb71ea98e381a8724af6`; no open PRs surfaced in connected search. This is time-bound evidence. Independently recheck before changes. Prior route discovery reported 47 nested `page.tsx` routes + root, and 18 protected operator destinations. These are **not** full action/runtime coverage counts.

## Verification scope

The HTML reference passed an automated Chromium check at 1440, 768, 390 and 320 pixels across six gallery sections (24 combinations), without page-wide overflow or script errors after repairs. Browser screenshot appearance alone does not verify functionality, multilingual usability, semantic access, production readiness or acceptance by end users.

## Dependencies

No external font files or vendor imagery included. Rendered using system-provided fonts and CSS. Newsreader is an optional future display-font recommendation to validate and license separately; its name in the spec is not permission to ship a fetched font file.
