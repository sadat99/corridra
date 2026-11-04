import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import {
  bindingMeaning,
  bindingStates,
  checkBindings,
  coverageReport,
  createWorkspace,
  findTestTitles,
  formatReport,
  gateNames,
  loadShards,
  run,
  seedBindings,
  seedDrift,
  shardPath,
  type Binding,
  type Shard,
  type Workspace,
} from '../../scripts/requirement-bindings';

// GAP-032 slice 1: requirement-to-evidence bindings. A binding is a pointer to evidence that exists at HEAD.
// Nothing here treats a binding as acceptance. Mutation tests run in memory against injected file stubs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const real = createWorkspace(root);
const requirements = JSON.parse(real.readText('docs/v3/phase-0/requirements.json')) as {
  id: string;
  section: string;
  requirement: string;
  status: string;
}[];
const manifest = JSON.parse(real.readText('docs/v3/history/manifest.json')) as {
  requirementIdentitySha256: string;
};
const committed = loadShards(real) as Shard[];
const clone = <T>(value: T): T => structuredClone(value);

// A workspace that answers from `files` first (a null value means the file does not exist) and from disk otherwise.
function overlay(files: Record<string, string | null>): Workspace {
  return {
    exists: (path) => (path in files ? files[path] !== null : real.exists(path)),
    readText: (path) => {
      if (path in files) {
        const text = files[path];
        if (text === null) throw new Error('missing ' + path);
        return text;
      }
      return real.readText(path);
    },
  };
}

const samplePath = 'tests/integration/synthetic-binding-sample.test.ts';
const sampleSource = [
  "import { expect, test } from 'vitest';",
  "test('synthetic behaviour is allowed', () => { expect(1).toBe(1); });",
  "test('synthetic denial is refused', () => { expect(2).toBe(2); });",
  '',
].join('\n');
const reviewed = { reviewedBy: 'tester (unreviewed by product)', reviewedOn: '2026-11-04' };
const testItem = (axis: 'positive' | 'denial' | 'recovery', title: string, path = samplePath) =>
  ({ kind: 'TEST', axis, path, title, assertion: 'Asserts ' + title, ...reviewed }) as const;
const boundSample = (id: string, extra: Partial<Binding> = {}): Binding => ({
  id,
  state: 'BOUND',
  gate: null,
  candidates: [],
  evidence: [
    testItem('positive', 'synthetic behaviour is allowed'),
    testItem('denial', 'synthetic denial is refused'),
  ],
  ...extra,
});

const sampleId = 'V3-00-001';
function withBinding(shards: Shard[], id: string, binding: Binding | null): Shard[] {
  const next = clone(shards);
  for (const shard of next) {
    const at = shard.bindings.findIndex((b) => b.id === id);
    if (at >= 0) {
      if (binding) shard.bindings[at] = binding;
      else shard.bindings.splice(at, 1);
    }
  }
  return next;
}
const sampleWorkspace = overlay({ [samplePath]: sampleSource });
const sampleShards = (binding: Binding = boundSample(sampleId)) =>
  withBinding(committed, sampleId, binding);
const problemsFor = (shards: unknown[], workspace: Workspace = sampleWorkspace) =>
  checkBindings(shards, workspace);
function expectProblem(problems: string[], rule: string, fragment: string) {
  const hit = problems.find((p) => p.startsWith(rule + ' ') && p.includes(fragment));
  expect(
    hit,
    'expected ' + rule + ' problem containing "' + fragment + '" in ' + problems.join(' | '),
  ).toBeDefined();
}

test('the committed shards pass every rule against HEAD', () => {
  expect(checkBindings(committed, real)).toEqual([]);
});

test('shard ids equal the 507 ids of requirements.json in order across ten sections', () => {
  expect(requirements).toHaveLength(507);
  expect(committed).toHaveLength(10);
  expect(committed.map((s) => s.section)).toEqual([
    '00',
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
  ]);
  expect(committed.flatMap((s) => s.bindings.map((b) => b.id))).toEqual(
    requirements.map((r) => r.id),
  );
  for (const shard of committed)
    for (const binding of shard.bindings)
      expect(binding.id.split('-')[1], binding.id).toBe(shard.section);
});

