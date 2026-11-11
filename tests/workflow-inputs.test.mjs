import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';

function checkInputs(source) {
  const document = parseDocument(source);
  assert.deepEqual(document.errors, [], 'workflow must parse without YAML errors');
  const workflow = document.toJS();
  const inputs = workflow.on?.workflow_dispatch?.inputs ?? {};
  const names = Object.keys(inputs);
  assert.ok(names.length <= 25, `workflow_dispatch has ${names.length} inputs; maximum is 25`);
  function visit(value) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(
        /\b(?:github\.event\.)?inputs(?:\.([A-Za-z_][A-Za-z_0-9]*)|\[['"]([^'"]+)['"]\])/g,
      )) {
        const name = match[1] ?? match[2];
        assert.ok(Object.hasOwn(inputs, name), `undeclared input: ${name}`);
      }
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  }
  visit(workflow);
  return names;
}

for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
  test(`${file} has at most 25 declared manual inputs and no dangling input references`, () => {
    checkInputs(readFileSync(`.github/workflows/${file}`, 'utf8'));
  });
}

test('the guard rejects 26 inputs and accepts exactly 25', () => {
  const workflow = (count) =>
    `on:\n  workflow_dispatch:\n    inputs:\n${Array.from(
      { length: count },
      (_, i) => `      input_${i}: {default: unchanged}\n`,
    ).join('')}`;
  assert.equal(checkInputs(workflow(25)).length, 25);
  assert.throws(() => checkInputs(workflow(26)), /26 inputs; maximum is 25/);
});

test('the guard rejects undeclared dot, bracket and event input references', () => {
  for (const reference of ['inputs.missing', "inputs['missing']", 'github.event.inputs.missing']) {
    assert.throws(
      () =>
        checkInputs(
          `on: {workflow_dispatch: {inputs: {apply: {default: 'no'}}}}\nenv:\n  TEST: \${{ ${reference} }}\n`,
        ),
      /undeclared input: missing/,
    );
  }
});

test('the guard rejects duplicate YAML input names', () => {
  assert.throws(
    () => checkInputs('on:\n  workflow_dispatch:\n    inputs:\n      apply: {}\n      apply: {}\n'),
    /workflow must parse/,
  );
});

