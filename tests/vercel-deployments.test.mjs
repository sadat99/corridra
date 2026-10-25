import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Owner decision of 25 October 2026: no previews. Only `main` deploys (to production); no branch or pull
// request builds. Vercel's `git.deploymentEnabled` takes branch patterns (minimatch), and a branch that matches
// several rules deploys when at least one of them is true. So "**" (every branch, slashes included) is off and
// "main" is on; a branch that needs one preview adds its own true rule on that branch.
const config = JSON.parse(readFileSync('apps/web/vercel.json', 'utf8'));

test('every branch is off and main is on', () => {
  assert.deepEqual(config.git.deploymentEnabled, { '**': false, main: true });
});

test('no other rule can turn a branch back on in the shared file', () => {
  const on = Object.entries(config.git.deploymentEnabled).filter(([, enabled]) => enabled);
  assert.deepEqual(on, [['main', true]]);
});

test('the rest of the deployment settings are unchanged', () => {
  assert.equal(config.framework, 'nextjs');
  assert.equal(config.installCommand, 'pnpm install --frozen-lockfile');
  assert.equal(config.buildCommand, 'pnpm build');
  assert.deepEqual(config.regions, ['fra1']);
});