test('every shard carries the manifest identity hash and the unaltered meaning sentence', () => {
  expect(bindingMeaning).toBe(
    'A binding is a pointer to evidence that exists at HEAD. It is not acceptance.',
  );
  for (const shard of committed) {
    expect(shard.identitySha256).toBe(manifest.requirementIdentitySha256);
    expect(shard.meaning).toBe(bindingMeaning);
    expect(shard.schemaVersion).toBe(1);
  }
});

test('the report sums to 507 and shows twelve GATED and two DEFERRED rows', () => {
  const report = coverageReport(committed, requirements);
  expect(report.total).toBe(507);
  expect(report.bound.total + report.none + report.gated + report.deferred).toBe(507);
  expect(report.gated).toBe(12);
  expect(report.deferred).toBe(2);
  expect(report.sumMatches).toBe(true);
  expect(report.sections.reduce((n, s) => n + s.total, 0)).toBe(507);
  const text = formatReport(report);
  expect(text).toContain('Total requirements: 507');
  expect(text.trimEnd().endsWith('No requirement is reported ACCEPTED by this file.')).toBe(true);
  expect(formatReport(coverageReport(committed, requirements))).toBe(text);
  expect(JSON.parse(JSON.stringify(report))).toEqual(report);
});

test('GATED and DEFERRED rows follow the status in requirements.json exactly', () => {
  const state = new Map(committed.flatMap((s) => s.bindings.map((b) => [b.id, b.state] as const)));
  const gated = requirements.filter((r) => r.status === 'GATED').map((r) => r.id);
  expect(gated).toEqual([
    'V3-06-008',
    'V3-06-009',
    ...Array.from({ length: 10 }, (_, i) => 'V3-09-0' + (41 + i)),
  ]);
  for (const id of gated) expect(state.get(id), id).toBe('GATED');
  for (const id of ['V3-06-015', 'V3-06-016']) expect(state.get(id), id).toBe('DEFERRED');
  for (const [id, s] of state) if (s === 'GATED') expect(gated, id).toContain(id);
  expect([...state.values()].every((s) => (bindingStates as readonly string[]).includes(s))).toBe(
    true,
  );
});

test('seed reproduces every committed NONE, GATED, DEFERRED and candidate field and drifts on nothing', () => {
  expect(seedDrift(committed, real)).toEqual([]);
  const fresh = seedBindings(real, []);
  const freshById = new Map(fresh.flatMap((s) => s.bindings.map((b) => [b.id, b] as const)));
  for (const shard of committed)
    for (const binding of shard.bindings) {
      const regenerated = freshById.get(binding.id)!;
      expect(binding.candidates, binding.id).toEqual(regenerated.candidates);
      if (binding.state !== 'BOUND') expect(binding, binding.id).toEqual(regenerated);
    }
  for (const shard of fresh) expect(shard.bindings.every((b) => b.state !== 'BOUND')).toBe(true);
});

test('seed is deterministic and idempotent, and keeps BOUND entries untouched', () => {
  const shards = sampleShards();
  const once = seedBindings(sampleWorkspace, shards);
  const twice = seedBindings(sampleWorkspace, once);
  expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  expect(JSON.stringify(seedBindings(real, []))).toBe(JSON.stringify(seedBindings(real, [])));
  const kept = once.flatMap((s) => s.bindings).find((b) => b.id === sampleId)!;
  expect(kept.state).toBe('BOUND');
  expect(kept.evidence).toEqual(boundSample(sampleId).evidence);
  expect(checkBindings(once, sampleWorkspace)).toEqual([]);
});

