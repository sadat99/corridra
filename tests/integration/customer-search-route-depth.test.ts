import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import { customerSearchLimits } from '../../apps/web/lib/customer-search';

// The customer search route with counting services (docs/revamp/specs/navigation-v1/customer-search.md, sections 3 to 5):
// a signed-out visitor reads nothing, a staff session is no customer session, each switch decides only its own scope,
// work per search is bounded whatever the totals say, and the words typed appear in no log, no response and no
// service argument.
const origin = 'https://corridra.example.invalid';
const secret = 'zebra-secret-query';
const state = vi.hoisted(() => ({
  calls: [] as { service: string; args: unknown[] }[],
  staff: 0,
  signedOut: false,
  requestFails: null as null | (() => unknown),
  companyFails: null as null | ((page: number) => unknown),
  rows: 100,
  companyPages: 0,
  synthetic: true,
  gate: null as null | Promise<void>,
  onDetail: null as null | (() => void),
}));
const requestId = (n: number) => `0b5a${String(n).padStart(4, '0')}-0000-4000-8000-000000000001`;
vi.mock('../../apps/web/lib/foundations', () => {
  // A staff service is reached only by mistake: every property read is counted and fails.
  const staffTrap = new Proxy(
    {},
    {
      get() {
        state.staff += 1;
        throw new Error('a staff service was reached');
      },
    },
  );
  const call = (service: string, args: unknown[]) => {
    state.calls.push({ service, args });
    if (state.signedOut && state.calls.length === 1)
      throw new DomainError('Sign in to continue', 401);
  };
  return {
    foundations: () => ({
      ready: Promise.resolve(),
      config: { APP_ORIGIN: 'https://corridra.example.invalid' },
      provider: staffTrap,
      missions: staffTrap,
      counterparties: staffTrap,
      customerRequests: {
        async list(...args: unknown[]) {
          call('requests', args);
          if (state.gate) await state.gate;
          if (state.requestFails) throw state.requestFails();
          return {
            requests: Array.from({ length: state.rows }, (_, n) => ({
              id: `0b5a${String(n + 1).padStart(4, '0')}-0000-4000-8000-000000000001`,
              createdAt: '2026-11-03T09:00:00.000Z',
              synthetic: true,
              available: true,
              progress: { status: 'ACTIVE' },
            })),
            nextAfter: state.rows >= 100 ? '0b5a9999-0000-4000-8000-000000000001' : null,
            synthetic: state.synthetic,
          };
        },
      },
      customerRequestDetails: {
        async detail(...args: unknown[]) {
          call('detail', args);
          state.onDetail?.();
          return { original: { objective: 'Sell in a new market', market: 'ES' } };
        },
      },
      customerCompanies: {
        async list(...args: unknown[]) {
          call('companies', args);
          state.companyPages += 1;
          const failure = state.companyFails?.(state.companyPages);
          if (failure) throw failure;
          return {
            companies: [
              {
                id: String(state.companyPages).padStart(64, 'b'),
                contexts: [
                  {
                    resourceId: `0c5a0000-0000-4000-8000-${String(state.companyPages).padStart(12, '0')}`,
                    company: `Spain Foods ${state.companyPages}`,
                    country: 'Spain',
                  },
                ],
              },
            ],
            nextAfter: '0c5a0000-0000-4000-8000-000000000999',
            unavailableScopes: 0,
            synthetic: state.synthetic,
          };
        },
      },
    }),
  };
});
import * as route from '../../apps/web/app/api/customer-search/route';

