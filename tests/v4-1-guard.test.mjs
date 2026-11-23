import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { DECISIONS, problems, readLedger } from '../scripts/v4-1-conformance.mjs';

// UI/UX.v4.1 guard. Spec: docs/revamp/specs/ui-ux-v4-1.md. Rollout: docs/revamp/specs/ui-ux-v4-1-rollout.md.
// Existing debt is frozen in tests/v4-1-guard-baseline.json. A count may fall, never rise, and a file with no
// baseline entry must have none. Regenerate after removing debt: V41_WRITE_BASELINE=1 node --test tests/v4-1-guard.test.mjs
// The guard cannot judge meaning (does an icon fit, is there one primary in a region). The ledger rows and the
// screenshot evidence in each wave PR carry that.

const root = new URL('..', import.meta.url).pathname;
const web = join(root, 'apps/web');
const baselinePath = join(root, 'tests/v4-1-guard-baseline.json');
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(root, p).split('\\').join('/');

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}
const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const tsx = walk(web, (p) => p.endsWith('.tsx') && !isTest(p));
const css = walk(web, (p) => p.endsWith('.css'));
// Old rule: components only.
const placeFiles = tsx.filter((p) => rel(p) !== 'apps/web/components/ux/flag.tsx');

// Rule: a place name written in a component that does not use the shared flag component. The nine places the
// flag policy covers, plus the EU, UK and US short forms. Prose that must stay unmarked carries `v4.1-prose` on its line.
const PLACE =
  /\b(China|Bangladesh|Australia|United Kingdom|United States|European Union|Spain|France|Italy|EU|UK|US)\b/;
/** The 1-based numbers of the lines of one source file that write a place name outside the flag component. */
function placeNameLines(src) {
  if (/ux\/flag['"]|from '\.\/flag'/.test(src)) return [];
  const out = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('import '))
      return;
    if (line.includes('v4.1-prose')) return;
    if (PLACE.test(line) && (/['"`]/.test(line) || line.includes('>'))) out.push(i + 1);
  });
  return out;
}
function placeNameCounts() {
  const out = {};
  for (const p of placeFiles) {
    const r = rel(p);
    const n = placeNameLines(read(p)).length;
    if (n) out[r] = n;
  }
  return out;
}

// Rule: no gradient or backdrop blur in stylesheets (v4.1: no gradient, glass or glow). A repeating gradient is the
// hatch for "Not stated" in the visual grammar and is allowed.
function glassCounts() {
  const out = {};
  for (const p of css) {
    const n = (
      read(p).match(/(?<!repeating-)(?:linear|radial|conic)-gradient\(|backdrop-filter\s*:/g) ?? []
    ).length;
    if (n) out[rel(p)] = n;
  }
  return out;
}

const current = { placeNameOutsideFlagComponent: placeNameCounts(), gradientOrBlur: glassCounts() };
if (process.env.V41_WRITE_BASELINE === '1')
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
const baseline = JSON.parse(read(baselinePath));

function ratchet(key, what) {
  const bad = [];
  for (const [file, n] of Object.entries(current[key])) {
    const allowed = baseline[key][file] ?? 0;
    if (n > allowed) bad.push(`${file}: ${n} ${what}, baseline ${allowed}`);
  }
  assert.deepEqual(
    bad,
    [],
    `${what}: the count may fall, never rise (see docs/revamp/specs/ui-ux-v4-1.md)`,
  );
}

test('v4.1 conformance ledger matches the page routes and its own rules', () => {
  assert.deepEqual(problems(), []);
});

test('v4.1 ledger carries every locked decision and the spec lists them', () => {
  const ledger = readLedger();
  const spec = read(join(root, 'docs/revamp/specs/ui-ux-v4-1.md'));
  for (const id of Object.keys(DECISIONS)) {
    assert.ok(ledger.decisions[id], `ledger lacks ${id}`);
    assert.ok(spec.includes(`| ${id} `), `spec lacks ${id}`);
  }
  assert.ok(existsSync(join(root, 'docs/revamp/specs/ui-ux-v4-1-rollout.md')));
});

test('v4.1 flag policy: exactly nine flags plus the region mark, and the code list matches the files', () => {
  const code = read(join(web, 'components/ux/flag.tsx'));
  const listed = [...code.match(/flagCodes = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)]
    .map((m) => m[1])
    .sort();
  const files = readdirSync(join(web, 'public/flags'))
    .filter((f) => f.endsWith('.svg') && f !== 'region.svg')
    .map((f) => f.replace('.svg', ''))
    .sort();
  assert.deepEqual(listed, ['au', 'bd', 'cn', 'es', 'eu', 'fr', 'gb', 'it', 'us']);
  assert.deepEqual(
    files,
    listed,
    'a new flag needs an owner decision under the flag policy, not a file drop',
  );
  assert.ok(existsSync(join(web, 'public/flags/region.svg')));
});

test('v4.1 place names are written through the flag component (ratchet)', () =>
  ratchet('placeNameOutsideFlagComponent', 'place-name lines outside the flag component'));

test('v4.1 stylesheets add no gradient or backdrop blur (ratchet)', () =>
  ratchet('gradientOrBlur', 'gradient or backdrop-filter uses'));

// The counting rule itself, on small written cases (the limits found in the review of PR 599).
const lines = (src) => placeNameLines(src.join('\n'));

test('v4.1 place rule: JSX text on its own line is counted', () => {
  assert.deepEqual(lines(['<strong>', '  Bangladesh', '</strong>']), [2]);
  assert.deepEqual(
    lines(['<p>', '  We open routes to China, the EU', '  and the UK', '</p>']),
    [2, 3],
  );
});

test('v4.1 place rule: a file that imports the flag component is still counted line by line', () => {
  const src = [
    "import { Flagged } from './ux/flag';",
    '<Flagged code="bd">Bangladesh</Flagged>',
    '<strong>China</strong>',
    '<Flagged code="cn">',
    '  China',
    '</Flagged>',
    "const from = { name: 'Bangladesh', mark: 'bd' };",
    "const label = 'Bangladesh to China';",
    '<Flagged code="bd">Bangladesh</Flagged> to China',
  ];
  assert.deepEqual(lines(src), [3, 8, 9]);
});

test('v4.1 place rule: comments, locale tags and country codes in code are not place names', () => {
  const src = [
    '// China and the EU have their own pages',
    '{/* the older lead and',
    '    the Spain link */}',
    "const eu = market === 'EU' || company === 'EU';",
    "const tag = 'en-US';",
    "const pinned = ['EU', 'US'];",
    "const url = 'https://example.test/a'; // to China",
    "const shown = { label: 'EU' };",
    "const wrong = { name: 'China', mark: null };",
  ];
  assert.deepEqual(lines(src), [8, 9]);
});

test('v4.1 place rule: words files under lib and content are scanned', () => {
  const scanned = placeFiles.map(rel);
  assert.ok(scanned.includes('apps/web/lib/i18n/form-words/en.ts'));
  assert.ok(scanned.includes('apps/web/content/corridors.ts'));
  assert.ok(!scanned.includes('apps/web/components/ux/flag.tsx'));
});
