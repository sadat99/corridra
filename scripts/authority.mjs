import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  assess,
  documentStatus,
  GOVERNED_ROOTS,
  hardIssues,
  isGoverned,
  registerRows,
  registerWord,
} from './authority-tools.mjs';

// Read-only. Resolves which documents govern today from the repository at HEAD, so no agent
// judges work against a plan that a later plan, owner direction or ledger entry replaced.
const REGISTER = 'docs/PLAN_STATUS.md';
const LEDGER = 'docs/V3_LEDGER.md';
const usage =
  'Usage: node scripts/authority.mjs [brief|stamp|check|doc PATH...] [--json]  (run from the repository root)';
const read = (path) => readFileSync(path, 'utf8');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return '';
  }
}

function governedFiles() {
  const roots = GOVERNED_ROOTS.map((root) => root.replace(/-$/, '-*').replace(/\/$/, ''));
  return git('ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots)
    .split('\n')
    .filter((path) => path && isGoverned(path) && existsSync(path))
    .sort();
}

// Documents edited after the register's last commit, plus uncommitted edits when the register
// itself is not being edited alongside them.
function changedAfterRegister() {
  const registerCommit = tryGit('log', '-1', '--format=%H', '--', REGISTER);
  const changed = new Set();
  if (registerCommit)
    for (const path of tryGit(
      'log',
      '--format=',
      '--name-only',
      `${registerCommit}..HEAD`,
      '--',
      'docs',
    ).split('\n'))
      if (isGoverned(path)) changed.add(path);
  const dirty = tryGit('status', '--porcelain', '--', 'docs')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  if (!dirty.includes(REGISTER)) for (const path of dirty) if (isGoverned(path)) changed.add(path);
  return { registerCommit, changed };
}

// Files whose content decides authority. Code commits leave the stamp alone; any change to these,
// or to a governed document's status word, makes every brief carrying the old stamp stale.
const AUTHORITY_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/START_HERE.md',
  LEDGER,
  REGISTER,
  'docs/V3_CONTRACT.md',
  'docs/product/corridra-product-vision-v2.1.md',
  'docs/implementation/current-plan.md',
  'docs/adr/README.md',
];

function stamp(assessed) {
  const hash = createHash('sha256');
  for (const path of AUTHORITY_FILES)
    hash.update(`${path}\0${existsSync(path) ? read(path) : ''}\0`);
  for (const row of assessed) hash.update(`${row.path}\0${row.word ?? 'none'}\0`);
  return `auth-${hash.digest('hex').slice(0, 12)}`;
}

function assessAll(paths, rows, changed) {
  return paths.map((path) =>
    assess({
      path,
      fileWord: existsSync(path) ? documentStatus(read(path)) : null,
      listedWord: registerWord(rows, path),
      changedAfterRegister: changed.has(path),
    }),
  );
}

function lastChanged(path) {
  return tryGit('log', '-1', '--format=%cs %h', '--', path) || 'uncommitted';
}

function ownerDirections() {
  const line = read(LEDGER)
    .split('\n')
    .find((row) => row.startsWith('- Owner directions in force'));
  return line ? line.slice(2) : 'Not found in the ledger: read docs/V3_LEDGER.md in full.';
}

// Owner rule, 25 Oct 2026: in a conflict or contradiction the latest decision always wins.
const PRECEDENCE = [
  'Latest wins. When two sources that can decide disagree, the more recent decision governs. Its date is the one stated with the decision; without one, the date of the commit that last changed it (`doc` prints it). An instruction from the owner in this session is the most recent of all.',
  'Sources that can decide: owner instructions and the owner directions in the ledger, the V3 contract, product vision, AGENTS.md and nested instructions, ADRs in force, CURRENT documents and the open phases of PARTLY BUILT documents.',
  'Sources that never decide, however recent: WAITING OWNER (not approved), DONE, HISTORICAL and NOT VALID documents. CURRENT, DATED is evidence only. FROZEN is never edited; a later decision amends it forward.',
  'Live state (what is merged, deployed, installed or switched on now) comes only from the ledger and fresh observation.',
  'If the dates cannot be established or are equal, report both positions with their sources; the owner decides.',
];

function main() {
  assert.ok(existsSync(REGISTER) && existsSync(LEDGER), usage);
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const [command = 'brief', ...rest] = args.filter((arg) => arg !== '--json');
  const rows = registerRows(read(REGISTER));
  const { registerCommit, changed } = changedAfterRegister();
  const all = assessAll(governedFiles(), rows, changed);

  if (command === 'stamp') return console.log(stamp(all));

  if (command === 'doc') {
    assert.ok(rest.length, usage);
    const result = assessAll(
      rest.map((path) => path.replace(/^\.\//, '')),
      rows,
      changed,
    );
    for (const row of result) row.lastChanged = lastChanged(row.path);
    if (json) return console.log(JSON.stringify(result, null, 2));
    for (const row of result)
      console.log(
        `${row.path}\n  last changed: ${row.lastChanged} | file: ${row.fileWord ?? 'none'} | register: ${row.listedWord ?? 'none'}${
          row.issues.length ? `\n  drift: ${row.issues.join('; ')}` : ''
        }${row.notes.length ? `\n  note: ${row.notes.join('; ')}` : ''}\n  verdict: ${row.verdict}`,
      );
    return;
  }

  const hard = hardIssues(all);
  const newer = all.filter((row) => row.notes.length);

  if (command === 'check') {
    for (const row of hard) console.log(`DRIFT ${row.path}: ${row.issues.join('; ')}`);
    console.log(
      hard.length
        ? `FAIL: ${hard.length} governed document(s) without a status the register agrees with.`
        : `PASS: ${all.length} governed documents carry a status word the register agrees with.`,
    );
    process.exitCode = hard.length ? 1 : 0;
    return;
  }

  assert.equal(command, 'brief', usage);
  const brief = {
    stamp: stamp(all),
    head: tryGit('rev-parse', '--short=8', 'HEAD') || 'unknown',
    branch: tryGit('branch', '--show-current') || 'detached',
    registerCommit: registerCommit ? registerCommit.slice(0, 8) : 'unavailable (shallow history)',
    precedence: PRECEDENCE,
    ownerDirections: ownerDirections(),
    drift: hard.map(({ path, issues }) => ({ path, issues })),
    newerThanRegister: newer.map(({ path, word }) => ({ path, word })),
    governedDocuments: all.length,
  };
  if (json) return console.log(JSON.stringify(brief, null, 2));
  console.log(
    [
      `Authority brief  stamp ${brief.stamp}  branch ${brief.branch} at ${brief.head}  register commit ${brief.registerCommit}`,
      '',
      'Precedence, highest first:',
      ...PRECEDENCE.map((rule, index) => `${index + 1}. ${rule}`),
      '',
      brief.ownerDirections,
      '',
      hard.length
        ? `Drift (UNRESOLVED until fixed): ${hard.map((row) => `${row.path} (${row.issues.join('; ')})`).join(' | ')}`
        : `Drift: none across ${all.length} governed documents.`,
      newer.length
        ? `Edited after the register, own status line agrees (${newer.length}): read the ledger for anything newer before relying on them.`
        : 'Edited after the register: none.',
      '',
      'Next: `node scripts/authority.mjs doc PATH...` for every document the task relies on. A brief whose stamp differs from `node scripts/authority.mjs stamp` is stale.',
    ].join('\n'),
  );
}

main();
