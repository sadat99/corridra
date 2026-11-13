import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

// Binding guard for new UI code. Contract: docs/agents/ui-direction.md ("How to build a new screen").
// tests/design-system.test.mjs already covers the stylesheet colour layer, fonts, the icon family and the
// AC/1 palette. This file covers what it does not: TypeScript colours, text-transform on actions,
// inline spacing and type size, signed-in pages outside the shared shell, and the docs that bind builders.
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
const colourLiteral =
  /(['"`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/g;
const RAW_COLOUR_ALLOWED = new Set(['apps/web/app/manifest.ts', 'apps/web/app/layout.tsx']);

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
  for (const section of ['rawColourInTypeScript', 'textTransformOnActions', 'inlineStyle']) {
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

test('the owner operating rules are recorded in AGENTS.md and linked from session rotation', () => {
  const agents = read(join(root, 'AGENTS.md'));
  assert.match(agents, /## Parallel work operating rules \(owner, 13 November 2026\)/);
  for (const phrase of ['At most 4 builder sessions at once', '250k tokens', '$30', '$60']) {
    assert.ok(agents.includes(phrase), `AGENTS.md must keep "${phrase}"`);
  }
  assert.match(
    read(join(root, 'docs/agents/session-rotation.md')),
    /Parallel work operating rules/,
  );
});
