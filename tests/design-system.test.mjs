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

// AC/1 Atlantic Cobalt (owner brand lock, 22 October 2026). Index: docs/design-system/README.md.
const packageRoot = new URL('../docs/source/ac1-design-system/', import.meta.url);
const tokens = JSON.parse(
  await readFile(new URL('atlantic-cobalt.tokens.json', packageRoot), 'utf8'),
);

// Resolve unconditional :root custom properties in cascade order (last declaration wins).
const unconditional = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const declared = new Map();
for (const block of unconditional.matchAll(/:root\s*\{([^}]*)\}/g)) {
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declared.set(name, value.trim());
  }
}
const resolve = (name, seen = new Set()) => {
  assert.ok(!seen.has(name), `circular token ${name}`);
  seen.add(name);
  const value = declared.get(name);
  assert.ok(value, `token ${name} is declared`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? resolve(alias[1], seen) : value.toLowerCase();
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(resolve(a)), luminance(resolve(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test('AC/1 package originals are preserved byte for byte', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', packageRoot), 'utf8'));
  const { createHash } = await import('node:crypto');
  assert.equal(Object.keys(manifest.files).length, 22);
  for (const [file, { sha256, size }] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(file, packageRoot));
    assert.equal(bytes.length, size, file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, file);
  }
});

test('the canonical colour layer carries the locked Atlantic Cobalt primitives', () => {
  const primitive = tokens.colors.primitive;
  const expected = {
    '--ac-navy': primitive.navy,
    '--ac-cobalt': primitive.cobalt,
    '--ac-cobalt-hover': primitive.cobaltHover,
    '--ac-cobalt-pressed': primitive.cobaltPressed,
    '--ac-porcelain': primitive.porcelain,
    '--ac-copper': primitive.copper,
    '--ac-ink': primitive.ink,
    '--ac-border': primitive.border,
    '--ac-text-secondary': primitive.textSecondary,
    '--ac-positive': primitive.positive,
    '--ac-warning': primitive.warning,
    '--ac-critical': primitive.critical,
    '--ac-unknown': primitive.unknown,
  };
  for (const [name, token] of Object.entries(expected)) {
    assert.equal(resolve(name), token.$value.toLowerCase(), name);
  }
  assert.equal(resolve('--paper'), primitive.porcelain.$value.toLowerCase());
  assert.equal(resolve('--ink'), primitive.ink.$value.toLowerCase());
  // Every colour primitive is declared exactly once, so there is one source of truth.
  for (const name of Object.keys(expected)) {
    assert.equal(css.split(`${name}:`).length, 2, `${name} declared once`);
  }
});

test('primary actions use cobalt and navy stays chrome, never a CTA fill', () => {
  assert.equal(resolve('--action'), resolve('--ac-cobalt'));
  assert.equal(resolve('--selected'), resolve('--ac-cobalt'));
  assert.equal(resolve('--brand-deep'), resolve('--ac-navy'));
  assert.notEqual(resolve('--action'), resolve('--brand-deep'));
  const rule = system.match(/\.primary-link,\s*\.button\s*\{([^}]*)\}/);
  assert.ok(rule, 'canonical primary action rule exists');
  assert.match(rule[1], /background:\s*var\(--action\)/);
  assert.doesNotMatch(rule[1], /var\(--brand-deep\)/);
  for (const state of ['hover', 'active']) {
    const stateRule = system.match(
      new RegExp(`\\.primary-link:${state},\\s*\\.button:${state}\\s*\\{([^}]*)\\}`),
    );
    assert.ok(stateRule, `${state} rule exists`);
    assert.match(stateRule[1], /background:\s*var\(--action-(?:hover|pressed)\)/);
  }
});

test('copper is ornament only and never sets text colour', async () => {
  const overview = await readFile(
    new URL('../apps/web/app/operator/operator-overview.css', import.meta.url),
    'utf8',
  );
  for (const source of [css, overview]) {
    assert.doesNotMatch(
      source,
      /(?:^|[\s;{])color:\s*var\(--(?:accent-gold|editorial-accent|ac-copper)\)/m,
    );
  }
});

test('AC/1 text and control pairs meet WCAG AA contrast', () => {
  const pairs = [
    ['--on-action', '--action'],
    ['--on-action', '--action-hover'],
    ['--on-action', '--action-pressed'],
    ['--on-brand', '--brand-deep'],
    ['--ink', '--paper'],
    ['--ink', '--surface-1'],
    ['--ink', '--surface-2'],
    ['--text-2', '--paper'],
    ['--text-2', '--surface-1'],
    ['--text-2', '--surface-2'],
    ['--text-3', '--paper'],
    ['--text-3', '--surface-1'],
    ['--brand', '--paper'],
    ['--brand', '--surface-1'],
    ['--brand-deep', '--selected-surface'],
    ['--positive', '--positive-surface'],
    ['--caution', '--caution-surface'],
    ['--critical', '--critical-surface'],
    ['--info', '--info-surface'],
    ['--unknown', '--unknown-surface'],
  ];
  for (const [text, surface] of pairs) {
    assert.ok(
      contrast(text, surface) >= 4.5,
      `${text} on ${surface}: ${contrast(text, surface).toFixed(2)}`,
    );
  }
  // Non-text boundaries: control borders and focus against the page.
  assert.ok(contrast('--focus', '--paper') >= 3, 'focus ring on page');
  assert.ok(contrast('--action', '--paper') >= 3, 'action fill on page');
});

test('every application stylesheet outside the token layer uses tokens only', async () => {
  const { readdir } = await import('node:fs/promises');
  const app = new URL('../apps/web/', import.meta.url);
  const files = (await readdir(app, { recursive: true }))
    .filter((file) => file.endsWith('.css') && !/(?:^|\/)(?:node_modules|\.next)\//.test(file))
    .filter((file) => file !== 'app/globals.css');
  assert.ok(files.includes('app/operator/operator-overview.css'), 'operator stylesheet discovered');
  for (const file of files) {
    const body = strip(await readFile(new URL(file, app), 'utf8'));
    assert.equal(count(body, hex), 0, `raw hex colour in ${file}`);
    assert.equal(count(body, colourFn), 0, `raw colour function in ${file}`);
    assert.equal(rawFonts(body), 0, `raw font-family in ${file}`);
  }
});

test('owner AC/1 geometry decisions hold: rounding B and spacing 64/80', () => {
  // Owner decision 22 October 2026. Controls 8, cards and choices 12, panels 16.
  assert.equal(resolve('--radius-sm'), '0.5rem');
  assert.equal(resolve('--radius-md'), '0.75rem');
  assert.equal(resolve('--radius-lg'), '1rem');
  assert.equal(resolve('--guided-control-radius'), resolve('--radius-sm'));
  assert.equal(resolve('--guided-card-radius'), resolve('--radius-md'));
  assert.equal(resolve('--guided-hero-radius'), resolve('--radius-lg'));
  // The 72 px step is retired for 64 and 80.
  assert.ok(!declared.has('--space-18'), '--space-18 (72 px) is retired');
  assert.equal(resolve('--space-16'), '4rem');
  assert.equal(resolve('--space-20'), '5rem');
  // Capsules are for status badges only, never navigation, tabs or buttons.
  for (const selector of [
    '.guide-tabs a',
    '.guide-route-quick button',
    ".pricing-tabs [role='tab']",
    '.ux-area-bar a',
    '.guide-bn > summary',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const rule of system.matchAll(
      new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'),
    )) {
      assert.doesNotMatch(rule[1], /border-radius:\s*999px/, selector);
    }
  }
});

test('one owned icon family: Meridian line, no stray inline icons, no sparkle', async () => {
  // Owner decision 22 October 2026 (AC/1 icons B). Source: apps/web/components/corridra-icon.tsx.
  const { readdir } = await import('node:fs/promises');
  const app = new URL('../apps/web/', import.meta.url);
  const icon = await readFile(new URL('components/corridra-icon.tsx', app), 'utf8');
  assert.equal(resolve('--icon-stroke'), '1.5px');
  assert.match(icon, /strokeLinecap="square"/);
  assert.match(icon, /viewBox="0 0 20 20"/);
  assert.doesNotMatch(
    icon,
    /^\s+spark:\s*'M/m,
    'no sparkle glyph; AI help is drawn as a draft pen',
  );
  // Icon rules never restyle the family back to round ends; maps and diagrams are not icons.
  for (const rule of system.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/atlas|map|path-/.test(rule[1])) continue;
    assert.doesNotMatch(rule[2], /stroke-linecap:\s*round/, `round icon ends in ${rule[1].trim()}`);
  }
  // Inline <svg> is allowed only for the wordmark, maps, the route diagram and the one icon component.
  const allowed = new Set([
    'components/corridra-icon.tsx',
    'components/site-header.tsx',
    'components/corridor-map.tsx',
    'components/world-route-map.tsx',
    'components/corridor.tsx',
    'app/operator/today.tsx', // decorative empty-state drawing; scheduled for the Signal reference package
  ]);
  const files = (await readdir(app, { recursive: true })).filter(
    (file) => file.endsWith('.tsx') && !/(?:^|\/)(?:node_modules|\.next)\//.test(file),
  );
  for (const file of files) {
    if (allowed.has(file)) continue;
    const source = await readFile(new URL(file, app), 'utf8');
    assert.doesNotMatch(source, /<svg[\s>]/, `${file} draws its own icon; use CorridraIcon`);
  }
});
