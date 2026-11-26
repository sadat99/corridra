import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureFullHistory } from '../scripts/ensure-full-history.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function origin() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-origin-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  for (const n of ['a', 'b', 'c']) {
    writeFileSync(join(dir, n), n);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', n);
  }
  return dir;
}

test('a shallow checkout is completed before the secret scan reads history', () => {
  const src = origin();
  const clone = mkdtempSync(join(tmpdir(), 'scan-clone-'));
  git(clone, 'clone', '-q', '--depth', '1', 'file://' + src, '.');
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(ensureFullHistory(clone), true);
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git(clone, 'rev-list', '--count', 'HEAD'), '3');
});

test('a full checkout is left untouched', () => {
  assert.equal(ensureFullHistory(origin()), false);
});

test('a shallow checkout that cannot be completed fails loudly instead of scanning', () => {
  const src = origin();
  const clone = mkdtempSync(join(tmpdir(), 'scan-clone-'));
  git(clone, 'clone', '-q', '--depth', '1', 'file://' + src, '.');
  git(clone, 'remote', 'set-url', 'origin', 'file:///nonexistent');
  assert.throws(() => ensureFullHistory(clone), /could not be completed/);
});
