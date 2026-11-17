import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Guards the narrow pnpm audit exception for GHSA-fc5q-39xc-vjpf (KI-63).
const GHSA = 'GHSA-fc5q-39xc-vjpf';
const EXPIRES = '2026-12-31';

const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');

function ignoredGhsas() {
  const block = workspace.match(/^auditConfig:\n {2}ignoreGhsas:\n((?: {4}- .+\n?)+)/m);
  assert.ok(block, 'pnpm-workspace.yaml must hold auditConfig.ignoreGhsas');
  return block[1]
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^ {4}- /, '').trim());
}

function lockedPicomatch() {
  const found = new Set();
  for (const m of lock.matchAll(/^ {2}picomatch@(\d+\.\d+\.\d+):/gm)) found.add(m[1]);
  return [...found];
}

const atLeast = (version, [maj, min, pat]) => {
  const [a, b, c] = version.split('.').map(Number);
  return a !== maj ? a > maj : b !== min ? b > min : c >= pat;
};

test('the audit ignore list holds only the picomatch advisory', () => {
  assert.deepEqual(ignoredGhsas(), [GHSA]);
  assert.doesNotMatch(workspace, /audit-level|ignoreCves/);
});

test('the exception is removed once every locked picomatch 4.x is patched', () => {
  const versions = lockedPicomatch().filter((v) => v.startsWith('4.'));
  assert.ok(
    versions.length > 0,
    'lockfile has no picomatch 4.x; remove the GHSA-fc5q-39xc-vjpf exception',
  );
  assert.ok(
    !versions.every((v) => atLeast(v, [4, 0, 8])),
    `every locked picomatch 4.x (${versions.join(', ')}) is >=4.0.8: remove the GHSA-fc5q-39xc-vjpf exception from pnpm-workspace.yaml and KI-63`,
  );
});

test('the exception expires after 2026-12-31', () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(
    today <= EXPIRES,
    `the GHSA-fc5q-39xc-vjpf exception expired on ${EXPIRES}: re-check upstream for picomatch 4.0.8 and renew or remove it (KI-63)`,
  );
});
