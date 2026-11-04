import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { z } from 'zod';

// GAP-032 requirement-to-evidence bindings. A binding is a pointer to evidence that exists at HEAD.
// It is not acceptance: nothing in this file reports a requirement as accepted.
//
//   pnpm exec tsx scripts/requirement-bindings.ts check
//   pnpm exec tsx scripts/requirement-bindings.ts report [--json]
//   pnpm exec tsx scripts/requirement-bindings.ts seed [--check]
//
// After `seed`, run `pnpm exec prettier --write docs/v3/phase-0/requirement-bindings`.

export const bindingMeaning =
  'A binding is a pointer to evidence that exists at HEAD. It is not acceptance.';
export const bindingStates = ['NONE', 'BOUND', 'GATED', 'DEFERRED'] as const;
export const gateNames = [
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D08',
  'REAL_PAYMENT',
  'OUTREACH',
  'AI_INFERENCE',
  'REAL_GST_BANK',
  'LIVE_IDP_MAILBOX',
  'PRODUCTION_OBSERVATION',
  'NATIVE_LANGUAGE_REVIEW',
] as const;

const shardDirectory = 'docs/v3/phase-0/requirement-bindings';
const requirementsPath = 'docs/v3/phase-0/requirements.json';
const manifestPath = 'docs/v3/history/manifest.json';
const receiptRoots = ['docs/qa/current-plan-gaps/verification/', 'docs/v3/'];
const noneReason =
  'No test title or receipt pointer bound yet; legacy evidence is file pointers, not an executed assertion';
const gatedReason =
  'requirements.json status is GATED (closed real-world gate); no evidence is bound while it stays closed';
const deferredReason = 'requirements.json status is DEFERRED; no evidence is bound';
const keywordPattern =
  /payment|payout|\bGST\b|\bbank|outreach|inference|\bIdP\b|mailbox|native[\s-]language|real customer/i;
const commitPattern = /^[0-9a-f]{7,40}$/;
const notEmpty = z.string().refine((text) => text.trim().length > 0, 'must not be empty');
const reviewFields = {
  assertion: notEmpty,
  reviewedBy: notEmpty,
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
const axisSchema = z.enum(['positive', 'denial', 'recovery']);
const evidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('TEST'),
    axis: axisSchema,
    path: notEmpty,
    title: notEmpty,
    ...reviewFields,
  }),
  z.strictObject({
    kind: z.literal('RECEIPT'),
    axis: axisSchema,
    path: notEmpty,
    headPointer: z.string(),
    resultPointer: z.string(),
    expect: z.union([z.literal('success'), z.literal(0)]),
    ...reviewFields,
  }),
]);
const bindingSchema = z.strictObject({
  id: z.string().regex(/^V3-\d{2}-\d{3}$/),
  state: z.enum(bindingStates),
  reason: z.string().optional(),
  gate: z.enum(gateNames).nullable(),
  gateReview: z.literal('NOT_GATED').optional(),
  candidates: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  denialNotApplicable: z.string().optional(),
});
const shardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  meaning: z.string(),
  identitySha256: z.string(),
  section: z.string().regex(/^\d{2}$/),
  bindings: z.array(bindingSchema),
});
const requirementsSchema = z.array(
  z.looseObject({
    id: z.string(),
    section: z.string(),
    requirement: z.string(),
    status: z.string(),
    evidence: z.array(z.string()),
  }),
);

export type Evidence = z.infer<typeof evidenceSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Shard = z.infer<typeof shardSchema>;
type Requirement = z.infer<typeof requirementsSchema>[number];

// The checker reads everything through this, so tests can inject missing or altered files.
export interface Workspace {
  exists(path: string): boolean;
  readText(path: string): string;
}

export function createWorkspace(root: string): Workspace {
  return {
    exists: (path) => existsSync(join(root, path)),
    readText: (path) => readFileSync(join(root, path), 'utf8'),
  };
}

export const shardPath = (section: string) => shardDirectory + '/section-' + section + '.json';

interface Context {
  requirements: Requirement[];
  byId: Map<string, Requirement>;
  sections: string[];
  idsBySection: Map<string, string[]>;
  identitySha256: string;
}

