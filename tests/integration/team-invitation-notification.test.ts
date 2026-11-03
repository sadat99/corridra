import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { TeamControl } from '../../packages/auth/src/team-control';

const mail = vi.hoisted(() => ({ notify: vi.fn() }));
let f: Awaited<ReturnType<typeof fixture>>;
let team: TeamControl;
let actor: 'owner' | 'operator' | 'viewer' | 'other' = 'owner';
let signedIn = true;
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'http://localhost:3300' },
    provider: { getSession: async () => (signedIn ? { token: f.users[actor].ctx.token } : null) },
    access: { team: () => team },
  }),
}));
vi.mock('../../apps/web/lib/notify', () => ({ notify: mail.notify }));
vi.mock('../../apps/web/lib/ux-switches', () => ({ uxSwitchOn: () => true }));
import { POST } from '../../apps/web/app/api/team-control/[action]/route';

beforeAll(async () => {
  f = await fixture();
  team = new TeamControl(f.runtime, f.auth);
}, 120000);
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  actor = 'owner';
  signedIn = true;
  mail.notify.mockReset();
  mail.notify.mockResolvedValue({ inbox: 'recorded', email: 'sent' });
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.owner.sessionId,
  ]);
});
const input = () => ({
  commandId: randomUUID(),
  email: `Team-${randomUUID()}@example.invalid`,
  name: 'Synthetic invited colleague',
  role: 'operator',
});
const send = (body: object) =>
  POST(
    new Request(`http://localhost:3300/api/team-control/invites?tenant=${f.tenantA}`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3300', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action: 'invites' }) },
  );
const pending = () => team.invite(f.users.owner.ctx, input());

// Real handler + TeamControl + isolated PostgreSQL. Only provider/notification transport is replaced.
test('initial team invitation supplies its real setup destination to the notification boundary', async () => {
  const response = await send({ action: 'invite', invite: input() });
  expect(response.status).toBe(201);
  expect(mail.notify).toHaveBeenCalledOnce();
  expect(mail.notify.mock.calls[0]![0].payload.href).toBe('/operator/setup');
});
test('resend notifies the stored staff recipient once, rotates the row, and keeps recipient metadata private', async () => {
  const v = input();
  const original = await team.invite(f.users.owner.ctx, v);
  const response = await send({ action: 'resend', invitationId: original.id });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.id).not.toBe(original.id);
  expect(body.notification).toEqual({ inbox: 'recorded', email: 'sent' });
  expect(body).not.toHaveProperty('notificationRecipient');
  expect(body).not.toHaveProperty('email');
  expect(mail.notify).toHaveBeenCalledOnce();
  const n = mail.notify.mock.calls[0]![0];
  expect({
    type: n.type,
    account: n.recipientAccountId,
    email: n.recipientEmail,
    role: n.payload.role,
    href: n.payload.href,
  }).toEqual({
    type: 'TEAM_INVITE',
    account: original.principalId,
    email: v.email.toLowerCase(),
    role: v.role,
    href: '/operator/setup',
  });
  expect(
    (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [original.id]))
      .rowCount,
  ).toBe(0);
});
test('concurrent replay of the consumed invitation produces one renewal and one notification', async () => {
  const v = await pending();
  const responses = await Promise.all([
    send({ action: 'resend', invitationId: v.id }),
    send({ action: 'resend', invitationId: v.id }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 404]);
  expect(mail.notify).toHaveBeenCalledOnce();
});
test('a non-sent email result is returned honestly after the invitation is renewed', async () => {
  const v = await pending();
  mail.notify.mockResolvedValueOnce({ inbox: 'off', email: 'off' });
  const response = await send({ action: 'resend', invitationId: v.id });
  expect(response.status).toBe(201);
  expect((await response.json()).notification).toEqual({ inbox: 'off', email: 'off' });
});
test('an unexpected notification exception preserves the committed renewal and reports no confirmed delivery', async () => {
  const v = await pending();
  mail.notify.mockRejectedValueOnce(new Error('Synthetic transport unavailable'));
  const response = await send({ action: 'resend', invitationId: v.id });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.notification).toEqual({ inbox: 'failed', email: 'not_sent' });
  expect(
    (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [body.id])).rowCount,
  ).toBe(1);
});
test('session, owner, workspace and fresh-MFA denials never invoke notification', async () => {
  const v = await pending();
  signedIn = false;
  expect((await send({ action: 'resend', invitationId: v.id })).status).toBe(401);
  signedIn = true;
  for (const denied of ['operator', 'viewer', 'other'] as const) {
    actor = denied;
    expect((await send({ action: 'resend', invitationId: v.id })).status).toBe(403);
  }
  actor = 'owner';
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  const stale = await send({ action: 'resend', invitationId: v.id });
  expect(stale.status).toBe(401);
  expect(await stale.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  expect(mail.notify).not.toHaveBeenCalled();
});
test('a client cannot replace the stored resend recipient', async () => {
  const v = await pending();
  const response = await send({
    action: 'resend',
    invitationId: v.id,
    recipientEmail: 'replacement@example.invalid',
  });
  expect(response.status).toBe(400);
  expect(mail.notify).not.toHaveBeenCalled();
  expect(
    (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [v.id])).rowCount,
  ).toBe(1);
});
