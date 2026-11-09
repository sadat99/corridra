# ADR-077: Corridra visual identity (logo, orb, icons)

Status: Proposed. Owner instruction to adopt the supplied logo was given on 6 November 2026. Acceptance, with the open gates below recorded, is the owner's decision.

Scope: logo, small-size mark, favicon, app icons and social images. Presentation only. This amends the logo clause of AC/1 master contract section 11 ("retain current wordmark and mark initially") only to the extent the owner accepts it here. The AC/1 colour, type, spacing and radius decisions are unchanged.

## Context

The owner supplied a new Corridra logo: a halftone dot sphere with an open bite, the wide wordmark CORRIDRA, a short bar and the line SOURCE, VALIDATE, TRANSACT. The repository drew a small stroked "C" and set the name as live text. The supplied artwork used navy `#041B46` and orange `#FE8E03`, which are not AC/1 primitives. The design-system tests allow raw hex only as `--ac-*` primitives, allow one inline brand drawing, and the AC/1 contract bans floating abstract spheres and invented logos.

## Decision

1. Adopt the supplied artwork as the Corridra identity, rebuilt as vectors (dots as ellipses, lettering traced) with no change to its design.
2. Express it in AC/1 colour: cobalt mark, navy wordmark, copper bar; white with copper bar on navy. The original orange and navy are archived and not used in product.
3. Add a derived small-size mark, the orb, for sizes where the halftone dots cannot hold. It needs the same review as the logo.
4. Draw the logo inline in one place (`site-header.tsx`), geometry in `brand-paths.ts`, colour in token-only CSS. Everything else uses files from `public/brand`.
5. Keep the tagline lockups out of product UI.
6. Provide favicon, Apple, Android, maskable, Open Graph and Twitter assets through Next file conventions and a manifest.
7. Do not use the sphere as decoration.

## Open gates (not passed)

| Gate                                                                                                                                                                                                              | Owner of the gate        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Human art-direction review of the orb as a standalone mark and of the rest of the logo family (done only for the sphere in the header, footer, rail and favicon, by the owner's 9 Nov 2026 decision, amendment 1) | Owner to name a reviewer |
| Trademark check for the name and mark in target markets                                                                                                                                                           | Owner and counsel        |
| Legal and technical handoff, including a vector master                                                                                                                                                            | Owner and designer       |
| Tagline claims against live capability (Transact)                                                                                                                                                                 | Owner                    |

## Consequences

- Additive files: `docs/brand/*`, `apps/web/public/brand/*`, icon and social files in `apps/web/app`, `components/brand-paths.ts`, `app/manifest.ts`, one test file.
- Edits: `site-header.tsx`, `shell-header.tsx`, `app-header.tsx`, `site-footer-view.tsx`, `globals.css` (appended after the design-system marker), `layout.tsx` (viewport theme colour, Twitter card size), `package.json` (test list).
- The wordmark is wider than the old text, so narrow headers need the responsive checks in the runbook.
- No data, authentication, RLS, migration, money or event change. Rollback is reverting the PR.
- The lettering and dots were traced from a raster image. A vector master should replace them when one exists.

## Required evidence

Format, lint, typecheck, test (including `tests/brand-identity.test.mjs`), build and e2e output; route checks for the icon, manifest and image files; head tags on a production build; screenshots at the widths listed in the runbook; forced-colours check.

## Amendment 1 (9 November 2026): halftone sphere in the product mark and favicon

Owner decision, 9 Nov 2026, verbatim: "all good except the icon/logo art, which is currently solid colored circle shaped and dot, instead of many dot type one" and "replace with the alternate version, color could whatever is appropriate". The owner means the halftone sphere (asset family `mark`) in place of the solid orb (family `orb`). This is the human review that the runbook (section 8) and gate 2 above ask for, for the sphere in these places. It is not a redesign: only the existing registry artwork is used, nothing is drawn or edited.

Where each asset is used from now on:

| Place                                                                       | Asset                                                          | Colour                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Public header, signed-in headers, collapsed left rail, footer (`BrandMark`) | halftone `mark`, 46 x 44 px, CSS mask                          | `--brand` on light, `--on-brand` on navy |
| `app/icon.svg`, `favicon.ico` 32 and 48 px entries, `favicon-32/48/64.png`  | halftone `mark` reversed on `--ac-navy` tile, 0.92 of the tile | white on `#142438`                       |
| `favicon-16.png` and the 16 px entry of `favicon.ico`                       | `orb` (unchanged)                                              | white on `#142438`                       |
| Apple, Android, maskable, Open Graph, Twitter                               | halftone `mark` (already, no change)                           | unchanged                                |
| Avatars and any other slot under 44 px                                      | `orb`                                                          | unchanged                                |

Why the 16 px favicon keeps the orb: at 16 px the dots turn to grey. At 32 px and above the sphere on the navy tile reads. Browsers that prefer `icon.svg` use the halftone at 16 CSS px; the orb shows only where `favicon.ico` is chosen. The mark is 44 x 42 px, with a 4 px header gap, in the signed-in headers at 430 px and below (the real team header at 390 px has no spare width; a 46 px mark wrapped it and pushed the team Today page over its two-screen budget, found by CI job operator (2) on the first head). It is 46 x 44 px everywhere else (the public header wordmark also drops to 14 px tall at 430 px and below, under the 24 px compact-lockup minimum, so the public row stays on one line at 390 px: a second deliberate exception), including the contributor header, which keeps its own gap: the 4 px gap and the 44 x 42 px mark apply to the customer and team headers only (`.site-header:is(.ux-customer-header, .ux-team-header)`). The contributor header is a wrapping row and was not measured at 320 to 430 px here. Measured against the old 30 px mark with an 8 px gap, header height is identical at 320, 340, 360, 375, 390, 414, 430, 500, 700 and 759 px. `.brand-mark` sets `print-color-adjust: exact` so the mask prints in colour.

Why 44 px tall in chrome: at 36 px the small dots vanish; at 44 px the dot grid and the bite on the right read on light and navy surfaces. The mark is sized 46 x 44 px wherever it appears, with one deliberate exception: in the customer and team signed-in headers at 430 px and below it is 44 x 42 px, 2 px under the 44 px rule, because the measured row width leaves no room for more (next paragraph). The signed-in headers still hide the wordmark under 760 px, and the collapsed rail still shows the mark alone; both now show the halftone sphere at the same 44 px, so no place falls back to the orb.

Mechanism: `BrandMark` is a `span` that CSS paints with `background-color: currentColor` and a mask of `public/brand/corridra-mark-cobalt.svg` (only its alpha is used), so 230 ellipses (about 21 KB) are not inlined in the client bundle and the colour still comes from the existing token rules. Forced colours use `CanvasText` with `forced-color-adjust: none`. `brand-paths.ts` now exports `MARK` (the file) and `WORDMARK`; the `ORB` path export is removed and `tests/brand-identity.test.mjs` and `tests/integration/navigation-v1-public-header.test.ts` were updated to this truth. The brand test still fails if the mask file, the CSS or the header code disagree.

Still open, unchanged: trademark check, legal and technical handoff and tagline review. Gate 2 (art-direction review) is recorded as done only for the sphere in these places by the owner's 9 Nov 2026 decision above. The review of the orb as a standalone mark and of the rest of the family stays open, and so do the trademark check, the vector master and legal handoff, and the tagline claims. Nothing wider is closed.
