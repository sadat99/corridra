import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  Probe,
  appliedNames,
  applyFiles,
  hideNewFiles,
  openNewFiles,
  sha,
} from './removed-member-support';
import { fixture } from './support';
import { withTenant, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMissionMail } from '../../packages/auth/src/customer-mission-mail-configuration';
import { configureNotifications } from '../../packages/auth/src/customer-notification-configuration';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { MissionService } from '../../packages/missions/src/index';
import { MissionMoveService } from '../../packages/missions/src/moves';
import { signMissionMailMute } from '../../packages/auth/src/mission-mail-mute';

// Removed members, mission mail and Pulse notifications (owner decision, 11 Nov 2026: "No, remove access (Recommended)").
// Built on the state production is in today: mission mail 0001 and 0002, notifications 0001 to 0004 and move records 0001,
// no request withdrawal. The new files then arrive the way the installer brings them. A message queued for a request whose
// author has since left is suppressed at claim and never revived, a new message for it is refused with the reason "removed",
// Move notifications skip it, the no-sign-in mute link still works, a withdrawn request keeps its own reason, and a new
// invitation lets new messages queue again. Real mode: mission mail only exists for real sessions. Fails on main.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

const issuer = 'https://ep-removed-mail.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secret = 'removed-member-mail-secret-0123456789';
const realOptions = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  dataMode: 'real' as const,
  openAdmission: true,
};
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;
let moves: MissionMoveService;
let W: string;
const requests: Record<string, string[]> = {};
const missionTenant: Record<string, string> = {};
const members: Record<string, string> = {};
const capability: Record<string, string> = {};
let oldMail: { name: string; sha256: string }[];
let oldPulse: { name: string; sha256: string }[];
const session = (person: string) => ({
  subject: `removed-mail-${person}`,
  email: `${person}@acme-textiles.com`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
  signedInAt: new Date(),
});
const as = <T>(person: string, work: (db: DatabaseClient) => Promise<T>) =>
  new Probe(f.runtime, f.auth, realOptions, async () => session(person)).run(work);
const sql = async (person: string, text: string, args: unknown[] = []) =>
  as<Record<string, unknown>>(person, async (db) => (await db.query(text, args)).rows[0]);
const workspaces = (person: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, realOptions, async () => session(person));
const realBrief = (person: string) => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors ' + randomUUID(),
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email: session(person).email,
  acknowledged: true,
});
const submit = async (person: string, target = W) => {
  const result = await new CustomerRequestService(f.runtime, f.auth, realOptions, async () =>
    session(person),
  ).submit({ commandId: randomUUID(), workspaceId: target, brief: realBrief(person) }, (c, b) =>
    missions.prepareCustomerIntake(c, b),
  );
  return result.id as string;
};
const join = async (person: string) => {
  const invitation = await workspaces('olive').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: W,
    label: `Invited ${person}`,
  });
  return (
    await workspaces(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token!,
    })
  ).memberId as string;
};
const leave = (person: string) =>
  new CustomerMemberRoleService(f.runtime, f.auth, realOptions, async () =>
    session(person),
  ).command({
    action: 'leave',
    commandId: randomUUID(),
    workspaceId: W,
  });
const enqueue = async (person: string, request: string, key: string) => {
  capability[`${request}:${key}`] = `capability-${randomBytes(24).toString('hex')}`;
  return (
    await sql(person, 'SELECT customer.enqueue_mission_mail($1,$2,$3,$4,$5,$6,$7,$8) AS r', [
      request,
      'request-received',
      key,
      session(person).email,
      'Amina Rahman',
      'Sell in a new market: Spain',
      sha(capability[`${request}:${key}`]!),
      sha(signMissionMailMute(secret, request)),
    ])
  ).r as { queued: boolean; reason?: string; id?: string };
};
const claim = async (id: string, key: string) =>
  (await f.runtime.query('SELECT customer.claim_mission_mail($1,$2) AS r', [id, capability[key]]))
    .rows[0].r as { status: string };
const queueRow = async (id: string) =>
  (await f.owner.query('SELECT * FROM customer_private.mission_mail_queue WHERE id=$1', [id]))
    .rows[0];
const addressRows = async (id: string) =>
  (
    await f.owner.query('SELECT 1 FROM customer_private.mission_mail_recipient WHERE queue_id=$1', [
      id,
    ])
  ).rowCount;
const staffCtx = (person: string) => ({
  ...f.users.operator.ctx,
  tenantId: missionTenant[person]!,
});
// The Corridra team sets a Move, and the same staff transaction asks for Move notifications, as the application does.
async function moveNotifications(person: string, request: string) {
  const mission = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      request,
    ])
  ).rows[0].mission_id as string;
  const ctx = staffCtx(person);
  const commandId = randomUUID();
  await moves.command(ctx, {
    action: 'set',
    commandId,
    missionId: mission,
    expectedVersion: await moves.version(ctx, mission),
    moves: [
      {
        verb: 'Add',
        holder: 'customer',
        dueOn: null,
        object: 'your licence number',
      },
    ],
  });
  return withTenant(f.runtime, ctx, 'missions.manage', async ({ db }) => {
    const r = await db.query('SELECT customer.enqueue_move_notifications($1) AS r', [commandId]);
    return r.rows[0].r as { queued: number; reason: string | null };
  });
}
const savePreferences = (person: string) =>
  sql(person, 'SELECT customer.set_notification_preferences($1,$2,$3,$4,$5,$6) AS r', [
    ['your-move', 'update', 'countdown', 'complete'],
    false,
    null,
    null,
    'UTC',
    null,
  ]);