function loadContext(workspace: Workspace): Context {
  const requirements = requirementsSchema.parse(JSON.parse(workspace.readText(requirementsPath)));
  const manifest = z
    .looseObject({ requirementIdentitySha256: z.string() })
    .parse(JSON.parse(workspace.readText(manifestPath)));
  const idsBySection = new Map<string, string[]>();
  for (const requirement of requirements)
    idsBySection.set(requirement.section, [
      ...(idsBySection.get(requirement.section) ?? []),
      requirement.id,
    ]);
  return {
    requirements,
    byId: new Map(requirements.map((requirement) => [requirement.id, requirement])),
    sections: [...idsBySection.keys()],
    idsBySection,
    identitySha256: manifest.requirementIdentitySha256,
  };
}

export function loadShards(workspace: Workspace): unknown[] {
  const { sections } = loadContext(workspace);
  return sections
    .filter((section) => workspace.exists(shardPath(section)))
    .map((section) => JSON.parse(workspace.readText(shardPath(section))));
}

// ---------------------------------------------------------------------------------------------------------
// Title scanner: reads a test file with the TypeScript parser and lists the string-literal titles of test(, it(,
// describe( and test.describe( calls, marks which are suites and says why a title would not run. It is
// deliberately conservative: anything it cannot prove is reported, never accepted.

export interface TitleCall {
  title: string;
  literal: 'string' | 'template';
  // True for describe(...) and test.describe(...): a group, not a test case. Groups stay in the scan so that
  // skip and loop detection can see them, but they are never evidence.
  suite: boolean;
  problem: string | null;
}

interface CallShape {
  name: string;
  chain: string[];
}

const callRoots = new Set(['xit', 'xtest', 'xdescribe', 'test', 'it', 'describe']);
const plainChain = new Set(['describe', 'serial', 'parallel']);
const skipModifiers = new Set(['skip', 'fixme', 'todo', 'fail', 'only', 'skipIf']);
const runtimeSkipModifiers = new Set(['skip', 'fixme', 'fail']);
const loopMethods = new Set(['forEach', 'map', 'flatMap', 'reduce', 'filter', 'each']);

// test.describe.serial -> ['test', 'describe', 'serial']; anything that is not a plain name chain gives null.
function calleeChain(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const head = calleeChain(expression.expression);
    return head ? [...head, expression.name.text] : null;
  }
  return null;
}

function shapeOf(node: ts.CallExpression): CallShape | null {
  const chain = calleeChain(node.expression);
  if (!chain || !callRoots.has(chain[0])) return null;
  return { name: chain[0], chain: chain.slice(1) };
}

const isSuite = (shape: CallShape) =>
  shape.name.endsWith('describe') || shape.chain.includes('describe');
const hasSkipModifier = (shape: CallShape) =>
  shape.name.startsWith('x') || shape.chain.some((part) => skipModifiers.has(part));
const isTemplate = (node: ts.Node) =>
  ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
const isLiteralTitle = (node: ts.Node) => ts.isStringLiteral(node) || isTemplate(node);

// 'a' + b + 'c': a title built from an expression whose first piece is a literal.
function startsWithLiteral(node: ts.Expression): boolean {
  if (isLiteralTitle(node)) return true;
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    startsWithLiteral(node.left)
  );
}

function runtimeSkipIn(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(child)) {
      const shape = shapeOf(child);
      if (
        shape &&
        (shape.name === 'test' || shape.name === 'it') &&
        shape.chain.some((part) => runtimeSkipModifiers.has(part))
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

// A runtime test.skip(condition, ...) or test.fixme(condition, ...) written directly in a suite body (not inside
// one of its tests or hooks, and not the declaration form test.skip('title', fn)) disables every test in it.
function suiteLevelSkip(suite: ts.CallExpression): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const shape = shapeOf(node);
      const first = node.arguments[0];
      if (
        shape &&
        (shape.name === 'test' || shape.name === 'it') &&
        shape.chain.some((part) => part === 'skip' || part === 'fixme') &&
        first !== undefined &&
        !isLiteralTitle(first)
      ) {
        found = true;
        return;
      }
    }
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  };
  for (const argument of suite.arguments)
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      ts.forEachChild(argument.body, visit);
  return found;
}

