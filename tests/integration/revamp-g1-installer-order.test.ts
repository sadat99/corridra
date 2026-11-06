import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';

// CRUD G1, the install order. Production already has mission mail 0001 and 0002 and notifications 0001 to 0004. The
// base install run now installs the request withdrawal module (its control stays closed), and mission mail 0003 and
// notifications 0005 need it. This proves, on a database in exactly that state: a run that leaves the mail actions
// unchanged installs withdrawal and touches nothing else; a run that installs the mail modules installs withdrawal
// first and then 0003 and 0005 cleanly in one run; and installing mail first stops with a clear message and changes
// nothing.
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;

async function applyFiles(directory: string, schema: string, files: string[]) {
  await f.owner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await f.owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,corridra_runtime,corridra_auth`);
  await f.owner.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  for (const name of files) {
    const sql = readFileSync(resolve('packages/db', directory, name), 'utf8');
    await f.owner.query(sql);
    await f.owner.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
      name,
      sha(sql),
    ]);
  }
}
const applied = async (schema: string) =>
  (await f.owner.query(`SELECT name,sha256 FROM ${schema}.applied ORDER BY name`)).rows as {
    name: string;
    sha256: string;
  }[];
const definition = async (signature: string) =>
  sha(
    (await f.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature])).rows[0]
      .d,
  );
const readers = [
  'customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text)',
  'customer.claim_mission_mail(uuid,text)',
  'customer_private.notification_valid(customer_private.notification_outbox)',
  'customer.enqueue_move_notifications(uuid)',
];
const withdrawalInstalled = async () =>
  (
    await f.owner.query(
      "SELECT to_regprocedure('customer_private.request_withdrawn_since(uuid,timestamptz)') IS NOT NULL AS present",
    )
  ).rows[0].present as boolean;

beforeAll(async () => {
  f = await fixture();
  // The state production is in: both mail modules installed up to the G6 files, no withdrawal module.
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMoves(f.owner);
  await applyFiles('customer-mission-mail-migrations', 'customer_mission_mail_migrations', [
    '0001_mission_mail.sql',
    '0002_mute_events.sql',
  ]);
  await applyFiles('customer-notification-migrations', 'customer_notification_migrations', [
    '0001_notifications.sql',
    '0002_email_off_until_chosen.sql',
    '0003_withdrawal_and_issuer_check.sql',
    '0004_mute_events.sql',
  ]);
  await pinCustomerAuthority(f.owner, {
    issuer: 'https://ep-withdrawal.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    executorId: f.serviceId,
  });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the install order fixture tests',
  });
});
afterAll(async () => {
  await f?.close();
});

describe('installing the withdrawal module on the production state', () => {
  test('installing the mail modules before withdrawal stops with a clear message and changes nothing', async () => {
    const before = {
      mail: await applied('customer_mission_mail_migrations'),
      pulse: await applied('customer_notification_migrations'),
      readers: await Promise.all(readers.map(definition)),
    };
    await expect(migrateCustomerMissionMail(f.owner)).rejects.toThrow(
      'Install the request withdrawal module',
    );
    await expect(migrateCustomerNotifications(f.owner)).rejects.toThrow(
      'Install the request withdrawal module',
    );
    expect(await withdrawalInstalled()).toBe(false);
    expect(await applied('customer_mission_mail_migrations')).toEqual(before.mail);
    expect(await applied('customer_notification_migrations')).toEqual(before.pulse);
    expect(await Promise.all(readers.map(definition))).toEqual(before.readers);
  });

  test('a run that leaves the mail actions unchanged installs withdrawal and touches nothing else', async () => {
    const before = {
      mail: await applied('customer_mission_mail_migrations'),
      pulse: await applied('customer_notification_migrations'),
      readers: await Promise.all(readers.map(definition)),
    };
    await migrateCustomerRequestWithdrawal(f.owner);
    expect(await withdrawalInstalled()).toBe(true);
    expect((await applied('customer_request_withdrawal_migrations')).map((r) => r.name)).toEqual([
      '0001_request_withdrawal.sql',
    ]);
    // Its control starts closed, so nothing is visible.
    expect(
      (await f.owner.query('SELECT customer_private.request_withdrawal_open() AS open')).rows[0]
        .open,
    ).toBe(false);
    expect(await applied('customer_mission_mail_migrations')).toEqual(before.mail);
    expect(await applied('customer_notification_migrations')).toEqual(before.pulse);
    expect(await Promise.all(readers.map(definition))).toEqual(before.readers);
    // Running it again changes nothing.
    await migrateCustomerRequestWithdrawal(f.owner);
    expect(await applied('customer_request_withdrawal_migrations')).toHaveLength(1);
  });

  test('opening withdrawals is refused while an installed mail module lacks its withdrawal upgrade, and pausing is never refused', async () => {
    const reason = 'Opening withdrawals for the first customers';
    const control = async () =>
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.request_withdrawal_control',
        )
      ).rows[0].n as number;
    const before = await control();
    await expect(configureRequestWithdrawal(f.owner, { enabled: true, reason })).rejects.toThrow(
      'Upgrade the installed mail modules before opening request withdrawal',
    );
    expect(await control()).toBe(before);
    // Closing is always allowed, so a pause can never be trapped.
    await expect(configureRequestWithdrawal(f.owner, { enabled: false, reason })).resolves.toEqual({
      enabled: false,
      changed: false,
    });
  });

  test('a run that installs the mail modules applies 0003 and 0005 cleanly, leaves the installed hashes alone, and is repeatable', async () => {
    const mailBefore = await applied('customer_mission_mail_migrations');
    const pulseBefore = await applied('customer_notification_migrations');
    await migrateCustomerMissionMail(f.owner);
    await migrateCustomerNotifications(f.owner);
    const mail = await applied('customer_mission_mail_migrations');
    const pulse = await applied('customer_notification_migrations');
    expect(mail.map((r) => r.name)).toEqual([
      '0001_mission_mail.sql',
      '0002_mute_events.sql',
      '0003_withdrawn_requests.sql',
    ]);
    expect(pulse.map((r) => r.name)).toEqual([
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
      '0003_withdrawal_and_issuer_check.sql',
      '0004_mute_events.sql',
      '0005_withdrawn_requests.sql',
    ]);
    // The files production already has are byte for byte what they were.
    expect(mail.slice(0, 2)).toEqual(mailBefore);
    expect(pulse.slice(0, 4)).toEqual(pulseBefore);
    // The four readers now ask the combined guards.
    const bodies = await Promise.all(
      readers.map(
        async (signature) =>
          (await f.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature]))
            .rows[0].d as string,
      ),
    );
    for (const body of bodies) expect(body).toMatch(/_block_reason\(/);
    await migrateCustomerMissionMail(f.owner);
    await migrateCustomerNotifications(f.owner);
    expect(await applied('customer_mission_mail_migrations')).toEqual(mail);
    expect(await applied('customer_notification_migrations')).toEqual(pulse);
  });

  test('once the installed mail modules are upgraded, opening withdrawals succeeds', async () => {
    await expect(
      configureRequestWithdrawal(f.owner, {
        enabled: true,
        reason: 'Opening withdrawals for the first customers',
      }),
    ).resolves.toEqual({ enabled: true, changed: true });
  });
});

describe('the install script', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  test('installs withdrawal in the base run, before the optional mail installs, and lists it in the report', () => {
    const base = script.indexOf(
      "['request withdrawal (its control stays closed)', migrateCustomerRequestWithdrawal]",
    );
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(script.indexOf('const pool = databasePool'));
    expect(script.indexOf("'customer_request_withdrawal_migrations',")).toBeGreaterThan(0);
    expect(script.indexOf('for (const [name, install] of installers)')).toBeLessThan(
      script.indexOf("if (v.MISSION_MAIL_ACTION !== 'unchanged') {"),
    );
  });
  test('keeps enable and pause, with a reason, out of the base run and out of the workflow', () => {
    expect(script).toContain("REQUEST_WITHDRAWAL_ACTION: z.enum(['unchanged', 'enable', 'pause'])");
    expect(script).toContain('Request withdrawal changes require an explicit reason');
    const workflow = readFileSync(
      resolve('.github/workflows/install-customer-modules.yml'),
      'utf8',
    );
    expect(workflow).not.toContain('REQUEST_WITHDRAWAL');
    expect(workflow).not.toContain('request_withdrawal');
  });
});
