# Corridra brand identity (logo and icon system)

Status: owner-supplied logo, adopted by owner instruction on 6 November 2026. Decision record: [ADR-077](../adr/0077-corridra-visual-identity.md) (Proposed), amended on 9 Nov 2026 by the owner (amendment 1: the halftone sphere in the header, footer, rail and favicon). Trademark check, vector master and legal handoff and tagline review are open; the art-direction review is recorded done only for the sphere in those places; see section 11.

This is the identity layer on top of the owner-locked AC/1 Atlantic Cobalt design system. It adds the logo, icon and social-image rules. It does not redefine any AC/1 colour, font, spacing or radius; those stay in `apps/web/app/globals.css` and [docs/design-system/README.md](../design-system/README.md). Machine-readable registry: [brand-identity.tokens.json](brand-identity.tokens.json). Visual reference: [brand-guidelines.html](brand-guidelines.html).

## 1. The logo family at a glance

| Part     | What it is                                                                         | Asset key           |
| -------- | ---------------------------------------------------------------------------------- | ------------------- |
| Mark     | Halftone dot sphere with an open bite on the right. 230 vector ellipses.           | `mark`              |
| Orb      | Solid crescent disc with one detached dot. Derived small-size version of the mark. | `orb`               |
| Wordmark | CORRIDRA in wide geometric capitals. Artwork, not live text.                       | `wordmark`          |
| Bar      | Short copper rule under the name. Decorative.                                      | part of the lockups |
| Tagline  | SOURCE, VALIDATE, TRANSACT in tracked capitals. Marketing only (section 8).        | `*-tagline`         |

Lockups: `lockup-compact` (orb + wordmark), `lockup-horizontal`, `lockup-stacked`, plus `-tagline` versions of the last two and of the wordmark.

## 2. Which asset to use

| Context                                                                         | Asset                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Favicon file at 16 px, avatar and any other slot under 44 px                    | `orb`                                           |
| Product chrome, 44 px tall beside the wordmark: headers, collapsed rail, footer | `mark` (BrandMark paints it from the mask file) |
| Product chrome 24 to 40 px tall: headers, footer                                | `lockup-compact`                                |
| Wide spaces: slides, documents, partner pages                                   | `lockup-horizontal`                             |
| Centred or narrow spaces: sign-in, covers, social cards                         | `lockup-stacked`                                |
| Large brand moments, square, 64 px and up                                       | `mark`                                          |
| App icon, 180 px and up                                                         | `mark` on a navy tile (`app-icons/`)            |
| Marketing and brand sheets only                                                 | `*-tagline` versions                            |

Never scale the dot mark below 44 px tall. The halftone dots merge into grey below that. Use the orb. Owner decision, 9 Nov 2026 (ADR-077 amendment 1): the header, rail and footer show the halftone sphere at 44 px tall, and the favicon uses it at 32 px and up; the orb stays only for the 16 px favicon file and slots under 44 px.

## 3. Colour

Colour roles map to existing AC/1 tokens. No new colour is introduced.

| Element  | On light surfaces                     | On Midnight Navy surfaces |
| -------- | ------------------------------------- | ------------------------- |
| Mark     | Cobalt `--brand` `#2856C5`            | White `--on-brand`        |
| Wordmark | Navy `--brand-deep` `#142438`         | White `--on-brand`        |
| Bar      | Copper `--editorial-accent` `#BF7548` | Copper `#BF7548`          |

Colorways: `cobalt` (default), `navy` (sphere in navy, for print or where cobalt would compete with an action), `reversed` (navy surfaces only), `mono-navy`, `mono-white`, `mono-black`.

Contrast, measured: cobalt on Porcelain 6.12, cobalt on white 6.51, navy on Porcelain 14.74, white on navy 15.68, white on cobalt 6.51, copper on Porcelain 3.37, **cobalt on navy 2.41 (fails, use `reversed`)**. Copper is decorative only, as AC/1 already requires: never text, never a status colour.

The original supplied artwork used navy `#041B46` and orange `#FE8E03`. Neither is in the AC/1 palette. Those files are kept in `docs/brand/assets/legacy-orange/` for reference only and must not appear in product code. The AC/1 colorways are the product identity.

## 4. Surfaces

Allowed: Porcelain (`--paper`), white (`--surface-1`), `--surface-subtle`, Midnight Navy (`--brand-deep`) and `--ac-surface-navy` with the `reversed` colorway. On a cobalt surface use `mono-white`. On photographs use `mono-white` or `mono-black` over a scrim that keeps 4.5:1. Not allowed: copper, status tints, gradients, patterns, or any busy area behind the logo.

## 5. Clear space and minimum size

Clear space `X` is the height of the letter C in the wordmark. For the orb alone, `X` is a quarter of the orb diameter. Keep at least `X` free on every side.

| Asset               | Minimum size                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `orb`               | 16 px                                                                                                                 |
| `lockup-compact`    | 24 px tall                                                                                                            |
| `wordmark`          | 96 px wide                                                                                                            |
| `lockup-stacked`    | 120 px wide                                                                                                           |
| `lockup-horizontal` | 160 px wide                                                                                                           |
| `mark`              | 64 px wide in print and on pages (large brand moments, app icons); 44 px tall in product chrome (ADR-077 amendment 1) |
| tagline lockups     | 200 to 260 px wide                                                                                                    |
| Print, any lockup   | 25 mm wide                                                                                                            |

