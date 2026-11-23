import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  RealEmailChannel,
  outreachEventFrom,
  plainAddress,
  realOutreachConfig,
  unsubscribeToken,
  verifyOutreachWebhook,
} from '../../packages/communications/src/real-outreach';

// ADR-090. The real email lane without a database: the switch, test mode, fail-closed config, what leaves and what
// never leaves. Every case counts calls to the network, so "nothing was sent" is measured, not assumed.
const id = '7b0f6d0e-4a55-4c1b-9d3e-2f1c9a5e8b11';
const effect = {
  id,
  capabilityHash: 'a'.repeat(64),
  leaseId: '0d9c2f4e-1b7a-4e0c-8f55-6a3b2c1d0e9f',
};
const secret = 'outreach-channel-test-secret';
const full = {
  CORRIDRA_REAL_OUTREACH: 'true',
  REAL_OUTREACH_MAIL_KEY: 'k'.repeat(24),
  REAL_OUTREACH_MAIL_FROM: 'introductions@mail.business.test',
  REAL_OUTREACH_MAIL_REPLY_TO: 'team@mail.business.test',
  REAL_OUTREACH_WEBHOOK_SECRET: 'whsec_' + Buffer.from('s'.repeat(24)).toString('base64'),
  APP_ORIGIN: 'https://app.business.test',
} as Record<string, string | undefined>;
const recipient = 'sales@supplier.business.test';
let fetched: { url: string; init: RequestInit }[];
let queries: { sql: string; values: unknown[] }[];
let rateOk: boolean;
let providerOk: boolean;
const db = {
  async query(sql: string, values: unknown[] = []) {
    queries.push({ sql, values });
    if (sql.includes('outreach_real_payload'))
      return {
        rows: [
          {
            payload: {
              email: recipient,
              name: 'Supplier contact',
              template: 'Would a short conversation be useful?',
              presentation: {
                company: 'Machinery participant',
                country: 'BD',
                capability: 'Factory expansion',
                fit: 'Declared exports fit',
                evidence: 'Self-declared',
                uncertainty: 'Not verified',
                conversationPurpose: 'Discuss a fit',
                availableDates: 'By agreement',
              },
            },
          },
        ],
      };
    if (sql.includes('outreach_rate_take')) return { rows: [{ ok: rateOk }] };
    if (sql.includes('deliver_real_email')) return { rows: [{ receipt: `${values[3]}:${id}` }] };
    throw new Error('Unexpected query');
  },
};
const channel = (env: Record<string, string | undefined>) =>
  new RealEmailChannel(db as never, secret, () => env as NodeJS.ProcessEnv);
