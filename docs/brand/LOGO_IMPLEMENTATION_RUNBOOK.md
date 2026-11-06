# Logo and favicon implementation runbook

Audience: Claude Code or Codex working in this repository. Spec: [CORRIDRA_BRAND_IDENTITY.md](CORRIDRA_BRAND_IDENTITY.md). Registry: [brand-identity.tokens.json](brand-identity.tokens.json). Decision: [ADR-077](../adr/0077-corridra-visual-identity.md).

## 0. Before you start

1. Follow AGENTS.md and the start sequence in CLAUDE.md: `git status --short`, `node scripts/v3-context.mjs`, `node scripts/v3-context.mjs verify`. Re-read the ledger.
2. Run `node scripts/check-git-branch-budget.mjs <branch>` before creating the branch. Use one short-lived branch, open a draft PR only, and do not merge without the owner's command.
3. This is a presentation-only change. No auth, RLS, money, migration or event behaviour changes. State that in the PR.
4. The owner supplied the logo. Do not generate, redraw or alter it. If the request is for a different mark, stop and report; section 11 of the AC/1 master contract needs human review first.
5. Never mark the open gates in the identity doc as passed.

## 1. Discover (never guess paths)

```bash
set -euo pipefail
rg -n 'BrandMark|BrandLockup|className="brand"|brand-mark|brand-word' apps/web --glob '!node_modules' || test "$?" -eq 1
rg --files apps/web | rg -i '(icon|favicon|opengraph|twitter-image|manifest|apple)' || test "$?" -eq 1
rg -n 'metadataBase|themeColor|openGraph|twitter|viewport' apps/web/app/layout.tsx || test "$?" -eq 1
rg -l -i '(logo|<img|pdf|react-pdf|pdfkit)' packages apps/web/app/api apps/web/lib || test "$?" -eq 1
rg -n 'toHaveScreenshot' tests || test "$?" -eq 1
rg -n 'CanonicalLink' apps/web/components/ux/canonical-link.tsx apps/web/app/layout.tsx || test "$?" -eq 1
```

Read the hits. The expected set at the time of writing was: `components/site-header.tsx` (public header, `BrandMark`), `components/ux/shell-header.tsx` and `components/ux/app-header.tsx` (signed-in header), `components/site-footer-view.tsx` (footer text link), CSS in `app/globals.css` and `components/ux/left-nav.css`, and `app/icon.svg` as a placeholder favicon. Any hit not in this list is a new touchpoint: add it to the matrix below.

## 2. Apply the files

Fast path, from the repository root on a fresh branch from main:

```bash
git apply --check brand-identity-v1.patch && git apply brand-identity-v1.patch
```

If main has moved and the patch does not apply, use `git apply --3way`, or copy the files from the package `repo/` folder and make the edits in section 3 by hand.

## 3. Touchpoint matrix

| Surface                     | File                                                                | Asset and rule                                                                                                         |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Public header               | `components/site-header.tsx`                                        | `<BrandLockup />` inside the existing `.brand` link; link keeps its `aria-label`                                       |
| Signed-in header            | `components/ux/shell-header.tsx`, `components/ux/app-header.tsx`    | Shell passes `brandMark={<BrandLockup />}`; remove the old `<span>Corridra</span>`                                     |
| Footer                      | `components/site-footer-view.tsx`                                   | `<BrandLockup />` plus `<span className="sr-only">Corridra</span>`; white on navy via CSS                              |
| Collapsed left rail         | `app/globals.css` (brand identity layer)                            | Hide `.brand-word`, keep the orb                                                                                       |
| Logo geometry               | `components/brand-paths.ts`                                         | `ORB` and `WORDMARK` path data; must equal the SVG assets (test enforces)                                              |
| Logo colour                 | `app/globals.css`, after the "Design system layer" marker           | `.brand-mark` uses `var(--brand)`, `.brand-word` uses `var(--brand-deep)`; tokens only                                 |
| Tab icon                    | `app/icon.svg`, `app/favicon.ico`                                   | Orb tile                                                                                                               |
| iOS icon                    | `app/apple-icon.png`                                                | 180 px                                                                                                                 |
| Social cards                | `app/opengraph-image.png`, `app/twitter-image.png` and `.alt.txt`   | 1200 x 630; set `twitter.card` to `summary_large_image`                                                                |
| Manifest                    | `app/manifest.ts`, `public/brand/android-*.png`, `maskable-512.png` | `display: 'browser'`, colours are AC/1 primitives                                                                      |
| Browser chrome colour       | `app/layout.tsx` `viewport.themeColor`                              | `#142438`                                                                                                              |
| Large logo in a page        | any `.tsx`                                                          | `next/image` with `unoptimized` and a file from `public/brand/`; never a new inline `<svg>`                            |
| Email (none today)          | `packages/communications`                                           | When added: `public/brand/corridra-lockup-horizontal-cobalt.png` (640 px) by absolute URL, `alt="Corridra"`, width 180 |
| PDFs (Trip Book and others) | the PDF builder found in step 1                                     | Vector from `docs/brand/assets/pdf/` or the SVG; `lockup-horizontal-cobalt` on white                                   |
| Slides and documents        | outside the repo                                                    | `docs/brand/assets/png/` and `svg/`                                                                                    |

