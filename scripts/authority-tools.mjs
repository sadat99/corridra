import { posix } from 'node:path';

// Pure helpers that decide which document governs. They never read the repository themselves.

export const STATUS_WORDS = [
  'CURRENT, DATED',
  'CURRENT',
  'DONE',
  'PARTLY BUILT',
  'WAITING OWNER',
  'HISTORICAL',
  'NOT VALID',
  'FROZEN',
];

// What an agent may do with a document, by its status word (meanings from docs/PLAN_STATUS.md).
export const VERDICTS = {
  CURRENT: 'FOLLOW',
  'CURRENT, DATED': 'EVIDENCE ONLY: re-check the code before quoting',
  DONE: 'CONTEXT ONLY: explains why code looks as it does, not a to-do list',
  'PARTLY BUILT': 'FOLLOW ONLY THE PHASES IT MARKS OPEN',
  'WAITING OWNER': 'DO NOT ACT until the owner approves',
  HISTORICAL: 'IGNORE as instruction',
  'NOT VALID': 'IGNORE: replaced by a later decision',
  FROZEN: 'READ ONLY: exact source, never edit',
};

export const GOVERNED_ROOTS = ['docs/product/', 'docs/implementation/', 'docs/v3/phase-'];

export function isGoverned(path) {
  return path.endsWith('.md') && GOVERNED_ROOTS.some((root) => path.startsWith(root));
}

export function normaliseWord(raw) {
  const word = String(raw)
    .toUpperCase()
    .replace(/[^A-Z ,]/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^CURRENT DATED$/, 'CURRENT, DATED');
  return STATUS_WORDS.find((known) => word === known || word.startsWith(`${known} `)) ?? null;
}

// The status line must sit near the title; later mentions are prose, not a label.
export function documentStatus(text) {
  const head = text.split('\n').slice(0, 12).join('\n');
  const match = /Document status:\s*\**\s*([A-Z][A-Z ,]*?)\s*[.*\n]/.exec(head);
  return match ? normaliseWord(match[1]) : null;
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function toDocsPath(target) {
  const clean = target.split('#')[0].trim();
  if (!clean || /^[a-z]+:/i.test(clean)) return null;
  return posix.normalize(posix.join('docs', clean));
}

export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}`);
}

// Rows of the register tables: every linked path or backtick glob in the first cell, and the
// status word that opens the second cell.
export function registerRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|') || /^\|\s*-/.test(line.trim())) continue;
    const [first = '', second = ''] = cells(line);
    const word = normaliseWord(second.split('.')[0]);
    if (!word) continue;
    const paths = [...first.matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => toDocsPath(match[1]))
      .filter(Boolean);
    const globs = [...first.matchAll(/`([^`]+\*[^`]*)`/g)].map((match) =>
      globToRegExp(posix.join('docs', match[1].trim())),
    );
    rows.push({ word, paths, globs, label: first.replace(/\s+/g, ' ').slice(0, 120) });
  }
  return rows;
}

export function registerWord(rows, path) {
  const direct = rows.find((row) => row.paths.includes(path));
  if (direct) return direct.word;
  const glob = rows.find((row) => row.globs.some((pattern) => pattern.test(path)));
  return glob ? glob.word : null;
}

// One row per document: its own label, the register's word, whether it changed after the
// register was last updated, and the verdict an agent must apply.
// A document's own line wins over a register word written before its latest edit: a register-only
// word on a document edited since is exactly how an executed plan kept reading WAITING OWNER.
export function assess({ path, fileWord, listedWord, changedAfterRegister }) {
  const issues = [];
  if (!fileWord && !listedWord) issues.push('no Document status line and not in the register');
  if (fileWord && listedWord && fileWord !== listedWord)
    issues.push(`file says ${fileWord}, register says ${listedWord}`);
  if (!fileWord && listedWord && changedAfterRegister)
    issues.push(`no status line of its own and edited after the register said ${listedWord}`);
  const notes = changedAfterRegister && !issues.length ? ['edited after the register'] : [];
  const word = fileWord ?? listedWord;
  const verdict =
    issues.length || !word
      ? 'UNRESOLVED: the ledger wins on live state; get the register fixed or ask the owner before acting on this document'
      : VERDICTS[word];
  return { path, fileWord, listedWord, word, issues, notes, verdict };
}

export function hardIssues(rows) {
  return rows.filter((row) => row.issues.length);
}
