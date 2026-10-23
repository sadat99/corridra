import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMissionMail } from '../../packages/auth/src/customer-mission-mail-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';
import {
  MissionMailService,
  type MissionMailJob,
  type MissionMailPort,
} from '../../packages/auth/src/mission-mail';
import type { MailSender } from '../../packages/auth/src/customer-auth-mail';

// The whole path, with the real database and roles, the real request service and the real templates.
// Only the email provider is replaced, by a recorder.
const issuer = 'https://ep-mission-mail-flow.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secret = 'mission-mail-flow-test-secret-0123456789abcdef';
const reason = 'Owner approved mission mail for the local flow tests';
const env = {
  DATA_ENVIRONMENT: 'real',
  CORRIDRA_REAL_USE_ENABLED: 'true',
  CORRIDRA_MISSION_EMAIL_ENABLED: 'true',
  CORRIDRA_CUSTOMER_CODE_SIGNIN: 'true',
  MISSION_EMAIL_FOUNDER_LINE: 'We will get back to you shortly, once we have done the checks.',
  APP_ORIGIN: 'https://corridra.test',
  NEON_AUTH_BASE_URL: 'https://ep-flow.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
  CUSTOMER_AUTH_MAIL_KEY: 'resend-test-key-0123456789',
  CUSTOMER_AUTH_MAIL_FROM: 'sender@mail.corridra.test',
  CUSTOMER_AUTH_MAIL_REPLY_TO: 'reply@corridra.test',
} as NodeJS.ProcessEnv;

let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;
type Sent = { to: string; subject: string; html: string; text: string; key: string };
const sent: Sent[] = [];
let failNext = 0;
const sender: MailSender = async ({ to, message, idempotencyKey }) => {
  if (failNext > 0) {
    failNext -= 1;
    throw new Error('provider down');
  }
  sent.push({
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    key: idempotencyKey,
  });
};
let service: MissionMailService;
const dispatched: MissionMailJob[] = [];
const port = (): MissionMailPort => ({
  enqueue: (db, input) => service.enqueue(db, input),
  dispatch: async (job) => {
    dispatched.push(job);
  },
});

const briefFor = (email: string, objective = 'Sell in a new market') => ({
  objective,
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors',
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Amina Rahman',
  company: 'Hospitality supplier',
  email,
  acknowledged: true,
});

async function submitRequest(options: { withPort: boolean; objective?: string }) {
  const email = `owner-${randomUUID()}@acme-textiles.com`;
  const subject = randomUUID();
  const customer = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({ subject, email, emailVerified: true, expiresAt: new Date(Date.now() + 60000) }),
    options.withPort ? port() : undefined,
  );
  const staged = await missions.stagePendingRequest(
    randomUUID(),
    briefFor(email, options.objective),
  );
  const claimed = await customer.claimPending(
    missions.pendingRequestCapability(staged.cookie),
    (ctx, input) => missions.prepareCustomerIntake(ctx, input),
  );
  return { email, requestId: claimed.id as string };
}
const queueRows = async (requestId: string) =>
  (
    await f.owner.query('SELECT * FROM customer_private.mission_mail_queue WHERE request_id=$1', [
      requestId,
    ])
  ).rows;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerMissionMail(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the mission mail flow tests',
  });
  missions = new MissionService(f.runtime, 'mission-mail-flow-intake-local-secret', 'real');
  service = new MissionMailService(f.runtime, secret, sender);
});
afterAll(async () => {
  await f?.close();
});

describe('with the switch off or the control closed', () => {
  test('a request is stored exactly as before and no mail is queued, with or without the port', async () => {
    const without = await submitRequest({ withPort: false });
    expect(await queueRows(without.requestId)).toHaveLength(0);
    // The port exists but the database control is closed: the request still succeeds, nothing is queued.
    const closed = await submitRequest({ withPort: true });
    expect(closed.requestId).toBeTruthy();
    expect(await queueRows(closed.requestId)).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });
});

