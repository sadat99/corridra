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
    'helper_interest',
    'programme_erasure',
    'personal_profile',
    'profile_picture',
    'viewer_reply_metadata',
    'viewer_export_access',
    'quotation_link_check',
    'member_notice',
    'member_notice_deliver',
    'member_access',
    'contact_changes_install',
    'contact_changes_enable',
    'contact_changes_pause',
    'supply_sources_install',
    'supply_sources_enable',
    'supply_sources_pause',
    'sourcing_workflow_install',
    'sourcing_workflow_enable',
    'sourcing_workflow_pause',
    'data_cleanup_inventory',
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
    ['helper_interest', u, u, u, u, u, u, u, u],
    ['programme_erasure', u, u, u, u, u, u, u, u],
    ['personal_profile', u, u, u, u, u, u, u, u],
    ['profile_picture', u, u, u, u, u, u, u, u],
    ['viewer_reply_metadata', u, u, u, u, u, u, u, u],
    ['viewer_export_access', u, u, u, u, u, u, u, u],
    ['quotation_link_check', u, u, u, u, u, u, u, u],
    ['member_notice', u, u, u, u, u, u, u, u],
    ['member_notice_deliver', u, u, u, u, u, u, u, u],
    ['member_access', u, u, u, u, u, u, u, u],
    ['contact_changes_install', u, u, u, u, u, u, u, u],
    ['contact_changes_enable', u, u, u, u, u, u, u, u],
    ['contact_changes_pause', u, u, u, u, u, u, u, u],
    ['supply_sources_install', u, u, u, u, u, u, u, u],
    ['supply_sources_enable', u, u, u, u, u, u, u, u],
    ['supply_sources_pause', u, u, u, u, u, u, u, u],
    ['sourcing_workflow_install', u, u, u, u, u, u, u, u],
    ['sourcing_workflow_enable', u, u, u, u, u, u, u, u],
    ['sourcing_workflow_pause', u, u, u, u, u, u, u, u],
    ['data_cleanup_inventory', u, u, u, u, u, u, u, u],
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
    assert.equal(
      evaluate(env.HELPER_INTEREST_ACTION, inputs),
      choice === 'helper_interest' ? 'install' : u,
    );
    // Programme words erasure: its own choice installs the database module and nothing else.
    assert.equal(
      evaluate(env.PROGRAMME_ERASURE_ACTION, inputs),
      choice === 'programme_erasure' ? 'install' : u,
    );
    // Personal profile (ADR-086): its own choice installs the database module and nothing else.
    assert.equal(
      evaluate(env.PERSONAL_PROFILE_ACTION, inputs),
      choice === 'personal_profile' ? 'install' : u,
    );
    // Profile picture (ADR-088): its own choice installs the database module and nothing else.
    assert.equal(
      evaluate(env.PROFILE_PICTURE_ACTION, inputs),
      choice === 'profile_picture' ? 'install' : u,
    );
    // ADR-087 U2 and U3: each own choice installs its database module and nothing else.
    assert.equal(
      evaluate(env.VIEWER_REPLY_METADATA_ACTION, inputs),
      choice === 'viewer_reply_metadata' ? 'install' : u,
    );
    assert.equal(
      evaluate(env.VIEWER_EXPORT_ACCESS_ACTION, inputs),
      choice === 'viewer_export_access' ? 'install' : u,
    );
    // ADR-087 quotation link check: its own choice installs its database module and nothing else.
    assert.equal(
      evaluate(env.QUOTATION_LINK_CHECK_ACTION, inputs),
      choice === 'quotation_link_check' ? 'install' : u,
    );
    for (const [own, line] of [
      ['personal_profile', 'PERSONAL_PROFILE_ACTION'],
      ['profile_picture', 'PROFILE_PICTURE_ACTION'],
      ['viewer_reply_metadata', 'VIEWER_REPLY_METADATA_ACTION'],
      ['viewer_export_access', 'VIEWER_EXPORT_ACCESS_ACTION'],
      ['quotation_link_check', 'QUOTATION_LINK_CHECK_ACTION'],
      ['member_notice', 'MEMBER_NOTICE_ACTION'],
      ['member_notice_deliver', 'MEMBER_NOTICE_ACTION'],
      ['member_access', 'MEMBER_ACCESS_ACTION'],
    ])
      if (choice === own)
        for (const [name, value] of Object.entries(env))
          if (name.endsWith('_ACTION') && name !== line)
            assert.ok(
              ['unchanged', 'no'].includes(String(evaluate(String(value), inputs))),
              `${choice} must not move ${name}`,
            );
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