## 6. Typography relation

The logo lettering is artwork. Never retype CORRIDRA in Geist, Newsreader or any other face to stand in for it, and never set the wordmark in running text. In sentences the name is plain text in the product font. Headings keep Newsreader, text keeps Geist, labels keep Geist Mono, Bengali keeps Noto Sans Bengali, all as decided in AC/1. The wordmark stays Latin on every language page; do not transliterate it inside the logo.

## 7. Where the logo is drawn in code

One place. `BrandMark`, `BrandWordmark` and `BrandLockup` live in `apps/web/components/site-header.tsx`, the single inline drawing the design-system test allows. `BrandMark` is a `span` that CSS paints from `public/brand/corridra-mark-cobalt.svg` as a mask (alpha only), so no mark geometry is inlined; the wordmark path is inlined from `apps/web/components/brand-paths.ts`, which also names the mask file (`MARK`). Colour comes from CSS classes `.brand-mark` and `.brand-word` using tokens, never from hex in a component. Anywhere else use a file from `apps/web/public/brand/` through `next/image` with `unoptimized`, `alt=""` when a visible name is next to it, or `alt="Corridra"` when it stands alone.

## 8. Tagline

SOURCE, VALIDATE, TRANSACT belongs to marketing material and brand sheets only. Product UI uses lockups without it. Reason: the repository keeps real-operation gates closed and says new copy must not claim coverage, verification or payments that do not exist. Transact must not appear next to a screen that cannot yet transact. Any tagline use needs owner sign-off against the [positioning constitution](positioning-messaging-constitution-v1.0.md).

## 9. Favicon, app icon and social

| Output                 | File                                           | Construction                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser tab (SVG)      | `apps/web/app/icon.svg`                        | Halftone mark in white on a navy rounded tile, 0.92 filled, 64 grid. Browsers that prefer SVG use this at 16 CSS px, so the halftone shows there; the orb shows only where `favicon.ico` is chosen |
| Browser tab (legacy)   | `apps/web/app/favicon.ico`                     | 16 px entry the orb tile; 32 and 48 px entries the halftone tile                                                                                                                                   |
| iOS home screen        | `apps/web/app/apple-icon.png` (180)            | Full-bleed navy, dot mark at 66 percent                                                                                                                                                            |
| Android, manifest      | `public/brand/android-chrome-192.png`, `-512`  | Full-bleed navy, dot mark at 66 percent                                                                                                                                                            |
| Android maskable       | `public/brand/maskable-512.png`                | Full-bleed navy, dot mark at 46 percent                                                                                                                                                            |
| Open Graph and Twitter | `app/opengraph-image.png`, `twitter-image.png` | 1200 x 630, Porcelain, horizontal lockup, no tagline                                                                                                                                               |
| Profile avatars        | `docs/brand/assets/app-icons/*-circle.png`     | Navy or cobalt circle, white dot mark                                                                                                                                                              |
| Browser chrome colour  | `viewport.themeColor` and manifest             | `#142438`                                                                                                                                                                                          |

## 10. Never

- Stretch, squash, rotate, skew, outline, emboss or add a shadow, glow, blur or gradient.
- Recolour outside the six colorways, change dot sizes or counts, or redraw the mark.
- Use the orange `#FE8E03` or `#041B46` in product, or any colour outside AC/1.
- Use the dot sphere as a decorative background, pattern or floating shape. The AC/1 contract bans floating abstract spheres; the mark is an identity element, not ornament.
- Put the logo on a busy photograph, a status tint or a copper surface.
- Animate it.
- Use a tagline lockup in product UI (section 8).
- Place the cobalt mark on navy.
- Generate or "improve" a new logo. A change to the identity needs the review in section 11.

## 11. Governance and open gates

AC/1 master contract section 11 says to retain the current mark and that a visual-identity revision needs separate human review, a trademark check and a legal and technical handoff. The owner supplied this logo and instructed its adoption. The gates below are not passed by any agent and must stay recorded as open until a named person closes them.

| Gate                                                                                                                                      | State                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Owner supplied the artwork                                                                                                                | Done                       |
| Human art-direction review: the halftone sphere in the header, footer, rail and favicon (owner decision, 9 Nov 2026, ADR-077 amendment 1) | Done for these places only |
| Human art-direction review of the orb as a standalone mark and of the rest of the logo family                                             | Open                       |
| Trademark check on the name and mark in target markets                                                                                    | Open                       |
| Legal and technical handoff (source files, licences, fonts)                                                                               | Open                       |
| Tagline claims reviewed against positioning and live capability                                                                           | Open                       |
| Accessibility and responsive checks (320 to 1920 px, 200 and 400 percent zoom)                                                            | Per PR                     |

The lettering and dots were traced from the supplied raster image, so a vector master from the original designer, if one exists, should replace them when available.

## 12. Accessibility

The inline logo is `aria-hidden` and the link around it carries the accessible name (the header links already have `aria-label`; the footer link carries a visually hidden "Corridra"). Standalone files used alone need `alt="Corridra"`. In forced-colours mode the logo takes `CanvasText`. The 44 px touch target on `.brand` stays. Test header and footer at 320, 360 and 390 px; if the wordmark crowds a narrow header, hide `.brand-word` at that width and keep the mark and the link name. The signed-in header mark is 42 x 40 px at 340 px and below (measured: 46 px wraps the row at 320 px); everywhere else it is 46 x 44 px.