function describeCall(
  source: string,
  node: ts.CallExpression,
  ancestors: ts.Node[],
): TitleCall | null {
  const shape = shapeOf(node);
  const first = node.arguments[0];
  if (!shape || first === undefined || !startsWithLiteral(first)) return null;
  const literalTitle = isLiteralTitle(first);
  const call: TitleCall = {
    title: ts.isStringLiteral(first)
      ? first.text
      : isTemplate(first)
        ? source.slice(first.getStart() + 1, first.getEnd() - 1)
        : first.getText(),
    literal: isTemplate(first) ? 'template' : 'string',
    suite: isSuite(shape),
    problem: null,
  };
  const calls = ancestors.filter(ts.isCallExpression);
  const enclosing = calls
    .map((ancestor) => ({ node: ancestor, shape: shapeOf(ancestor) }))
    .filter(
      (entry): entry is { node: ts.CallExpression; shape: CallShape } => entry.shape !== null,
    );
  const modifiers = shape.chain.filter((part) => !plainChain.has(part));
  if (isTemplate(first)) call.problem = 'it is a template literal, not a plain string';
  else if (shape.name.startsWith('x') || modifiers.length > 0)
    call.problem =
      'it is marked ' +
      (shape.name.startsWith('x') ? shape.name : modifiers.join('.')) +
      ' and is not a plain runnable test';
  else if (!literalTitle) call.problem = 'its title is built from an expression';
  else if (enclosing.some((entry) => hasSkipModifier(entry.shape)))
    call.problem = 'it sits inside a skipped suite';
  else if (
    ancestors.some(
      (ancestor) =>
        ts.isForStatement(ancestor) ||
        ts.isForInStatement(ancestor) ||
        ts.isForOfStatement(ancestor) ||
        ts.isWhileStatement(ancestor) ||
        ts.isDoStatement(ancestor),
    ) ||
    calls.some(
      (ancestor) =>
        ts.isPropertyAccessExpression(ancestor.expression) &&
        loopMethods.has(ancestor.expression.name.text),
    )
  )
    call.problem = 'it is generated in a loop or callback';
  else if (
    ancestors.some(
      (ancestor) =>
        ts.isIfStatement(ancestor) ||
        ts.isConditionalExpression(ancestor) ||
        (ts.isBinaryExpression(ancestor) &&
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(ancestor.operatorToken.kind)),
    )
  )
    call.problem = 'it is defined conditionally';
  else if (runtimeSkipIn(node))
    call.problem = 'it calls skip or fixme at run time, so it may not run';
  else if (
    !call.suite &&
    enclosing.some((entry) => isSuite(entry.shape) && suiteLevelSkip(entry.node))
  )
    call.problem = 'its enclosing suite calls skip or fixme at run time, so it may not run';
  return call;
}

export function findTestTitles(source: string): { balanced: boolean; calls: TitleCall[] } {
  const file = ts.createSourceFile(
    'scan.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const syntax = ts.transpileModule(source, {
    fileName: 'scan.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const calls: TitleCall[] = [];
  const ancestors: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const call = describeCall(source, node, ancestors);
      if (call) calls.push(call);
    }
    ancestors.push(node);
    ts.forEachChild(node, visit);
    ancestors.pop();
  };
  visit(file);
  return { balanced: (syntax.diagnostics ?? []).length === 0, calls };
}

// ---------------------------------------------------------------------------------------------------------
// CI suites: which test files a CI job actually runs, read from the same configuration the jobs use.

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('**/')
    .map((part) =>
      part
        .split('*')
        .map((chunk) => chunk.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('(?:.*/)?');
  return new RegExp('^' + body + '$');
}

const playwrightConfigs = [
  'playwright.config.ts',
  'playwright.operator.config.ts',
  'playwright.ux.config.ts',
  'playwright.verification.config.ts',
];

function suiteOf(path: string, workspace: Workspace): string | null {
  const vitest = workspace.exists('vitest.config.ts') ? workspace.readText('vitest.config.ts') : '';
  const include = /include:\s*\[([^\]]*)\]/.exec(vitest)?.[1] ?? '';
  for (const [, glob] of include.matchAll(/'([^']+)'/g))
    if (globToRegExp(glob).test(path)) return 'vitest ' + glob;
  for (const config of playwrightConfigs) {
    if (!workspace.exists(config)) continue;
    const text = workspace.readText(config);
    const directory = /testDir:\s*'(?:\.\/)?([^']+)'/.exec(text)?.[1];
    const match = /testMatch:\s*'([^']+)'/.exec(text)?.[1];
    if (!directory || !path.startsWith(directory + '/')) continue;
    if (
      match
        ? globToRegExp(match).test(path.slice(directory.length + 1))
        : /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)
    )
      return config;
  }
  if (workspace.exists('package.json')) {
    const docs = z
      .looseObject({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(workspace.readText('package.json'))).scripts['test:docs'];
    if (docs?.split(/\s+/).includes(path) && /^tests\/[^/]+\.test\.mjs$/.test(path))
      return 'test:docs';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// check

function resolvePointer(document: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer !== '' && !pointer.startsWith('/')) return { found: false };
  let value: unknown = document;
  for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key))
      return { found: false };
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}

