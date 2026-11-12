import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

// The customer search route at the door (Sensitive: yes; docs/revamp/specs/navigation-v1/customer-search.md, section 3).
// The services here are spies: a refusal at the door must leave every one of them untouched, and every answer, an
// error included, carries the private headers and a request id. The control test does the same request correctly
// first, so a route that refuses everything cannot pass.
const origin = 'https://corridra.example.invalid';
const state = vi.hoisted(() => ({
  available: true,
  list: [] as unknown[][],
  detail: [] as unknown[][],
  companies: [] as unknown[][],
  failList: null as null | (() => unknown),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () =>
    state.available
      ? {
          ready: Promise.resolve(),
          config: { APP_ORIGIN: 'https://corridra.example.invalid' },
          customerRequests: {
            async list(...args: unknown[]) {
              state.list.push(args);
              if (state.failList) throw state.failList();
              return { requests: [], nextAfter: null, synthetic: true };
            },
          },
          customerRequestDetails: {
            async detail(...args: unknown[]) {
              state.detail.push(args);
              return null;
            },
          },
          customerCompanies: {
            async list(...args: unknown[]) {
              state.companies.push(args);
              return { companies: [], nextAfter: null, unavailableScopes: 0, synthetic: true };
            },
          },
        }
      : null,
}));
import * as route from '../../apps/web/app/api/customer-search/route';

const url = `${origin}/api/customer-search`;
const ids = {
  'x-corridra-customer-subject': 'synthetic-alice',
  'x-corridra-customer-issuer': 'https://issuer.example.invalid/auth',
};
const post = (
  body: unknown,
  headers: Record<string, string | null> = {},
  raw = typeof body === 'string' ? body : JSON.stringify(body),
) => {
  const all: Record<string, string> = {
    Origin: origin,
    'Content-Type': 'application/json',
    ...ids,
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete all[key];
    else all[key] = value;
  }
  return route.POST(new Request(url, { method: 'POST', headers: all, body: raw }));
};
const untouched = () => {
  expect(state.list).toHaveLength(0);
  expect(state.detail).toHaveLength(0);
  expect(state.companies).toHaveLength(0);
};
const privateHeaders = (response: Response) => {
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('X-Corridra-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
};

beforeEach(() => {
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_COMPANIES_ENABLED', 'true');
  state.available = true;
  state.failList = null;
  state.list.length = state.detail.length = state.companies.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('the control: a correct request reaches both services once', () => {
  test('200, private headers, the claimed subject and issuer passed through verbatim', async () => {
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hits: [],
      scopes: { requests: 'ok', companies: 'ok' },
    });
    privateHeaders(response);
    expect(state.list).toEqual([
      [{ pageSize: 100 }, 'synthetic-alice', ids['x-corridra-customer-issuer']],
    ]);
    expect(state.companies).toEqual([
      [{ pageSize: 5 }, 'synthetic-alice', ids['x-corridra-customer-issuer']],
    ]);
  });
  test('a single scope reads only its own service; the scope defaults to all', async () => {
    await post({ q: 'spain', scope: 'companies' });
    expect([state.list.length, state.companies.length]).toEqual([0, 1]);
    state.companies.length = 0;
    await post({ q: 'spain', scope: 'requests' });
    expect([state.list.length, state.companies.length]).toEqual([1, 0]);
  });
  test('the route answers POST only', () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(['POST']);
  });
});

describe('D8 refusals at the door touch no service', () => {
  test('the route is unavailable: 503, nothing read', async () => {
    state.available = false;
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(503);
    privateHeaders(response);
    untouched();
  });
  test.each([
    ['no origin', { Origin: null }],
    ['another origin', { Origin: 'https://evil.example.invalid' }],
    ['the same host over http', { Origin: 'http://corridra.example.invalid' }],
  ])('%s is a 403', async (_name, headers) => {
    const response = await post({ q: 'spain' }, headers);
    expect(response.status).toBe(403);
    privateHeaders(response);
    untouched();
  });
  test.each([
    ['text', { 'Content-Type': 'text/plain' }],
    ['a form', { 'Content-Type': 'application/x-www-form-urlencoded' }],
    ['none', { 'Content-Type': null }],
  ])('a %s content type is a 415', async (_name, headers) => {
    const response = await post({ q: 'spain' }, headers);
    expect(response.status).toBe(415);
    privateHeaders(response);
    untouched();
  });
  test('a body over 8 KB is a 413', async () => {
    const response = await post({ q: 'spain', pad: 'x'.repeat(9000) });
    expect(response.status).toBe(413);
    privateHeaders(response);
    untouched();
  });
  test.each([
    ['a query of 81 characters', { q: 'a'.repeat(81) }],
    ['a query that is not text', { q: 12 }],
    ['no query', { scope: 'all' }],
    ['an unknown scope', { q: 'spain', scope: 'people' }],
    ['the Pages scope, which is never sent to the server', { q: 'spain', scope: 'pages' }],
    ['an extra key', { q: 'spain', workspaceId: '11111111-1111-4111-8111-111111111111' }],
    ['an array', ['spain']],
    ['null', null],
    ['a number', 7],
    ['bad JSON', '{"q":'],
    ['an empty body', ''],
  ])('%s is a 400', async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Check the submitted values' });
    privateHeaders(response);
    untouched();
  });
  test('a query of exactly 80 characters is accepted', async () => {
    expect((await post({ q: 'a'.repeat(80) })).status).toBe(200);
    expect(state.list).toHaveLength(1);
  });
});

describe('P5 a query not worth reading reads nothing', () => {
  test.each(['', ' ', 'a', ' a ', '!!', '--', '   '])('"%s" is a 200 with nothing', async (q) => {
    const response = await post({ q });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hits: [], scopes: {} });
    privateHeaders(response);
    untouched();
  });
});

describe('M2 every answer carries the private headers and a request id', () => {
  test.each([
    [200, () => undefined],
    [401, () => new DomainError('Sign in to continue', 401)],
    [403, () => new DomainError('Account closed', 403, 'account_closed')],
    [409, () => new DomainError('Customer account context does not match', 409)],
    [400, () => new DomainError('Customer account context is invalid', 400)],
    [500, () => new Error('connection lost')],
  ])('status %i', async (status, fail) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.failList = () => fail();
    if (status === 200) state.failList = null;
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(status);
    privateHeaders(response);
    const body = (await response.json()) as { correlationId?: string };
    if (status !== 200)
      expect(body.correlationId).toBe(response.headers.get('X-Corridra-Request-ID'));
  });
  test('the 503 answers carry them too', async () => {
    state.available = false;
    privateHeaders(await post({ q: 'spain' }));
    state.available = true;
    vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'false');
    vi.stubEnv('CORRIDRA_CUSTOMER_COMPANIES_ENABLED', 'false');
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(503);
    privateHeaders(response);
  });
  test('413 and 415 answers carry them (see the refusals above)', async () => {
    privateHeaders(await post({ q: 'spain', pad: 'x'.repeat(9000) }));
    privateHeaders(await post({ q: 'spain' }, { 'Content-Type': 'text/plain' }));
  });
});
