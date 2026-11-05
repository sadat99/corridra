import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { withTenant } from '../../packages/db/src/index';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerInboxService } from '../../apps/web/lib/customer-inbox';
import { InboxService } from '../../packages/communications/src/inbox';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

const issuer = 'https://ep-reply-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const secret = 'unit-only-replies';
const session = (person = 'alice') => ({
  subject: 'synthetic-reply-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof fixture>>, base: MissionService, inbox: InboxService;
let workspaceId: string;
const request = () => new CustomerRequestService(f.runtime, f.auth, options, async () => session());
const customerInbox = (person = 'alice') =>
  new CustomerInboxService(f.runtime, f.auth, options, async () => session(person), inbox);
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic reply fixture ' + randomUUID(),
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic fixture, never a provider request',
  name: 'Synthetic Person',
  company: 'Synthetic Company',
  email: 'reply@example.invalid',
  acknowledged: true,
});
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const person of ['alice', 'bob']) {
    const principal = await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit synthetic reply-notification fixture, no real provider data',
    });
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principal.id,
      reason: 'Explicit synthetic reply request authority',
    });
    const workspace = await new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
      session(person),
    ).provision({ commandId: randomUUID(), name: 'Synthetic reply workspace ' + person });
    if (person === 'alice') workspaceId = workspace.id;
  }
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await migrateCommercialReadiness(f.owner);
  base = new MissionService(f.runtime, secret);
  inbox = new InboxService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});