test('each field-module choice maps to install only and reaches the exact-head check', () => {
  const workflow = parseDocument(
    readFileSync('.github/workflows/install-customer-modules.yml', 'utf8'),
  ).toJS();
  const declared = workflow.on.workflow_dispatch.inputs;
  const steps = workflow.jobs.install.steps;
  const env = steps.find((step) => step.name === 'Report or install the customer modules').env;
  const guard = steps.find((step) => step.name?.startsWith('Verify exact revision')).if;
  const evaluate = (expression, inputs) =>
    runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), { inputs });
  assert.deepEqual(declared.field_modules_action.options, [
    'unchanged',
    'specification_confirmation',
    'commercial_arrangements',
    'both',
    'programme_lifecycle',
    'participant_labels',
    'response_revision',
    'response_revision_enable',
    'response_revision_pause',
    'lifecycle_install',
    'lifecycle_enable',
    'lifecycle_pause',
    'problem_reports',
    'programme_pages',
    'contact_changes_install',
    'contact_changes_enable',
    'contact_changes_pause',
  ]);
  const defaults = Object.fromEntries(
    Object.entries(declared).map(([name, input]) => [name, input.default]),
  );
  const u = 'unchanged';
  for (const [
    choice,
    confirmation,
    arrangements,
    lifecycle,
    labels,
    revision,
    g4g5,
    reports,
    pages,
  ] of [
    ['unchanged', u, u, u, u, u, u, u, u],
    ['specification_confirmation', 'install', u, u, u, u, u, u, u],
    ['commercial_arrangements', u, 'install', u, u, u, u, u, u],
    ['both', 'install', 'install', u, u, u, u, u, u],
    ['programme_lifecycle', u, u, 'install', u, u, u, u, u],
    ['participant_labels', u, u, u, 'install', u, u, u, u],
    ['response_revision', u, u, u, u, 'install', u, u, u],
    ['response_revision_enable', u, u, u, u, 'enable', u, u, u],
    ['response_revision_pause', u, u, u, u, 'pause', u, u, u],
    ['lifecycle_install', u, u, u, u, u, 'install', u, u],
    ['lifecycle_enable', u, u, u, u, u, 'enable', u, u],
    ['lifecycle_pause', u, u, u, u, u, 'pause', u, u],
    ['problem_reports', u, u, u, u, u, u, 'install', u],
    ['programme_pages', u, u, u, u, u, u, u, 'install'],
    ['contact_changes_install', u, u, u, u, u, u, u, u],
    ['contact_changes_enable', u, u, u, u, u, u, u, u],
    ['contact_changes_pause', u, u, u, u, u, u, u, u],
  ]) {
    const inputs = { ...defaults, field_modules_action: choice };
    assert.equal(evaluate(env.SPECIFICATION_CONFIRMATION_ACTION, inputs), confirmation);
    assert.equal(evaluate(env.COMMERCIAL_ARRANGEMENTS_ACTION, inputs), arrangements);
    assert.equal(evaluate(env.PROGRAMME_LIFECYCLE_ACTION, inputs), lifecycle);
    assert.equal(evaluate(env.PARTICIPANT_LABELS_ACTION, inputs), labels);
    assert.equal(evaluate(env.RESPONSE_REVISION_ACTION, inputs), revision);
    // G4 and G5 always move together, and an open or pause always carries a reason of 10 to 500 characters.
    assert.equal(evaluate(env.WORKSPACE_LIFECYCLE_ACTION, inputs), g4g5);
    assert.equal(evaluate(env.ACCOUNT_LIFECYCLE_ACTION, inputs), g4g5);
    // Problem reports have no control: the choice installs the database module and nothing else.
    assert.equal(evaluate(env.PROBLEM_REPORTS_ACTION, inputs), reports);
    // Programme pages (ADR-080): the choice installs the database module and nothing else; the app switch is separate.
    assert.equal(evaluate(env.PROGRAMME_PAGES_ACTION, inputs), pages);
    for (const reason of [env.WORKSPACE_LIFECYCLE_REASON, env.ACCOUNT_LIFECYCLE_REASON]) {
      const value = evaluate(reason, inputs);
      if (g4g5 === 'enable' || g4g5 === 'pause') {
        assert.ok(value.length >= 10 && value.length <= 500, `${choice} reason length`);
        assert.match(value, g4g5 === 'enable' ? /opened/ : /paused/);
      } else assert.equal(value, '');
    }
    assert.equal(evaluate(guard, inputs), choice !== 'unchanged');
  }
  for (const name of Object.keys(defaults).filter((name) => name.endsWith('_action'))) {
    assert.equal(evaluate(guard, { ...defaults, [name]: 'install' }), true, name);
  }
});

test('the contact change choices install, open and pause only that module, each open or pause with a reason', () => {
  const workflow = parseDocument(
    readFileSync('.github/workflows/install-customer-modules.yml', 'utf8'),
  ).toJS();
  const declared = workflow.on.workflow_dispatch.inputs;
  const env = workflow.jobs.install.steps.find(
    (step) => step.name === 'Report or install the customer modules',
  ).env;
  const evaluate = (expression, inputs) =>
    runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), { inputs });
  const defaults = Object.fromEntries(
    Object.entries(declared).map(([name, input]) => [name, input.default]),
  );
  for (const choice of declared.field_modules_action.options) {
    const inputs = { ...defaults, field_modules_action: choice };
    const expected =
      {
        contact_changes_install: 'install',
        contact_changes_enable: 'enable',
        contact_changes_pause: 'pause',
      }[choice] ?? 'unchanged';
    assert.equal(evaluate(env.COUNTERPARTY_CHANGES_ACTION, inputs), expected, choice);
    const reason = evaluate(env.COUNTERPARTY_CHANGES_REASON, inputs);
    if (expected === 'enable' || expected === 'pause') {
      assert.ok(reason.length >= 10 && reason.length <= 500, `${choice} reason length`);
      assert.match(reason, expected === 'enable' ? /opened/ : /paused/);
    } else assert.equal(reason, '');
  }
});
