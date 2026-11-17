import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import {
  migrateCustomerPersonalProfiles,
  personalProfileLifecycleStep,
} from '../../packages/db/src/customer-personal-profile-migrate';

// ADR-086 install wiring. The personal profile module is reached only through field_modules_action=personal_profile, never
// by a base run, and it refuses, naming the step, until the account lifecycle module is installed.
describe('the personal profile install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a two-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "PERSONAL_PROFILE_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/PERSONAL_PROFILE_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain('Personal profile installation requires INSTALL_APPLY=yes');
    expect(script).toContain("'customer_personal_profile_migrations'");
  });

  test('the installer is called once, only inside its own block, and never in a base run', () => {
    const call = 'migrateCustomerPersonalProfiles(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(script.slice(at - 80, at)).toContain("v.PERSONAL_PROFILE_ACTION === 'install'");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/personal/i);
    expect(at).toBeGreaterThan(script.indexOf("await report(apply ? 'Before install'"));
    expect(at).toBeLessThan(script.indexOf("await report('After install');"));
  });

  test('the workflow derives the line from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}personal_profile,$/m);
    expect(workflow).not.toMatch(/^\s{6}personal_profile[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => /PERSONAL_PROFILE_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'personal_profile' && 'install'");
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });
});

describe('the personal profile install on a database', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
    await migrateCustomerRealUse(f.owner);
  });
  afterAll(async () => {
    await f?.close();
  });

  test('refuses without the account lifecycle module, names the step and writes nothing', async () => {
    await expect(migrateCustomerPersonalProfiles(f.owner)).rejects.toThrow(
      personalProfileLifecycleStep,
    );
    expect(personalProfileLifecycleStep).toContain('field_modules_action=lifecycle_install');
    const present = (
      await f.owner.query(
        "SELECT to_regnamespace('customer_personal_profile_migrations') IS NOT NULL AS schema, to_regclass('customer_private.personal_profile_revision') IS NOT NULL AS tbl",
      )
    ).rows[0];
    expect(present).toEqual({ schema: false, tbl: false });
  });

  test('installs once the lifecycle module is present, and again is a no-op', async () => {
    await migrateCustomerAccountLifecycle(f.owner);
    await migrateCustomerPersonalProfiles(f.owner);
    await migrateCustomerPersonalProfiles(f.owner);
    expect(
      (await f.owner.query('SELECT name FROM customer_personal_profile_migrations.applied')).rows,
    ).toEqual([{ name: '0001_personal_profile.sql' }]);
  });
});
