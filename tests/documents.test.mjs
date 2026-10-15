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
for (const part of ['04', '05']) {
  test(`revised V2 Part ${part} owner packet retains its recorded integrity`, async () => {
    const record = JSON.parse(
      await readFile(
        new URL(`docs/implementation/v2-part-${part}-request-integrity.json`, root),
        'utf8',
      ),
    );
    const source = await readFile(new URL(record.source, root));
    assert.equal(source.length, record.bytes);
    assert.equal(createHash('sha256').update(source).digest('hex'), record.sha256);
    assert.equal(record.originalsModified, false);
  });
}

test('UX acceptance ledgers keep phase identifiers, unique records and bounded verification aligned', async () => {
  for (const [phase, directory] of [
    ['01', 'docs/ux10x'],
    ['02', 'docs/ux10x/ux02'],
    ['03', 'docs/ux10x/ux03'],
    ['04', 'docs/ux10x/ux04'],
    ['05', 'docs/ux10x/ux05'],
  ]) {
    const ledger = JSON.parse(await readFile(new URL(`${directory}/coverage.json`, root), 'utf8'));
    assert.ok(ledger.verification.scope.includes(`UX-${phase}`));
    assert.equal(new Set(ledger.records.map((record) => record.id)).size, ledger.records.length);
    const scenarios = ledger.records.filter((record) => /-SCENARIO-\d+$/.test(record.id));
    assert.equal(scenarios.length, ledger.verification.tests.length);
    scenarios.forEach((record, index) => {
      const acceptance = ledger.verification.tests[index];
      assert.equal(record.id, `UX${phase}-SCENARIO-${index + 1}`);
      assert.equal(record.baselineAction, acceptance.baseline);
      assert.equal(
        record.preservation,
        acceptance.status === 'PASS'
          ? 'VERIFIED'
          : acceptance.status === 'PARTIAL'
            ? 'PARTIAL'
            : 'NOT_YET_VERIFIED',
      );
      assert.ok(record.positiveTestIds.includes(acceptance.positive));
      assert.ok(record.negativeTestIds.includes(acceptance.negative));
    });
  }
});
