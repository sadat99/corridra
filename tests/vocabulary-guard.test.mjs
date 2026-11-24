import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Vocabulary guard (commercial-ready run, unit L0). Owner, 23 November 2026: "there shouldnt be synthetic, draft
// etc, all must be live and commercially ready". Rule: the words Synthetic, draft, brief, contributor and operator
// are not written on a customer screen.
//
// What is read: every .ts and .tsx file under apps/web/app, components, lib and content, except the staff and
// helper routes (app/operator, app/contributor) and the server routes (app/api). In each file the guard reads the
// text a person can be shown: text between JSX tags, and written sentences in strings (a string with a space in
// it, or one that starts with a capital letter; in the words files under lib/i18n every value counts).
//
// What is not a hit: names in code (keys, imports, types, class names, paths, values such as 'draft' or 'DRAFT'
// that a program compares), and the phrases in ALLOWED_PHRASES.
//
// Two named lists hold everything the rule does not yet cover. Each entry is exact: the count may not rise, and
// when it falls the entry must be lowered or deleted in the same change. A file on neither list must have none.
//   LEFTOVERS     words still on customer screens, each with the open unit that removes them. This list shrinks
//                 to nothing; it is never a place to park a new word.
//   OUTSIDE_RULE  text the rule does not cover (staff screens that live outside app/operator, and phrases a
//                 person types that are matched and never shown), each with the reason.
// Limits: the guard cannot see words built at run time or sent by the server, and it cannot tell a staff screen
// from a customer one inside a shared file, which is why those files are named below with exact counts.

const root = new URL('..', import.meta.url).pathname;
const web = join(root, 'apps/web');
const rel = (p) => relative(root, p).split('\\').join('/');

export const WORDS = ['synthetic', 'draft', 'brief', 'contributor', 'operator'];
const WORD =
  /(?<![\w./-])(synthetic|draft(?:s|ed|ing)?|briefs?|contributors?|operators?)(?![\w/:=-]|\.\w)/gi;

// A phrase that holds one of the words in another meaning. Taken out of the text before the words are looked for.
const ALLOWED_PHRASES = [
  // The legal role of the party that sells a package trip. Corridra says it is not that party (programme pages).
  /\btravel operator\b/gi,
];

/** Words still on customer screens. `unit` is the open unit of the commercial-ready run that removes them. */
const LEFTOVERS = [
  // B7b-ui: the "Synthetic" prefix, its hints and its checks leave these screens after the owner's install.
  ['apps/web/app/account/customer-workspace-team.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/customer-workspaces.tsx', 3, 'B7b-ui'],
  ['apps/web/app/account/delegations/buying-trip-starter.ts', 1, 'B7b-ui'],
  ['apps/web/app/account/delegations/first-run.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/participant-account.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/participant-payment-declaration.tsx', 3, 'B7b-ui'],
  ['apps/web/app/account/delegations/participant-results.tsx', 12, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-applications.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-context-editor.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-coordination.tsx', 15, 'B7b-ui'],
  // 9 "Synthetic" and 1 "contributor" ("a supplier or contributor") on the same screen.
  ['apps/web/app/account/delegations/programme-economics.tsx', 10, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-objective-editor.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-page.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-participants.tsx', 6, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-payment-review.tsx', 3, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-pricing.tsx', 12, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-projections.tsx', 1, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-series.tsx', 10, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-templates.tsx', 22, 'B7b-ui'],
  ['apps/web/app/account/delegations/programme-terms.tsx', 23, 'B7b-ui'],
  ['apps/web/app/account/delegations/terms-client.ts', 1, 'B7b-ui'],
  ['apps/web/app/account/drafts/guided-request.tsx', 10, 'B7b-ui'],
  ['apps/web/app/account/profile/company-link.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/profile/organisation-profile.tsx', 2, 'B7b-ui'],
  ['apps/web/app/account/service-requests/service-request-detail.tsx', 5, 'B7b-ui'],
  ['apps/web/app/account/service-requests/service-request-new.tsx', 2, 'B7b-ui'],
  ['apps/web/components/commercial-arrangement-fields.tsx', 1, 'B7b-ui'],
  // The three "Start ... with Synthetic" refusals of the programme pages.
  ['apps/web/lib/i18n/programme-pages-words.ts', 3, 'B7b-ui'],
];

/** Text the rule does not cover, with the reason. Exact counts, so a customer word cannot hide in these files. */
const OUTSIDE_RULE = [
  // Staff screens that live outside app/operator. Operator is a real staff role and is named to staff.
  ['apps/web/lib/owner-switches.ts', 1, 'the owner-only switches screen names the Operator desk'],
  ['apps/web/lib/owner-gaps.ts', 2, 'the owner-only gaps screen'],
  ['apps/web/components/founder-overview.tsx', 3, 'the owner-only overview'],
  ['apps/web/components/ux/team-utility-menus.tsx', 1, 'the staff menu names the staff role'],
  ['apps/web/lib/reply-review-view.ts', 1, 'the staff reply review names the staff roles'],
  ['apps/web/lib/access-doors.ts', 7, 'the staff sign-in and set-up doors name the staff role'],
  ['apps/web/components/account-form.tsx', 1, 'the link to the staff sign-in door'],
  [
    'apps/web/components/ux/reference-picker.tsx',
    1,
    'a staff picker, used only under app/operator',
  ],
  // Phrases a person may type into the action search. They are matched against what is typed and never shown.
  ['apps/web/lib/actions/catalogue.ts', 10, 'search phrases a person types, never shown'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path) && !/\.(test|spec)\.|\.d\.ts$/.test(path)) out.push(path);
  }
  return out;
}

