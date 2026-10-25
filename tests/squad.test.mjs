import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  assess,
  documentStatus,
  hardIssues,
  isGoverned,
  registerRows,
  registerWord,
} from '../scripts/authority-tools.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(`${root}${path}`, 'utf8');

const SQUAD = {
  'corridra-authority': { writes: false },
  'corridra-product': { writes: false },
  'corridra-architect': { writes: true },
  'corridra-designer': { writes: false },
  'corridra-builder': { writes: true },
  'corridra-verifier': { writes: false },
  'corridra-reviewer': { writes: false },
  'corridra-scribe': { writes: true },
};

// Facts that change with the plan. Agent files hold procedure only, so none of these may appear.
const VOLATILE = [
  [/\bPR ?#?\d+\b/, 'a pull request number'],
  [/\bV3-\d{2}-\d{3}\b/, 'a requirement ID'],
  [/\bCORRIDRA_[A-Z0-9_]+\b/, 'a switch name'],
  [/\bADR-?\d{2,4}\b/i, 'an ADR number'],
  [/\bKI-\d+\b/, 'a known-issues number'],
  [/\bD0\d\b/, 'a gate number'],
  [/\b20\d\d-\d\d-\d\d\b/, 'a date'],
  [/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/, 'a date'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/, 'a commit hash'],
];

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'missing frontmatter');
  return Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
}

test('status lines are read from the head of a document only', () => {
  assert.equal(documentStatus('# T\n\n**Document status: CURRENT.** More.'), 'CURRENT');
  assert.equal(
    documentStatus('# T\n\nDocument status: CURRENT, DATED. True then.'),
    'CURRENT, DATED',
  );
  assert.equal(documentStatus('# T\n\n**Document status: PARTLY BUILT.** x'), 'PARTLY BUILT');
  assert.equal(documentStatus('# T\n\nDocument status: WAITING OWNER.\n'), 'WAITING OWNER');
  assert.equal(documentStatus(`# T\n${'\n'.repeat(20)}Document status: CURRENT.`), null);
  assert.equal(documentStatus('# T\n\nStatus: built and dark.'), null);
});

test('register rows map linked paths and backtick globs to their word', () => {
  const rows = registerRows(
    [
      '| Plan | Status | Note |',
      '| ---- | ------ | ---- |',
      '| [Current plan](implementation/current-plan.md) | CURRENT | Work order. |',
      '| Lane records (`product/lane*`) | DONE | Built. |',
      '| [Old](implementation/plan-v1.0.md) | HISTORICAL | Old. |',
      '| [0014](adr/0014-x.md) | NOT VALID. Superseded by a later ADR. |',
    ].join('\n'),
  );
  assert.equal(registerWord(rows, 'docs/implementation/current-plan.md'), 'CURRENT');
  assert.equal(registerWord(rows, 'docs/product/lane5-room.md'), 'DONE');
  assert.equal(registerWord(rows, 'docs/implementation/plan-v1.0.md'), 'HISTORICAL');
  assert.equal(registerWord(rows, 'docs/adr/0014-x.md'), 'NOT VALID');
  assert.equal(registerWord(rows, 'docs/product/other.md'), null);
  assert.ok(isGoverned('docs/v3/phase-3/x/bounded-plan.md'));
  assert.ok(!isGoverned('docs/adr/0014-x.md'));
});

test('an executed plan still labelled WAITING OWNER by the register cannot instruct anyone', () => {
  // The drift that existed before this guard: plan files without their own line, edited after
  // a register row that still called them WAITING OWNER.
  const stale = assess({
    path: 'docs/product/plan.md',
    fileWord: null,
    listedWord: 'WAITING OWNER',
    changedAfterRegister: true,
  });
  assert.match(stale.verdict, /^UNRESOLVED/);
  assert.equal(hardIssues([stale]).length, 1);

  const mismatch = assess({
    path: 'docs/product/plan.md',
    fileWord: 'DONE',
    listedWord: 'WAITING OWNER',
    changedAfterRegister: false,
  });
  assert.match(mismatch.verdict, /^UNRESOLVED/);

  const unlabelled = assess({
    path: 'docs/product/new.md',
    fileWord: null,
    listedWord: null,
    changedAfterRegister: false,
  });
  assert.match(unlabelled.verdict, /^UNRESOLVED/);
});