async function ownedMission() {
  const owned = await request().submit(
    { commandId: randomUUID(), workspaceId, brief: brief() },
    base.prepareCustomerIntake.bind(base),
  );
  const row = await f.owner.query(
    'SELECT mission_id FROM customer_private.owned_request WHERE id=$1',
    [owned.id],
  );
  return { requestId: owned.id, missionId: row.rows[0].mission_id as string };
}
function notified(failMail = false) {
  const sent: { id: string; replies: number; notices: number }[] = [];
  const service = new MissionService(f.runtime, secret, 'synthetic', async (db, replyId) => {
    const receipt = await inbox.recordReplyPosted(db, replyId);
    if (!receipt) return undefined;
    return async () => {
      const visible = await f.owner.query(
        `SELECT
        (SELECT count(*)::int FROM app.mission_reply WHERE id=$1) replies,
        (SELECT count(*)::int FROM app.inbox_notification WHERE id=$2) notices`,
        [replyId, receipt.id],
      );
      sent.push({ id: receipt.id, ...visible.rows[0] });
      if (failMail) throw Error('Synthetic transport unavailable');
    };
  });
  return { service, sent };
}
async function notices(requestId: string, person = 'alice') {
  return (await customerInbox(person).list()).filter(
    (item) =>
      item.type === 'REPLY_POSTED' && item.payload.href === '/account/requests/' + requestId,
  );
}
test('the actual reply producer commits one private-owner inbox item and sends only after commit', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID(),
    n = notified();
  const result = await n.service.reply(
    f.users.operator.ctx,
    owned.missionId,
    'Synthetic private reply body',
    replyId,
  );
  expect(result).toEqual({ id: replyId });
  expect(n.sent).toHaveLength(1);
  expect(n.sent[0]).toMatchObject({ replies: 1, notices: 1 });
  const items = await notices(owned.requestId);
  expect(items).toHaveLength(1);
  expect(items[0].payload).toEqual({
    title: 'There is a new reply',
    href: '/account/requests/' + owned.requestId,
  });
  expect(JSON.stringify(items)).not.toContain('Synthetic private reply body');
  expect(JSON.stringify(items)).not.toContain('reply@example.invalid');
  expect(await notices(owned.requestId, 'bob')).toHaveLength(0);
});
test('concurrent retry and failed transport preserve one reply, one inbox item and the same delivery key', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID(),
    n = notified(true);
  await Promise.all(
    [1, 2].map(() =>
      n.service.reply(f.users.operator.ctx, owned.missionId, 'Synthetic retry reply', replyId),
    ),
  );
  expect(n.sent).toHaveLength(2);
  expect(new Set(n.sent.map((item) => item.id)).size).toBe(1);
  expect(await notices(owned.requestId)).toHaveLength(1);
  await expect(
    n.service.reply(f.users.operator.ctx, owned.missionId, 'Changed retry body', replyId),
  ).rejects.toThrow('key reused');
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.mission_reply WHERE id=$1', [replyId]))
      .rows[0].n,
  ).toBe(1);
});
test('viewer, foreign tenant and another author cannot manufacture a reply notice', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID(),
    n = notified();
  await expect(
    n.service.reply(f.users.viewer.ctx, owned.missionId, 'Synthetic denied reply', replyId),
  ).rejects.toThrow('Access denied');
  await expect(
    n.service.reply(f.users.other.ctx, owned.missionId, 'Synthetic foreign reply', replyId),
  ).rejects.toThrow();
  await base.reply(f.users.operator.ctx, owned.missionId, 'Synthetic original author', replyId);
  await expect(
    withTenant(f.runtime, f.users.owner.ctx, 'missions.read', ({ db }) =>
      inbox.recordReplyPosted(db, replyId),
    ),
  ).rejects.toThrow('denied');
  await expect(
    withTenant(f.runtime, f.users.viewer.ctx, 'missions.read', ({ db }) =>
      inbox.recordReplyPosted(db, replyId),
    ),
  ).rejects.toThrow('denied');
  expect(await notices(owned.requestId)).toHaveLength(0);
});
test('anonymous receipts do not acquire an invented customer recipient', async () => {
  const mission = await base.submit(randomUUID(), brief()),
    n = notified();
  await n.service.reply(
    f.users.operator.ctx,
    mission.id!,
    'Synthetic anonymous receipt reply',
    randomUUID(),
  );
  expect(n.sent).toHaveLength(0);
  expect((await base.receipt(mission.receipt!)).replies).toHaveLength(1);
});
test('optional notice failure preserves the reply and rolls back only the partial inbox item', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID();
  const service = new MissionService(f.runtime, secret, 'synthetic', async (db, id) => {
    await inbox.recordReplyPosted(db, id);
    throw Error('Synthetic recorder failure');
  });
  await expect(
    service.reply(f.users.operator.ctx, owned.missionId, 'Synthetic retained reply', replyId),
  ).resolves.toEqual({ id: replyId });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.mission_reply WHERE id=$1', [replyId]))
      .rows[0].n,
  ).toBe(1);
  expect(await notices(owned.requestId)).toHaveLength(0);
});
test('revoked private requests receive no new notice while existing staff reply behavior stays intact', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID(),
    n = notified();
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: owned.requestId,
    reason: 'Synthetic private request revocation before reply notification',
  });
  expect(
    await n.service.reply(
      f.users.operator.ctx,
      owned.missionId,
      'Synthetic revoked-scope reply',
      replyId,
    ),
  ).toEqual({ id: replyId });
  expect(n.sent).toHaveLength(0);
  expect(await notices(owned.requestId)).toHaveLength(0);
});
test('code deployed before optional SQL installation retains the existing reply action', async () => {
  const owned = await ownedMission(),
    replyId = randomUUID(),
    n = notified();
  await f.owner.query(
    'ALTER FUNCTION app.record_reply_posted(uuid) RENAME TO reply_posted_fixture_hold',
  );
  try {
    expect(
      await n.service.reply(
        f.users.operator.ctx,
        owned.missionId,
        'Synthetic old-schema reply',
        replyId,
      ),
    ).toEqual({ id: replyId });
    expect(n.sent).toHaveLength(0);
    expect(await notices(owned.requestId)).toHaveLength(0);
  } finally {
    await f.owner.query(
      'ALTER FUNCTION app.reply_posted_fixture_hold(uuid) RENAME TO record_reply_posted',
    );
  }
});
test('the authentication login has no execute grant on the notification recorder', async () => {
  expect(
    (
      await f.owner.query(
        "SELECT has_function_privilege('corridra_auth','app.record_reply_posted(uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});