const post = (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  route.POST(
    new Request(`${origin}/api/customer-search`, {
      method: 'POST',
      signal,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-corridra-customer-subject': 'synthetic-alice',
        'x-corridra-customer-issuer': 'https://issuer.example.invalid/auth',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
const names = () => state.calls.map((entry) => entry.service);
const count = (service: string) => names().filter((name) => name === service).length;
const on = (name: string, value: string) => vi.stubEnv(name, value);
const flags = {
  requests: 'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
  details: 'CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED',
  companies: 'CORRIDRA_CUSTOMER_COMPANIES_ENABLED',
};

beforeEach(() => {
  on('DATA_ENVIRONMENT', 'synthetic');
  on(flags.requests, 'true');
  on(flags.details, 'true');
  on('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  on('CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED', 'true');
  on('CORRIDRA_DELIVERY_ENABLED', 'true');
  on(flags.companies, 'true');
  state.calls.length = 0;
  state.staff = 0;
  state.signedOut = false;
  state.requestFails = null;
  state.companyFails = null;
  state.rows = 100;
  state.companyPages = 0;
  state.synthetic = true;
  state.gate = null;
  state.onDetail = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('D1 signed out and D4 staff only', () => {
  test('a visitor with no customer session gets a 401 after exactly one service call', async () => {
    state.signedOut = true;
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Sign in to continue' });
    expect(state.calls).toHaveLength(1);
    expect(names()).toEqual(['requests']);
  });
  test('the second scope and the lookups are not reached after the refusal', async () => {
    state.requestFails = () => new DomainError('Sign in to continue', 401);
    await post({ q: 'spain', scope: 'all' });
    expect(names()).toEqual(['requests']);
  });
  test('a staff session is invisible: the staff services and provider are never read', async () => {
    state.signedOut = true;
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(401);
    expect(state.staff).toBe(0);
    state.signedOut = false;
    expect((await post({ q: 'spain' })).status).toBe(200);
    expect(state.staff).toBe(0);
  });
});

describe('D2 the claimed identity is rejection-only', () => {
  test('a subject or issuer that does not match is a 409 from the first call, with no further read', async () => {
    state.requestFails = () => new DomainError('Customer account context does not match', 409);
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(409);
    expect(names()).toEqual(['requests']);
  });
  test('a malformed claim is a 400 from the service, with no further read', async () => {
    state.requestFails = () => new DomainError('Customer account context is invalid', 400);
    const response = await post({ q: 'spain' }, { 'x-corridra-customer-subject': 'bad\u0001' });
    expect(response.status).toBe(400);
    expect(names()).toEqual(['requests']);
  });
  test("another person's workspace or request ids in the body are refused before any read", async () => {
    for (const extra of [
      { workspaceId: '11111111-1111-4111-8111-111111111111' },
      { requestId: requestId(1) },
      { tenantId: '22222222-2222-4222-8222-222222222222' },
      { subject: 'synthetic-bob' },
      { after: requestId(2) },
    ]) {
      const response = await post({ q: 'spain', ...extra });
      expect(response.status).toBe(400);
    }
    expect(state.calls).toHaveLength(0);
  });
  test('no service argument carries anything from the body but the page size and the paging cursor', async () => {
    await post({ q: secret, scope: 'all' });
    for (const entry of state.calls) expect(JSON.stringify(entry.args)).not.toContain(secret);
    expect(state.calls.find((entry) => entry.service === 'requests')!.args[0]).toEqual({
      pageSize: 100,
    });
  });
});

describe('D5 closed account and archived workspace', () => {
  test('a closed account is a 403 that keeps its code, not an empty list', async () => {
    state.requestFails = () => new DomainError('Account closed', 403, 'account_closed');
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'account_closed' });
    expect(names()).toEqual(['requests']);
  });
  test('an archived workspace is a Requests state and Companies still answer', async () => {
    state.requestFails = () =>
      Object.assign(
        new Error(
          'This workspace is archived. Restore it to send new private requests, invitations and registrations.',
        ),
        { code: '55000' },
      );
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      scopes: Record<string, string>;
      hits: { kind: string }[];
    };
    expect(body.scopes).toEqual({ requests: 'archived', companies: 'partial' });
    expect(body.hits.every((hit) => hit.kind === 'company')).toBe(true);
  });
});

describe('D6 each switch decides only its own scope', () => {
  test('Requests off: unavailable with no call, Companies answer', async () => {
    on(flags.requests, 'false');
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { scopes: unknown }).scopes).toEqual({
      requests: 'unavailable',
      companies: 'partial',
    });
    expect(count('requests') + count('detail')).toBe(0);
    expect(count('companies')).toBeGreaterThan(0);
  });
  test('the request details switch off: Requests are unavailable, never an empty list', async () => {
    on(flags.details, 'false');
    const body = (await (await post({ q: 'spain' })).json()) as { scopes: Record<string, string> };
    expect(body.scopes.requests).toBe('unavailable');
    expect(count('requests') + count('detail')).toBe(0);
  });
  test('Companies off: unavailable with no call, Requests answer', async () => {
    on(flags.companies, 'false');
    const body = (await (await post({ q: 'spain' })).json()) as { scopes: Record<string, string> };
    expect(body.scopes).toEqual({ requests: 'partial', companies: 'unavailable' });
    expect(count('companies')).toBe(0);
  });
  test('every scope asked for off is a 503, and one scope asked for and off is a 503', async () => {
    on(flags.requests, 'false');
    on(flags.companies, 'false');
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(503);
    expect(state.calls).toHaveLength(0);
    on(flags.companies, 'true');
    expect((await post({ q: 'spain', scope: 'requests' })).status).toBe(503);
    expect((await post({ q: 'spain', scope: 'companies' })).status).toBe(200);
  });
  test('data whose provenance may not be shown here makes the scope unavailable', async () => {
    state.synthetic = false;
    state.rows = 3;
    const response = await post({ q: 'spain' });
    expect(response.status).toBe(503);
    expect(count('detail')).toBe(0);
  });
});

describe('D7 failures', () => {
  test('a first read that fails unexpectedly is a generic 500 with the request id in the log and no words', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requestFails = () => new Error(`connection lost while searching for ${secret}`);
    const response = await post({ q: secret });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; correlationId: string };
    expect(body.error).toBe('The request could not be completed');
    expect(spy.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual([
      {
        event: 'customer_search_failed',
        scope: 'requests',
        correlationId: body.correlationId,
        errorName: 'Error',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(secret);
  });
  test('the failure line carries the scope, the kind of error and its capped code, and never the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.companyFails = () =>
      Object.assign(new TypeError(`bad ${secret}`), { code: 'X'.repeat(40) });
    await post({ q: 'spain', scope: 'companies' });
    state.companyFails = () =>
      Object.assign(new Error(`bad ${secret}`), { code: '57014', name: 'N'.repeat(70) });
    await post({ q: 'spain', scope: 'companies' });
    state.companyFails = () => Object.assign(new Error(secret), { code: '57014' });
    await post({ q: 'spain', scope: 'companies' });
    const lines = spy.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
    expect(lines).toHaveLength(3);
    // A code of more than 32 characters and a name of more than 64 are left out, not cut or passed on.
    expect(lines[0]).toMatchObject({
      event: 'customer_search_failed',
      scope: 'companies',
      errorName: 'TypeError',
    });
    expect(lines[0]).not.toHaveProperty('errorCode');
    expect(lines[1]).not.toHaveProperty('errorName');
    expect(lines[2]).toMatchObject({ errorName: 'Error', errorCode: '57014' });
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(secret);
  });
  test('a company page that fails after the first keeps the hits, is partial and logs one allowed line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.companyFails = (page) =>
      page === 2 ? Object.assign(new Error(`timeout for ${secret}`), { code: '57014' }) : undefined;
    const response = await post({ q: 'spain foods', scope: 'companies' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { scopes: Record<string, string>; hits: unknown[] };
    expect(body.scopes).toEqual({ companies: 'partial' });
    expect(body.hits).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(
      ['correlationId', 'errorCode', 'errorName', 'event', 'page', 'scope'].sort(),
    );
    expect(String(spy.mock.calls[0]![0])).not.toContain(secret);
  });
});

describe('M1 bounded work through the route', () => {
  test('services that always report more rows are read within the caps', async () => {
    const response = await post({ q: 'spain', scope: 'all' });
    expect(response.status).toBe(200);
    expect(count('requests')).toBe(1);
    expect(count('detail')).toBe(customerSearchLimits.titleCap);
    expect(count('companies')).toBe(customerSearchLimits.companyPages);
    expect(state.calls).toHaveLength(1 + 30 + 4);
    const body = (await response.json()) as {
      hits: { kind: string }[];
      scopes: Record<string, string>;
    };
    expect(body.scopes).toEqual({ requests: 'partial', companies: 'partial' });
    expect(body.hits.filter((hit) => hit.kind === 'request')).toHaveLength(5);
    expect(body.hits.filter((hit) => hit.kind === 'company')).toHaveLength(4);
    expect(JSON.stringify(body).length).toBeLessThan(8000);
  });
  test('one scope shows ten', async () => {
    const body = (await (await post({ q: 'spain', scope: 'requests' })).json()) as {
      hits: unknown[];
    };
    expect(body.hits).toHaveLength(10);
    expect(count('companies')).toBe(0);
  });
});

describe('D9 the words typed are in no log, response or service argument', () => {
  test('on every path', async () => {
    const spies = (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const bodies: string[] = [];
    const run = async (setup: () => void, scope = 'all') => {
      state.calls.length = 0;
      state.companyPages = 0;
      state.requestFails = null;
      state.companyFails = null;
      setup();
      const response = await post({ q: secret, scope });
      bodies.push(await response.text());
      for (const entry of state.calls) expect(JSON.stringify(entry.args)).not.toContain(secret);
    };
    await run(() => undefined);
    await run(() => (state.requestFails = () => new Error(`boom ${secret}`)));
    await run(() => (state.requestFails = () => new DomainError('Sign in to continue', 401)));
    await run(
      () => (state.requestFails = () => new DomainError('Account closed', 403, 'account_closed')),
    );
    await run(
      () => (state.requestFails = () => Object.assign(new Error(secret), { code: '42501' })),
    );
    await run(
      () => (state.companyFails = (page) => (page === 2 ? new Error(`late ${secret}`) : undefined)),
      'companies',
    );
    await run(() => (state.companyFails = () => new Error(`first ${secret}`)), 'companies');
    on(flags.requests, 'false');
    await run(() => undefined);
    for (const spy of spies)
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(secret);
    for (const text of bodies) expect(text).not.toContain(secret);
    expect(bodies.length).toBe(8);
  });
});

describe('which refusals show their own words', () => {
  test.each([400, 401, 403, 409])(
    'a service refusal with status %i keeps its message and code',
    async (status) => {
      state.requestFails = () => new DomainError('A plain refusal', status, 'plain_code');
      const response = await post({ q: 'spain' });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: 'A plain refusal', code: 'plain_code' });
    },
  );
  test.each([404, 418, 429, 500, 502, 504])(
    'a service refusal with status %i is the generic failure',
    async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      state.requestFails = () =>
        new DomainError(`internal detail ${secret}`, status, 'internal_code');
      const response = await post({ q: 'spain' });
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({ error: 'The request could not be completed' });
      expect(JSON.stringify(body)).not.toMatch(/internal|detail|secret/);
    },
  );
});

describe('an aborted request stops the work (the request signal reaches the core)', () => {
  test('aborted while the first title is looked up: far fewer lookups than the cap, no company page', async () => {
    const controller = new AbortController();
    state.onDetail = () => controller.abort();
    const response = await post({ q: 'spain' }, {}, controller.signal);
    expect(response.status).toBe(200);
    expect(count('detail')).toBeLessThanOrEqual(customerSearchLimits.titleConcurrency);
    expect(count('detail')).toBeLessThan(customerSearchLimits.titleCap);
    expect(count('companies')).toBe(0);
    expect(((await response.json()) as { scopes: unknown }).scopes).toEqual({
      requests: 'partial',
      companies: 'partial',
    });
  });
  test('aborted before the search starts: no service is read at all', async () => {
    const controller = new AbortController();
    controller.abort();
    await post({ q: 'spain' }, {}, controller.signal);
    expect(state.calls).toHaveLength(0);
  });
});

describe('the search slots: a burst is told to come back, and every slot is given back', () => {
  const busy = { error: 'Search is busy, try again in a moment' };
  const slots = customerSearchLimits.maxConcurrentSearches;
  const waiting = async () => {
    let open!: () => void;
    state.gate = new Promise<void>((resolve) => (open = resolve));
    const running = Array.from({ length: slots }, () => post({ q: 'spain', scope: 'requests' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { open, running };
  };
  test('the search after the limit is a 503 with Retry-After and the private headers, and reads nothing', async () => {
    const { open, running } = await waiting();
    expect(count('requests')).toBe(slots);
    const extra = await post({ q: 'spain', scope: 'requests' });
    expect(extra.status).toBe(503);
    expect(await extra.json()).toMatchObject(busy);
    expect(extra.headers.get('Retry-After')).toBe('2');
    expect(extra.headers.get('Cache-Control')).toBe('no-store');
    expect(extra.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(extra.headers.get('X-Corridra-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
    expect(count('requests')).toBe(slots);
    open();
    for (const response of await Promise.all(running)) expect(response.status).toBe(200);
    // Every slot is free again.
    state.gate = null;
    expect((await post({ q: 'spain', scope: 'requests' })).status).toBe(200);
  });
  test('refusals at the door do not take a slot', async () => {
    const { open, running } = await waiting();
    expect((await post({ q: 'a'.repeat(81) })).status).toBe(400);
    expect((await post({ q: 'spain' }, { Origin: 'https://evil.example.invalid' })).status).toBe(
      403,
    );
    open();
    await Promise.all(running);
  });
  test('slots come back after a failed search and after an aborted one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.requestFails = () => new Error('boom');
    for (let n = 0; n < slots * 2; n++)
      expect((await post({ q: 'spain', scope: 'requests' })).status).toBe(500);
    state.requestFails = null;
    state.onDetail = null;
    for (let n = 0; n < slots * 2; n++) {
      const controller = new AbortController();
      state.onDetail = () => controller.abort();
      expect((await post({ q: 'spain', scope: 'requests' }, {}, controller.signal)).status).toBe(
        200,
      );
    }
    state.onDetail = null;
    expect((await post({ q: 'spain', scope: 'requests' })).status).toBe(200);
  });
});
