# Design is binding here

Any visible change under this directory follows [UI/UX.v3](../../docs/agents/ui-direction.md) (the binding design contract since 13 November 2026, until the owner launches UI/UX.v4; older looks are listed there as legacy): read "Current locked decisions", follow "How to build a new screen" and meet "Definition of done for any visible change". Use tokens, `CorridraIcon`, the shared shells and `components/ux/`; no raw colours, no CSS `text-transform` on actions, no inline type size or px spacing. `tests/design-system-guard.test.mjs` enforces it. `next dev` rewrites the Next.js block below; keep this section above it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