beforeAll(async () => {
  // The state production is in: no new file anywhere, mail 0001 and 0002, notifications 0001 to 0004, no withdrawal module.
  hideNewFiles();
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMoves(f.owner);
  await applyFiles(
    f.owner,
    'customer-mission-mail-migrations',
    'customer_mission_mail_migrations',
    ['0001_mission_mail.sql', '0002_mute_events.sql'],
  );
  await applyFiles(
    f.owner,
    'customer-notification-migrations',
    'customer_notification_migrations',
    [
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
      '0003_withdrawal_and_issuer_check.sql',
      '0004_mute_events.sql',
    ],
  );
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the removed member mail tests',
  });
  process.env.CORRIDRA_REAL_USE_ENABLED = 'true';
  process.env.DATA_ENVIRONMENT = 'real';
  missions = new MissionService(f.runtime, secret, 'real');
  moves = new MissionMoveService(f.runtime);
  oldMail = (
    await f.owner.query(
      'SELECT name,sha256 FROM customer_mission_mail_migrations.applied ORDER BY name',
    )
  ).rows;
  oldPulse = (
    await f.owner.query(
      'SELECT name,sha256 FROM customer_notification_migrations.applied ORDER BY name',
    )
  ).rows;
  // The upgrade, the way the installer does it: base run and real-use, then withdrawal, mail and notifications.
  openNewFiles();
  await migrateCustomerRealUse(f.owner);
  await migrateCommercialReadiness(f.owner);
  await migrateCustomerRequestWithdrawal(f.owner);
  await migrateCustomerMissionMail(f.owner);
  await migrateCustomerNotifications(f.owner);
  await configureMoveRecords(f.owner, {
    enabled: true,
    reason: 'Owner approved Move records for the mail tests',
  });
  await configureMissionMail(f.owner, {
    enabled: true,
    reason: 'Owner approved mission mail for the mail tests',
  });
  await configureNotifications(f.owner, {
    enabled: true,
    reason: 'Owner approved Pulse for the mail tests',
  });
  await configureRequestWithdrawal(f.owner, {
    enabled: true,
    reason: 'Owner approved withdrawal for the mail tests',
  });
  W = (
    await workspaces('olive').provision({
      commandId: randomUUID(),
      name: 'Mail workspace of olive',
    })
  ).id;
  for (const person of ['lena', 'sam', 'wil']) members[person] = await join(person);
  for (const person of ['olive', 'lena', 'sam', 'wil']) {
    requests[person] = [await submit(person), await submit(person)];
    missionTenant[person] = (
      await f.owner.query(
        'SELECT mission_tenant_id FROM customer_private.owned_request WHERE id=$1',
        [requests[person]![0]],
      )
    ).rows[0].mission_tenant_id;
  }
  for (const person of ['lena', 'sam']) await savePreferences(person);
}, 900000);
afterAll(async () => {
  delete process.env.CORRIDRA_REAL_USE_ENABLED;
  delete process.env.DATA_ENVIRONMENT;
  await f?.close();
});

describe('the upgrade from the production state', () => {
  test('mail gains 0003 and 0004 and notifications 0005 and 0006, and the installed files keep their hashes', async () => {
    expect(await appliedNames(f.owner, 'customer_mission_mail_migrations')).toEqual([
      '0001_mission_mail.sql',
      '0002_mute_events.sql',
      '0003_withdrawn_requests.sql',
      '0004_removed_member_mail.sql',
    ]);
    expect(await appliedNames(f.owner, 'customer_notification_migrations')).toEqual([
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
      '0003_withdrawal_and_issuer_check.sql',
      '0004_mute_events.sql',
      '0005_withdrawn_requests.sql',
      '0006_removed_member_notifications.sql',
    ]);
    const mail = (
      await f.owner.query(
        'SELECT name,sha256 FROM customer_mission_mail_migrations.applied ORDER BY name',
      )
    ).rows;
    const pulse = (
      await f.owner.query(
        'SELECT name,sha256 FROM customer_notification_migrations.applied ORDER BY name',
      )
    ).rows;
    expect(mail.slice(0, 2)).toEqual(oldMail);
    expect(pulse.slice(0, 4)).toEqual(oldPulse);
  });
});