test('seed --check reports edited derived content, a status flip and a missing shard', () => {
  const edited = clone(committed);
  const none = edited[2].bindings.find((b) => b.state === 'NONE' && b.candidates.length === 0)!;
  none.candidates = ['tests/integration/customer-companies.test.ts'];
  expect(seedDrift(edited, real)).toEqual([none.id + ': differs from regeneration']);
  const flipped = clone(committed);
  const gated = flipped[6].bindings.find((b) => b.state === 'GATED')!;
  gated.state = 'NONE';
  expect(seedDrift(flipped, real)).toEqual([gated.id + ': differs from regeneration']);
  expect(seedDrift(committed.slice(0, 9), real)).toEqual(['section 09: shard is missing']);
  const stray = clone(committed);
  stray[0].identitySha256 = '0'.repeat(64);
  expect(seedDrift(stray, real)).toEqual(['section 00: shard header differs']);
  const reworded = clone(committed);
  reworded[1].meaning = 'A binding proves acceptance.';
  expect(seedDrift(reworded, real)).toEqual(['section 01: shard header differs']);
});

test('the command line exits 0 for check, report and seed --check at HEAD and non-zero when a shard is wrong', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    for (const args of [['check'], ['report'], ['report', '--json'], ['seed', '--check']])
      expect(run(args, real, root), args.join(' ')).toBe(0);
    const printed = JSON.parse(String(log.mock.calls[log.mock.calls.length - 2][0]));
    expect(printed.total).toBe(507);
    const tampered = overlay({
      [shardPath('00')]: JSON.stringify({ ...committed[0], identitySha256: '0'.repeat(64) }),
    });
    expect(run(['check'], tampered, root)).toBe(1);
    const emptied = overlay({
      [shardPath('00')]: JSON.stringify({ ...committed[0], bindings: [] }),
    });
    expect(run(['seed', '--check'], emptied, root)).toBe(1);
    expect(run(['nonsense'], real, root)).toBe(2);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});

test('seed never keeps a BOUND entry for a requirement whose status is GATED or DEFERRED', () => {
  const shards = withBinding(committed, 'V3-06-015', boundSample('V3-06-015'));
  const seeded = seedBindings(sampleWorkspace, shards);
  const row = seeded.flatMap((s) => s.bindings).find((b) => b.id === 'V3-06-015')!;
  expect(row.state).toBe('DEFERRED');
  expect(row.evidence).toEqual([]);
});

test('every pilot BOUND title is found exactly once as a runnable string-literal test in its file', () => {
  const bound = committed.flatMap((s) => s.bindings).filter((b) => b.state === 'BOUND');
  for (const binding of bound)
    for (const item of binding.evidence) {
      if (item.kind !== 'TEST') continue;
      const hits = findTestTitles(real.readText(item.path)).calls.filter(
        (c) => c.title === item.title,
      );
      expect(hits, binding.id + ' ' + item.title).toHaveLength(1);
      expect(hits[0].problem, binding.id + ' ' + item.title).toBeNull();
    }
});

test('bound rows come from at least three sections and every one has a positive item and a denial item or a reason', () => {
  const bound = committed.flatMap((s) => s.bindings).filter((b) => b.state === 'BOUND');
  expect(new Set(bound.map((b) => b.id.split('-')[1])).size).toBeGreaterThanOrEqual(3);
  for (const binding of bound) {
    expect(
      binding.evidence.some((e) => e.axis === 'positive'),
      binding.id,
    ).toBe(true);
    expect(
      binding.evidence.some((e) => e.axis === 'denial') || Boolean(binding.denialNotApplicable),
      binding.id,
    ).toBe(true);
  }
});

test('the JSON schema file lists the same states, gates and meaning sentence as the checker', () => {
  const schema = JSON.parse(real.readText('docs/v3/phase-0/requirement-bindings.schema.json'));
  const text = JSON.stringify(schema);
  for (const name of [...bindingStates, ...gateNames])
    expect(text, name).toContain('"' + name + '"');
  expect(text).toContain(bindingMeaning);
  expect(schema.properties.schemaVersion.const).toBe(1);
});