const safePath = (path: string) => !path.startsWith('/') && !path.split('/').includes('..');
const isReceiptPath = (path: string) =>
  safePath(path) &&
  path.endsWith('.json') &&
  receiptRoots.some((root) => path.startsWith(root)) &&
  !path.startsWith(shardDirectory + '/') &&
  path !== requirementsPath;

const evidenceKey = (item: Evidence) =>
  [
    item.kind,
    item.axis,
    item.path,
    item.kind === 'TEST' ? item.title : item.headPointer + ' ' + item.resultPointer,
  ].join('|');

export function checkBindings(shardsInput: readonly unknown[], workspace: Workspace): string[] {
  const context = loadContext(workspace);
  const problems: string[] = [];
  const shards: Shard[] = [];
  const unreadable = new Set<string>();
  shardsInput.forEach((raw, index) => {
    const parsed = shardSchema.safeParse(raw);
    if (parsed.success) {
      shards.push(parsed.data);
      return;
    }
    const section = (raw as { section?: unknown } | null)?.section;
    if (typeof section === 'string') unreadable.add(section);
    for (const issue of parsed.error.issues)
      problems.push('R0 shard ' + index + ' ' + issue.path.join('.') + ': ' + issue.message);
  });
  checkCompleteness(shards, unreadable, context, problems);

  const scans = new Map<string, ReturnType<typeof findTestTitles> | null>();
  const scanOf = (path: string) => {
    if (!scans.has(path))
      scans.set(path, workspace.exists(path) ? findTestTitles(workspace.readText(path)) : null);
    return scans.get(path)!;
  };
  for (const shard of shards)
    for (const binding of shard.bindings) {
      const requirement = context.byId.get(binding.id);
      if (!requirement) continue;
      const found: string[] = [];
      checkState(binding, requirement, found);
      checkCandidates(binding, workspace, found);
      if (binding.state === 'BOUND') checkEvidence(binding, workspace, scanOf, found);
      problems.push(
        ...found.map((message) => message.replace(/^(R\d) /, '$1 ' + binding.id + ': ')),
      );
    }
  return problems;
}

function checkCompleteness(
  shards: Shard[],
  unreadable: Set<string>,
  context: Context,
  problems: string[],
) {
  const seenSections = new Set<string>();
  const seenIds = new Set<string>();
  for (const shard of shards) {
    if (seenSections.has(shard.section))
      problems.push('R1 section ' + shard.section + ': more than one shard');
    seenSections.add(shard.section);
    if (!context.idsBySection.has(shard.section))
      problems.push('R1 section ' + shard.section + ': no requirement belongs to this section');
    if (shard.identitySha256 !== context.identitySha256)
      problems.push(
        'R1 section ' +
          shard.section +
          ': identitySha256 does not equal the manifest requirementIdentitySha256',
      );
    if (shard.meaning !== bindingMeaning)
      problems.push('R1 section ' + shard.section + ': the meaning sentence was altered');
    const own: string[] = [];
    for (const binding of shard.bindings) {
      const requirement = context.byId.get(binding.id);
      if (seenIds.has(binding.id)) problems.push('R1 ' + binding.id + ': duplicate id');
      else if (!requirement) problems.push('R1 ' + binding.id + ': unknown requirement id');
      else if (requirement.section !== shard.section)
        problems.push(
          'R1 ' +
            binding.id +
            ': belongs to section ' +
            requirement.section +
            ' but is filed in the section ' +
            shard.section +
            ' shard',
        );
      else own.push(binding.id);
      seenIds.add(binding.id);
    }
    const expected = context.idsBySection.get(shard.section) ?? [];
    const filed = new Set(own);
    for (const id of expected)
      if (!filed.has(id))
        problems.push('R1 ' + id + ': missing from the section ' + shard.section + ' shard');
    if (
      own.length === expected.length &&
      own.every((id) => filed.has(id)) &&
      !isDeepStrictEqual(own, expected) &&
      new Set(own).size === own.length
    )
      problems.push('R1 section ' + shard.section + ': ids are not in requirements.json order');
  }
  for (const section of context.sections)
    if (!seenSections.has(section) && !unreadable.has(section))
      problems.push('R1 section ' + section + ': shard is missing');
  const order = shards
    .map((shard) => context.sections.indexOf(shard.section))
    .filter((at) => at >= 0);
  if (order.some((at, index) => index > 0 && at < order[index - 1]))
    problems.push('R1 shards are not in section order');
}