Owner actions outside the repository, list in the PR and do not attempt: GitHub repository social preview and avatar, Vercel project icon, email signatures, LinkedIn and other profile avatars (`app-icons/*-circle.png`), domain and partner portals.

## 4. Rules that make the existing tests pass

- Inline `<svg>` is allowed only in the files the design-system test lists. Do not add files to that list; keep drawing the logo in `site-header.tsx`.
- Hex colours in `.ts` and `.tsx` under `app`, `components` and `lib` must be AC/1 primitives. `#142438` and `#f6f8fb` are. Orange `#FE8E03` and `#041B46` are not and must never appear.
- CSS written after the "Design system layer (Phase 1)" marker uses tokens only. Add logo CSS at the end of `globals.css`. Do not remove legacy `.brand span` rules unless you also lower `tests/design-system-baseline.json` as that file instructs.
- Never edit, skip or weaken an existing assertion. The new `tests/brand-identity.test.mjs` is added to the `test:docs` script in `package.json`.
- Run prettier on every new or changed file: `pnpm exec prettier --write <files>`. SVG and PNG are not formatted.

## 5. metadataBase

`app/layout.tsx` has no `metadataBase`. With social images added, Next resolves image URLs from it. Find the canonical site URL the app already uses (see `CanonicalLink`). If a single canonical constant exists, use it. If not, do not invent a domain: leave a note in the PR for the owner and verify that `og:image` renders as an absolute production URL on the preview deployment.

## 6. Verify (quote the output in the ledger)

```bash
set -euo pipefail
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
```

Then, with a production build served (`pnpm start` after rebuilding, per the known rebuild lesson):

```bash
for p in /icon.svg /favicon.ico /apple-icon.png /manifest.webmanifest /brand/corridra-lockup-compact-cobalt.svg; do
  curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" http://localhost:3000$p
done
curl -s http://localhost:3000/ | rg -o '<link rel="(icon|apple-touch-icon|manifest)"[^>]*>|<meta (property="og:image"|name="theme-color"|name="twitter:card")[^>]*>'
```

Expected: every path 200 with an image or manifest type; the head shows icon, apple-touch-icon, manifest, `og:image`, `theme-color` and `summary_large_image`. The middleware matcher skips paths with a file extension, so these are served without a session check. If a route inventory test lists app routes, add `manifest.webmanifest` to it.

Visual checks, on the representative screens: public home, signed-in customer shell with the left rail expanded and collapsed, team shell, footer, at 320, 360, 390, 768, 1024, 1440 and 1920 px and at 200 and 400 percent zoom. Pass when there is no horizontal overflow, the brand link keeps a 44 px target, focus ring is visible, and the wordmark does not collide with neighbouring controls. If a header is crowded at 320 or 360 px, add a token-only rule hiding `.brand-word` at that width. Check forced-colours mode in the browser dev tools. If `toHaveScreenshot` baselines exist, update only the affected ones and name them in the PR for the owner's review.

## 7. Record

1. Ledger entry in `docs/V3_LEDGER.md` in its existing format: what changed, exact command output, open gates, next action. Run the context-tools tests after the handoff edit.
2. Add the ADR-077 row to `docs/adr/README.md`.
3. Add one pointer line to `docs/design-system/README.md` and a dated addendum line to `docs/agents/ui-direction.md` saying the logo and icon rules live in `docs/brand/CORRIDRA_BRAND_IDENTITY.md`. Do not edit anything under `docs/source/`.
4. If `tests/documents.test.mjs` or `scripts/v3-context.mjs` reports the documentation map is stale, regenerate it the way that failure message says.
5. PR description: presentation only, list of files, test output, the open gates from the identity doc, the owner actions outside the repo, and the `metadataBase` finding.

## 8. Updating the logo later

A new artwork needs a new ADR and the review in section 11 of the identity doc first. Mechanically: replace the SVGs in `docs/brand/assets/` and `apps/web/public/brand/`, regenerate PNG, favicon and social files, update `brand-paths.ts` to the new orb and wordmark paths, update the registry JSON, run the tests. The test fails if `brand-paths.ts` and the SVG assets disagree.

## 9. Rollback

Everything is additive and presentation-only. Revert the PR. No data, migration or switch is involved.
