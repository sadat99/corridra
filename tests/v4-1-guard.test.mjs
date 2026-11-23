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
// Where place names are written: every component, and the words and copy files under lib and content.
const placeFiles = [
  ...tsx,
  ...walk(join(web, 'lib'), (p) => p.endsWith('.ts') && !isTest(p)),
  ...walk(join(web, 'content'), (p) => p.endsWith('.ts') && !isTest(p)),
]
  .filter((p) => rel(p) !== 'apps/web/components/ux/flag.tsx')
  .sort();

// Rule: a place name is written through the shared flag component. The nine places the flag policy covers, plus the
// EU, UK and US short forms. Counted line by line, in every component and in the words files under lib and content.
// A line counts when a place name is left on it after taking away:
// 1. comments;
// 2. what sits inside a `Flagged` element, or an object, key or prop that passes a mark (`mark: 'bd'`, `Spain: 'es'`);
// 3. locale tags such as en-US, and component or function names;
// 4. a bare 'EU', 'UK' or 'US' string, which is a country code in code, unless a display key (label, title, name,
//    text and the like) holds it.
// A line that draws a `Flag`, `RegionMark` or `RouteLine` itself is fine. `v4.1-prose` on a line still skips it, and
// is not owner-approved for new uses.
// Limits: it cannot tell that the mark is the right one for the name, and a bare 'EU' string shown through a key
// that is not a display key is not seen. Text that cannot hold markup (option text, aria-label, SVG text, values
// sent to the server) stays counted in the baseline as known debt.
const PLACE =
  /\b(China|Bangladesh|Australia|United Kingdom|United States|European Union|Spain|France|Italy|EU|UK|US)\b/;
const MARK = `['"](?:bd|cn|eu|gb|us|au|es|fr|it|region)['"]`;
const FLAGGED_ELEMENT = /<Flagged\b[^>]*>.*?<\/Flagged>/g;
const MARK_OBJECT = new RegExp(`\\{[^{}]*\\bmark\\s*:\\s*${MARK}[^{}]*\\}`, 'g');
const MARK_PROP = new RegExp(`\\bmark=\\{?${MARK}`);
const DRAWS_MARK = /<(?:Flag|RegionMark|RouteLine)\b/;
const CODE_STRING = /(['"])(?:EU|UK|US)\1/g;
const DISPLAY_KEY =
  /(?:\b(?:label|title|name|text|heading|alt|placeholder|description)|aria-label)\s*[:=]\s*\{?\s*$/;
const LOCALE_TAG = /\b[a-z]{2,3}-(?:US|UK|EU)\b/g;
// A name used as a key that gives its mark (`Spain: 'es'`), and a component or function that is named after a place.
const MARK_KEY = new RegExp(`(?:\\b\\w+|'[^']*'|"[^"]*")\\s*:\\s*${MARK}`, 'g');
const CODE_NAME = /<\/?[A-Z]\w*|\bfunction\s+[A-Z]\w*/g;

/** The source with every comment blanked out. Line breaks stay, so line numbers still match. */
function withoutComments(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (state === 'line') {
      if (c === '\n') state = 'code';
      out += c === '\n' ? c : ' ';
    } else if (state === 'block') {
      if (two === '*/') {
        state = 'code';
        out += '  ';
        i += 1;
      } else out += c === '\n' ? c : ' ';
    } else if (state === 'code') {
      if (two === '/*') {
        state = 'block';
        out += '  ';
        i += 1;
      } else if (two === '//' && src[i - 1] !== ':') {
        state = 'line';
        out += '  ';
        i += 1;
      } else {
        if (c === "'" || c === '"' || c === '`') state = c;
        out += c;
      }
    } else {
      // Inside a string. A quoted string ends at its quote or at the line end; a template string at its backtick.
      if (c === '\\' && i + 1 < src.length && src[i + 1] !== '\n') {
        out += two;
        i += 1;
      } else {
        if (c === state || (c === '\n' && state !== '`')) state = 'code';
        out += c;
      }
    }
  }
  return out;
}

/** The 1-based numbers of the lines of one source file that write a place name outside the flag component. */
function placeNameLines(src) {
  const raw = src.split('\n');
  const out = [];
  let open = 0; // `Flagged` elements opened on an earlier line and not yet closed
  withoutComments(src)
    .split('\n')
    .forEach((line, i) => {
      let rest = line.replace(FLAGGED_ELEMENT, '').replace(MARK_OBJECT, '');
      if (open > 0) {
        const close = rest.indexOf('</Flagged>');
        rest = close < 0 ? '' : rest.slice(close + '</Flagged>'.length);
        if (close >= 0) open -= 1;
      }
      const opens = rest.search(/<Flagged\b/);
      if (opens >= 0) {
        rest = rest.slice(0, opens);
        open += 1;
      }
      if (raw[i].includes('v4.1-prose') || line.trim().startsWith('import ')) return;
      if (DRAWS_MARK.test(rest) || MARK_PROP.test(rest)) return;
      rest = rest
        .replace(MARK_KEY, '')
        .replace(CODE_NAME, '')
        .replace(LOCALE_TAG, '')
        .replace(CODE_STRING, (found, quote, at, whole) =>
          DISPLAY_KEY.test(whole.slice(0, at)) ? found : '',
        );
      if (PLACE.test(rest)) out.push(i + 1);
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
    '{shown ? <China /> : null}',
    'function China() {',
    "const marks = { Spain: 'es', 'United Kingdom': 'gb' };",
  ];
  assert.deepEqual(lines(src), [8, 9]);
});

test('v4.1 place rule: words files under lib and content are scanned', () => {
  const scanned = placeFiles.map(rel);
  assert.ok(scanned.includes('apps/web/lib/i18n/form-words/en.ts'));
  assert.ok(scanned.includes('apps/web/content/corridors.ts'));
  assert.ok(!scanned.includes('apps/web/components/ux/flag.tsx'));
});
