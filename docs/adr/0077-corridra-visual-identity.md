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

| Gate                                                      | Owner of the gate        |
| --------------------------------------------------------- | ------------------------ |
| Human art-direction review of the logo family and the orb | Owner to name a reviewer |
| Trademark check for the name and mark in target markets   | Owner and counsel        |
| Legal and technical handoff, including a vector master    | Owner and designer       |
| Tagline claims against live capability (Transact)         | Owner                    |

## Consequences

- Additive files: `docs/brand/*`, `apps/web/public/brand/*`, icon and social files in `apps/web/app`, `components/brand-paths.ts`, `app/manifest.ts`, one test file.
- Edits: `site-header.tsx`, `shell-header.tsx`, `app-header.tsx`, `site-footer-view.tsx`, `globals.css` (appended after the design-system marker), `layout.tsx` (viewport theme colour, Twitter card size), `package.json` (test list).
- The wordmark is wider than the old text, so narrow headers need the responsive checks in the runbook.
- No data, authentication, RLS, migration, money or event change. Rollback is reverting the PR.
- The lettering and dots were traced from a raster image. A vector master should replace them when one exists.

## Required evidence

Format, lint, typecheck, test (including `tests/brand-identity.test.mjs`), build and e2e output; route checks for the icon, manifest and image files; head tags on a production build; screenshots at the widths listed in the runbook; forced-colours check.