const receipts = () => queries.filter((q) => q.sql.includes('deliver_real_email'));
beforeEach(() => {
  fetched = [];
  queries = [];
  rateOk = true;
  providerOk = true;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    fetched.push({ url: String(url), init });
    return new Response('{}', { status: providerOk ? 200 : 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

test('the switch is off unless it is exactly true, and off sends nothing and reads nothing', async () => {
  for (const value of [undefined, '', 'TRUE', '1', 'yes', 'on']) {
    const env = { ...full, CORRIDRA_REAL_OUTREACH: value };
    expect(realOutreachConfig(env as NodeJS.ProcessEnv).state).toBe('off');
    await expect(channel(env).deliver(effect)).rejects.toThrow('Real outreach is off');
  }
  expect(fetched).toEqual([]);
  expect(queries).toEqual([]);
});

test('test mode is the default and only the exact word live is live', () => {
  for (const value of [undefined, '', 'LIVE', 'Live', ' live', 'live ', 'true', 'production'])
    expect(
      realOutreachConfig({ ...full, CORRIDRA_REAL_OUTREACH_MODE: value } as NodeJS.ProcessEnv),
    ).toMatchObject({ state: 'on', mode: 'test' });
  expect(
    realOutreachConfig({ ...full, CORRIDRA_REAL_OUTREACH_MODE: 'live' } as NodeJS.ProcessEnv),
  ).toMatchObject({ state: 'on', mode: 'live' });
});

test('in test mode no message leaves for an address that is not on the test list', async () => {
  for (const env of [
    full,
    { ...full, CORRIDRA_REAL_OUTREACH_MODE: 'LIVE' },
    { ...full, CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS: 'someone.else@supplier.business.test' },
    { ...full, CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS: 'supplier.business.test,*,@' },
  ]) {
    queries = [];
    expect(await channel(env).deliver(effect)).toBe(`email_test:${id}`);
    expect(receipts().map((q) => q.values.slice(3))).toEqual([['email_test', `sink:${id}`]]);
  }
  expect(fetched).toEqual([]);
});

test('in test mode an address on the test list gets one marked message with both opt-out headers', async () => {
  const env = {
    ...full,
    CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS: ` other@x.test , ${recipient.toUpperCase()} `,
  };
  await channel(env).deliver(effect);
  expect(fetched).toHaveLength(1);
  expect(fetched[0].url).toBe('https://api.resend.com/emails');
  const headers = fetched[0].init.headers as Record<string, string>;
  expect(headers['Idempotency-Key']).toBe(id);
  const body = JSON.parse(String(fetched[0].init.body));
  expect(body.to).toEqual([recipient]);
  expect(body.subject.startsWith('[Test] ')).toBe(true);
  const link = `https://app.business.test/api/outreach/unsubscribe?t=${unsubscribeToken(secret, id)}`;
  expect(body.headers).toEqual({
    'List-Unsubscribe': `<${link}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  expect(body.text).toContain(
    `https://app.business.test/buyer?stop=1#${unsubscribeToken(secret, id)}`,
  );
  expect(body.text).toContain('https://app.business.test/buyer#');
  expect(body.text).not.toContain('—');
  expect(body.tags).toEqual([{ name: 'corridra_message', value: id }]);
  expect(receipts().map((q) => q.values.slice(3))).toEqual([['email_test', `resend:${id}`]]);
});

test('live mode sends one unmarked message and records a real receipt', async () => {
  await channel({ ...full, CORRIDRA_REAL_OUTREACH_MODE: 'live' }).deliver(effect);
  expect(fetched).toHaveLength(1);
  expect(JSON.parse(String(fetched[0].init.body)).subject.startsWith('[Test]')).toBe(false);
  expect(receipts().map((q) => q.values.slice(3))).toEqual([['email', `resend:${id}`]]);
});

test('any missing setting fails closed: nothing is read, sent or recorded, in test and in live mode', async () => {
  for (const mode of [undefined, 'live'])
    for (const name of [
      'REAL_OUTREACH_MAIL_KEY',
      'REAL_OUTREACH_MAIL_FROM',
      'REAL_OUTREACH_MAIL_REPLY_TO',
      'REAL_OUTREACH_WEBHOOK_SECRET',
      'APP_ORIGIN',
    ]) {
      const env = { ...full, CORRIDRA_REAL_OUTREACH_MODE: mode, [name]: undefined };
      expect(realOutreachConfig(env as NodeJS.ProcessEnv).state).toBe('unconfigured');
      await expect(channel(env).deliver(effect)).rejects.toThrow('Real outreach is not set up');
    }
  expect(fetched).toEqual([]);
  expect(queries).toEqual([]);
});

test('a reached limit sends nothing, and a provider failure records no receipt', async () => {
  rateOk = false;
  const live = { ...full, CORRIDRA_REAL_OUTREACH_MODE: 'live' };
  await expect(channel(live).deliver(effect)).rejects.toThrow('Real outreach limit reached');
  expect(fetched).toEqual([]);
  rateOk = true;
  providerOk = false;
  await expect(channel(live).deliver(effect)).rejects.toThrow('Real outreach delivery failed');
  expect(fetched).toHaveLength(1);
  expect(receipts()).toEqual([]);
});

test('limits default low and a setting can only be a whole number in range', () => {
  const limits = (w?: string, g?: string) => {
    const c = realOutreachConfig({
      ...full,
      CORRIDRA_REAL_OUTREACH_DAILY_WORKSPACE_LIMIT: w,
      CORRIDRA_REAL_OUTREACH_DAILY_GLOBAL_LIMIT: g,
    } as NodeJS.ProcessEnv);
    return c.state === 'on' ? [c.workspaceLimit, c.globalLimit] : null;
  };
  expect(limits()).toEqual([20, 100]);
  expect(limits('5', '9')).toEqual([5, 9]);
  for (const bad of ['0', '-1', '1.5', 'many', '100000'])
    expect(limits(bad, bad)).toEqual([20, 100]);
});

const sign = (key: string, msgId: string, at: number, body: string) =>
  'v1,' +
  createHmac('sha256', Buffer.from(key.slice(6), 'base64'))
    .update(`${msgId}.${at}.${body}`)
    .digest('base64');
test('a provider notice is accepted only with a current, correct signature and a set secret', () => {
  const key = full.REAL_OUTREACH_WEBHOOK_SECRET as string;
  const now = 1_800_000_000_000;
  const at = now / 1000;
  const body = JSON.stringify({ type: 'email.bounced' });
  const headers = (signature: string, time = at) =>
    new Headers({
      'svix-id': 'msg_1',
      'svix-timestamp': String(time),
      'svix-signature': signature,
    });
  const good = sign(key, 'msg_1', at, body);
  expect(verifyOutreachWebhook(key, headers(good), body, now)).toBe(true);
  expect(verifyOutreachWebhook(key, headers(`v1,AAAA ${good}`), body, now)).toBe(true);
  expect(verifyOutreachWebhook(key, headers(good), body + ' ', now)).toBe(false);
  expect(verifyOutreachWebhook(key, headers('v1,' + 'A'.repeat(44)), body, now)).toBe(false);
  expect(
    verifyOutreachWebhook(key, headers(sign(key, 'msg_1', at - 301, body), at - 301), body, now),
  ).toBe(false);
  expect(
    verifyOutreachWebhook(key, headers(sign(key, 'msg_1', at + 301, body), at + 301), body, now),
  ).toBe(false);
  expect(verifyOutreachWebhook(key, new Headers(), body, now)).toBe(false);
  for (const none of [undefined, '', 'whsec_'])
    expect(verifyOutreachWebhook(none, headers(good), body, now)).toBe(false);
});

test('only bounces, complaints and deliveries of a tagged message become events, with no address kept', () => {
  const notice = (type: string, extra: object = {}) => ({
    type,
    data: { to: [recipient], tags: { corridra_message: id }, ...extra },
  });
  expect(outreachEventFrom(notice('email.bounced', { bounce: { type: 'Permanent' } }))).toEqual({
    messageId: id,
    kind: 'BOUNCED',
    hard: true,
  });
  expect(outreachEventFrom(notice('email.bounced', { bounce: { type: 'Transient' } }))).toEqual({
    messageId: id,
    kind: 'BOUNCED',
    hard: false,
  });
  expect(outreachEventFrom(notice('email.complained'))).toEqual({
    messageId: id,
    kind: 'COMPLAINED',
    hard: true,
  });
  expect(outreachEventFrom(notice('email.delivered'))).toEqual({
    messageId: id,
    kind: 'DELIVERED',
    hard: false,
  });
  expect(outreachEventFrom(notice('email.opened'))).toBeNull();
  expect(outreachEventFrom({ type: 'email.bounced', data: { tags: {} } })).toBeNull();
  expect(
    outreachEventFrom({ type: 'email.bounced', data: { tags: { corridra_message: 'x' } } }),
  ).toBeNull();
  expect(outreachEventFrom(null)).toBeNull();
});

test('the address check accepts and refuses what the earlier pattern did, and stays fast on hostile input', () => {
  const earlier = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
  const cases = [
    'a@b.c',
    'sales@supplier.business.test',
    'first.last+tag@sub.domain.example',
    'a@.b.c',
    'a@b..c',
    'a@b.c.',
    'a@.b',
    'a@b.',
    'a@b',
    '@b.c',
    'a@@b.c',
    'a@b@c.d',
    'a b@c.d',
    'a@b c.d',
    'a,b@c.d',
    '<a@b.c>',
    'a@b.c\n',
    '',
    '.',
    '@',
    '!@!.',
    '!@!.!',
  ];
  for (const value of cases)
    expect([value, plainAddress(value)]).toEqual([value, earlier.test(value)]);
  expect(plainAddress(`${'a'.repeat(240)}@b.c`)).toBe(true);
  expect(plainAddress(`${'a'.repeat(260)}@b.c`)).toBe(false);
  const hostile = '!@!.' + '!.'.repeat(200000);
  const started = performance.now();
  expect(plainAddress(hostile)).toBe(false);
  expect(plainAddress(hostile.slice(0, 254))).toBe(earlier.test(hostile.slice(0, 254)));
  expect(
    realOutreachConfig({
      ...full,
      REAL_OUTREACH_MAIL_FROM: hostile,
      CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS: `${hostile},${recipient}`,
    } as NodeJS.ProcessEnv).state,
  ).toBe('unconfigured');
  const listed = realOutreachConfig({
    ...full,
    CORRIDRA_REAL_OUTREACH_TEST_RECIPIENTS: `${hostile},${recipient}`,
  } as NodeJS.ProcessEnv);
  expect(listed.state === 'on' && [...listed.testRecipients]).toEqual([recipient]);
  expect(performance.now() - started).toBeLessThan(500);
});
