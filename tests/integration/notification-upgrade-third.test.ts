import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// The path a database takes when 0001 and 0002 are already installed (their hashes are checked, so neither may
// ever change) and 0003 arrives afterwards: the runner applies 0003 alone, throws no history mismatch, and the
// two functions it replaces keep their owner, access list and settings.
const issuer = 'https://ep-pulse-third.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const directory = resolve('packages/db/customer-notification-migrations');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;
const functionState = async (signature: string) =>
  (
    await f.owner.query(
      `SELECT proowner::regrole::text AS owner,proacl::text AS acl,prosecdef AS definer,proconfig::text AS config
       FROM pg_proc WHERE oid=$1::regprocedure`,
      [signature],
    )
  ).rows[0];
const replaced = [
  'customer.notification_recipient(uuid,text)',
  'customer.set_notification_preferences(text[],boolean,text,text,text,text)',
];
let before: Awaited<ReturnType<typeof functionState>>[];

beforeAll(async () => {
  f = await fixture('corridra_upgrade_third');
  await migrateCustomerMoves(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the Pulse third file test',
  });
  await configureMoveRecords(f.owner, {
    enabled: true,
    reason: 'Owner approved Move records for the Pulse third file test',
  });
  await f.owner.query('CREATE SCHEMA IF NOT EXISTS customer_notification_migrations');
  await f.owner.query(
    'REVOKE ALL ON SCHEMA customer_notification_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
  );
  await f.owner.query(
    'CREATE TABLE IF NOT EXISTS customer_notification_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  // Install 0001 and 0002 exactly as the runner did when they were released: the file, then its hash.
  for (const name of ['0001_notifications.sql', '0002_email_off_until_chosen.sql']) {
    const sql = readFileSync(`${directory}/${name}`, 'utf8');
    await f.owner.query(sql);
    await f.owner.query(
      'INSERT INTO customer_notification_migrations.applied(name,sha256) VALUES($1,$2)',
      [name, sha(sql)],
    );
  }
  before = await Promise.all(replaced.map(functionState));
});
afterAll(async () => {
  await f?.close();
});

describe('upgrading from installed 0001 and 0002 to the third file', () => {
  test('the released files are exactly the bytes whose hashes are recorded in installed databases', () => {
    // Once a notification file is on main it never changes; a correction is always a new file.
    expect(sha(readFileSync(`${directory}/0001_notifications.sql`, 'utf8'))).toBe(
      'f45a55e9b64bea957edfd2344f9d7c7262d39d0fb5dd3799257e2a6ef0956fe3',
    );
    expect(sha(readFileSync(`${directory}/0002_email_off_until_chosen.sql`, 'utf8'))).toBe(
      '5dac2a95b4e5fe6799b99d38b3d2809a1b3a747a48048ac4f8c15cc7e720c8e8',
    );
  });

  test('the runner applies 0003 alone, with no history mismatch, and again does nothing', async () => {
    await migrateCustomerNotifications(f.owner);
    const applied = (
      await f.owner.query(
        'SELECT name,sha256 FROM customer_notification_migrations.applied ORDER BY name',
      )
    ).rows;
    expect(applied.map((r) => r.name)).toEqual([
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
      '0003_withdrawal_and_issuer_check.sql',
    ]);
    expect(applied[2].sha256).toBe(
      sha(readFileSync(`${directory}/0003_withdrawal_and_issuer_check.sql`, 'utf8')),
    );
    await migrateCustomerNotifications(f.owner);
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_notification_migrations.applied'))
        .rows[0].n,
    ).toBe(3);
  });

  test('the two replaced functions keep their owner, access list and settings', async () => {
    expect(await Promise.all(replaced.map(functionState))).toEqual(before);
    expect(before[0].acl).toContain('corridra_runtime=X/');
    expect(before[0].acl).not.toContain('corridra_auth=');
  });
});