describe('with the control open', () => {
  beforeAll(async () => {
    await configureMissionMail(f.owner, { enabled: true, reason });
  });

  test('queues inside the request, starts delivery only after it commits, and sends one email', async () => {
    const r = await submitRequest({ withPort: true });
    const rows = await queueRows(r.requestId);
    expect(rows).toHaveLength(1);
    expect(dispatched.at(-1)).toMatchObject({
      queueId: rows[0].id,
      requestId: r.requestId,
      kind: 'request-received',
    });
    expect(await service.send(dispatched.at(-1)!, env)).toBe('SENT');
    const mail = sent.at(-1)!;
    expect(mail.to).toBe(r.email.toLowerCase());
    expect(mail.subject).toBe('We have your request');
    expect(mail.key).toBe(`mission-mail:${rows[0].id}`);
    expect(mail.text).toContain('Hi Amina Rahman,');
    expect(mail.text).toContain('Your request about selling in a new market has reached us');
    expect(mail.text).toContain(
      'Sign in with your email address and a code, or with your password.',
    );
    expect(mail.text).toContain(env.MISSION_EMAIL_FOUNDER_LINE);
    expect(mail.text).toContain(
      `See your request: https://corridra.test/account/requests/${r.requestId}`,
    );
    expect(mail.text).toContain(`Manage messages: https://corridra.test/account`);
    expect(mail.text).toMatch(
      new RegExp(
        `Mute this request: https://corridra\\.test/mute/${r.requestId}#t=[A-Za-z0-9_-]{43}`,
      ),
    );
    // Done: marked sent, the address is gone, a second attempt sends nothing.
    expect((await queueRows(r.requestId))[0].status).toBe('SENT');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.mission_mail_recipient WHERE queue_id=$1',
          [rows[0].id],
        )
      ).rows[0].n,
    ).toBe(0);
    const before = sent.length;
    expect(await service.send(dispatched.at(-1)!, env)).toBe('SENT');
    expect(sent).toHaveLength(before);
  });

  test('a free text objective gets the version without the job phrase', async () => {
    const r = await submitRequest({ withPort: true, objective: 'Something else' });
    await service.send(dispatched.at(-1)!, env);
    expect(sent.at(-1)!.text).toContain(
      'Your request has reached us, and a person on our team will read it.',
    );
    expect(sent.at(-1)!.text).not.toContain('request about');
    expect(r.requestId).toBeTruthy();
  });

  test('a failing provider is retried with a cap, then ends, and the address is removed', async () => {
    const r = await submitRequest({ withPort: true });
    const job = dispatched.at(-1)!;
    const before = sent.length;
    failNext = 3;
    expect(await service.send(job, env)).toBe('RETRY');
    expect(await service.send(job, env)).toBe('WAIT');
    for (const attempt of [2, 3]) {
      await f.owner.query(
        'UPDATE customer_private.mission_mail_queue SET available_at=clock_timestamp() WHERE id=$1',
        [job.queueId],
      );
      expect(await service.send(job, env)).toBe(attempt === 3 ? 'DEAD' : 'RETRY');
    }
    expect(sent).toHaveLength(before);
    expect((await queueRows(r.requestId))[0].status).toBe('DEAD');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.mission_mail_recipient WHERE queue_id=$1',
          [job.queueId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('the mute link in the email stops other mail for that request and nobody else', async () => {
    const a = await submitRequest({ withPort: true });
    const jobA = dispatched.at(-1)!;
    const b = await submitRequest({ withPort: true });
    const jobB = dispatched.at(-1)!;
    await service.send(jobA, env);
    const link = sent.at(-1)!.text.match(/Mute this request: (\S+)/)![1];
    const token = new URL(link).hash.replace('#t=', '');
    expect(new URL(link).pathname).toBe(`/mute/${a.requestId}`);
    expect(await service.mute(a.requestId, token)).toEqual({ muted: true, already: false });
    await expect(service.mute(b.requestId, token)).rejects.toMatchObject({ code: '42501' });
    // B was queued before and is still sent: a mute is scoped to one request.
    expect(await service.send(jobB, env)).toBe('SENT');
    // A new message for A is refused.
    const again = await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.mission_mail_mute WHERE request_id=$1',
      [a.requestId],
    );
    expect(again.rows[0].n).toBe(1);
  });

  test('a mail problem never fails or undoes the request', async () => {
    const broken = new MissionMailService(f.runtime, 'short', sender);
    const email = `owner-${randomUUID()}@acme-textiles.com`;
    const subject = randomUUID();
    const customer = new CustomerRequestService(
      f.runtime,
      f.auth,
      {
        enabled: true,
        synthetic: false,
        production: false,
        issuer,
        dataMode: 'real',
        openAdmission: true,
      },
      async () => ({
        subject,
        email,
        emailVerified: true,
        expiresAt: new Date(Date.now() + 60000),
      }),
      { enqueue: (db, input) => broken.enqueue(db, input), dispatch: async () => undefined },
    );
    const staged = await missions.stagePendingRequest(randomUUID(), briefFor(email));
    const claimed = await customer.claimPending(
      missions.pendingRequestCapability(staged.cookie),
      (ctx, input) => missions.prepareCustomerIntake(ctx, input),
    );
    expect(claimed.id).toBeTruthy();
    expect(await queueRows(claimed.id)).toHaveLength(0);
    // A database-side failure inside the savepoint is also contained.
    const dbBroken = new MissionMailService(f.runtime, secret, sender);
    await f.owner.query(
      'ALTER FUNCTION customer.enqueue_mission_mail(uuid,text,text,text,text,text,text,text) RENAME TO enqueue_mission_mail_off',
    );
    try {
      const r = await (async () => {
        const e2 = `owner-${randomUUID()}@acme-textiles.com`;
        const s2 = randomUUID();
        const c2 = new CustomerRequestService(
          f.runtime,
          f.auth,
          {
            enabled: true,
            synthetic: false,
            production: false,
            issuer,
            dataMode: 'real',
            openAdmission: true,
          },
          async () => ({
            subject: s2,
            email: e2,
            emailVerified: true,
            expiresAt: new Date(Date.now() + 60000),
          }),
          { enqueue: (db, input) => dbBroken.enqueue(db, input), dispatch: async () => undefined },
        );
        const st = await missions.stagePendingRequest(randomUUID(), briefFor(e2));
        return c2.claimPending(missions.pendingRequestCapability(st.cookie), (ctx, input) =>
          missions.prepareCustomerIntake(ctx, input),
        );
      })();
      expect(r.id).toBeTruthy();
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.enqueue_mission_mail_off(uuid,text,text,text,text,text,text,text) RENAME TO enqueue_mission_mail',
      );
    }
  });
});

