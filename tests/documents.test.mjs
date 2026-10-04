import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const manifest = JSON.parse(
  await readFile(new URL('../docs/source/manifest.json', import.meta.url)),
);
const root = new URL('../', import.meta.url);

for (const document of manifest) {
  test(`${document.id}: original upload is preserved byte for byte`, async () => {
    const source = await readFile(new URL(document.source, root));
    assert.equal(source.length, document.bytes);
    assert.equal(createHash('sha256').update(source).digest('hex'), document.sha256);
  });

  test(`${document.id}: working copy preserves all supplied content`, async () => {
    const source = (await readFile(new URL(document.source, root), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    let working = await readFile(new URL(document.working_copy, root), 'utf8');

    if (document.id === 'positioning-constitution') {
      assert.ok(
        working.includes(
          '**Must never read, sound, look copies like ai/machine-written and no em-dashes**',
        ),
      );
      const addition = /\n## Human writing and punctuation\n[\s\S]*?(?=\n## Use verbs\n)/;
      assert.equal(
        working.match(addition)?.length,
        1,
        'the requested amendment exists exactly once',
      );
      working = working.replace(addition, '');
    }

    assert.equal(working, source, 'no supplied wording was removed, rewritten or reordered');
  });
}

test('implementation plan contains 12 ordered parts and a complete canvas-packet mapping', async () => {
  const plan = await readFile(new URL('docs/implementation/plan-v1.0.md', root), 'utf8');
  const parts = [...plan.matchAll(/^## Part (\d{2}):/gm)].map((match) => Number(match[1]));
  assert.deepEqual(
    parts,
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  assert.ok(plan.includes('25 original build packets'));
  assert.ok(plan.includes('production-readiness'));
  assert.ok(!plan.includes('\u2014'), 'new plan copy contains no em dashes');
});