describe('a current member and a member who leaves', () => {
  const queued: Record<string, string> = {};
  test('CONTROL (holds on main too): while members, both queue mail', async () => {
    for (const [person, key] of [
      ['lena', 'before'],
      ['lena', 'mutable'],
      ['sam', 'sam'],
    ] as const) {
      const result = await enqueue(person, requests[person]![0]!, key);
      expect(result.queued, `${person} ${key}`).toBe(true);
      queued[`${person}:${key}`] = result.id!;
    }
  });

  test('CONTROL (holds on main too): lena leaves', async () => {
    await leave('lena');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_access_revocation r JOIN customer_private.workspace_member m ON m.id=r.member_id WHERE m.id=$1',
          [members.lena],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('a message queued before she left is suppressed at claim, loses its address, and sam is unaffected', async () => {
    const id = queued['lena:before']!;
    expect(await claim(id, `${requests.lena![0]}:before`)).toEqual({ status: 'SUPPRESSED' });
    expect((await queueRow(id)).status).toBe('SUPPRESSED');
    expect(await addressRows(id)).toBe(0);
    expect((await claim(queued['sam:sam']!, `${requests.sam![0]}:sam`)).status).toBe('CLAIMED');
  });

  test('a new message for either of her requests is refused with the reason removed, and writes no row', async () => {
    for (const request of requests.lena!) {
      expect(await enqueue('lena', request, 'after')).toEqual({ queued: false, reason: 'removed' });
      expect(
        (
          await f.owner.query(
            "SELECT count(*)::int AS n FROM customer_private.mission_mail_queue WHERE request_id=$1 AND dedupe_key='after'",
            [request],
          )
        ).rows[0].n,
      ).toBe(0);
    }
    expect((await enqueue('sam', requests.sam![0]!, 'later')).queued).toBe(true);
  });

  test('the mute link still works with no sign-in, and is the only thing she can do about the request', async () => {
    const request = requests.lena![0]!;
    const token = signMissionMailMute(secret, request);
    const muted = (
      await f.runtime.query('SELECT customer.mute_mission_mail($1,$2) AS r', [request, token])
    ).rows[0].r;
    expect(muted).toMatchObject({ muted: true });
    expect((await queueRow(queued['lena:mutable']!)).status).toBe('SUPPRESSED');
    // Signed in she cannot change the mute: the request is not hers any more.
    await expect(
      sql('lena', 'SELECT customer.set_mission_mail_mute($1,$2,false) AS r', [
        request,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501', message: 'Request is not available' });
    expect((await sql('lena', 'SELECT customer.my_mission_mail_mutes() AS r')).r).toEqual([]);
  });

  test('Move notifications skip her request with the reason removed and still queue for sam', async () => {
    const reasonOf = (
      await f.owner.query(
        'SELECT customer_private.notification_block_reason($1,clock_timestamp()) AS r',
        [requests.lena![1]],
      )
    ).rows[0].r;
    expect(reasonOf).toBe('removed');
    expect(
      (
        await f.owner.query(
          'SELECT customer_private.notification_block_reason($1,clock_timestamp()) AS r',
          [requests.sam![1]],
        )
      ).rows[0].r,
    ).toBeNull();
    expect(await moveNotifications('lena', requests.lena![1]!)).toMatchObject({
      queued: 0,
      reason: 'removed',
    });
    expect(await moveNotifications('sam', requests.sam![1]!)).toMatchObject({ queued: 1 });
    expect((await sql('lena', 'SELECT customer.my_notification_mutes() AS r')).r).toEqual([]);
    await expect(
      sql('lena', 'SELECT customer.set_notification_mute($1,$2,true) AS r', [
        requests.lena![1],
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501', message: 'Request is not available' });
  });

  test('CONTROL (holds on main too): a withdrawn request keeps its own reason when its author has also left', async () => {
    const request = requests.wil![0]!;
    await sql('wil', 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
      request,
      randomUUID(),
      'I sent this to the wrong team and will send it again',
    ]);
    await leave('wil');
    expect(await enqueue('wil', request, 'wil')).toEqual({ queued: false, reason: 'withdrawn' });
  });

  test('a new invitation lets new messages queue again, and the suppressed message stays suppressed', async () => {
    // Between the leave and the new invitation nothing queues and the suppressed message stays suppressed (main queues here).
    expect(await enqueue('lena', requests.lena![1]!, 'between')).toEqual({
      queued: false,
      reason: 'removed',
    });
    expect((await queueRow(queued['lena:before']!)).status).toBe('SUPPRESSED');
    await join('lena');
    const result = await enqueue('lena', requests.lena![1]!, 'again');
    expect(result.queued).toBe(true);
    expect((await queueRow(queued['lena:before']!)).status).toBe('SUPPRESSED');
    expect(await addressRows(queued['lena:before']!)).toBe(0);
    expect(await addressRows(result.id!)).toBe(1);
  });

  test('CONTROL (holds on main too): what is shown stays real: real requests keep their provenance whoever left', async () => {
    const page = (await sql('sam', 'SELECT customer.private_requests(NULL,25) AS r')).r as {
      synthetic: boolean;
      requests: { synthetic: boolean }[];
    };
    expect(page.synthetic).toBe(false);
    expect(page.requests).toHaveLength(2);
    for (const request of page.requests) expect(request.synthetic).toBe(false);
  });
});
