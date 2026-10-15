import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Keeps the interface one product. Contract: docs/agents/ui-direction.md.
// Rule 1: CSS written after the design system marker may use tokens only.
// Rule 2: legacy CSS written before it may not grow. Lower the baseline when you remove debt.
const css = await readFile(new URL('../apps/web/app/globals.css', import.meta.url), 'utf8');
const baseline = JSON.parse(
  await readFile(new URL('./design-system-baseline.json', import.meta.url), 'utf8'),
);
const marker = 'Design system layer (Phase 1)';
const at = css.indexOf(marker);
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[^}]*\}/g, '');
const legacy = strip(css.slice(0, at));
const system = strip(css.slice(at + marker.length));
const hex = /#[0-9a-fA-F]{3,8}\b/g;
const colourFn = /\b(?:rgb|rgba|hsl|hsla)\(/g;
const allowedFont = /^(?:var\(--(?:font-ui|sans|serif)\)|inherit)$/;
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const rawFonts = (text) =>
  [...text.matchAll(/font-family\s*:\s*([^;}]+)/g)].filter((m) => !allowedFont.test(m[1].trim()))
    .length;

test('the design system marker exists exactly once', () => {
  assert.ok(at > 0);
  assert.equal(css.split(marker).length, 2);
});

test('new CSS uses design tokens, never raw colours or fonts', () => {
  assert.equal(count(system, hex), 0, 'raw hex colour after the design system marker');
  assert.equal(count(system, colourFn), 0, 'raw colour function after the design system marker');
  assert.equal(rawFonts(system), 0, 'raw font-family after the design system marker');
});

test('legacy CSS debt does not grow', () => {
  assert.ok(count(legacy, hex) <= baseline.legacyHex, 'more raw hex colours than the baseline');
  assert.ok(
    count(legacy, colourFn) <= baseline.legacyColourFunctions,
    'more raw colour functions than the baseline',
  );
  assert.ok(
    rawFonts(legacy) <= baseline.legacyFontFamilies,
    'more raw font-family values than the baseline',
  );
});

test('the root layout loads the single self-hosted interface font', async () => {
  const layout = await readFile(new URL('../apps/web/app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /next\/font\/local/);
  assert.doesNotMatch(layout, /next\/font\/google/);
});
