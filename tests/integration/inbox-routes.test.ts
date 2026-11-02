import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

const state = vi.hoisted(() => ({
  on: true,
  requests: true,
  token: 'local-staff-token' as string | null,
  staffList: vi.fn(),
  staffMark: vi.fn(),
  customerList: vi.fn(),
  customerMark: vi.fn(),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.example.invalid' },
    provider: { getSession: async () => (state.token ? { token: state.token } : null) },
    inbox: { list: state.staffList, markRead: state.staffMark },
    customerInbox: { list: state.customerList, markRead: state.customerMark },
  }),
}));
vi.mock('../../apps/web/lib/notify', () => ({ notificationsOn: () => state.on }));

import * as customer from '../../apps/web/app/api/customer-inbox/route';
import * as staff from '../../apps/web/app/api/notifications/route';

const origin = 'https://app.example.invalid';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
  state.on = true;
  state.requests = true;
  state.token = 'local-staff-token';
  state.staffList.mockResolvedValue([]);
  state.customerList.mockResolvedValue([]);
  state.staffMark.mockResolvedValue(true);
  state.customerMark.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });

test('customer inbox has a separate verified-customer boundary and rejects recipient selection', async () => {
  const response = await customer.GET(
    new Request(origin + '/api/customer-inbox', {
      headers: {
        'x-corridra-customer-subject': 'local-customer',
        'x-corridra-customer-issuer': 'https://issuer.example.invalid',
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(state.customerList).toHaveBeenCalledWith(
    'local-customer',
    'https://issuer.example.invalid',
  );
  expect(state.staffList).not.toHaveBeenCalled();
  expect(
    (await customer.GET(new Request(origin + '/api/customer-inbox?recipient=' + id))).status,
  ).toBe(400);
  state.customerList.mockRejectedValueOnce(new DomainError('Sign in to continue', 401));
  expect((await customer.GET(new Request(origin + '/api/customer-inbox'))).status).toBe(401);
  state.customerList.mockRejectedValueOnce(
    new DomainError('Your account changed. Reload before continuing.', 409),
  );
  expect((await customer.GET(new Request(origin + '/api/customer-inbox'))).status).toBe(409);
});

test('customer mark-read checks origin, JSON, size and allowed fields before invoking its boundary', async () => {
  expect(
    (
      await customer.POST(
        post('/api/customer-inbox', { id }, { Origin: 'https://evil.example.invalid' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await customer.POST(post('/api/customer-inbox', { id }, { 'Content-Type': 'text/plain' })))
      .status,
  ).toBe(415);
  expect((await customer.POST(post('/api/customer-inbox', { id, recipient: id }))).status).toBe(
    400,
  );
  expect(
    (await customer.POST(post('/api/customer-inbox', { id, padding: 'x'.repeat(1100) }))).status,
  ).toBe(413);
  expect(state.customerMark).not.toHaveBeenCalled();
  const response = await customer.POST(post('/api/customer-inbox', { id }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ read: true });
  expect(state.customerMark).toHaveBeenCalledWith(id, undefined, undefined);
});

test('contributor staff identity reads its account-wide inbox without a stale team workspace', async () => {
  expect((await staff.GET(new Request(origin + '/api/notifications'))).status).toBe(200);
  expect(state.staffList).toHaveBeenCalledWith({
    kind: 'staff',
    ctx: { token: 'local-staff-token', tenantId: '', purpose: 'synthetic_validation' },
  });
  expect((await staff.POST(post('/api/notifications', { id }))).status).toBe(200);
  expect((await staff.GET(new Request(origin + '/api/notifications?tenant=invalid'))).status).toBe(
    400,
  );
  state.token = null;
  expect((await staff.GET(new Request(origin + '/api/notifications'))).status).toBe(401);
});

test('notification and customer-area switches fail closed before inbox calls', async () => {
  state.on = false;
  expect((await customer.GET(new Request(origin + '/api/customer-inbox'))).status).toBe(404);
  expect((await staff.GET(new Request(origin + '/api/notifications'))).status).toBe(404);
  state.on = true;
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'false');
  expect((await customer.GET(new Request(origin + '/api/customer-inbox'))).status).toBe(404);
  expect(state.customerList).not.toHaveBeenCalled();
  expect(state.staffList).not.toHaveBeenCalled();
});
