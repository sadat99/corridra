import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const manifest = JSON.parse(
  await readFile(new URL('../docs/source/manifest.json', import.meta.url)),
);
const root = new URL('../', import.meta.url);

test('developer handoff matrix points to real implementation, tests and decisions', async () => {
  const matrix = JSON.parse(
    await readFile(new URL('docs/implementation/implementation-matrix.json', root), 'utf8'),
  );
  assert.match(matrix.baselineCommit, /^[a-f0-9]{40}$/);
  assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length);
  for (const programme of ['V1', 'V2', 'UX10X', 'ACCESS', 'CROSS_CUTTING']) {
    assert.ok(
      matrix.rows.some((row) => row.programme === programme),
      programme,
    );
  }
  for (const row of matrix.rows) {
    assert.ok(row.requirement && row.status && row.limits, row.id);
    assert.ok(row.code.length && row.tests.length && row.decisions.length, row.id);
    assert.ok(row.pullRequests.every((number) => Number.isInteger(number) && number > 0));
    for (const path of [...row.code, ...row.tests, ...row.decisions]) {
      assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), path);
      assert.ok((await stat(new URL(path, root))).isFile(), `${row.id}: ${path}`);
    }
  }
  for (const path of [
    matrix.authority,
    ...matrix.historicalPlans,
    matrix.completeUXSpecification,
  ]) {
    assert.ok((await stat(new URL(path, root))).isFile(), path);
  }
  const ledger = JSON.parse(await readFile(new URL(matrix.coverageLedger, root), 'utf8'));
  const counts = {};
  for (const record of ledger.records)
    counts[record.preservation] = (counts[record.preservation] ?? 0) + 1;
  const plan = await readFile(new URL(matrix.authority, root), 'utf8');
  for (const [status, count] of Object.entries(counts)) {
    assert.ok(plan.includes(`${count} ${status}`), `current plan matches ledger: ${status}`);
  }
});

test('documentation catalogue covers every Markdown document without duplicate or missing files', async () => {
  const catalogue = JSON.parse(
    await readFile(new URL('docs/documentation-map.json', root), 'utf8'),
  );
  const found = [];
  async function discover(directory) {
    for (const entry of await readdir(new URL(`${directory}/`, root), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await discover(path);
      else if (entry.isFile() && path.endsWith('.md')) found.push(path);
    }
  }
  await discover('docs');
  const listed = catalogue.entries.map((entry) => entry.path);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual(listed.toSorted(), found.toSorted());
  for (const entry of catalogue.entries) assert.ok(entry.classification && entry.use, entry.path);
});

test('current developer entry and operational guides have valid local document links', async () => {
  const guides = [
    'README.md',
    'CLAUDE.md',
    'docs/README.md',
    'docs/START_HERE.md',
    'docs/verification-guide.md',
    'docs/documentation-map.md',
    'docs/implementation/current-plan.md',
    'docs/implementation/v2-master-plan.md',
    'docs/adr/README.md',
    'docs/ux10x/README.md',
    'docs/runbooks/deployment.md',
    'docs/runbooks/development.md',
    'docs/runbooks/neon-auth-accounts.md',
    'docs/runbooks/v2-access-and-launch.md',
    'packages/README.md',
  ];
  for (const path of guides) {
    const url = new URL(path, root);
    const document = await readFile(url, 'utf8');
    for (const match of document.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      const destination = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(destination)) continue;
      const target = new URL(destination, url);
      target.hash = '';
      target.search = '';
      assert.ok(target.href.startsWith(root.href), `${path}: ${destination}`);
      await assert.doesNotReject(stat(target), `${path}: ${destination}`);
    }
  }
});

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
    ['06', 'docs/ux10x/ux06'],
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