test('the synthetic control binding passes before any mutation', () => {
  expect(problemsFor(sampleShards())).toEqual([]);
});

test('a missing requirement id is refused', () => {
  const problems = problemsFor(withBinding(committed, 'V3-00-002', null));
  expectProblem(problems, 'R1', 'V3-00-002');
  expectProblem(problems, 'R1', 'missing');
});

test('a duplicate id is refused', () => {
  const shards = clone(committed);
  shards[0].bindings.push(clone(shards[0].bindings[0]));
  expectProblem(problemsFor(shards), 'R1', 'duplicate');
});

test('an unknown id is refused', () => {
  const shards = clone(committed);
  shards[0].bindings.push({ ...clone(shards[0].bindings[0]), id: 'V3-00-999' });
  expectProblem(problemsFor(shards), 'R1', 'V3-00-999');
});

test('an id filed under the wrong section is refused', () => {
  const shards = clone(committed);
  const moved = shards[0].bindings.pop()!;
  shards[1].bindings.push(moved);
  const problems = problemsFor(shards);
  expectProblem(
    problems,
    'R1',
    moved.id + ': belongs to section 00 but is filed in the section 01',
  );
  expectProblem(problems, 'R1', moved.id + ': missing from the section 00 shard');
});

test('a missing shard is refused', () => {
  expectProblem(problemsFor(committed.slice(0, 9)), 'R1', 'section 09');
});

test('a tampered identity hash is refused in every shard', () => {
  const shards = clone(committed);
  shards[3].identitySha256 = '0'.repeat(64);
  expectProblem(problemsFor(shards), 'R1', 'identitySha256');
});

test('an altered meaning constant is refused', () => {
  const shards = clone(committed);
  shards[2].meaning = 'A binding proves acceptance.';
  expectProblem(problemsFor(shards), 'R1', 'meaning');
});

test('an unknown property or malformed field is refused by the structure check', () => {
  const shards = clone(committed) as unknown as Record<string, unknown>[];
  (shards[0].bindings as Record<string, unknown>[])[0].accepted = true;
  expectProblem(problemsFor(shards), 'R0', 'accepted');
});

test('evidence pointing at a file that does not exist is refused', () => {
  const missing = boundSample(sampleId, {
    evidence: [
      testItem('positive', 'synthetic behaviour is allowed', 'tests/integration/not-there.test.ts'),
      testItem('denial', 'synthetic denial is refused', 'tests/integration/not-there.test.ts'),
    ],
  });
  expectProblem(problemsFor(sampleShards(missing)), 'R4', 'does not exist');
});

test('evidence outside tests and receipt locations is refused', () => {
  for (const path of ['docs/v3/phase-0/baseline.json', 'tests/../package.json', '/etc/passwd']) {
    const outside = boundSample(sampleId, {
      evidence: [
        testItem('positive', 'synthetic behaviour is allowed', path),
        testItem('denial', 'synthetic denial is refused'),
      ],
    });
    expectProblem(
      problemsFor(sampleShards(outside)),
      'R3',
      'TEST evidence path ' + path + ' must be under tests/',
    );
  }
});

test('a title that is not in the file is refused', () => {
  const wrong = boundSample(sampleId, {
    evidence: [
      testItem('positive', 'synthetic behaviour is allowed'),
      testItem('denial', 'a denial title nobody wrote'),
    ],
  });
  expectProblem(problemsFor(sampleShards(wrong)), 'R4', 'not found');
});

