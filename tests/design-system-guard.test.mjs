import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

// Binding guard for new UI code. Contract: docs/agents/ui-direction.md ("How to build a new screen").
// tests/design-system.test.mjs already covers the stylesheet colour layer, fonts, the icon family and the
// AC/1 palette. This file covers what it does not: TypeScript colours, text-transform on actions,
// inline spacing and type size, signed-in pages outside the shared shell, the type scale (weights, raw
// font sizes, radius set) and the docs that bind builders.
// Existing debt is frozen in tests/design-system-guard-baseline.json. Lower it when you remove debt;
// never raise it. A new file with a violation is not in the baseline, so it fails.

const root = new URL('..', import.meta.url).pathname;
const web = join(root, 'apps/web');
const read = (path) => readFileSync(path, 'utf8');
const baseline = JSON.parse(read(join(root, 'tests/design-system-guard-baseline.json')));

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

const rel = (path) => relative(root, path);
const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
const sources = walk(web, (p) => /\.(tsx?)$/.test(p) && !isTest(p) && !p.endsWith('.d.ts'));
const styles = walk(web, (p) => p.endsWith('.css'));

// Rule 1: no raw colour in TypeScript. Tokens live in CSS custom properties; the web manifest and
// viewport metadata are the only places a browser needs a literal value, and they carry AC/1 primitives.
// `lib/ux/web-manifest.ts` holds what the manifest says, as plain data, so a test can read it without the
// framework's types; it is the manifest and is allowed the same two literals, which a test pins to AC/1.
const colourLiteral =
  /(['"`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/g;
const RAW_COLOUR_ALLOWED = new Set([
  'apps/web/app/manifest.ts',
  'apps/web/app/layout.tsx',
  'apps/web/lib/ux/web-manifest.ts',
]);

export function rawColours(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return code.match(colourLiteral) ?? [];
}

// Rule 2: no CSS text-transform on actions (Title Case is written in the text, never styled in).
const ACTION =
  /(^|[\s,>+~])(?:button|a)\b|\[role=["']?(?:button|menuitem|tab)["']?\]|-(?:btn|button|cta|action|link)\b|\.(?:primary|secondary|text)-link\b|\.button\b/;

export function actionTransforms(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of clean.matchAll(re)) {
    const body = m[2];
    const t = /text-transform\s*:\s*([^;}\s]+)/.exec(body);
    if (!t || t[1] === 'none' || t[1] === 'inherit') continue;
    for (const selector of m[1].split(',')) {
      const s = selector.trim().replace(/^@[^{]*$/, '');
      if (s && ACTION.test(` ${s}`)) found.push(`${s} { text-transform: ${t[1]} }`);
    }
  }
  return found;
}

// Rule 3: no inline font size and no inline px spacing in style props. Use a token class instead.
export function inlineStyleDebt(text) {
  const hits = [];
  for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    const body = m[1];
    if (/\bfontSize\b/.test(body)) hits.push('font-size');
    for (const px of body.matchAll(/\b(?:padding|margin|gap)\w*\s*:\s*(['"`])[^'"`]*\d+px/g)) {
      hits.push(`spacing ${px[0]}`);
    }
    for (const n of body.matchAll(/\b(?:padding|margin|gap)\w*\s*:\s*[1-9]\d*\s*(?:,|$)/g)) {
      hits.push(`spacing ${n[0]}`);
    }
  }
  return hits;
}

// Rule 4: every signed-in customer page is rendered inside a shared shell. A page counts when the page,
// a local module it imports, or a layout in any folder above it names one.
const SHELL = /\b(?:CustomerShell|WorkspaceShell|OperatorShell|ContributorShell|PublicShell)\b/;
const signedInPages = walk(join(web, 'app/account'), (p) => /\/page\.tsx$/.test(p));

export function usesShell(pagePath, readFile = read, exists = existsSync) {
  // A page counts when it, or a local module it imports (two hops, relative imports only), names a shell.
  // A parent page.tsx never vouches for a child route unless the child actually imports it.
  const seen = new Set();
  const resolve = (from, spec) => {
    const base = join(dirname(from), spec);
    return [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].find(
      (c) => exists(c),
    );
  };
  const visit = (file, depth) => {
    if (seen.has(file)) return false;
    seen.add(file);
    const text = readFile(file);
    if (SHELL.test(text)) return true;
    if (depth === 0) return false;
    for (const m of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(file, m[1]);
      if (target && target.startsWith(join(web, 'app')) && visit(target, depth - 1)) return true;
    }
    return false;
  };
  if (visit(pagePath, 2)) return true;
  // A layout in the page's own folder or any folder above it wraps child routes.
  let dir = dirname(pagePath);
  while (dir.startsWith(web) && dir !== web) {
    const layout = join(dir, 'layout.tsx');
    if (exists(layout) && SHELL.test(readFile(layout))) return true;
    dir = dirname(dir);
  }
  return false;
}

const counts = (items, key) => {
  const map = {};
  for (const item of items) map[key(item)] = (map[key(item)] ?? 0) + 1;
  return map;
};

// The baseline is an exact list: a new violation fails, and so does an entry that no longer violates
// (or violates less), so the list can only shrink. Lower or delete the entry when you remove debt.
export function baselineDrift(found, allowed) {
  const out = [];
  for (const [file, n] of Object.entries(found)) {
    if (n > (allowed[file] ?? 0))
      out.push(`new violation ${file}: ${n} found, ${allowed[file] ?? 0} allowed`);
  }
  for (const [file, n] of Object.entries(allowed)) {
    if ((found[file] ?? 0) < n)
      out.push(`stale entry ${file}: ${found[file] ?? 0} found, ${n} listed`);
  }
  return out;
}

function exceeds(found, allowed, label) {
  const drift = baselineDrift(found, allowed);
  assert.deepEqual(drift, [], `${label} (see docs/agents/ui-direction.md): ${drift.join('; ')}`);
}

test('TypeScript uses no raw colour outside the web manifest and viewport', () => {
  const found = {};
  for (const file of sources) {
    if (RAW_COLOUR_ALLOWED.has(rel(file))) continue;
    const n = rawColours(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.rawColourInTypeScript, 'raw colour in TypeScript');
});

test('no CSS text-transform on actions', () => {
  const found = {};
  for (const file of styles) {
    const n = actionTransforms(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.textTransformOnActions, 'text-transform on an action');
});

test('no new inline font size or px spacing', () => {
  const found = {};
  for (const file of sources) {
    const n = inlineStyleDebt(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.inlineStyle, 'inline font size or px spacing');
});

test('every signed-in account page renders inside a shared shell', () => {
  const missing = signedInPages.filter((p) => !usesShell(p)).map(rel);
  const listed = baseline.signedInPagesOutsideShell;
  const fresh = missing.filter((p) => !listed.includes(p));
  const stale = listed.filter((p) => !missing.includes(p));
  assert.deepEqual(fresh, [], `page outside the shared shell: ${fresh.join(', ')}`);
  assert.deepEqual(stale, [], `stale shell baseline entry, remove it: ${stale.join(', ')}`);
});

test('the baseline only lists files that still exist and still have debt', () => {
  for (const section of [
    'rawColourInTypeScript',
    'textTransformOnActions',
    'inlineStyle',
    'fontWeightOffScale',
    'rawFontSize',
    'radiusOffScale',
  ]) {
    for (const file of Object.keys(baseline[section])) {
      assert.ok(existsSync(join(root, file)), `${section} lists a missing file: ${file}`);
    }
  }
  for (const file of baseline.signedInPagesOutsideShell) {
    assert.ok(existsSync(join(root, file)), `shell baseline lists a missing file: ${file}`);
  }
});

// Each rule must fail on a planted violation, or the guard proves nothing.
test('the baseline fails on a new violation and on a stale entry', () => {
  assert.equal(baselineDrift({ 'a.tsx': 1 }, {}).length, 1);
  assert.equal(baselineDrift({}, { 'a.tsx': 1 }).length, 1);
  assert.equal(baselineDrift({ 'a.tsx': 1 }, { 'a.tsx': 2 }).length, 1);
  assert.equal(baselineDrift({ 'a.tsx': 2 }, { 'a.tsx': 2 }).length, 0);
});

test('rule 1 flags a planted raw colour and passes a token', () => {
  assert.equal(rawColours("const c = '#ff0000';").length, 1);
  assert.equal(rawColours("el.style.color = 'rgb(1, 2, 3)';").length, 1);
  assert.equal(rawColours("const c = 'var(--action)'; // #fff in a comment").length, 0);
});

test('rule 2 flags a planted uppercase button and passes a label', () => {
  assert.equal(actionTransforms('.save-button { text-transform: uppercase; }').length, 1);
  assert.equal(actionTransforms('a.card-link, .x { text-transform: capitalize; }').length, 1);
  assert.equal(actionTransforms('button { text-transform: none; }').length, 0);
  assert.equal(actionTransforms('.eyebrow { text-transform: uppercase; }').length, 0);
});

test('rule 3 flags planted inline type size and px spacing and passes a token style', () => {
  assert.equal(inlineStyleDebt('<p style={{ fontSize: 18 }}>x</p>').length, 1);
  assert.equal(inlineStyleDebt("<p style={{ margin: '8px 0' }}>x</p>").length, 1);
  assert.equal(inlineStyleDebt('<p style={{ padding: 12 }}>x</p>').length, 1);
  assert.equal(inlineStyleDebt("<p style={{ marginBlock: '1rem' }}>x</p>").length, 0);
  assert.equal(inlineStyleDebt("<p style={{ display: 'flex' }}>x</p>").length, 0);
});

// Rule 5: the UI/UX.v3 type scale (consistency pass, owner "full approved", 13 November 2026). Weights are
// 400, 500 and 600 only. A font size is a token (`--text-*`), never a raw px or rem value. A corner radius
// is a token or one of 8, 12 and 16 px; `999px` is the capsule for status badges, `50%` a dot, and 1 to 3 px
// is a hairline for a bar track or a scrollbar thumb. Custom property definitions in the token layer are
// where raw values live, so only real declarations are checked.
const WEIGHTS_ALLOWED = new Set(['400', '500', '600']);
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = (css, property) => {
  const found = [];
  const re = new RegExp(`(?:^|[;{\\s])(${property})\\s*:\\s*([^;}]+)`, 'g');
  for (const m of stripCss(css).matchAll(re)) found.push(m[2].trim());
  return found;
};

export function offScaleWeights(css) {
  const found = [];
  for (const value of declarations(css, 'font-weight')) {
    if (/^(?:inherit|initial|unset|normal|var\(.*\))$/i.test(value)) continue;
    if (!WEIGHTS_ALLOWED.has(value)) found.push(`font-weight: ${value}`);
  }
  // The font shorthand starts with an optional weight: `font: 650 var(--text-base) var(--font-ui)`.
  for (const value of declarations(css, 'font')) {
    const w = /^(?:italic\s+)?(\d{3}|bold|bolder|lighter)\b/.exec(value);
    if (w && !WEIGHTS_ALLOWED.has(w[1])) found.push(`font: ${value}`);
  }
  return found;
}

export function rawFontSizes(css) {
  const found = [];
  for (const value of declarations(css, 'font-size')) {
    if (/\d(?:px|rem|pt|ch|vw|vh)\b|^[1-9]\d*$|^0?\.\d+$/.test(value))
      found.push(`font-size: ${value}`);
  }
  for (const value of declarations(css, 'font')) {
    if (/(?:^|\s)\d*\.?\d+(?:px|rem|pt)\b/.test(value)) found.push(`font: ${value}`);
  }
  return found;
}

const RADIUS_PROPERTY = '(?:border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius)';
export function offScaleRadius(css) {
  const found = [];
  for (const value of declarations(css, RADIUS_PROPERTY)) {
    // A token, or a token with an offset, is fine; any literal next to it is still checked.
    const literals = value
      .replace(/calc\(\s*var\([^)]*\)[^)]*\)/g, ' ')
      .replace(/var\([^)]*\)/g, ' ');
    for (const part of literals.split(/[\s/]+/).filter(Boolean)) {
      if (/^(?:0|inherit|initial|unset|50%|999px|99px|9999px)$/.test(part)) continue;
      const px = /^(\d*\.?\d+)px$/.exec(part);
      const rem = /^(\d*\.?\d+)rem$/.exec(part);
      const size = px ? Number(px[1]) : rem ? Number(rem[1]) * 16 : NaN;
      if ([1, 2, 3, 8, 12, 16].includes(size)) continue;
      found.push(`border-radius: ${value}`);
      break;
    }
  }
  return found;
}

test('font weights are 400, 500 and 600 only', () => {
  const found = {};
  for (const file of styles) {
    const n = offScaleWeights(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.fontWeightOffScale, 'font weight outside 400, 500 and 600');
});

test('font sizes are tokens, never a raw px or rem value', () => {
  const found = {};
  for (const file of styles) {
    const n = rawFontSizes(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.rawFontSize, 'raw font size');
});

test('corner radius is a token, 8, 12 or 16 px, a capsule, a dot or a hairline', () => {
  const found = {};
  for (const file of styles) {
    const n = offScaleRadius(read(file)).length;
    if (n) found[rel(file)] = n;
  }
  exceeds(found, baseline.radiusOffScale, 'radius outside the set');
});

test('the type scale tokens match UI/UX.v3', () => {
  const css = stripCss(read(join(web, 'app/globals.css')));
  const token = (name) => {
    const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
    return all;
  };
  // Steps: label 12, secondary 14, body 16, card or row title 18, figure 24 (px = rem x 16).
  assert.equal(token('--text-xs')[0], '0.75rem');
  assert.equal(token('--text-sm')[0], '0.875rem');
  assert.equal(token('--text-base')[0], '1rem');
  assert.equal(
    token('--text-xl')[0],
    'var(--text-lg)',
    'the retired 20 px step lands on the card title size',
  );
  assert.equal(token('--text-2xl')[0], '1.5rem');
  // Page title 40 on desktop and 29 on a phone; section title 24 and 22; home display 56 and 30 on a phone.
  assert.match(token('--text-h1')[0], /^clamp\(1\.8125rem,.*\b2\.5rem\)$/);
  assert.match(token('--text-h2')[0], /^clamp\(1\.375rem,.*\b1\.5rem\)$/);
  assert.match(token('--text-display')[0], /\b3\.5rem\)$/);
  assert.equal(
    token('--text-h1').at(-1),
    'clamp(1.625rem, 7.4vw, 1.8125rem)',
    'the phone page title is 29 px from 390 px wide and eases to 26 px below',
  );
  // Weights and leading are tokens too.
  assert.equal(token('--weight-regular')[0], '400');
  assert.equal(token('--weight-medium')[0], '500');
  assert.equal(token('--weight-semibold')[0], '600');
  assert.equal(token('--leading-heading')[0], '1.15');
  assert.equal(token('--leading-title')[0], '1.3');
  assert.equal(token('--leading-reading')[0], '1.6');
  // Rounding B.
  assert.equal(token('--radius-sm')[0], '0.5rem');
  assert.equal(token('--radius-md')[0], '0.75rem');
  assert.equal(token('--radius-lg')[0], '1rem');
});

test('rule 5 flags a planted off-scale weight, raw size and off-set radius, and passes the tokens', () => {
  assert.equal(offScaleWeights('.a { font-weight: 650; }').length, 1);
  assert.equal(offScaleWeights('.a { font-weight: 700; }').length, 1);
  assert.equal(offScaleWeights('.a { font-weight: 550; }').length, 1);
  assert.equal(offScaleWeights('.a { font-weight: bold; }').length, 1);
  assert.equal(offScaleWeights('.a { font: 700 var(--text-xl)/1.25 var(--font-ui); }').length, 1);
  assert.equal(
    offScaleWeights('.a { font-weight: 400; } .b { font-weight: 500; } .c { font-weight: 600; }')
      .length,
    0,
  );
  assert.equal(offScaleWeights('.a { font: 600 var(--text-sm)/1.3 var(--font-ui); }').length, 0);
  assert.equal(offScaleWeights('.a { font-weight: inherit; } /* font-weight: 700 */').length, 0);
  assert.equal(rawFontSizes('.a { font-size: 15px; }').length, 1);
  assert.equal(rawFontSizes('.a { font-size: 0.9375rem; }').length, 1);
  assert.equal(
    rawFontSizes('.a { font-size: clamp(1.875rem, 1.2rem + 1.5vw, 2.5rem); }').length,
    1,
  );
  assert.equal(rawFontSizes('.a { font: 600 14px/1.3 var(--font-ui); }').length, 1);
  assert.equal(
    rawFontSizes(
      '.a { font-size: var(--text-sm); } .b { font-size: 0.92em; } .c { font-size: 112.5%; }',
    ).length,
    0,
  );
  assert.equal(rawFontSizes(':root { --text-sm: 0.875rem; } .a { font-size: 0; }').length, 0);
  assert.equal(offScaleRadius('.a { border-radius: 4px; }').length, 1);
  assert.equal(offScaleRadius('.a { border-radius: 10px; }').length, 1);
  assert.equal(offScaleRadius('.a { border-radius: 0.5625rem; }').length, 1);
  assert.equal(offScaleRadius('.a { border-radius: 8px 8px 0 4px; }').length, 1);
  assert.equal(offScaleRadius('.a { border-radius: var(--radius-sm); }').length, 0);
  assert.equal(offScaleRadius('.a { border-radius: 12px; } .b { border-radius: 1rem; }').length, 0);
  assert.equal(
    offScaleRadius(
      '.a { border-radius: 999px; } .b { border-radius: 50%; } .c { border-radius: 2px; }',
    ).length,
    0,
  );
  assert.equal(offScaleRadius('.a { border-radius: calc(var(--radius-sm) - 2px); }').length, 0);
  assert.equal(
    offScaleRadius('.a { border-radius: 4px 4px var(--radius-md) var(--radius-md); }').length,
    1,
  );
});

test('rule 4 does not let an ancestor page vouch for a child route', () => {
  const parent = join(web, 'app/account/planted/page.tsx');
  const child = join(web, 'app/account/planted/child/page.tsx');
  const files = {
    [parent]: 'import { CustomerShell } from "x"; export default () => <CustomerShell />;',
    [child]: 'export default function C(){ return <main>hi</main>; }',
  };
  const fakeRead = (p) => files[p] ?? '';
  const fakeExists = (p) => p in files;
  assert.equal(usesShell(child, fakeRead, fakeExists), false);
  // A layout in the ancestor folder does wrap it.
  const layout = join(dirname(parent), 'layout.tsx');
  files[layout] = 'import { CustomerShell } from "x"; export default CustomerShell;';
  assert.equal(usesShell(child, fakeRead, fakeExists), true);
});

test('rule 4 follows a relative import to a shell helper, and flags a page with none', () => {
  const page = join(web, 'app/account/planted/page.tsx');
  const helper = join(web, 'app/account/planted/frame.tsx');
  const files = {
    [page]: 'import { Frame } from "./frame"; export default () => <Frame />;',
    [helper]: 'export function Frame(){ return <main>no shell</main>; }',
  };
  const fakeRead = (p) => files[p] ?? '';
  const fakeExists = (p) => p in files;
  assert.equal(usesShell(page, fakeRead, fakeExists), false);
  files[helper] = 'import { WorkspaceShell } from "x"; export const Frame = WorkspaceShell;';
  assert.equal(usesShell(page, fakeRead, fakeExists), true);
  files[page] = 'export default function P(){ return <main>hi</main>; }';
  files[helper] = 'export const Frame = 1;';
  assert.equal(usesShell(page, fakeRead, fakeExists), false);
});

// The contract binds every builder only if every place a builder starts points at it.
test('every builder entry point binds the design contract', () => {
  const need = (path, pattern, why) =>
    assert.match(read(join(root, path)), pattern, `${path}: ${why}`);
  const contract = read(join(root, 'docs/agents/ui-direction.md'));
  assert.match(contract, /## How to build a new screen/);
  assert.match(contract, /## Definition of done for any visible change/);
  assert.match(contract, /## Current locked decisions/);
  for (const path of [
    'AGENTS.md',
    'apps/web/AGENTS.md',
    'CLAUDE.md',
    'docs/START_HERE.md',
    '.claude/agents/corridra-designer.md',
    '.claude/agents/corridra-builder.md',
    '.claude/agents/corridra-reviewer.md',
    '.claude/skills/corridra-squad/SKILL.md',
    '.github/pull_request_template.md',
  ]) {
    need(path, /ui-direction\.md/, 'must link docs/agents/ui-direction.md');
  }
  need('.github/pull_request_template.md', /Definition of done/i, 'needs the design checklist');
  need(
    'AGENTS.md',
    /Owner instruction, 2 November 2026: \*\*“Keep it lean/,
    'Codex lean exception must stay',
  );
});

// The owner named the design contract UI/UX.v3 on 13 November 2026. Every entry point must say so,
// so no agent can follow an older look by name. (Fails on a main that predates the naming.)
test('every entry point names UI/UX.v3 and the contract lists its legacy', () => {
  const entryPoints = [
    'AGENTS.md',
    'apps/web/AGENTS.md',
    'CLAUDE.md',
    'docs/START_HERE.md',
    'docs/design-system/README.md',
    'docs/revamp/README.md',
    'docs/PLAN_STATUS.md',
    'docs/agents/ui-direction.md',
    '.claude/agents/corridra-designer.md',
    '.claude/agents/corridra-builder.md',
    '.claude/agents/corridra-reviewer.md',
    '.claude/skills/corridra-squad/SKILL.md',
    '.github/pull_request_template.md',
    'docs/documentation-map.json',
  ];
  for (const path of entryPoints) {
    assert.match(read(join(root, path)), /UI\/UX\.v3/, `${path} must name UI/UX.v3`);
  }
  const contract = read(join(root, 'docs/agents/ui-direction.md'));
  assert.match(contract, /^# UI\/UX\.v3/m, 'the contract title must be UI/UX.v3');
  assert.match(contract, /## UI\/UX\.v3 version block/);
  assert.match(
    contract,
    /binding until the owner launches UI\/UX\.v4|until the owner launches UI\/UX\.v4/,
  );
  assert.match(contract, /13 November 2026, verbatim: "lets name the the latest ui style/);
  assert.match(contract, /## Legacy \(not to be followed for new work\)/);
  for (const legacy of ['Pre-AC/1', 'UX10X', 'A Ledger']) {
    assert.ok(contract.includes(legacy), `the Legacy section must name ${legacy}`);
  }
});

test('the owner operating rules are recorded, linked from AGENTS.md and session rotation', () => {
  const agents = read(join(root, 'AGENTS.md'));
  assert.match(agents, /docs\/agents\/operating-rules\.md/, 'AGENTS.md must link the rules');
  assert.ok(agents.includes('At most 4 builder sessions at once'));
  assert.ok(agents.includes("Never merge before the Guardian's PASS"));
  const rules = read(join(root, 'docs/agents/operating-rules.md'));
  assert.match(rules, /# Parallel work operating rules \(owner, 13 November 2026\)/);
  for (const phrase of ['At most 4 builder sessions at once', '250k tokens', '$30', '$60']) {
    assert.ok(rules.includes(phrase), `operating-rules.md must keep "${phrase}"`);
  }
  assert.match(
    read(join(root, 'docs/agents/session-rotation.md')),
    /operating-rules\.md/,
    'session rotation must point at the rules',
  );
});

// UI/UX.v3 audit, screens batch A (owner, 13 November 2026, "full approved"): Home, Requests and All Tools use the page
// frame, and the All Tools finder is built from native controls (a labelled search box, a radio group and links), so
// the keyboard and screen readers work and the list stays reachable without a script.
test('Home, Requests and All Tools use the shared page frame, and the finder is native and works without a script', () => {
  const account = read(join(web, 'app/account/page.tsx'));
  assert.match(
    account,
    /frame=\{[\s\S]*?homeHelper[\s\S]*?requestsHelper/,
    'Home and Requests pass a frame',
  );
  const allTools = read(join(web, 'app/account/all-tools/page.tsx'));
  assert.match(allTools, /frame=\{\{ helper: allToolsHelper \}\}/, 'All Tools passes a frame');
  assert.ok(
    allTools.includes('searchParams'),
    'All Tools reads ?q and ?group for the no-script path',
  );
  const finder = read(join(web, 'app/account/all-tools/all-tools-finder.tsx'));
  assert.match(finder, /role="search"/);
  assert.match(finder, /method="get"/);
  assert.match(finder, /action="\/account\/all-tools"/);
  assert.match(finder, /type="search"/);
  assert.match(finder, /<label htmlFor=\{searchId\}/, 'the search box has a label');
  assert.match(finder, /<SegmentedFilter/, 'the group chips are the shared radio group');
  assert.ok(!/<div[^>]*onClick/.test(finder), 'no clickable div in the finder');
  assert.ok(!/[–—]/.test(finder), 'no dash in the finder words');
});

// Rule 6 (UI/UX.v3, audit unit A3b): the company profile form is drawn in steps of one to three controls wherever a
// page mounts it. The steps are presentation only; the form, its ids and its payload are the same either way.
export function unsteppedProfiles(source) {
  return [...source.matchAll(/<OrganisationProfile\b[^>]*>/g)].filter(
    (m) => !/\bsteps\b/.test(m[0]),
  ).length;
}

test('every page that mounts the company profile form shows it in steps', () => {
  const pages = walk(
    join(web, 'app'),
    (path) => path.endsWith('.tsx') && !isTest(path) && read(path).includes('<OrganisationProfile'),
  );
  assert.ok(pages.length > 0, 'no page mounts the company profile form');
  const loose = pages.filter((path) => unsteppedProfiles(read(path)) > 0).map(rel);
  assert.deepEqual(loose, [], `company profile form without steps: ${loose.join(', ')}`);
});

test('rule 6 flags a planted profile form without steps and passes one with steps', () => {
  assert.equal(
    unsteppedProfiles('<OrganisationProfile subject="a" issuer="b" workspaceId="c" />'),
    1,
  );
  assert.equal(
    unsteppedProfiles(
      '<OrganisationProfile subject="a" issuer="b" workspaceId="c" steps framed />',
    ),
    0,
  );
});

// Audit unit A3d, part 2 (Programmes): both programme pages pass the page frame, the planning page tells the room it is
// framed (so the room draws no second back link), and the rare programme actions sit in a "More actions" menu where
// archiving asks first. The rename form, its payloads and the Undo are the existing ones.
test('the programme pages use the shared page frame and the room keeps its rare actions in a menu', () => {
  const chooser = read(join(web, 'app/account/delegations/organise/page.tsx'));
  assert.match(
    chooser,
    /frame=\{\{ back: programmesChooserBack \}\}/,
    'the chooser passes a frame',
  );
  const planning = read(join(web, 'app/account/delegations/[workspaceId]/page.tsx'));
  assert.match(planning, /frame=\{\{ back: programmeBack \}\}/, 'the planning page passes a frame');
  assert.match(planning, /\n\s+framed\n/, 'the planning page marks the room as framed');
  const lifecycle = read(join(web, 'app/account/delegations/programme-lifecycle.tsx'));
  assert.match(lifecycle, /<OverflowMenu[\s\S]*?'More actions for '[\s\S]*?Archive Programme/);
  assert.ok(
    lifecycle.includes('Archive this programme? You can restore it later.'),
    'archive asks',
  );
  assert.ok(lifecycle.includes('Rename programme'), 'the rename form is kept');
});
