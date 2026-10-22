import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { headings, outline, safeMarkdownPath, section } from '../scripts/context-tools.mjs';

const root = new URL('..', import.meta.url).pathname;
const context = (...args) =>
  execFileSync('node', ['scripts/v3-context.mjs', ...args], { cwd: root, encoding: 'utf8' });
const fixture = [
  '# Title',
  'intro',
  '```',
  '# not a heading',
  '```',
  '## Alpha',
  'alpha body',
  '### Alpha detail',
  'detail body',
  '## Beta',
  'beta body',
  '## Beta two',
  'last body é',
].join('\n');

test('headings ignore fenced code and measure each section to the next peer', () => {
  const found = headings(fixture);
  assert.deepEqual(
    found.map((item) => [item.level, item.title]),
    [
      [1, 'Title'],
      [2, 'Alpha'],
      [3, 'Alpha detail'],
      [2, 'Beta'],
      [2, 'Beta two'],
    ],
  );
  const alpha = found.find((item) => item.title === 'Alpha');
  assert.equal(
    fixture.slice(alpha.offset, alpha.end),
    '## Alpha\nalpha body\n### Alpha detail\ndetail body\n',
  );
  assert.equal(outline(fixture, { last: 2, maxLevel: 2 }).split('\n').length, 2);
});

test('section prefers an exact title, accepts line numbers and reports ambiguity', () => {
  assert.match(section(fixture, 'beta'), /match 1 of 1[\s\S]*## Beta\nbeta body$/);
  assert.match(section(fixture, 'be', { nth: 2 }), /"Beta two" lines 12-13; match 2 of 2/);
  assert.match(section(fixture, '8'), /### Alpha detail\ndetail body$/);
  assert.match(section(fixture, 'Beta two', { tail: 14 }), /last 12 bytes only -->\nlast body é$/);
  assert.throws(() => section(fixture, 'missing'), /No heading matches/);
  assert.throws(() => section(fixture, 'be', { nth: 3 }), /--nth must be 1 to 2/);
});

test('only repository Markdown guides can be read through the helper', () => {
  assert.equal(safeMarkdownPath('docs/v3/CONTEXT.md', root), 'docs/v3/CONTEXT.md');
  assert.equal(safeMarkdownPath('AGENTS.md', root), 'AGENTS.md');
  for (const bad of [
    '../etc/passwd',
    'package.json',
    'apps/web/README.md',
    '/etc/hosts',
    'docs/x.json',
  ])
    assert.throws(() => safeMarkdownPath(bad, root), /Path must be Markdown/, bad);
});

test('status can prove the ledger is unchanged without printing it again', () => {
  const first = context('status');
  const id = /ledger-sha8: ([0-9a-f]{8})\s*$/.exec(first)?.[1];
  assert.ok(id, 'status ends with the ledger hash');
  const again = context('status', '--since', id);
  assert.match(again, /^UNCHANGED/);
  assert.ok(again.length < 200);
  assert.ok(context('status', '--since', '00000000').includes('# V3 execution ledger'));
});

test('budget and outline expose the cold-start cost and the heavy files to avoid', () => {
  const table = context('budget');
  assert.match(table, /always\tSUBTOTAL\t\d+/);
  assert.match(table, /query-never-whole\tdocs\/agents\/work-log\.md\t\d+/);
  assert.match(
    context('outline', 'docs/agents/ui-direction.md'),
    /^line\tbytes\theading\n1\t\d+\t# /,
  );
});

function gate(cwd, ...args) {
  return spawnSync('node', [join(root, 'scripts/gate.mjs'), ...args], { cwd, encoding: 'utf8' });
}

test('gate keeps the exact exit code, saves the full log and redacts printed secrets', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-'));
  const pass = gate(
    cwd,
    'ok',
    '--',
    'node',
    '-e',
    "console.log('# pass 3'); console.log('token=abc12345')",
  );
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /"exit":0/);
  assert.match(pass.stdout, /# pass 3/);
  assert.ok(!pass.stdout.includes('abc12345'));
  const logs = readdirSync(join(cwd, 'work')).filter((file) => file.endsWith('.log'));
  assert.equal(logs.length, 1);
  assert.ok(readFileSync(join(cwd, 'work', logs[0]), 'utf8').includes('token=abc12345'));
  assert.ok(readdirSync(join(cwd, 'work')).some((file) => file.endsWith('.receipt.json')));

  const fail = gate(
    cwd,
    'bad',
    '--tail',
    '3',
    '--',
    'node',
    '-e',
    "console.error('Error: boom'); process.exit(3)",
  );
  assert.equal(fail.status, 3);
  assert.match(fail.stdout, /"exit":3/);
  assert.match(fail.stdout, /failure context:\nError: boom/);

  assert.equal(gate(cwd, 'x y', '--', 'node').status, 2);
  assert.equal(gate(cwd, 'nocmd').status, 2);
  assert.equal(gate(cwd, 'missing', '--', 'definitely-not-a-command').status, 127);
});