function checkState(binding: Binding, requirement: Requirement, found: string[]) {
  if (requirement.status === 'GATED' && binding.state !== 'GATED')
    found.push(
      'R3 requirement status is GATED but the binding is ' + binding.state + '; it must stay GATED',
    );
  if (requirement.status === 'DEFERRED' && binding.state !== 'DEFERRED')
    found.push(
      'R3 requirement status is DEFERRED but the binding is ' +
        binding.state +
        '; it must stay DEFERRED',
    );
  if (binding.state === 'GATED' && requirement.status !== 'GATED')
    found.push(
      'R3 state GATED needs requirements.json status GATED (found ' + requirement.status + ')',
    );
  if (binding.state === 'DEFERRED' && requirement.status !== 'DEFERRED')
    found.push(
      'R3 state DEFERRED needs requirements.json status DEFERRED (found ' +
        requirement.status +
        ')',
    );
  if (binding.state !== 'BOUND') {
    if (binding.evidence.length > 0)
      found.push('R2 a ' + binding.state + ' row must have empty evidence');
    if (!binding.reason?.trim())
      found.push('R2 a ' + binding.state + ' row needs a non-empty reason');
    return;
  }
  if (binding.gate !== null)
    found.push('R3 gate ' + binding.gate + ' is set, so the row can never be BOUND');
  if (
    keywordPattern.test(requirement.requirement) &&
    (binding.gateReview !== 'NOT_GATED' || !binding.reason?.trim())
  )
    found.push(
      'R3 the requirement text mentions a closed-gate keyword; BOUND needs gateReview NOT_GATED and a reason',
    );
  if (binding.evidence.length === 0) found.push('R2 a BOUND row needs at least one evidence item');
  if (!binding.evidence.some((item) => item.axis === 'positive'))
    found.push('R2 a BOUND row needs a positive evidence item');
  const hasDenial = binding.evidence.some((item) => item.axis === 'denial');
  const reason = binding.denialNotApplicable?.trim();
  if (!hasDenial && !reason)
    found.push('R2 a BOUND row needs a denial item or a denialNotApplicable reason');
  if (hasDenial && binding.denialNotApplicable !== undefined)
    found.push('R2 a row with a denial item must not also carry denialNotApplicable');
}

function checkCandidates(binding: Binding, workspace: Workspace, found: string[]) {
  for (const candidate of binding.candidates)
    if (!safePath(candidate) || !workspace.exists(candidate))
      found.push('R6 candidate ' + candidate + ' does not exist');
}

function checkEvidence(
  binding: Binding,
  workspace: Workspace,
  scanOf: (path: string) => ReturnType<typeof findTestTitles> | null,
  found: string[],
) {
  const keys = new Set<string>();
  for (const item of binding.evidence) {
    const key = evidenceKey(item);
    if (keys.has(key)) found.push('R7 duplicate evidence item ' + key);
    keys.add(key);
    if (item.kind === 'TEST') checkTest(item, workspace, scanOf, found);
    else checkReceipt(item, workspace, found);
  }
}

