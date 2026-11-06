import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRUD G6: the route behind "Requests you muted" on the Email choices page. Stopping emails never depends on a
// switch; turning them back on does, exactly as the email choices do. Every refusal leaves the database alone.
const enabled = { pulse: true, withdrawal: true };
const mutes = vi.fn();
const setMute = vi.fn();
// The route resolves the package from apps/web, so the mock names that same file.
const web = createRequire(resolve('apps/web/package.json'));
const notificationsFile = web.resolve('@corridra/auth/customer-notifications');
vi.doMock(notificationsFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(notificationsFile)),
  customerNotificationsEnabled: () => enabled.pulse,
  customerNotificationWithdrawalEnabled: () => enabled.withdrawal,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    customerNotifications: { mutes, setMute },
  }),
}));

const route = async () => await import('../../apps/web/app/api/pulse/mutes/route');
const id = '00000000-0000-4000-8000-000000000001';
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    store: 'request',
    requestId: id,
    commandId: id.replace(/1$/, '2'),
    muted: true,
    ...over,
  });
const post = (text: string, headers: Record<string, string> = {}) =>
  new Request('https://app.corridra.test/api/pulse/mutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.corridra.test',
      'x-corridra-customer-subject': 'alice',
      'x-corridra-customer-issuer': 'https://issuer.test',
      ...headers,
    },
    body: text,
  });

beforeEach(() => {
  enabled.pulse = true;
  enabled.withdrawal = true;
  mutes.mockReset().mockResolvedValue([]);
  setMute.mockReset().mockResolvedValue({ muted: true, changed: true });
});

describe("GET lists the signed-in person's muted requests", () => {
  it('passes the session identity through and answers with no-store', async () => {
    mutes.mockResolvedValue([{ store: 'request', requestId: id, muted: true, at: 'x' }]);
    const { GET } = await route();
    const response = await GET(
      new Request('https://app.corridra.test/api/pulse/mutes', {
        headers: {
          'x-corridra-customer-subject': 'alice',
          'x-corridra-customer-issuer': 'https://issuer.test',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mutes).toHaveBeenCalledWith('alice', 'https://issuer.test');
    expect((await response.json()).mutes).toHaveLength(1);
  });
  it('still lists with the Pulse switch off, and is closed when the customer area is off', async () => {
    const { GET } = await route();
    enabled.pulse = false;
    expect((await GET(new Request('https://app.corridra.test/api/pulse/mutes'))).status).toBe(200);
    enabled.withdrawal = false;
    expect((await GET(new Request('https://app.corridra.test/api/pulse/mutes'))).status).toBe(503);
  });
});

describe('POST stops or resumes one request', () => {
  it('sends one valid choice to the service with the session identity', async () => {
    const { POST } = await route();
    const response = await POST(post(body()));
    expect(response.status).toBe(200);
    expect(setMute).toHaveBeenCalledTimes(1);
    expect(setMute.mock.calls[0]).toEqual([
      { store: 'request', requestId: id, commandId: id.replace(/1$/, '2'), muted: true },
      'alice',
      'https://issuer.test',
    ]);
  });
  it('with the Pulse switch off, stopping still works and turning emails on is refused before the database', async () => {
    const { POST } = await route();
    enabled.pulse = false;
    expect((await POST(post(body({ muted: true })))).status).toBe(200);
    setMute.mockClear();
    expect((await POST(post(body({ muted: false })))).status).toBe(503);
    expect(setMute).not.toHaveBeenCalled();
  });
  it('refuses another origin, a body that is not JSON, an extra key, a bad id and an oversized body', async () => {
    const { POST } = await route();
    expect((await POST(post(body(), { origin: 'https://evil.test' }))).status).not.toBe(200);
    expect((await POST(post(body(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post(body({ extra: 1 })))).status).toBe(400);
    expect((await POST(post(body({ requestId: 'nope' })))).status).toBe(400);
    expect((await POST(post(body({ store: 'other' })))).status).toBe(400);
    expect((await POST(post('{' + ' '.repeat(2000) + '}'))).status).toBe(413);
    expect((await POST(post('not json'))).status).toBe(400);
    expect(setMute).not.toHaveBeenCalled();
  });
  it("maps the database's refusals: not your request is 403, a missing module is 503", async () => {
    const { POST } = await route();
    setMute.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42501' }));
    expect((await POST(post(body()))).status).toBe(403);
    setMute.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42883' }));
    expect((await POST(post(body()))).status).toBe(503);
  });
});