test('a title under test.skip, describe.skip, fixme or todo is refused', () => {
  for (const modifier of ['test.skip', 'test.fixme', 'test.todo', 'it.skip', 'xit', 'test.only']) {
    const source = sampleSource.replace("test('synthetic denial", modifier + "('synthetic denial");
    const problems = problemsFor(sampleShards(), overlay({ [samplePath]: source }));
    expectProblem(problems, 'R4', 'synthetic denial is refused');
  }
  const suite = [
    "import { expect, test } from 'vitest';",
    "test('synthetic behaviour is allowed', () => { expect(1).toBe(1); });",
    "test.describe.skip('group', () => {",
    "  test('synthetic denial is refused', () => { expect(2).toBe(2); });",
    '});',
    '',
  ].join('\n');
  expectProblem(problemsFor(sampleShards(), overlay({ [samplePath]: suite })), 'R4', 'skipped');
});

test('an ambiguous duplicated title is refused', () => {
  const doubled =
    sampleSource + "test('synthetic denial is refused', () => { expect(3).toBe(3); });\n";
  expectProblem(
    problemsFor(sampleShards(), overlay({ [samplePath]: doubled })),
    'R4',
    'more than once',
  );
});

test('a template-literal or loop-generated title is refused', () => {
  const template = sampleSource.replace(
    "test('synthetic denial is refused'",
    'test(`synthetic denial is refused`',
  );
  expectProblem(problemsFor(sampleShards(), overlay({ [samplePath]: template })), 'R4', 'template');
  const looped = sampleSource.replace(
    "test('synthetic denial is refused', () => { expect(2).toBe(2); });",
    "for (const n of [1, 2]) test('synthetic denial is refused', () => { expect(n).toBe(n); });",
  );
  expectProblem(problemsFor(sampleShards(), overlay({ [samplePath]: looped })), 'R4', 'loop');
});

test('a test in a directory that no CI suite runs is refused', () => {
  const stray = 'tests/misc/synthetic-binding-sample.test.ts';
  const binding = boundSample(sampleId, {
    evidence: [
      testItem('positive', 'synthetic behaviour is allowed', stray),
      testItem('denial', 'synthetic denial is refused', stray),
    ],
  });
  const workspace = overlay({ [stray]: sampleSource });
  expectProblem(problemsFor(sampleShards(binding), workspace), 'R4', 'no CI suite');
  const wrongSuffix = 'tests/integration/synthetic-binding-sample.ts';
  const helper = boundSample(sampleId, {
    evidence: [
      testItem('positive', 'synthetic behaviour is allowed', wrongSuffix),
      testItem('denial', 'synthetic denial is refused', wrongSuffix),
    ],
  });
  expectProblem(
    problemsFor(sampleShards(helper), overlay({ [wrongSuffix]: sampleSource })),
    'R4',
    'no CI suite',
  );
});

test('a Playwright spec under a configured test directory and a named docs test are accepted as CI suites', () => {
  const spec = 'tests/operator/synthetic-binding-sample.spec.ts';
  const doc = 'tests/synthetic-binding-sample.test.mjs';
  const packageText = real
    .readText('package.json')
    .replace('node --test ', 'node --test ' + doc + ' ');
  for (const path of [spec, doc]) {
    const binding = boundSample(sampleId, {
      evidence: [
        testItem('positive', 'synthetic behaviour is allowed', path),
        testItem('denial', 'synthetic denial is refused', path),
      ],
    });
    const workspace = overlay({ [path]: sampleSource, 'package.json': packageText });
    expect(problemsFor(sampleShards(binding), workspace), path).toEqual([]);
  }
});

const receiptPath = 'docs/v3/phase-3/synthetic-release.json';
const receiptItem = (overrides: Record<string, unknown> = {}) => ({
  kind: 'RECEIPT' as const,
  axis: 'positive' as const,
  path: receiptPath,
  headPointer: '/testedHead',
  resultPointer: '/ci/result',
  expect: 'success' as const,
  assertion: 'The recorded CI result was success for the recorded head.',
  ...reviewed,
  ...overrides,
});
const receiptBinding = (overrides: Record<string, unknown> = {}) =>
  boundSample(sampleId, {
    evidence: [receiptItem(overrides), testItem('denial', 'synthetic denial is refused')],
  } as Partial<Binding>);
