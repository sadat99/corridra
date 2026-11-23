import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// ADR-090. The two public entries of the real email lane, with the services replaced by counted stand-ins: opening a
// link never changes anything, the opt-out is honoured with every switch off, and a notice needs a set secret and a
// correct signature.
const calls: { method: string; args: unknown[] }[] = [];
let known = true;
const services = {
  ready: Promise.resolve(),
  communications: {
    async budget(...args: unknown[]) {
      calls.push({ method: 'budget', args });
    },
    async unsubscribe(...args: unknown[]) {
      calls.push({ method: 'unsubscribe', args });
      return known;
    },
    async providerEvent(...args: unknown[]) {
      calls.push({ method: 'providerEvent', args });
      return true;
    },
  },
};
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));
const route = await import('../../apps/web/app/api/outreach/[action]/route');
const token = 'c'.repeat(64);
const key = 'whsec_' + Buffer.from('s'.repeat(24)).toString('base64');
const messageId = '7b0f6d0e-4a55-4c1b-9d3e-2f1c9a5e8b11';
const post = (action: string, url: string, init: RequestInit = {}) =>
  route.POST(
    new Request(`https://app.business.test/api/outreach/${url}`, { method: 'POST', ...init }),
    {
      params: Promise.resolve({ action }),
    },
  );
const done = () => calls.filter((c) => c.method !== 'budget');
beforeEach(() => {
  calls.length = 0;
  known = true;
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

test('only POST exists, so opening a link can never record anything', () => {
  expect(
    Object.keys(route).filter((name) => /^(GET|HEAD|PUT|PATCH|DELETE|OPTIONS)$/.test(name)),
  ).toEqual([]);
  expect(typeof route.POST).toBe('function');
});

test('the opt-out works by one-click POST and from the page, with every outreach setting unset', async () => {
  for (const name of [
    'CORRIDRA_REAL_OUTREACH',
    'CORRIDRA_REAL_OUTREACH_MODE',
    'REAL_OUTREACH_WEBHOOK_SECRET',
  ])
    vi.stubEnv(name, '');
  const oneClick = await post('unsubscribe', `unsubscribe?t=${token}`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  expect([oneClick.status, await oneClick.json()]).toEqual([200, { stopped: true }]);
  const fromPage = await post('unsubscribe', 'unsubscribe', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: token }),
  });
  expect(fromPage.status).toBe(200);
  expect(done()).toEqual([
    { method: 'unsubscribe', args: [token] },
    { method: 'unsubscribe', args: [token] },
  ]);
  expect(oneClick.headers.get('cache-control')).toBe('no-store');
});

test('a malformed or unknown opt-out token gets the same not-found answer', async () => {
  for (const bad of ['', 'abc', 'C'.repeat(64), `${token}0`]) {
    const response = await post('unsubscribe', `unsubscribe?t=${bad}`);
    expect([response.status, await response.json()]).toEqual([404, { error: 'Not found' }]);
  }
  expect(done()).toEqual([]);
  known = false;
  const unknown = await post('unsubscribe', `unsubscribe?t=${token}`);
  expect([unknown.status, await unknown.json()]).toEqual([404, { error: 'Not found' }]);
  expect((await post('anything', 'anything')).status).toBe(404);
});

const notice = JSON.stringify({
  type: 'email.bounced',
  data: {
    to: ['sales@supplier.business.test'],
    bounce: { type: 'Permanent' },
    tags: { corridra_message: messageId },
  },
});
const signed = (body: string, secret = key, at = Math.floor(Date.now() / 1000)) => ({
  'svix-id': 'msg_route_1',
  'svix-timestamp': String(at),
  'svix-signature':
    'v1,' +
    createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`msg_route_1.${at}.${body}`)
      .digest('base64'),
});
test('a provider notice is refused while the signing secret is not set, even when correctly signed', async () => {
  for (const value of ['', 'not-a-secret', 'whsec_']) {
    vi.stubEnv('REAL_OUTREACH_WEBHOOK_SECRET', value);
    const response = await post('webhook', 'webhook', { headers: signed(notice), body: notice });
    expect(response.status).toBe(503);
  }
  expect(calls).toEqual([]);
});

test('a provider notice needs a correct, current signature; a good one records only our id and the kind', async () => {
  vi.stubEnv('REAL_OUTREACH_WEBHOOK_SECRET', key);
  const other = 'whsec_' + Buffer.from('t'.repeat(24)).toString('base64');
  for (const headers of [
    {},
    signed(notice, other),
    signed(notice + ' '),
    signed(notice, key, Math.floor(Date.now() / 1000) - 400),
  ])
    expect((await post('webhook', 'webhook', { headers, body: notice })).status).toBe(401);
  expect(calls).toEqual([]);
  const good = await post('webhook', 'webhook', { headers: signed(notice), body: notice });
  expect([good.status, await good.json()]).toEqual([200, { recorded: true }]);
  expect(calls).toEqual([
    { method: 'providerEvent', args: ['msg_route_1', { messageId, kind: 'BOUNCED', hard: true }] },
  ]);
  expect(JSON.stringify(calls)).not.toContain('supplier.business.test');
  const ignored = JSON.stringify({
    type: 'email.opened',
    data: { tags: { corridra_message: messageId } },
  });
  const skipped = await post('webhook', 'webhook', { headers: signed(ignored), body: ignored });
  expect([skipped.status, await skipped.json()]).toEqual([200, { recorded: false }]);
  expect(calls).toHaveLength(1);
});
