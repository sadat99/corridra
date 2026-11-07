import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

// The customer inbox route, bulk Mark All Read and the server unread count. The recipient is never in the request:
// the body is exactly {all:true} (or the existing {id}), and the service reads the person from the verified session.
const state = vi.hoisted(() => ({
  list: vi.fn(),
  mark: vi.fn(),
  markAll: vi.fn(),
  count: vi.fn(),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.example.invalid' },
    customerInbox: {
      list: state.list,
      markRead: state.mark,
      markAllRead: state.markAll,
      unreadCount: state.count,
    },
  }),
}));
vi.mock('../../apps/web/lib/notify', () => ({ notificationsOn: () => true }));
import * as route from '../../apps/web/app/api/customer-inbox/route';

const origin = 'https://app.example.invalid';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
  state.list.mockResolvedValue([]);
  state.mark.mockResolvedValue(true);
  state.markAll.mockResolvedValue(45);
  state.count.mockResolvedValue(45);
});
afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown, extra: Record<string, string> = {}) =>
  new Request(origin + '/api/customer-inbox', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });

test('{all:true} marks every unread item and answers with the count marked and nothing left unread', async () => {
  state.count.mockResolvedValueOnce(0);
  const response = await route.POST(post({ all: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ marked: 45, unread: 0 });
  expect(state.markAll).toHaveBeenCalledWith(undefined, undefined);
  expect(state.mark).not.toHaveBeenCalled();
  // The unread figure is read again from the server after the marking, never assumed.
  expect(state.count).toHaveBeenCalledTimes(1);
});

test('the forwarded subject and issuer reach the service, so a changed account is refused there', async () => {
  await route.POST(
    post(
      { all: true },
      {
        'x-corridra-customer-subject': 'local-customer',
        'x-corridra-customer-issuer': 'https://issuer.example.invalid',
      },
    ),
  );
  expect(state.markAll).toHaveBeenCalledWith('local-customer', 'https://issuer.example.invalid');
});

test('the body is strict: no recipient, no mixed shapes, all must be true, origin, JSON and size are checked first', async () => {
  for (const body of [
    { all: true, recipient: id },
    { all: true, id },
    { all: false },
    { all: 'true' },
    {},
    { id, all: true },
  ])
    expect((await route.POST(post(body))).status, JSON.stringify(body)).toBe(400);
  expect(
    (await route.POST(post({ all: true }, { Origin: 'https://evil.example.invalid' }))).status,
  ).toBe(403);
  expect((await route.POST(post({ all: true }, { 'Content-Type': 'text/plain' }))).status).toBe(
    415,
  );
  expect((await route.POST(post({ all: true, padding: 'x'.repeat(1100) }))).status).toBe(413);
  expect(state.markAll).not.toHaveBeenCalled();
});

test('the single-item read is unchanged', async () => {
  const response = await route.POST(post({ id }));
  expect(await response.json()).toEqual({ read: true });
  expect(state.mark).toHaveBeenCalledWith(id, undefined, undefined);
  expect(state.markAll).not.toHaveBeenCalled();
});

test('signed out gets 401 and a changed account 409, with no marking', async () => {
  state.markAll.mockRejectedValueOnce(new DomainError('Sign in to continue', 401));
  expect((await route.POST(post({ all: true }))).status).toBe(401);
  state.markAll.mockRejectedValueOnce(new DomainError('Your account changed. Reload.', 409));
  expect((await route.POST(post({ all: true }))).status).toBe(409);
});

test('GET ?count=1 returns the server unread count; the list and its strict query stay as they were', async () => {
  const counted = await route.GET(new Request(origin + '/api/customer-inbox?count=1'));
  expect(counted.status).toBe(200);
  expect(await counted.json()).toEqual({ unread: 45 });
  expect(state.list).not.toHaveBeenCalled();
  for (const query of ['count=2', 'count=1&x=1', 'recipient=' + id, 'count='])
    expect(
      (await route.GET(new Request(origin + '/api/customer-inbox?' + query))).status,
      query,
    ).toBe(400);
  expect((await route.GET(new Request(origin + '/api/customer-inbox'))).status).toBe(200);
  expect(state.list).toHaveBeenCalledTimes(1);
  state.count.mockRejectedValueOnce(new DomainError('Sign in to continue', 401));
  expect((await route.GET(new Request(origin + '/api/customer-inbox?count=1'))).status).toBe(401);
});