describe('the application switch and settings', () => {
  test('with the application switch off, or the sender settings missing, nothing is claimed or sent', async () => {
    const r = await submitRequest({ withPort: true });
    const job = dispatched.at(-1)!;
    const before = sent.length;
    expect(await service.send(job, { ...env, CORRIDRA_MISSION_EMAIL_ENABLED: undefined })).toBe(
      'UNAVAILABLE',
    );
    expect(await service.send(job, { ...env, CORRIDRA_MISSION_EMAIL_ENABLED: 'TRUE' })).toBe(
      'UNAVAILABLE',
    );
    expect(await service.send(job, { ...env, CUSTOMER_AUTH_MAIL_KEY: undefined })).toBe(
      'UNAVAILABLE',
    );
    expect(await service.send(job, { ...env, DATA_ENVIRONMENT: 'synthetic' })).toBe('UNAVAILABLE');
    expect(sent).toHaveLength(before);
    const row = (await queueRows(r.requestId))[0];
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(0);
    expect(await service.send(job, env)).toBe('SENT');
  });

  test('closing the database control stops sending without losing the record', async () => {
    const r = await submitRequest({ withPort: true });
    const job = dispatched.at(-1)!;
    await configureMissionMail(f.owner, { enabled: false, reason });
    const before = sent.length;
    expect(await service.send(job, env)).toBe('CLOSED');
    expect(sent).toHaveLength(before);
    expect((await queueRows(r.requestId))[0].status).toBe('PENDING');
    await configureMissionMail(f.owner, { enabled: true, reason });
    expect(await service.send(job, env)).toBe('SENT');
  });
});
