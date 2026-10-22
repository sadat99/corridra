# Corridra AC/1 — Legacy token crosswalk and impact map

**Status:** implementation guidance only; repo unchanged. Resolve actual CSS cascade at implementation time. **Baseline:** latest source inspected at `main` commit `bc044991210d66175d62eb71ea98e381a8724af6` (22 October 2026 snapshot); recalculate before edits.

## Why "change --brand to cobalt" is NOT a safe implementation plan

The existing `apps/web/app/globals.css` contains historical roots plus later design-system / guided / operator overrides. Selectors such as `.primary-link` currently use `var(--brand-deep)` for fill; changing `--brand-deep` to navy would unintentionally turn every primary CTA navy when AC/1 requires cobalt interactive actions. Another class may use `--accent` as editorial colour and a control colour. We must migrate by **semantic role**, not string replacement.

| Existing var or CSS usage | Intended AC/1 role | Desired expression | Action |
|---|---|---|---|
| `--paper`, `--surface-0` | Page canvas | Porcelain `#F6F8FB` | Audit both roots and derived light/dark applications |
| `--ink`, `--text-1` | Primary copy | Ink `#18283C` | Audit legibility at dense text sizes |
| `--muted`, `--text-2` | Secondary copy | `#4B5A6C` | Re-run body contrast at actual backgrounds |
| `--brand-deep` | Navy chrome and strong headings | `#142438` | **Decouple from CTAs and success states** |
| `--brand` | Interactive brand tone | `#2856C5` | Use only for appropriate interaction/selected states |
| `--brand-hover` | Interactive hover | `#234EB0` | Ensure pressed `#1E4295` separate |
| `--on-brand` | On cobalt/navy | `#FFFFFF` | Actual contrast checks per state |
| `--action` | Primary CTA fill | Cobalt `#2856C5` | Update central CTA primitive to `--action` |
| `--accent` | Historically generic accent | Cobalt or deprecated alias, per usage | Audit every use; do not map editorial copper through action |
| `--accent-gold` | Legacy decorative highlight | Copper `#BF7548` | New alias suggested `--editorial-accent`; never warning or small normal text |
| `--line` | Borders/dividers | `#D8E0EA` | Structure, not decoration |
| `--surface-1` | Raised readable surface | White | Not a mandate to wrap everything in cards |
| `--surface-2` | Quiet backdrop | `#EFF3F8` | Not alternative brand colour |
| `--ring`, `--focus` | Keyboard focus | Visible cobalt + halo | Meets focus appearance + contrast |
| `.primary-link`, `.button` | Canonical primary action | Cobalt, 8px radius, 44/52/60 heights | Central behavioural test; no local overrides |
| `.button-secondary`, `.secondary-link` | Secondary | White, border, navy | Same geometry across pages |
| `.text-link` | Quiet contextual action | Unboxed unless standalone primary affordance requires clear hit area | Earlier blanket text-link box conversion requires local task review |
| `.guide-tabs` | Customer nav | Keep locked destinations; cobalt selected and proper focus | Mobile tab bar with safe area |
| `.guide-next` | Guided next step | Navy contrast band, one clear light CTA | Keep locked first-on-home rule |
| `.ux-tool-index`, `.ux-role-navigation` | Tool directory/nav rows | Divider-led, icon optional, no card grid-by-default | Preserve 18 protected destinations |
| `.operator-form`, `.field` | Forms | Correct labels, errors, statuses | Preserve actual form logic, validation and unsaved entry behaviour |
| `.ux-status`, `.ux-state` | Status/empty/denial | Semantic not brand mapping | No new verification claims |

## Canonical semantic aliases (approved proposal)

```css
/* Add or reconcile in ONE authoritative token layer; do not append another late cascade block. */
:root {
  --ac-navy: #142438;
  --ac-cobalt: #2856C5;
  --ac-cobalt-hover: #234EB0;
  --ac-cobalt-pressed: #1E4295;
  --ac-porcelain: #F6F8FB;
  --ac-copper: #BF7548;
  --ac-ink: #18283C;
  --ac-paper: #FFFFFF;
  --ac-surface-muted: #EFF3F8;
  --ac-line: #D8E0EA;
  --ac-text-secondary: #4B5A6C;
  --ac-focus: #2856C5;
  --page-bg: var(--ac-porcelain);
  --page-fg: var(--ac-ink);
  --nav-bg: var(--ac-navy);
  --primary-action: var(--ac-cobalt);
  --primary-hover: var(--ac-cobalt-hover);
  --primary-pressed: var(--ac-cobalt-pressed);
  --surface-default: var(--ac-paper);
  --surface-muted: var(--ac-surface-muted);
  --border-default: var(--ac-line);
  --editorial-accent: var(--ac-copper);
  --focus-ring: var(--ac-focus);
}
```

**Implementation warning:** These aliases are a mapping *proposal* to reconcile, not instructions to insert duplicates. Inspect actual `:root`, `@layer`, variants, `.primary-link`, `.text-link`, `.guide-tabs`, guided token usage and server side class conditions; update canonical source without conflicting definitions.

## Expected source touchpoints (inspect, don't blindly edit)

`apps/web/app/globals.css`, `apps/web/components/public-shell.tsx`, `workspace-shell.tsx`, `customer-shell.tsx`, `customer-nav.tsx`, `next-step-card.tsx`, `role-navigation.tsx`, `workspace-area-bar.tsx`, `operator-icon.tsx`, `access-state.tsx`, `operator-workbench.tsx`; `apps/web/app/operator/workspace.tsx`, and the affected route-level components and tests.

Approved future code location suggested: `docs/design-system/AC1-MASTER.md`, `docs/design-system/atlantic-cobalt.tokens.json`, `docs/design-system/AC1-SCREEN-REFERENCE.html`; link them from *existing* `docs/agents/ui-direction.md` and existing start guide; no independent agent status ledger.

## Compulsory migration checks

1. Enumerate selectors and variables with `rg -n` across repo before editing; capture current computed styles via browser for 5 distinct shells.
2. Merge tokens and one primary-control family first. Test button contrast, hover, focus, pressed, disabled, long labels, locale text.
3. Compare screenshots for public, customer, operator, source comparison, delegation on 320/390/768/1440.
4. Confirm ALL original nav destinations, role filters, stable links, hashes, drafts and in-panel state remain intact.
5. Confirm no new unapproved raw colours or duplicate component variants, and all migrated usages point to exactly one source of truth.
6. Report any unsupported legacy CSS selector instead of deleting it. Keep historic test evidence intact.
