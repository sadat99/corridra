import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  customerSearchLimits,
  personLimitSize,
  resetPersonLimit,
  spendPersonSearch,
} from '../../apps/web/lib/customer-search';
import {
  paletteLimit,
  resetPaletteLimit,
  spendPaletteSearch,
} from '../../apps/web/lib/palette-limit';

// The per-person limit on the customer search (docs/revamp/specs/navigation-v1/customer-search.md, section 3 and 12). One
// search can make up to 35 service calls, so a person is limited before any service is read. The key is the signed-in
// person from the provider session on the server and nothing the browser sends. The services below count every call.
const origin = 'https://corridra.example.invalid';
const secret = 'zebra-secret-query';
const state = vi.hoisted(() => ({
  identity: { subject: 'person-a', issuer: 'https://issuer.example.invalid/auth' } as null | {
    subject: string;
    issuer: string;
  },
  identityFails: false,
  calls: 0,
}));
vi.mock('../../apps/web/lib/customer-page-session', () => ({
  customerIdentity: async () => {
    if (state.identityFails) throw new Error('the provider did not answer');
    return state.identity;
  },
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://corridra.example.invalid' },
    missions: { budget: async () => undefined },
    customerRequests: {
      async list() {
        state.calls += 1;
        return { requests: [], nextAfter: null, synthetic: true };
      },
    },
    customerRequestDetails: {
      async detail() {
        state.calls += 1;
        return null;
      },
    },
    customerCompanies: {
      async list() {
        state.calls += 1;
        return { companies: [], nextAfter: null, unavailableScopes: 0, synthetic: true };
      },
    },
  }),
}));
import * as route from '../../apps/web/app/api/customer-search/route';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request(`${origin}/api/customer-search`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
const searches = customerSearchLimits.perPersonSearches;
const flags = [
  'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
  'CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED',
  'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
  'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
  'CORRIDRA_DELIVERY_ENABLED',
  'CORRIDRA_CUSTOMER_COMPANIES_ENABLED',
];

beforeEach(() => {
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  for (const flag of flags) vi.stubEnv(flag, 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
  resetPersonLimit();
  resetPaletteLimit();
  state.identity = { subject: 'person-a', issuer: 'https://issuer.example.invalid/auth' };
  state.identityFails = false;
  state.calls = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the budget', () => {
  test('is 10 searches in 10 seconds for a person, below the staff palette, and the map is bounded', () => {
    expect(customerSearchLimits.perPersonSearches).toBe(10);
    expect(customerSearchLimits.perPersonWindowMs).toBe(10_000);
    expect(customerSearchLimits.perPersonKeys).toBe(5_000);
    expect(customerSearchLimits.perPersonSearches).toBeLessThan(paletteLimit.searches);
    expect(customerSearchLimits.perPersonWindowMs).toBeLessThanOrEqual(paletteLimit.windowMs);
  });
  test('the window slides: the limit, then a refusal with seconds to wait, then allowed again', () => {
    for (let n = 0; n < searches; n++)
      expect(spendPersonSearch('k', 1_000 + n)).toEqual({ allowed: true });
    const refused = spendPersonSearch('k', 1_000 + searches);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(spendPersonSearch('k', 1_000 + customerSearchLimits.perPersonWindowMs + 1)).toEqual({
      allowed: true,
    });
  });
  test('more people than the cap do not grow the map', () => {
    for (let n = 0; n < customerSearchLimits.perPersonKeys + 700; n++)
      spendPersonSearch(`p${n}`, n);
    expect(personLimitSize()).toBeLessThanOrEqual(customerSearchLimits.perPersonKeys);
    expect(spendPersonSearch('p-new', 100_000).allowed).toBe(true);
  });
  test('a customer never spends a staff budget and a staff search never spends a customer one', () => {
    for (let n = 0; n < paletteLimit.searches; n++) spendPaletteSearch('same-key', 0);
    expect(spendPaletteSearch('same-key', 1).allowed).toBe(false);
    expect(spendPersonSearch('same-key', 1).allowed).toBe(true);
    resetPaletteLimit();
    for (let n = 0; n < searches; n++) spendPersonSearch('other-key', 0);
    expect(spendPersonSearch('other-key', 1).allowed).toBe(false);
    expect(spendPaletteSearch('other-key', 1).allowed).toBe(true);
  });
});

describe('the route', () => {
  test('past the limit it answers 429 with Retry-After and the private headers, and reads no service', async () => {
    for (let n = 0; n < searches; n++) expect((await post({ q: 'spain' })).status).toBe(200);
    const readBefore = state.calls;
    expect(readBefore).toBe(searches * 2);
    const response = await post({ q: secret });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: 'Too many searches, try again in a moment',
    });
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Corridra-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.calls).toBe(readBefore);
  });
  test('the answer names a correlation id that is the request id, and carries nothing typed', async () => {
    for (let n = 0; n < searches; n++) await post({ q: 'spain' });
    const response = await post({ q: secret });
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(JSON.parse(text).correlationId).toBe(response.headers.get('X-Corridra-Request-ID'));
  });
  test('after the window the person may search again', async () => {
    for (let n = 0; n < searches; n++) await post({ q: 'spain' });
    expect((await post({ q: 'spain' })).status).toBe(429);
    vi.setSystemTime(Date.now() + customerSearchLimits.perPersonWindowMs + 1);
    expect((await post({ q: 'spain' })).status).toBe(200);
  });
  test('nothing the browser sends resets or bypasses it: scope, subject and issuer headers, other ids', async () => {
    for (let n = 0; n < searches; n++) await post({ q: 'spain' });
    const readBefore = state.calls;
    const tries = [
      post({ q: 'spain', scope: 'requests' }),
      post({ q: 'spain', scope: 'companies' }),
      post({ q: 'spain' }, { 'x-corridra-customer-subject': 'person-b' }),
      post({ q: 'spain' }, { 'x-corridra-customer-issuer': 'https://other.example.invalid/auth' }),
      post(
        { q: 'spain' },
        {
          'x-corridra-customer-subject': 'person-c',
          'x-corridra-tenant': '22222222-2222-4222-8222-222222222222',
        },
      ),
      post(
        { q: 'a different spelling' },
        { 'x-forwarded-for': '203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.10' },
      ),
    ];
    for (const response of await Promise.all(tries)) expect(response.status).toBe(429);
    // Extra ids in the body are refused as a bad request and do not buy a fresh allowance either.
    expect(
      (await post({ q: 'spain', workspaceId: '11111111-1111-4111-8111-111111111111' })).status,
    ).toBe(400);
    expect((await post({ q: 'spain' })).status).toBe(429);
    expect(state.calls).toBe(readBefore);
  });
  test('another person has an allowance of their own', async () => {
    for (let n = 0; n < searches; n++) await post({ q: 'spain' });
    expect((await post({ q: 'spain' })).status).toBe(429);
    state.identity = { subject: 'person-b', issuer: 'https://issuer.example.invalid/auth' };
    expect((await post({ q: 'spain' })).status).toBe(200);
    state.identity = { subject: 'person-a', issuer: 'https://other-issuer.example.invalid/auth' };
    expect((await post({ q: 'spain' })).status).toBe(200);
  });
  test('nobody signed in, or a provider that does not answer, is a 401 that reads nothing and counts nobody', async () => {
    state.identity = null;
    for (let n = 0; n < searches * 3; n++) expect((await post({ q: 'spain' })).status).toBe(401);
    state.identityFails = true;
    for (let n = 0; n < searches * 3; n++) expect((await post({ q: 'spain' })).status).toBe(401);
    expect(state.calls).toBe(0);
    // Nobody was counted: the first signed-in person still has the whole allowance.
    state.identityFails = false;
    state.identity = { subject: 'person-a', issuer: 'https://issuer.example.invalid/auth' };
    for (let n = 0; n < searches; n++) expect((await post({ q: 'spain' })).status).toBe(200);
  });
  test('the key is the verified issuer and subject, and the same subject at another issuer is another person', async () => {
    for (let n = 0; n < searches; n++) await post({ q: 'spain' });
    expect((await post({ q: 'spain' })).status).toBe(429);
    state.identity = { subject: 'person-a', issuer: 'https://other-issuer.example.invalid/auth' };
    expect((await post({ q: 'spain' })).status).toBe(200);
  });
  test('words not worth reading cost nothing and spend no allowance', async () => {
    for (let n = 0; n < searches * 3; n++) {
      const response = await post({ q: n % 2 ? 'a' : '!!' });
      expect(await response.json()).toEqual({ hits: [], scopes: {} });
    }
    expect(state.calls).toBe(0);
    for (let n = 0; n < searches; n++) expect((await post({ q: 'spain' })).status).toBe(200);
    expect((await post({ q: 'spain' })).status).toBe(429);
  });
  test('refusals at the door spend no allowance', async () => {
    for (let n = 0; n < searches * 2; n++) {
      expect((await post({ q: 'a'.repeat(81) })).status).toBe(400);
      expect((await post({ q: 'spain' }, { Origin: 'https://evil.example.invalid' })).status).toBe(
        403,
      );
      expect((await post({ q: 'spain' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    }
    expect((await post({ q: 'spain' })).status).toBe(200);
  });
  test('a limited search writes no log line at all', async () => {
    const spies = (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    for (let n = 0; n < searches + 5; n++) await post({ q: secret });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
