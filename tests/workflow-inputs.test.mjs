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
  ]);
  const defaults = Object.fromEntries(
    Object.entries(declared).map(([name, input]) => [name, input.default]),
  );
  for (const [choice, confirmation, arrangements] of [
    ['unchanged', 'unchanged', 'unchanged'],
    ['specification_confirmation', 'install', 'unchanged'],
    ['commercial_arrangements', 'unchanged', 'install'],
    ['both', 'install', 'install'],
  ]) {
    const inputs = { ...defaults, field_modules_action: choice };
    assert.equal(evaluate(env.SPECIFICATION_CONFIRMATION_ACTION, inputs), confirmation);
    assert.equal(evaluate(env.COMMERCIAL_ARRANGEMENTS_ACTION, inputs), arrangements);
    assert.equal(evaluate(guard, inputs), choice !== 'unchanged');
  }
  for (const name of Object.keys(defaults).filter((name) => name.endsWith('_action'))) {
    assert.equal(evaluate(guard, { ...defaults, [name]: 'install' }), true, name);
  }
});