test('the supply source choices install, open and pause only the module control, each open or pause with a reason', () => {
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
        supply_sources_install: 'install',
        supply_sources_enable: 'enable',
        supply_sources_pause: 'pause',
      }[choice] ?? 'unchanged';
    assert.equal(evaluate(env.SUPPLY_SOURCES_ACTION, inputs), expected, choice);
    const reason = evaluate(env.SUPPLY_SOURCES_REASON, inputs);
    if (expected === 'enable' || expected === 'pause') {
      assert.ok(reason.length >= 10 && reason.length <= 500, `${choice} reason length`);
      assert.match(reason, expected === 'enable' ? /opened/ : /paused/);
    } else assert.equal(reason, '');
    // No other module reacts to a supply sources choice.
    for (const name of Object.keys(env).filter(
      (name) => name.endsWith('_ACTION') && name !== 'SUPPLY_SOURCES_ACTION',
    ))
      if (choice.startsWith('supply_sources_'))
        assert.equal(
          evaluate(env[name], inputs),
          defaults[name.toLowerCase()] ?? 'unchanged',
          `${choice} ${name}`,
        );
  }
  // ADR-082 section 12: no input is added, and no installer value opens any of the other six controls.
  assert.equal(Object.keys(declared).length, 24);
  assert.deepEqual(
    Object.keys(env)
      .filter((name) => name.startsWith('SUPPLY_SOURCES_'))
      .sort(),
    ['SUPPLY_SOURCES_ACTION', 'SUPPLY_SOURCES_REASON'],
  );
});

test('the sourcing workflow choices install, open and pause only that module, each open or pause with a reason', () => {
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
        sourcing_workflow_install: 'install',
        sourcing_workflow_enable: 'enable',
        sourcing_workflow_pause: 'pause',
      }[choice] ?? 'unchanged';
    assert.equal(evaluate(env.SOURCING_WORKFLOW_ACTION, inputs), expected, choice);
    const reason = evaluate(env.SOURCING_WORKFLOW_REASON, inputs);
    if (expected === 'enable' || expected === 'pause') {
      assert.ok(reason.length >= 10 && reason.length <= 500, `${choice} reason length`);
      assert.match(reason, expected === 'enable' ? /opened/ : /paused/);
    } else assert.equal(reason, '');
    // No other module moves with a sourcing choice: every other action variable that is an expression stays unchanged.
    if (expected !== 'unchanged')
      for (const [name, value] of Object.entries(env))
        if (name.endsWith('_ACTION') && name !== 'SOURCING_WORKFLOW_ACTION')
          assert.ok(
            ['unchanged', 'no'].includes(String(evaluate(String(value), inputs))),
            `${choice} must not move ${name}`,
          );
  }
});

test('the data cleanup choice only lists, moves no other module and carries no reason', () => {
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
    const expected = choice === 'data_cleanup_inventory' ? 'inventory' : 'unchanged';
    assert.equal(evaluate(env.DATA_CLEANUP_ACTION, inputs), expected, choice);
    if (expected === 'inventory')
      for (const [name, value] of Object.entries(env))
        if (name.endsWith('_ACTION') && name !== 'DATA_CLEANUP_ACTION')
          assert.ok(
            ['unchanged', 'no'].includes(String(evaluate(String(value), inputs))),
            `${choice} must not move ${name}`,
          );
  }
  // No archive or restore is wired, and no input is added.
  assert.deepEqual(
    Object.keys(env).filter((name) => name.startsWith('DATA_CLEANUP_')),
    ['DATA_CLEANUP_ACTION'],
  );
  assert.equal(
    declared.field_modules_action.options.filter((option) => option.startsWith('data_cleanup_'))
      .length,
    1,
  );
  assert.equal(Object.keys(declared).length, 24);
});

