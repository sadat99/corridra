import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';

// The customer company-link route (ADR-079, section 3). Search writes an attempt row, so it moved from a GET
// to a POST with scope "search" in the JSON body. The services here are spies: a refusal at the door must leave
// the search service and the per-IP budget untouched, and because the attempt row is written only by the search
// service, "search never called" is the proof that no attempt row was written. Each refusal test first does the
// same request correctly (it must reach the search), so a route that refuses everything cannot pass.
const calls = vi.hoisted(() => ({
  search: [] as unknown[][],
  view: [] as unknown[][],
  overview: [] as unknown[][],
  command: [] as unknown[][],
  budget: [] as unknown[][],
  budgetError: null as null | Error,
}));
const origin = 'https://corridra.example.invalid';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const answer = {
  workspaceId,
  expiresAt: '2030-01-01T00:00:00.000Z',
  organisations: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Acme GmbH', country: 'DE' }],
};
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
    missions: {
      budget: async (...args: unknown[]) => {
        calls.budget.push(args);
        if (calls.budgetError) throw calls.budgetError;
      },
    },
    customerOrganisationLinks: {
      search: async (...args: unknown[]) => (calls.search.push(args), answer),
      view: async (...args: unknown[]) => (calls.view.push(args), { status: 'none' }),
      overview: async (...args: unknown[]) => (calls.overview.push(args), { overview: true }),
      command: async (...args: unknown[]) => (calls.command.push(args), { status: 'pending' }),
    },
  }),
}));
import * as route from '../../apps/web/app/api/customer-organisation-links/route';

const url = origin + '/api/customer-organisation-links';
const ids = {
  'x-corridra-customer-subject': 'synthetic-alice',
  'x-corridra-customer-issuer': 'https://issuer.example.invalid/auth',
};
const good = { scope: 'search', workspaceId, q: 'acme' };
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
const get = (query: string) => route.GET(new Request(`${url}?${query}`, { headers: ids }));
const reset = () => {
  for (const key of ['search', 'view', 'overview', 'command', 'budget'] as const)
    calls[key].length = 0;
};
const untouched = () => {
  expect(calls.search).toHaveLength(0);
  expect(calls.budget).toHaveLength(0);
};
// The control: the same request done correctly reaches the search through the budget exactly once.
async function control() {
  const response = await post(good);
  expect(response.status).toBe(200);
  expect(calls.budget).toHaveLength(1);
  expect(calls.search).toHaveLength(1);
  reset();
}
async function refusedAs(status: number, response: Response) {
  expect(response.status).toBe(status);
  const body = await response.json();
  // An ordinary error, never the neutral empty list.
  expect(body).toHaveProperty('error');
  expect(body).not.toHaveProperty('organisations');
  expect(response.headers.get('cache-control')).toBe('no-store');
}