const receiptText = (body: unknown) => JSON.stringify(body);
const goodReceipt = { testedHead: 'a'.repeat(40), ci: { result: 'success', exit: 0 } };
const receiptWorkspace = (body: unknown) =>
  overlay({ [samplePath]: sampleSource, [receiptPath]: receiptText(body) });

test('a receipt whose pointers resolve to a hex head and the expected result is accepted', () => {
  expect(problemsFor(sampleShards(receiptBinding()), receiptWorkspace(goodReceipt))).toEqual([]);
  const exitZero = receiptBinding({ resultPointer: '/ci/exit', expect: 0 });
  expect(problemsFor(sampleShards(exitZero), receiptWorkspace(goodReceipt))).toEqual([]);
});

test('a receipt pointer that does not resolve is refused', () => {
  const problems = problemsFor(
    sampleShards(receiptBinding({ resultPointer: '/ci/missing' })),
    receiptWorkspace(goodReceipt),
  );
  expectProblem(problems, 'R5', 'does not resolve');
});

test('a receipt whose result is pending or different from the expectation is refused', () => {
  const pending = { testedHead: 'a'.repeat(40), ci: { result: 'pending' } };
  expectProblem(
    problemsFor(sampleShards(receiptBinding()), receiptWorkspace(pending)),
    'R5',
    'expected',
  );
  const failed = { testedHead: 'a'.repeat(40), ci: { result: 'failure' } };
  expectProblem(
    problemsFor(sampleShards(receiptBinding()), receiptWorkspace(failed)),
    'R5',
    'expected',
  );
  const nonZero = { testedHead: 'a'.repeat(40), ci: { exit: 1 } };
  const exit = receiptBinding({ resultPointer: '/ci/exit', expect: 0 });
  expectProblem(problemsFor(sampleShards(exit), receiptWorkspace(nonZero)), 'R5', 'expected');
});

test('a receipt whose head is not a hexadecimal commit id is refused', () => {
  for (const head of ['not-a-sha', 'ABCDEF1234567', 'abc12', 12345])
    expectProblem(
      problemsFor(
        sampleShards(receiptBinding()),
        receiptWorkspace({ testedHead: head, ci: { result: 'success' } }),
      ),
      'R5',
      'head',
    );
});

test('a receipt outside the allowed receipt locations or that is not JSON is refused', () => {
  const elsewhere = receiptBinding({ path: 'docs/agents/work-log.md' });
  expectProblem(
    problemsFor(sampleShards(elsewhere), receiptWorkspace(goodReceipt)),
    'R3',
    'receipt',
  );
  const broken = overlay({ [samplePath]: sampleSource, [receiptPath]: '{ not json' });
  expectProblem(problemsFor(sampleShards(receiptBinding()), broken), 'R5', 'JSON');
});

test('a GATED requirement bound as BOUND is refused', () => {
  const shards = withBinding(committed, 'V3-06-008', boundSample('V3-06-008'));
  expectProblem(problemsFor(shards), 'R3', 'must stay GATED');
});

test('a DEFERRED requirement bound as BOUND is refused', () => {
  const shards = withBinding(committed, 'V3-06-016', boundSample('V3-06-016'));
  expectProblem(problemsFor(shards), 'R3', 'must stay DEFERRED');
});

test('a binding that names a gate can never be BOUND', () => {
  for (const gate of ['D03', 'REAL_PAYMENT', 'OUTREACH'] as const)
    expectProblem(problemsFor(sampleShards(boundSample(sampleId, { gate }))), 'R3', 'gate');
  expect(gateNames).toContain('D03');
});

test('a NONE, GATED or DEFERRED row that carries evidence is refused', () => {
  const none = boundSample(sampleId, { state: 'NONE', reason: 'Not yet bound' });
  expectProblem(problemsFor(sampleShards(none)), 'R2', 'evidence');
});