function checkTest(
  item: Extract<Evidence, { kind: 'TEST' }>,
  workspace: Workspace,
  scanOf: (path: string) => ReturnType<typeof findTestTitles> | null,
  found: string[],
) {
  if (!safePath(item.path) || !item.path.startsWith('tests/')) {
    found.push('R3 TEST evidence path ' + item.path + ' must be under tests/');
    return;
  }
  const scan = scanOf(item.path);
  if (!scan) {
    found.push('R4 ' + item.path + ' does not exist');
    return;
  }
  if (!suiteOf(item.path, workspace))
    found.push(
      'R4 ' + item.path + ' is in no CI suite (vitest include, Playwright testDir or test:docs)',
    );
  if (!scan.balanced) {
    found.push('R4 ' + item.path + ' could not be read reliably (unbalanced source)');
    return;
  }
  const named = scan.calls.filter((call) => call.title === item.title);
  const hits = named.filter((call) => !call.suite);
  if (hits.length === 0 && named.length > 0)
    found.push(
      'R4 title "' +
        item.title +
        '" in ' +
        item.path +
        ' names a describe suite, not a test case, so it is not evidence',
    );
  else if (hits.length === 0)
    found.push('R4 title "' + item.title + '" not found as a string-literal title in ' + item.path);
  else if (hits.length > 1)
    found.push(
      'R4 title "' +
        item.title +
        '" appears more than once in ' +
        item.path +
        ', so it is ambiguous',
    );
  else if (hits[0].problem)
    found.push(
      'R4 title "' + item.title + '" in ' + item.path + ' is not runnable: ' + hits[0].problem,
    );
}

function checkReceipt(
  item: Extract<Evidence, { kind: 'RECEIPT' }>,
  workspace: Workspace,
  found: string[],
) {
  if (!isReceiptPath(item.path)) {
    found.push(
      'R3 receipt path ' + item.path + ' must be a JSON file under ' + receiptRoots.join(' or '),
    );
    return;
  }
  if (!workspace.exists(item.path)) {
    found.push('R5 receipt ' + item.path + ' does not exist');
    return;
  }
  let document: unknown;
  try {
    document = JSON.parse(workspace.readText(item.path));
  } catch {
    found.push('R5 receipt ' + item.path + ' is not valid JSON');
    return;
  }
  const head = resolvePointer(document, item.headPointer);
  if (!head.found || typeof head.value !== 'string' || !commitPattern.test(head.value))
    found.push(
      'R5 head pointer ' +
        item.headPointer +
        ' in ' +
        item.path +
        ' does not resolve to a hexadecimal commit id (git objects are not verified offline)',
    );
  const result = resolvePointer(document, item.resultPointer);
  if (!result.found)
    found.push(
      'R5 result pointer ' + item.resultPointer + ' in ' + item.path + ' does not resolve',
    );
  else if (!isDeepStrictEqual(result.value, item.expect))
    found.push(
      'R5 result at ' +
        item.resultPointer +
        ' is ' +
        JSON.stringify(result.value) +
        ' but expected ' +
        JSON.stringify(item.expect),
    );
}

// ---------------------------------------------------------------------------------------------------------
// report

export interface CoverageReport {
  total: number;
  bound: { total: number; positiveAndDenial: number; positiveOnly: number; other: number };
  none: number;
  gated: number;
  deferred: number;
  sumMatches: boolean;
  noneWithLegacyCandidate: number;
  keywordSuspect: { total: number; bound: string[] };
  sections: {
    section: string;
    total: number;
    bound: number;
    none: number;
    gated: number;
    deferred: number;
  }[];
}

export function coverageReport(
  shards: readonly Shard[],
  requirements: readonly { id: string; requirement: string }[],
): CoverageReport {
  const text = new Map(
    requirements.map((requirement) => [requirement.id, requirement.requirement]),
  );
  const report: CoverageReport = {
    total: requirements.length,
    bound: { total: 0, positiveAndDenial: 0, positiveOnly: 0, other: 0 },
    none: 0,
    gated: 0,
    deferred: 0,
    sumMatches: false,
    noneWithLegacyCandidate: 0,
    keywordSuspect: { total: 0, bound: [] },
    sections: [],
  };
  for (const shard of shards) {
    const row = {
      section: shard.section,
      total: shard.bindings.length,
      bound: 0,
      none: 0,
      gated: 0,
      deferred: 0,
    };
    for (const binding of shard.bindings) {
      const suspect = keywordPattern.test(text.get(binding.id) ?? '');
      if (suspect) report.keywordSuspect.total++;
      if (binding.state === 'BOUND') {
        const positive = binding.evidence.some((item) => item.axis === 'positive');
        const denial = binding.evidence.some((item) => item.axis === 'denial');
        report.bound.total++;
        row.bound++;
        if (positive && denial) report.bound.positiveAndDenial++;
        else if (positive) report.bound.positiveOnly++;
        else report.bound.other++;
        if (suspect) report.keywordSuspect.bound.push(binding.id);
      } else if (binding.state === 'NONE') {
        report.none++;
        row.none++;
        if (binding.candidates.length > 0) report.noneWithLegacyCandidate++;
      } else if (binding.state === 'GATED') {
        report.gated++;
        row.gated++;
      } else {
        report.deferred++;
        row.deferred++;
      }
    }
    report.sections.push(row);
  }
  const sum = report.bound.total + report.none + report.gated + report.deferred;
  report.sumMatches =
    sum === report.total && report.sections.reduce((n, s) => n + s.total, 0) === report.total;
  return report;
}

