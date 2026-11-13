## What changed and why

## Checks run (exact commands and results; list what was not run)

## Design checklist (every visible change; contract: [docs/agents/ui-direction.md](../docs/agents/ui-direction.md))

Delete this section only for a PR with no visible change, and say so.

- [ ] Read "Current locked decisions" and followed "How to build a new screen"
- [ ] Reused the shared shell, tokens, `CorridraIcon` and existing components (no raw colours, no CSS `text-transform` on actions, no inline type size or px spacing)
- [ ] Screenshots at 390, 768 and 1440 px attached, page length inside the budget
- [ ] States covered: loading, empty, error, denied, success, switch-off
- [ ] Accessibility: keyboard, focus, 44 px targets, contrast, axe clean
- [ ] Copy: Title Case actions, no em dashes, sample data labelled
- [ ] Original actions, routes, ids and payloads preserved
- [ ] `tests/design-system.test.mjs` and `tests/design-system-guard.test.mjs` pass; no baseline raised
- [ ] Definition of done for any visible change met

## Notes for the reviewer
