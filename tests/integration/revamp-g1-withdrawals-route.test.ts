import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRUD G1: the route behind "Withdraw Request". Every refusal leaves the database alone, the reason is never echoed
// in an error, and the control's closed answer reaches the page as an ordinary answer, not an error.
const enabled = { requests: true };
const withdrawals = vi.fn();
const setWithdrawal = vi.fn();
// The route resolves the package from apps/web, so the mock names that same file.
const web = createRequire(resolve('apps/web/package.json'));
const requestsFile = web.resolve('@corridra/auth/customer-requests');
vi.doMock(requestsFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(requestsFile)),
  customerRequestsEnabled: () => enabled.requests,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    customerRequests: { withdrawals, setWithdrawal },
  }),
}));

const route = async () => await import('../../apps/web/app/api/customer-request-withdrawals/route');
const id = '00000000-0000-4000-8000-000000000001';
const command = '00000000-0000-4000-8000-000000000002';
const why = 'I sent this to the wrong team and will send it again';
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ action: 'withdraw', requestId: id, commandId: command, reason: why, ...over });
const post = (text: string, headers: Record<string, string> = {}) =>
  new Request('https://app.corridra.test/api/customer-request-withdrawals', {
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
  enabled.requests = true;
  withdrawals.mockReset().mockResolvedValue({ open: true, items: [] });
  setWithdrawal.mockReset().mockResolvedValue({ withdrawn: true, changed: true });
});

describe("GET lists the signed-in person's withdrawals", () => {
  it('passes the session identity through and answers with no-store', async () => {
    const { GET } = await route();
    const response = await GET(
      new Request('https://app.corridra.test/api/customer-request-withdrawals', {
        headers: {
          'x-corridra-customer-subject': 'alice',
          'x-corridra-customer-issuer': 'https://issuer.test',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(withdrawals).toHaveBeenCalledWith('alice', 'https://issuer.test');
    expect(await response.json()).toEqual({ open: true, items: [] });
  });
  it('is closed when the customer area is off', async () => {
    enabled.requests = false;
    const { GET } = await route();
    expect(
      (await GET(new Request('https://app.corridra.test/api/customer-request-withdrawals'))).status,
    ).toBe(503);
  });
});

describe('POST withdraws or restores one request', () => {
  it('sends one valid decision to the service with the session identity', async () => {
    const { POST } = await route();
    expect((await POST(post(body()))).status).toBe(200);
    expect(setWithdrawal).toHaveBeenCalledTimes(1);
    expect(setWithdrawal.mock.calls[0]).toEqual([
      { action: 'withdraw', requestId: id, commandId: command, reason: why },
      'alice',
      'https://issuer.test',
    ]);
    setWithdrawal.mockClear();
    expect(
      (await POST(post(JSON.stringify({ action: 'restore', requestId: id, commandId: command }))))
        .status,
    ).toBe(200);
    expect(setWithdrawal.mock.calls[0][0]).toEqual({
      action: 'restore',
      requestId: id,
      commandId: command,
    });
  });
  it('refuses another origin, a body that is not JSON, a bad decision and an oversized body, and never reaches the service', async () => {
    const { POST } = await route();
    expect((await POST(post(body(), { origin: 'https://evil.test' }))).status).not.toBe(200);
    expect((await POST(post(body(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post(body({ reason: 'too short' })))).status).toBe(400);
    expect((await POST(post(body({ reason: undefined })))).status).toBe(400);
    expect((await POST(post(body({ extra: 1 })))).status).toBe(400);
    expect((await POST(post(body({ requestId: 'nope' })))).status).toBe(400);
    expect(
      (
        await POST(
          post(
            JSON.stringify({ action: 'restore', requestId: id, commandId: command, reason: why }),
          ),
        )
      ).status,
    ).toBe(400);
    expect((await POST(post('{' + ' '.repeat(3000) + '}'))).status).toBe(413);
    expect((await POST(post('not json'))).status).toBe(400);
    expect(setWithdrawal).not.toHaveBeenCalled();
  });
  it('never echoes the reason in an error', async () => {
    const { POST } = await route();
    const secret = 'My supplier lost the sample batch and I am embarrassed';
    const response = await POST(post(body({ reason: secret, requestId: 'nope' })));
    expect(await response.text()).not.toContain(secret);
    setWithdrawal.mockRejectedValueOnce(Object.assign(new Error(secret), { code: '42501' }));
    const refused = await POST(post(body({ reason: secret })));
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(secret);
  });
  it("maps the database's refusals: not your request is 403, a missing module is 503, the closed control is a normal answer", async () => {
    const { POST } = await route();
    setWithdrawal.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42883' }));
    expect((await POST(post(body()))).status).toBe(503);
    setWithdrawal.mockResolvedValueOnce({ withdrawn: false, changed: false, reason: 'closed' });
    const closed = await POST(post(body()));
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ withdrawn: false, changed: false, reason: 'closed' });
  });
});
