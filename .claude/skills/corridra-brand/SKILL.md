---
name: corridra-brand
description: Apply the Corridra logo, orb, favicon, app icons and social images correctly. Use for any task that adds, changes or checks a logo, wordmark, favicon, app icon, Open Graph image, brand colour on a logo, or a logo in an email, PDF, slide or page. Holds procedure only.
---

# Corridra brand

Sources, in order: `docs/brand/CORRIDRA_BRAND_IDENTITY.md` (rules), `docs/brand/brand-identity.tokens.json` (asset registry), `docs/brand/LOGO_IMPLEMENTATION_RUNBOOK.md` (steps), ADR-077 (decision and open gates). AC/1 in `docs/design-system/README.md` stays the authority for colour, type, spacing and radius.

## Stop conditions

- The request is to design, redraw, restyle or "improve" a logo or mark. Do not. Report that the identity needs the human review in AC/1 master contract section 11 and ADR-077.
- The request is to use the tagline in product UI, to use the sphere as decoration, or to use the old orange or `#041B46`. Decline and give the reason from the identity doc.
- Never mark an open gate in the identity doc or ADR as passed.

## Choose the asset

Use the table in section 2 of the identity doc. Short form: under 48 px the `orb`; product chrome `lockup-compact`; wide `lockup-horizontal`; narrow or centred `lockup-stacked`; 64 px and up square `mark`; app icon the dot mark on a navy tile. Colorway: `cobalt` on light, `reversed` on navy, `mono-white` on cobalt or photos, `mono-navy` or `mono-black` for one-colour print. Cobalt on navy fails contrast.

## Place it

1. In product code, draw the logo only through `BrandLockup`, `BrandMark` or `BrandWordmark` in `apps/web/components/site-header.tsx`. Colour only by the `.brand-mark` and `.brand-word` CSS classes with tokens. Do not add another inline `<svg>` or a hex colour in a component.
2. For any other page use `next/image` with `unoptimized` and a file from `apps/web/public/brand/`. Decorative next to a visible name: `alt=""`. Standing alone: `alt="Corridra"`.
3. Emails, PDFs and slides: use the PNG or PDF files from `docs/brand/assets`, never a screenshot, never a re-typed wordmark.
4. Keep the 44 px target on `.brand`, the link's accessible name, and the clear space `X` from the identity doc.

## Change or add an output

Follow the runbook phases: discover with `rg` and `rg --files`, apply, verify, record. New CSS goes at the end of `globals.css`, tokens only. Run prettier on changed files. Add new files to the registry JSON.

## Verify before saying done

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` from the repository root as the runbook says, plus the route and head checks. Quote the output. State which gates remain open. Draft PR only; no merge without the owner's command.