test('a NONE row with an empty reason is refused', () => {
  for (const reason of ['', '   ', undefined]) {
    const none: Binding = { id: sampleId, state: 'NONE', gate: null, candidates: [], evidence: [] };
    if (reason !== undefined) none.reason = reason;
    expectProblem(problemsFor(sampleShards(none)), 'R2', 'reason');
  }
});

test('a BOUND row without evidence is refused', () => {
  const empty = boundSample(sampleId, { evidence: [] });
  expectProblem(problemsFor(sampleShards(empty)), 'R2', 'at least one evidence item');
});

test('a BOUND row without a positive item is refused', () => {
  const denialOnly = boundSample(sampleId, {
    evidence: [testItem('denial', 'synthetic denial is refused')],
  });
  expectProblem(problemsFor(sampleShards(denialOnly)), 'R2', 'positive');
});

test('a BOUND row with neither a denial item nor a reason why denial does not apply is refused', () => {
  const positiveOnly = boundSample(sampleId, {
    evidence: [testItem('positive', 'synthetic behaviour is allowed')],
  });
  expectProblem(problemsFor(sampleShards(positiveOnly)), 'R2', 'denial');
  const explained = boundSample(sampleId, {
    evidence: [testItem('positive', 'synthetic behaviour is allowed')],
    denialNotApplicable: 'The requirement lists content only and states no refusal behaviour.',
  });
  expect(problemsFor(sampleShards(explained))).toEqual([]);
  const blank = { ...explained, denialNotApplicable: '  ' };
  expectProblem(problemsFor(sampleShards(blank)), 'R2', 'denial');
});

test('a BOUND row whose requirement text mentions a closed gate needs an explicit NOT_GATED review', () => {
  const keywordId = requirements.find(
    (r) => /payment/i.test(r.requirement) && r.status !== 'GATED' && r.status !== 'DEFERRED',
  )!.id;
  const guarded = withBinding(committed, keywordId, boundSample(keywordId));
  expectProblem(problemsFor(guarded), 'R3', 'NOT_GATED');
  const reviewedRow = boundSample(keywordId, {
    gateReview: 'NOT_GATED',
    reason: 'Reviewed: the text names a ledger label, not a live provider.',
  });
  expect(problemsFor(withBinding(committed, keywordId, reviewedRow))).toEqual([]);
  const noReason = boundSample(keywordId, { gateReview: 'NOT_GATED' });
  expectProblem(problemsFor(withBinding(committed, keywordId, noReason)), 'R3', 'reason');
  const report = coverageReport(withBinding(committed, keywordId, reviewedRow), requirements);
  expect(report.keywordSuspect.bound).toContain(keywordId);
});

test('a candidate that is not on disk is refused', () => {
  const shards = clone(committed);
  shards[0].bindings[0].candidates = ['tests/integration/never-existed.test.ts'];
  expectProblem(problemsFor(shards), 'R6', 'never-existed');
});

test('duplicate evidence items in one binding are refused', () => {
  const item = testItem('positive', 'synthetic behaviour is allowed');
  const doubled = boundSample(sampleId, {
    evidence: [
      item,
      { ...item, assertion: 'Asserts it again' },
      testItem('denial', 'synthetic denial is refused'),
    ],
  });
  expectProblem(problemsFor(sampleShards(doubled)), 'R7', 'duplicate');
});

test('a binding downgraded to NONE with a reason passes and is counted as NONE', () => {
  const downgraded: Binding = {
    id: sampleId,
    state: 'NONE',
    reason: 'The bound test was removed in a later change.',
    gate: null,
    candidates: [],
    evidence: [],
  };
  expect(problemsFor(sampleShards(downgraded))).toEqual([]);
  const report = coverageReport(sampleShards(downgraded), requirements);
  expect(report.bound.total).toBe(coverageReport(committed, requirements).bound.total);
  expect(report.none + report.bound.total + report.gated + report.deferred).toBe(507);
});