export function formatReport(report: CoverageReport): string {
  const sum = [report.bound.total, report.none, report.gated, report.deferred];
  return (
    [
      'Requirement-to-evidence bindings report (GAP-032, first slice)',
      'Total requirements: ' + report.total,
      'BOUND: ' + report.bound.total,
      '  with positive and denial evidence: ' + report.bound.positiveAndDenial,
      '  with positive evidence and a stated reason denial does not apply: ' +
        report.bound.positiveOnly,
      '  other: ' + report.bound.other,
      'NONE: ' + report.none,
      'GATED: ' + report.gated,
      'DEFERRED: ' + report.deferred,
      'Sum check: ' +
        sum.join(' + ') +
        ' = ' +
        report.total +
        (report.sumMatches ? ' (matches)' : ' (DOES NOT MATCH)'),
      'NONE rows with a legacy candidate file (informational, never counted as evidence): ' +
        report.noneWithLegacyCandidate,
      'Keyword-suspect rows (requirement text mentions a closed-gate keyword): ' +
        report.keywordSuspect.total +
        '; BOUND among them: ' +
        (report.keywordSuspect.bound.join(', ') || 'none'),
      'Receipt head pointers are checked for shape only; git objects are not verified offline.',
      'Per section (total / BOUND / NONE / GATED / DEFERRED):',
      ...report.sections.map(
        (s) =>
          '  ' +
          [s.section + ':', s.total, '/', s.bound, '/', s.none, '/', s.gated, '/', s.deferred].join(
            ' ',
          ),
      ),
      'No requirement is reported ACCEPTED by this file.',
    ].join('\n') + '\n'
  );
}

// ---------------------------------------------------------------------------------------------------------
// seed

function canonicalBinding(binding: Binding): Binding {
  const evidence = binding.evidence.map((item): Evidence => {
    if (item.kind === 'TEST')
      return {
        kind: 'TEST',
        axis: item.axis,
        path: item.path,
        title: item.title,
        assertion: item.assertion,
        reviewedBy: item.reviewedBy,
        reviewedOn: item.reviewedOn,
      };
    return {
      kind: 'RECEIPT',
      axis: item.axis,
      path: item.path,
      headPointer: item.headPointer,
      resultPointer: item.resultPointer,
      expect: item.expect,
      assertion: item.assertion,
      reviewedBy: item.reviewedBy,
      reviewedOn: item.reviewedOn,
    };
  });
  return {
    id: binding.id,
    state: binding.state,
    ...(binding.reason === undefined ? {} : { reason: binding.reason }),
    gate: binding.gate,
    ...(binding.gateReview === undefined ? {} : { gateReview: binding.gateReview }),
    candidates: binding.candidates,
    evidence,
    ...(binding.denialNotApplicable === undefined
      ? {}
      : { denialNotApplicable: binding.denialNotApplicable }),
  };
}

function seedBinding(
  requirement: Requirement,
  previous: Binding | undefined,
  workspace: Workspace,
): Binding {
  const candidates = [
    ...new Set(
      requirement.evidence.filter(
        (path) =>
          (path.startsWith('tests/') || /(?:^|\/)release\.json$/.test(path)) &&
          workspace.exists(path),
      ),
    ),
  ];
  const base = { id: requirement.id, gate: null, candidates, evidence: [] };
  if (requirement.status === 'GATED')
    return canonicalBinding({ ...base, state: 'GATED', reason: gatedReason });
  if (requirement.status === 'DEFERRED')
    return canonicalBinding({ ...base, state: 'DEFERRED', reason: deferredReason });
  if (previous?.state === 'BOUND') return canonicalBinding({ ...previous, candidates });
  if (previous?.state === 'NONE' && previous.reason?.trim())
    return canonicalBinding({
      ...base,
      state: 'NONE',
      reason: previous.reason,
      gate: previous.gate,
    });
  return canonicalBinding({ ...base, state: 'NONE', reason: noneReason });
}