test('a document whose own line agrees with the register gets the verdict for its word', () => {
  const cases = [
    ['CURRENT', /^FOLLOW$/],
    ['PARTLY BUILT', /OPEN/],
    ['WAITING OWNER', /^DO NOT ACT/],
    ['DONE', /^CONTEXT ONLY/],
    ['HISTORICAL', /^IGNORE/],
    ['CURRENT, DATED', /^EVIDENCE ONLY/],
  ];
  for (const [word, verdict] of cases) {
    const row = assess({
      path: 'docs/product/x.md',
      fileWord: word,
      listedWord: word,
      changedAfterRegister: true,
    });
    assert.match(row.verdict, verdict, word);
    assert.deepEqual(row.issues, []);
    assert.deepEqual(row.notes, ['edited after the register']);
  }
});

test('every governed plan in the repository carries a status the register agrees with', () => {
  const run = spawnSync('node', ['scripts/authority.mjs', 'check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const stamp = spawnSync('node', ['scripts/authority.mjs', 'stamp'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(stamp.stdout.trim(), /^auth-[0-9a-f]{12}$/);
});

test('the squad has exactly its eight agents, each with one owner role and the right tools', () => {
  const files = readdirSync(`${root}.claude/agents`).filter((name) => name.endsWith('.md'));
  assert.deepEqual(
    files.map((name) => name.replace(/\.md$/, '')).sort(),
    Object.keys(SQUAD).sort(),
  );
  for (const [name, { writes }] of Object.entries(SQUAD)) {
    const text = read(`.claude/agents/${name}.md`);
    const meta = frontmatter(text);
    assert.equal(meta.name, name);
    assert.ok(meta.description.length > 80, `${name} needs a routing description`);
    const tools = meta.tools.split(',').map((tool) => tool.trim());
    assert.equal(tools.includes('Write') || tools.includes('Edit'), writes, `${name} write tools`);
    assert.ok(!tools.includes('Agent'), `${name} must not start other agents`);
    if (name !== 'corridra-authority')
      assert.match(text, /node scripts\/authority\.mjs stamp/, `${name} must check the stamp`);
  }
});

test('squad files hold procedure only: no plan facts, no em dashes', () => {
  const paths = [
    ...Object.keys(SQUAD).map((name) => `.claude/agents/${name}.md`),
    '.claude/skills/corridra-squad/SKILL.md',
    '.claude/skills/corridra-squad/quality-bar.md',
    '.claude/workflows/corridra-squad.js',
  ];
  for (const path of paths) {
    const text = read(path);
    assert.ok(!text.includes('—'), `${path} contains an em dash`);
    for (const [pattern, what] of VOLATILE) {
      const hit = pattern.exec(text);
      assert.equal(
        hit,
        null,
        `${path} contains ${what}: "${hit?.[0]}"; read it at run time instead`,
      );
    }
  }
});

test('the quality bar is complete and bound to the agents that plan, build and review', () => {
  const bar = read('.claude/skills/corridra-squad/quality-bar.md');
  for (const section of [
    'Clean',
    'Secure',
    'Easy to use',
    'Durable',
    'Maintainable',
    'Easy to change and scale',
    'Observable',
    'Fast enough',
  ])
    assert.ok(bar.includes(`\n## ${section}\n`), `quality bar lacks ${section}`);
  for (const name of ['corridra-architect', 'corridra-builder', 'corridra-reviewer'])
    assert.ok(
      read(`.claude/agents/${name}.md`).includes('.claude/skills/corridra-squad/quality-bar.md'),
      `${name} must apply the quality bar`,
    );
  assert.ok(read('.claude/skills/corridra-squad/SKILL.md').includes('(quality-bar.md)'));
});

test('the workflow compiles and routes only to squad agents the skill documents', () => {
  const source = read('.claude/workflows/corridra-squad.js');
  const body = source.replace(/^export const meta =/m, 'const meta =');
  assert.doesNotThrow(() => new vm.Script(`(async () => {\n${body}\n})`));
  const used = new Set(
    [...source.matchAll(/'(corridra-(?!squad')[a-z]+)'/g)].map((match) => match[1]),
  );
  for (const name of used) assert.ok(name in SQUAD, `workflow uses unknown agent ${name}`);
  for (const name of Object.keys(SQUAD)) assert.ok(used.has(name), `workflow never uses ${name}`);
  const skill = read('.claude/skills/corridra-squad/SKILL.md');
  for (const name of Object.keys(SQUAD)) assert.match(skill, new RegExp(`\`${name}\``));
});
