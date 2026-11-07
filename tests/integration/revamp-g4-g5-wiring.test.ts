import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// CRUD G4 and G5, the wiring. The workspace and account lifecycle modules are optional and installed only by the owner,
// through the protected install workflow or the offline script. A base run installs nothing of them, only that workflow
// carries them, and no request code can reach the offline install or configuration modules.
const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
const installers = script.slice(
  script.indexOf('const installers'),
  script.indexOf('const pool = databasePool'),
);

describe('the install script', () => {
  test('a base run (apply yes, every action unchanged) installs nothing of G4 or G5', () => {
    expect(installers).not.toContain('Lifecycle');
    expect(installers).not.toContain('lifecycle');
    const block = script.slice(
      script.indexOf("if (v.WORKSPACE_LIFECYCLE_ACTION !== 'unchanged') {"),
    );
    expect(block.indexOf('migrateCustomerWorkspaceLifecycle(pool)')).toBeGreaterThan(-1);
    // Each call site is inside its own action guard.
    for (const [call, action] of [
      ['migrateCustomerWorkspaceLifecycle(pool)', 'WORKSPACE_LIFECYCLE_ACTION'],
      ['migrateCustomerAccountLifecycle(pool)', 'ACCOUNT_LIFECYCLE_ACTION'],
    ] as const) {
      const at = script.indexOf(call + ';');
      expect(at).toBeGreaterThan(-1);
      expect(script.slice(at - 80, at)).toContain(`v.${action} !== 'unchanged'`);
      expect(script.split(call).length - 1).toBe(1);
    }
  });
  test('the actions need apply, the enable and pause actions need a reason, and the report lists both registries', () => {
    expect(script).toMatch(/WORKSPACE_LIFECYCLE_ACTION !== 'unchanged' && !apply/);
    expect(script).toMatch(/ACCOUNT_LIFECYCLE_ACTION !== 'unchanged' && !apply/);
    expect(script).toMatch(/\['enable', 'pause'\]\.includes\(v\.WORKSPACE_LIFECYCLE_ACTION\)/);
    expect(script).toMatch(/\['enable', 'pause'\]\.includes\(v\.ACCOUNT_LIFECYCLE_ACTION\)/);
    expect(script).toContain("'customer_workspace_lifecycle_migrations'");
    expect(script).toContain("'customer_account_lifecycle_migrations'");
    expect(script).toContain('WORKSPACE_LIFECYCLE_REASON: z.preprocess(');
    expect(script).toContain('ACCOUNT_LIFECYCLE_REASON: z.preprocess(');
  });
});

describe('the programme lifecycle install', () => {
  test('re-runs the workspace lifecycle only through the refresh, which never installs it, and only inside its own action', () => {
    const at = script.indexOf('refreshCustomerWorkspaceLifecycle(pool)');
    expect(at).toBeGreaterThan(-1);
    expect(script.split('refreshCustomerWorkspaceLifecycle(pool)').length - 1).toBe(1);
    expect(script.slice(at - 600, at)).toContain("v.PROGRAMME_LIFECYCLE_ACTION === 'install'");
    expect(script.slice(at - 600, at)).toContain('migrateCustomerProgrammeLifecycle(pool)');
  });
});

// Owner, 7 Nov 2026 ("switch on g4+g5 in production"): the protected install workflow is the one way in. It reaches
// both actions only through field_modules_action, runs only on main in the owner-approved environment, and passes the
// exact-head revision check. Every other workflow still carries neither action.
const installWorkflow = 'install-customer-modules.yml';
describe('only the protected install workflow carries the two actions', () => {
  const directory = resolve('.github/workflows');
  for (const name of readdirSync(directory).filter((n) => /\.ya?ml$/.test(n)))
    test(name, () => {
      const text = readFileSync(join(directory, name), 'utf8');
      if (name !== installWorkflow) {
        expect(text).not.toMatch(/WORKSPACE_LIFECYCLE|ACCOUNT_LIFECYCLE/);
        return;
      }
      expect(text).toContain('environment: customer-modules-install');
      expect(text).toContain("if: github.ref == 'refs/heads/main'");
      expect(text).toContain("inputs.field_modules_action != 'unchanged'");
      // No input of its own: each action line is derived from field_modules_action alone.
      expect(text).not.toMatch(/^\s{6}(workspace|account)_lifecycle_[a-z_]+:/m);
      const lines = text.split('\n').filter((line) => /(WORKSPACE|ACCOUNT)_LIFECYCLE_/.test(line));
      expect(lines).toHaveLength(4);
      for (const line of lines) {
        expect(line).toContain('inputs.field_modules_action');
        expect(line.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
      }
    });
});

describe('request code never reaches the offline modules', () => {
  const offline = [
    'customer-workspace-lifecycle-configuration',
    'customer-account-lifecycle-configuration',
    'customer-workspace-lifecycle-migrate',
    'customer-account-lifecycle-migrate',
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (['node_modules', '.next', '.turbo'].includes(name)) return [];
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? walk(path)
        : /\.(ts|tsx|mjs|js)$/.test(name)
          ? [path]
          : [];
    });
  test('nothing under apps/web or the service modules imports them', () => {
    const files = [
      ...walk(resolve('apps/web')),
      resolve('packages/auth/src/customer-workspace-lifecycle.ts'),
      resolve('packages/auth/src/customer-account-lifecycle.ts'),
      resolve('packages/auth/src/customer-erasure-queue.ts'),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const name of offline) expect(text, `${file} imports ${name}`).not.toContain(name);
    }
  });
});