export function seedBindings(workspace: Workspace, existing: readonly unknown[]): Shard[] {
  const context = loadContext(workspace);
  const previous = new Map<string, Binding>();
  for (const raw of existing)
    for (const binding of shardSchema.parse(raw).bindings) previous.set(binding.id, binding);
  return context.sections.map((section) => ({
    schemaVersion: 1,
    meaning: bindingMeaning,
    identitySha256: context.identitySha256,
    section,
    bindings: context.requirements
      .filter((requirement) => requirement.section === section)
      .map((requirement) => seedBinding(requirement, previous.get(requirement.id), workspace)),
  }));
}

// Compares committed shards with a regeneration; BOUND content is kept by the seed, so only derived content can drift.
export function seedDrift(committed: readonly unknown[], workspace: Workspace): string[] {
  const parsed = committed.map((raw) => shardSchema.safeParse(raw));
  if (parsed.some((result) => !result.success))
    return ['a committed shard does not match the schema; run check'];
  const shards = parsed.map((result) => result.data!);
  const drift: string[] = [];
  const committedBySection = new Map(shards.map((shard) => [shard.section, shard]));
  for (const fresh of seedBindings(workspace, shards)) {
    const shard = committedBySection.get(fresh.section);
    if (!shard) {
      drift.push('section ' + fresh.section + ': shard is missing');
      continue;
    }
    if (
      shard.schemaVersion !== fresh.schemaVersion ||
      shard.meaning !== fresh.meaning ||
      shard.identitySha256 !== fresh.identitySha256
    )
      drift.push('section ' + fresh.section + ': shard header differs');
    const have = new Map(shard.bindings.map((binding) => [binding.id, binding]));
    for (const binding of fresh.bindings)
      if (!isDeepStrictEqual(have.get(binding.id), binding))
        drift.push(binding.id + ': differs from regeneration');
    if (
      !isDeepStrictEqual(
        shard.bindings.map((binding) => binding.id),
        fresh.bindings.map((binding) => binding.id),
      )
    )
      drift.push('section ' + fresh.section + ': ids or order differ');
  }
  return drift;
}

// ---------------------------------------------------------------------------------------------------------
// command line

export function run(args: string[], workspace: Workspace, root: string): number {
  const [command, flag] = args;
  const context = loadContext(workspace);
  if (command === 'check') {
    const problems = checkBindings(loadShards(workspace), workspace);
    if (problems.length === 0) {
      console.log(
        'PASS: bindings cover all ' +
          context.requirements.length +
          ' requirements and every rule holds. A binding is not acceptance.',
      );
      return 0;
    }
    for (const problem of problems) console.error(problem);
    console.error('FAIL: ' + problems.length + ' problem(s)');
    return 1;
  }
  if (command === 'report') {
    const report = coverageReport(
      loadShards(workspace).map((raw) => shardSchema.parse(raw)),
      context.requirements,
    );
    console.log(
      flag === '--json' ? JSON.stringify(report, null, 2) : formatReport(report).trimEnd(),
    );
    return report.sumMatches ? 0 : 1;
  }
  if (command === 'seed' && flag === '--check') {
    const drift = seedDrift(loadShards(workspace), workspace);
    if (drift.length === 0) {
      console.log(
        'PASS: committed NONE, GATED, DEFERRED and candidate content matches regeneration.',
      );
      return 0;
    }
    for (const line of drift) console.error(line);
    console.error(
      'FAIL: ' + drift.length + ' difference(s); run seed and prettier --write on the shards',
    );
    return 1;
  }
  if (command === 'seed' && flag === undefined) {
    for (const shard of seedBindings(workspace, loadShards(workspace)))
      writeFileSync(join(root, shardPath(shard.section)), JSON.stringify(shard, null, 2) + '\n');
    console.log(
      'Wrote ' +
        context.sections.length +
        ' shards under ' +
        shardDirectory +
        '. Run prettier --write on them.',
    );
    return 0;
  }
  console.error('Usage: requirement-bindings.ts check | report [--json] | seed [--check]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = run(process.argv.slice(2), createWorkspace(root), root);
}
