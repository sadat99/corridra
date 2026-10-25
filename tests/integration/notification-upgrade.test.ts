import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// The path production takes: the first notification file (0001) is already installed with its control closed,
// and the second (0002, email off until chosen) arrives afterwards. Proves the upgrade applies only the new
// file, leaves the installed file's hash alone, keeps what the replaced function guarded (its owner, its
// access list and its settings), changes the default for a person with no choice and not for a person with
// one, and gives the new functions the access they need and no more.
const issuer = 'https://ep-pulse-upgrade.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const preferenceOf = async (person: string) =>
  (
    await f.owner.query('SELECT (customer_private.notification_preference_of($1)).kinds AS kinds', [
      person,
    ])
  ).rows[0].kinds as string[];

let first = '';
let principal = '';
let before: Awaited<ReturnType<typeof functionState>>;
let strangerBefore: string[];
let chosenBefore: string[];
let strangerId = '';

beforeAll(async () => {
  f = await fixture('corridra_upgrade');
  await migrateCustomerMoves(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the Pulse upgrade test',
  });
  await configureMoveRecords(f.owner, {
    enabled: true,
    reason: 'Owner approved Move records for the Pulse upgrade test',
  });
  // Install 0001 alone, exactly as the runner does: the schema, the record of applied files, the file, its hash.
  first = readFileSync(`${directory}/0001_notifications.sql`, 'utf8');
  await f.owner.query('CREATE SCHEMA IF NOT EXISTS customer_notification_migrations');
  await f.owner.query(
    'REVOKE ALL ON SCHEMA customer_notification_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
  );
  await f.owner.query(
    'CREATE TABLE IF NOT EXISTS customer_notification_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await f.owner.query(first);
  await f.owner.query(
    'INSERT INTO customer_notification_migrations.applied(name,sha256) VALUES($1,$2)',
    ['0001_notifications.sql', sha(first)],
  );
  // A person who saved a choice under 0001, and one who made none.
  principal = (
    await f.owner.query(
      `INSERT INTO customer_private.principal(issuer,subject,admission_reason)
       VALUES($1,$2,'Owner approved this person for the Pulse upgrade test') RETURNING id`,
      [issuer, randomUUID()],
    )
  ).rows[0].id;
  await f.owner.query(
    `INSERT INTO customer_private.notification_preference(principal_id,version,kinds,digest,time_zone)
     VALUES($1,1,ARRAY['complete'],false,'UTC')`,
    [principal],
  );
  strangerId = randomUUID();
  before = await functionState('customer_private.notification_preference_of(uuid)');
  strangerBefore = await preferenceOf(strangerId);
  chosenBefore = await preferenceOf(principal);
});
afterAll(async () => {
  await f?.close();
});

describe('upgrading from the installed first file to email off until chosen', () => {
  test('under the first file a person with no choice has every kind on', () => {
    expect(strangerBefore).toEqual(['your-move', 'update', 'countdown', 'complete']);
    expect(chosenBefore).toEqual(['complete']);
  });

  test('the runner applies only the new file, leaves the installed hash alone and is repeatable', async () => {
    await migrateCustomerNotifications(f.owner);
    const applied = (
      await f.owner.query(
        'SELECT name,sha256 FROM customer_notification_migrations.applied ORDER BY name',
      )
    ).rows;
    expect(applied.map((r) => r.name)).toEqual([
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
    ]);
    expect(applied[0].sha256).toBe(sha(first));
    expect(applied[1].sha256).toBe(
      sha(readFileSync(`${directory}/0002_email_off_until_chosen.sql`, 'utf8')),
    );
    await migrateCustomerNotifications(f.owner);
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_notification_migrations.applied'))
        .rows[0].n,
    ).toBe(2);
  });

  test('a person with no choice now has email off, and a person who chose keeps their choice', async () => {
    expect(await preferenceOf(strangerId)).toEqual([]);
    expect(await preferenceOf(principal)).toEqual(['complete']);
  });

  test('the replaced function keeps its owner, access list and settings, and no application role can run it', async () => {
    expect(await functionState('customer_private.notification_preference_of(uuid)')).toEqual(
      before,
    );
    for (const pool of [f.runtime, f.auth])
      await expect(
        pool.query('SELECT customer_private.notification_preference_of($1)', [randomUUID()]),
      ).rejects.toMatchObject({ code: '42501' });
  });

  test('the new functions are closed to everyone except the one application role that needs the lookup', async () => {
    const lookup = await functionState('customer.notification_recipient(uuid,text)');
    expect(lookup.definer).toBe(true);
    expect(lookup.config).toContain('search_path=pg_catalog');
    expect(lookup.acl).toContain('corridra_runtime=X/');
    expect(lookup.acl).not.toContain('corridra_auth=');
    const ready = await functionState('customer.notification_recipient_ready()');
    expect(ready.acl).not.toContain('corridra_runtime=');
    expect(ready.acl).not.toContain('corridra_auth=');
    await expect(
      f.runtime.query('SELECT customer.notification_recipient($1,$2)', [
        randomUUID(),
        'x'.repeat(30),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.auth.query('SELECT customer.notification_recipient($1,$2)', [randomUUID(), 'x'.repeat(30)]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('the control is still closed after the upgrade: nothing was opened by it', async () => {
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.notification_control'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await f.owner.query('SELECT customer_private.notification_open() AS open')).rows[0].open,
    ).toBe(false);
  });
});