// Attributes whose value is never read by a person.
const CODE_ATTRIBUTE =
  /^(className|class|id|href|src|key|type|name|htmlFor|role|rel|target|style|method|action|autoComplete|inputMode|d|viewBox|fill|stroke|slot|as|variant|size|tone|kind|icon|mark|lang|dir|k)$|^data-/;

/** The banned words a person can be shown in one source text. Exported for the guard's own tests. */
export function shownWords(source, file = 'file.tsx') {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const wordsFile = /(^|\/)lib\/i18n\//.test(file) || /-words\.ts$/.test(file);
  const found = [];
  const read = (node, raw, sentenceOnly) => {
    const text = raw.trim();
    // A sentence has a space or starts with a capital letter; a value in capitals throughout ('DRAFT') is code.
    const sentence = /\s/.test(text) || (/^[A-Z]/.test(text) && text !== text.toUpperCase());
    if (sentenceOnly && !sentence) return;
    if (text.startsWith('/')) return;
    const kept = ALLOWED_PHRASES.reduce((value, phrase) => value.replace(phrase, ' '), text);
    for (const match of kept.matchAll(WORD))
      found.push({
        line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        word: match[1].toLowerCase(),
        text: text.slice(0, 80),
      });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxAttribute(node) && CODE_ATTRIBUTE.test(node.name.getText())) return;
    if (ts.isJsxText(node)) read(node, node.text, false);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isKey =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isElementAccessExpression(parent) && parent.argumentExpression === node);
      const isWord = wordsFile && ts.isPropertyAssignment(parent) && parent.initializer === node;
      if (!isKey) read(node, node.text, !isWord);
    } else if (ts.isTemplateExpression(node)) {
      read(
        node,
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('{}'),
        true,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const files = ['app', 'components', 'lib', 'content']
  .flatMap((dir) => walk(join(web, dir)))
  .filter((path) => !/^apps\/web\/app\/(operator|contributor|api)\//.test(rel(path)))
  .sort();
const hits = new Map();
for (const path of files) {
  const found = shownWords(readFileSync(path, 'utf8'), rel(path));
  if (found.length) hits.set(rel(path), found);
}
const show = (file) =>
  (hits.get(file) ?? [])
    .map((hit) => `\n    ${file}:${hit.line} [${hit.word}] ${hit.text}`)
    .join('');

test('the guard reads sentences a person is shown and leaves code names alone', () => {
  const words = (source, file) => shownWords(source, file).map((hit) => hit.word);
  assert.deepEqual(words('const a = <p>Save your draft and come back.</p>;'), ['draft']);
  assert.deepEqual(words("const a = { label: 'Synthetic' };", 'a.ts'), ['synthetic']);
  assert.deepEqual(words('const a = `Ask your operator about ${name} briefs`;', 'a.ts'), [
    'operator',
    'briefs',
  ]);
  assert.deepEqual(words('const a = <input aria-label="Contributor name" />;'), ['contributor']);
  // Code: keys, compared values, class names, paths, imports and types.
  assert.deepEqual(words("const a = { draft: status === 'draft', kind: 'DRAFT' };", 'a.ts'), []);
  assert.deepEqual(words('const a = <p className="draft row">Saved</p>;'), []);
  assert.deepEqual(words("const a = '/account/drafts'; const b = 'is-draft open';", 'a.ts'), []);
  assert.deepEqual(words("import { Draft } from './draft'; type A = 'operator view';", 'a.ts'), []);
  // A words file: every value is read, a single lower-case word too.
  assert.deepEqual(words("export const w = { 'a.b': 'draft' };", 'apps/web/lib/i18n/x.ts'), [
    'draft',
  ]);
  // The legal phrase is allowed; the staff role beside it is not.
  assert.deepEqual(words("const a = 'Not the travel operator. Ask an operator.';", 'a.ts'), [
    'operator',
  ]);
});

test('both lists are well formed and name files that exist', () => {
  const units = new Set(['B7b-ui', 'L1-buyer', 'B9b', 'B8b', 'CP']);
  const seen = new Set();
  for (const [file, count, unit] of LEFTOVERS) {
    assert.ok(
      files.some((path) => rel(path) === file),
      `${file} is not a file the guard reads`,
    );
    assert.ok(Number.isInteger(count) && count > 0, `${file}: an entry at zero must be deleted`);
    assert.ok(units.has(unit), `${file}: "${unit}" is not an open unit of the run`);
    assert.ok(!seen.has(file), `${file} is listed twice`);
    seen.add(file);
  }
  for (const [file, count, reason] of OUTSIDE_RULE) {
    assert.ok(
      files.some((path) => rel(path) === file),
      `${file} is not a file the guard reads`,
    );
    assert.ok(Number.isInteger(count) && count > 0, `${file}: an entry at zero must be deleted`);
    assert.ok(reason.length > 10, `${file}: say why the rule does not cover it`);
    assert.ok(!seen.has(file), `${file} is listed twice`);
    seen.add(file);
  }
});

test('no Synthetic, draft, brief, contributor or operator on a customer screen', () => {
  const allowed = new Map([...LEFTOVERS, ...OUTSIDE_RULE].map(([file, count]) => [file, count]));
  const fresh = [...hits.keys()].filter((file) => !allowed.has(file));
  assert.deepEqual(
    fresh,
    [],
    `These customer screens use a word the owner removed. Use the plain word (sample, saved request, summary, helper, the Corridra team):${fresh.map(show).join('')}`,
  );
  for (const [file, count] of allowed) {
    const now = hits.get(file)?.length ?? 0;
    assert.ok(
      now <= count,
      `${file} has ${now} of these words, more than the ${count} listed:${show(file)}`,
    );
    assert.equal(
      now,
      count,
      `${file} now has ${now} of these words, fewer than the ${count} listed. Lower the entry, or delete it at zero.`,
    );
  }
});