test('mutating the title of one real pilot binding makes the check fail', () => {
  const pilot = committed.flatMap((s) => s.bindings).find((b) => b.state === 'BOUND');
  expect(pilot, 'the pilot has at least one BOUND row').toBeDefined();
  const shards = clone(committed);
  const row = shards.flatMap((s) => s.bindings).find((b) => b.id === pilot!.id)!;
  const item = row.evidence.find((e) => e.kind === 'TEST')!;
  expect(item.kind).toBe('TEST');
  if (item.kind === 'TEST') item.title = item.title + ' (renamed)';
  expectProblem(checkBindings(shards, real), 'R4', pilot!.id);
  expect(checkBindings(committed, real)).toEqual([]);
});

test('the title scanner accepts plain string titles in test, it, describe and test.describe calls', () => {
  const source = [
    "import { describe, expect, it, test } from 'vitest';",
    "test('plain title', () => {});",
    'it("double quoted title", () => {});',
    "describe('a group', () => { it('inside a group', () => {}); });",
    "test.describe('playwright group', () => { test('inside playwright', async ({ page }) => {}); });",
    "test.describe.serial('serial group', () => {});",
    "test('escaped \\'quote\\' title', () => {});",
    "// test('commented out', () => {});",
    'const text = "test(\'inside a string\', () => {})";',
    '',
  ].join('\n');
  const scan = findTestTitles(source);
  expect(scan.balanced).toBe(true);
  expect(scan.calls.map((c) => c.title)).toEqual([
    'plain title',
    'double quoted title',
    'a group',
    'inside a group',
    'playwright group',
    'inside playwright',
    'serial group',
    "escaped 'quote' title",
  ]);
  expect(scan.calls.every((c) => c.problem === null)).toBe(true);
});

test('the title scanner marks skipped, conditional, generated and non-literal titles as not runnable', () => {
  const source = [
    "test.skip('skipped one', () => {});",
    "test.fixme('fixme one', () => {});",
    "test.todo('todo one');",
    "xit('x one', () => {});",
    'test(`template one`, () => {});',
    'test(`template ${1} two`, () => {});',
    "test('joined ' + 1 + ' title', () => {});",
    "[1, 2].forEach((n) => { test('each one', () => {}); });",
    "for (const n of [1]) { test('for block one', () => {}); }",
    "for (const n of [1]) test('for statement one', () => {});",
    "if (process.env.X) test('conditional one', () => {});",
    "describe.skip('skipped group', () => { it('inside skipped', () => {}); });",
    "test('conditionally skipped inside', ({ page }) => { test.skip(!page, 'no page'); });",
    "test('fine one', () => {});",
    '',
  ].join('\n');
  const scan = findTestTitles(source);
  expect(scan.balanced).toBe(true);
  const byTitle = new Map(scan.calls.map((c) => [c.title, c] as const));
  for (const title of [
    'skipped one',
    'fixme one',
    'todo one',
    'x one',
    'template one',
    'joined ',
    'each one',
    'for block one',
    'for statement one',
    'conditional one',
    'inside skipped',
    'conditionally skipped inside',
  ])
    expect(byTitle.get(title)?.problem, title).toEqual(expect.any(String));
  expect(byTitle.get('template ${1} two')?.problem).toEqual(expect.any(String));
  expect(byTitle.get('fine one')?.problem).toBeNull();
});

test('the title scanner reports unbalanced source instead of guessing', () => {
  expect(findTestTitles("test('open', () => {").balanced).toBe(false);
});

test('regular expressions and strings with brackets do not confuse the title scanner', () => {
  const source = [
    'const pattern = /\\)\\{[a-z]+/;',
    "const text = '}{)(';",
    "test('after tricky tokens', () => { expect(pattern.test(text)).toBe(false); });",
    '',
  ].join('\n');
  const scan = findTestTitles(source);
  expect(scan.balanced).toBe(true);
  expect(scan.calls.map((c) => [c.title, c.problem])).toEqual([['after tricky tokens', null]]);
});