beforeEach(() => {
  reset();
  calls.budgetError = null;
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('company search is a POST', () => {
  test('a same-origin JSON search returns the unchanged answer, no-store, through the budget, scope removed', async () => {
    const response = await post({ ...good, q: '  acme  ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(calls.budget).toHaveLength(1);
    expect(calls.search).toHaveLength(1);
    // The service schema is strict on {workspaceId, q}: scope must not reach it, the term arrives trimmed.
    expect(calls.search[0]).toEqual([
      { workspaceId, q: 'acme' },
      ids['x-corridra-customer-subject'],
      ids['x-corridra-customer-issuer'],
    ]);
    expect(calls.command).toHaveLength(0);
  });

  test('the answer keys are exactly workspaceId, expiresAt and organisations', async () => {
    const body = await (await post(good)).json();
    expect(Object.keys(body)).toEqual(['workspaceId', 'expiresAt', 'organisations']);
    expect(Object.keys(body.organisations[0]).sort()).toEqual(['country', 'id', 'name']);
  });

  test('a cross-origin or missing Origin is a 403 and reaches neither the budget nor the search', async () => {
    await control();
    await refusedAs(403, await post(good, { Origin: 'https://evil.example.invalid' }));
    untouched();
    await refusedAs(403, await post(good, { Origin: null }));
    untouched();
  });

  test('a non-JSON content type is a 415 and reaches neither the budget nor the search', async () => {
    await control();
    await refusedAs(415, await post(good, { 'Content-Type': 'text/plain' }));
    untouched();
    await refusedAs(415, await post(good, { 'Content-Type': null }));
    untouched();
  });

  test('a body over 8192 bytes is a 413 and reaches neither the budget nor the search', async () => {
    await control();
    await refusedAs(413, await post({ ...good, pad: 'x'.repeat(9000) }));
    untouched();
  });

  test('malformed JSON is a 400 and reaches neither the budget nor the search', async () => {
    await control();
    await refusedAs(400, await post(null, {}, '{"scope":'));
    untouched();
  });

  test('JSON null is a 400, not a TypeError, and searches nothing', async () => {
    await control();
    await refusedAs(400, await post(null, {}, 'null'));
    expect(calls.search).toHaveLength(0);
    expect(calls.command).toHaveLength(0);
    for (const raw of ['true', '7', '"search"', '[]', '[{"scope":"search"}]']) {
      await refusedAs(400, await post(null, {}, raw));
    }
    expect(calls.search).toHaveLength(0);
    expect(calls.command).toHaveLength(0);
  });

  test('an extra key, a short term, a long term or a bad id is a 400 and never reaches the search', async () => {
    await control();
    for (const body of [
      { ...good, extra: 1 },
      { ...good, q: 'ac' },
      { ...good, q: '  a  ' },
      { ...good, q: 'a'.repeat(81) },
      { ...good, q: 7 },
      { scope: 'search', workspaceId },
      { ...good, workspaceId: 'not-a-uuid' },
      { ...good, scope: 'view' },
      { ...good, scope: null },
      { ...good, action: 'withdraw' },
    ]) {
      await refusedAs(400, await post(body));
    }
    expect(calls.search).toHaveLength(0);
    expect(calls.command).toHaveLength(0);
  });

  test('an exhausted per-IP budget refuses before the lookup, as an ordinary error', async () => {
    await control();
    calls.budgetError = new DomainError('Too many requests. Try again later.', 429);
    await refusedAs(429, await post(good));
    expect(calls.budget).toHaveLength(1);
    expect(calls.search).toHaveLength(0);
  });

  test('an unavailable module is a 503 and reaches neither the budget nor the search', async () => {
    await control();
    vi.stubEnv('CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED', 'false');
    await refusedAs(503, await post(good));
    untouched();
  });
});

describe('the GET search branch is gone', () => {
  test('GET scope=search is the existing 400 Unknown scope and writes nothing', async () => {
    await control();
    const response = await get(
      new URLSearchParams({ scope: 'search', workspaceId, q: 'acme' }).toString(),
    );
    await refusedAs(400, response);
    untouched();
    expect(calls.view).toHaveLength(0);
  });

  test('the refusal says Unknown scope', async () => {
    const response = await get(`scope=search&workspaceId=${workspaceId}&q=acme`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown scope' });
    untouched();
  });

  test('GET view (default and explicit) and overview still work and never call the search', async () => {
    for (const query of [`workspaceId=${workspaceId}`, `scope=view&workspaceId=${workspaceId}`]) {
      const response = await get(query);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'none' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls.view).toHaveLength(2);
    expect(calls.view[0]).toEqual([
      { workspaceId },
      ids['x-corridra-customer-subject'],
      ids['x-corridra-customer-issuer'],
    ]);
    const overview = await get('scope=overview');
    expect(overview.status).toBe(200);
    expect(await overview.json()).toEqual({ overview: true });
    expect(calls.overview).toHaveLength(1);
    untouched();
  });

  test('GET with an unknown scope is still a 400', async () => {
    expect((await get('scope=people')).status).toBe(400);
    untouched();
  });
});

describe('the command path is unchanged', () => {
  const withdraw = {
    action: 'withdraw',
    commandId: '33333333-3333-4333-8333-333333333333',
    workspaceId,
    claimId: '44444444-4444-4444-8444-444444444444',
    expectedVersion: 1,
  };
  test('a command still goes through the budget to the command service and not to the search', async () => {
    await control();
    const response = await post(withdraw);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(calls.budget).toHaveLength(1);
    expect(calls.command).toHaveLength(1);
    expect(calls.command[0]![0]).toEqual(withdraw);
    expect(calls.search).toHaveLength(0);
  });

  test('a command with a bad shape is a 400 and reaches no service', async () => {
    await control();
    await refusedAs(400, await post({ ...withdraw, action: 'nonsense' }));
    expect(calls.command).toHaveLength(0);
    expect(calls.search).toHaveLength(0);
  });
});
