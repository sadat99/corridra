import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerPersonalProfiles } from '../../packages/db/src/customer-personal-profile-migrate';
import {
  migrateCustomerProfilePictures,
  profilePicturePersonalProfileStep,
} from '../../packages/db/src/customer-profile-picture-migrate';

// ADR-088 install wiring. The profile picture module is reached only through field_modules_action=profile_picture, never
// by a base run, and it refuses, naming the step, until the personal profile module is installed.
describe('the profile picture install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');

  test('the script takes a two-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "PROFILE_PICTURE_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/PROFILE_PICTURE_ACTION !== 'unchanged' && !apply/);
    expect(script).toContain('Profile picture installation requires INSTALL_APPLY=yes');
    expect(script).toContain("'customer_profile_picture_migrations'");
  });

  test('the installer is called once, only inside its own block, and never in a base run', () => {
    const call = 'migrateCustomerProfilePictures(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(script.slice(at - 80, at)).toContain("v.PROFILE_PICTURE_ACTION === 'install'");
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/picture/i);
    expect(at).toBeGreaterThan(script.indexOf("await report(apply ? 'Before install'"));
    expect(at).toBeLessThan(script.indexOf("await report('After install');"));
  });

  test('the workflow derives the line from field_modules_action alone and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}profile_picture,$/m);
    expect(workflow).not.toMatch(/^\s{6}profile_picture[a-z_]*:/m);
    const lines = workflow.split('\n').filter((line) => /PROFILE_PICTURE_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'profile_picture' && 'install'");
    expect(lines[0]!.replace(/inputs\.field_modules_action/g, '')).not.toMatch(/inputs\./);
  });
});

describe('the profile picture install on a database', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
    await migrateCustomerRealUse(f.owner);
    await migrateCustomerAccountLifecycle(f.owner);
  });
  afterAll(async () => {
    await f?.close();
  });

  test('refuses without the personal profile module, names the step and writes nothing', async () => {
    await expect(migrateCustomerProfilePictures(f.owner)).rejects.toThrow(
      profilePicturePersonalProfileStep,
    );
    expect(profilePicturePersonalProfileStep).toContain('field_modules_action=personal_profile');
    const present = (
      await f.owner.query(
        "SELECT to_regnamespace('customer_profile_picture_migrations') IS NOT NULL AS schema, to_regclass('customer_private.profile_picture_object') IS NOT NULL AS tbl",
      )
    ).rows[0];
    expect(present).toEqual({ schema: false, tbl: false });
  });

  test('installs once the personal profile module is present, and again is a no-op', async () => {
    await migrateCustomerPersonalProfiles(f.owner);
    await migrateCustomerProfilePictures(f.owner);
    await migrateCustomerProfilePictures(f.owner);
    expect(
      (await f.owner.query('SELECT name,sha256 FROM customer_profile_picture_migrations.applied'))
        .rows,
    ).toMatchObject([{ name: '0001_profile_picture.sql' }]);
  });

  test('a changed applied file is refused (hash guard)', async () => {
    await f.owner.query(
      "UPDATE customer_profile_picture_migrations.applied SET sha256=repeat('0',64) WHERE name='0001_profile_picture.sql'",
    );
    await expect(migrateCustomerProfilePictures(f.owner)).rejects.toThrow(
      'Profile picture migration history mismatch',
    );
  });
});
