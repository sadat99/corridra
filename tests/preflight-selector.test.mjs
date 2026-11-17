import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { selectOperatorSpecs } from '../scripts/preflight.mjs';

// preflight picks the operator specs a change can affect by the changed file's name. Names of four
// characters or fewer were dropped, so apps/web/components/mr/road.tsx never selected the spec that
// renders <Road>. Short names now match as whole words.
const dir = 'tests/operator';
const read = (spec) => readFileSync(`${dir}/${spec}`, 'utf8');

test('a change to a short-named component selects the spec that renders it', () => {
  const picked = selectOperatorSpecs(
    ['apps/web/components/mr/road.tsx'],
    ['ux-view-as-samples.spec.ts', 'workspace.spec.ts'],
    read,
  );
  assert.ok(picked.includes(`${dir}/ux-view-as-samples.spec.ts`), picked.join(', '));
});

test('short names match whole words only', () => {
  const specs = { 'a.spec.ts': 'the broad railroad', 'b.spec.ts': 'class mr-road here' };
  const picked = selectOperatorSpecs(['apps/web/x/road.tsx'], Object.keys(specs), (s) => specs[s]);
  assert.deepEqual(picked, [`${dir}/b.spec.ts`]);
});

test('generic names stay excluded', () => {
  const picked = selectOperatorSpecs(
    ['apps/web/app/page.tsx', 'apps/web/src/index.ts'],
    ['a.spec.ts'],
    () => 'page route layout index app src',
  );
  assert.deepEqual(picked, []);
});