test('the member notice choices install or deliver only that module and add no input', () => {
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
      { member_notice: 'install', member_notice_deliver: 'deliver' }[choice] ?? 'unchanged';
    assert.equal(evaluate(env.MEMBER_NOTICE_ACTION, inputs), expected, choice);
  }
  // Guardian G27, 17 Nov 2026: no 25th input. Delivery takes no list; it covers every real workspace not yet delivered.
  assert.equal(Object.keys(declared).length, 24);
  assert.ok(Object.keys(declared).every((name) => !/notice/.test(name)));
  // The live app origin (a repository variable, not an input) reaches the job only for deliver.
  assert.deepEqual(
    Object.keys(env).filter((name) => name.startsWith('MEMBER_NOTICE_')),
    ['MEMBER_NOTICE_ACTION', 'MEMBER_NOTICE_APP_ORIGIN'],
  );
  assert.equal(
    env.MEMBER_NOTICE_APP_ORIGIN,
    "${{ inputs.field_modules_action == 'member_notice_deliver' && vars.APP_ORIGIN || '' }}",
  );
  // The deliver choice warns that it waits for U5 and the owner's install approval.
  assert.match(
    declared.field_modules_action.description,
    /member_notice_deliver[^)]*turn CORRIDRA_MEMBER_NOTICE on in the live app first[^)]*only after U5 is merged and its install approved by the owner/,
  );
});

test('ADR-087 U5: member_access installs only the member access module, through no new input', () => {
  const workflow = parseDocument(readFileSync('.github/workflows/install-customer-modules.yml', 'utf8')).toJS();
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
    assert.equal(
      evaluate(env.MEMBER_ACCESS_ACTION, inputs),
      choice === 'member_access' ? 'install' : 'unchanged',
      choice,
    );
  }
  assert.equal(Object.keys(declared).length, 24);
  assert.deepEqual(
    Object.keys(env).filter((name) => name.startsWith('MEMBER_ACCESS_')),
    ['MEMBER_ACCESS_ACTION'],
  );
  assert.match(
    declared.field_modules_action.description,
    /member_access \(ADR-087 U5:[^)]*needs member_notice installed first[^)]*only while CORRIDRA_MEMBER_ACCESS is on; only when the owner approves\)/,
  );
  const script = readFileSync('scripts/install-customer-modules.ts', 'utf8');
  assert.match(script, /MEMBER_ACCESS_ACTION: z\.enum\(\['unchanged', 'install'\]\)\.default\('unchanged'\)/);
  assert.match(script, /if \(v\.MEMBER_ACCESS_ACTION !== 'unchanged' && !apply\)\n\s+throw new Error\('Member access installation requires INSTALL_APPLY=yes'\);/);
});

test('set_supplier takes the supplier details only from the protected environment secret, never an input', () => {
  const source = readFileSync('.github/workflows/install-customer-modules.yml', 'utf8');
  const workflow = parseDocument(source).toJS();
  const declared = workflow.on.workflow_dispatch.inputs;
  // Owner, 17 Nov 2026: the repository is public, so the supplier JSON (UEN, bank details) must never be an input.
  assert.equal(
    Object.keys(declared).some((name) => /supplier/i.test(name)),
    false,
  );
  assert.equal(workflow.jobs.install.environment, 'customer-modules-install');
  const step = workflow.jobs.install.steps.find(
    (candidate) => candidate.name === 'Report or install the customer modules',
  );
  assert.equal(
    step.env.REAL_INVOICING_SUPPLIER_JSON,
    "${{ inputs.real_invoicing_action == 'set_supplier' && secrets.REAL_INVOICING_SUPPLIER_JSON || '' }}",
  );
  // The secret reaches the job only through env, never a run line, and no step traces commands or dumps the environment.
  for (const candidate of workflow.jobs.install.steps) {
    const run = candidate.run ?? '';
    assert.doesNotMatch(run, /secrets\.|SUPPLIER|set -x|\benv\b|printenv|toJSON/);
  }
  assert.doesNotMatch(source, /toJSON\(\s*(secrets|env|inputs)/);
});
