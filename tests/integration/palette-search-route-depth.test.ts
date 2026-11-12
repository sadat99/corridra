import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import { paletteLimits } from '../../apps/web/lib/palette-search';

// The palette's search route with counting services (docs/revamp/specs/navigation-v1/command-palette-search.md,
// sections 1 and 3): work per request is bounded whatever the totals say, a signed-out visitor reads nothing, and
// an unexpected failure is a 500 with the generic message and no query in the log.
const state = vi.hoisted(() => ({
  session: null as null | { token: string },
  queue: 0,
  catalogue: 0,
  queueFails: null as null | (() => Error),
  catalogueFails: null as null | (() => Error),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: async () => state.session },
    missions: {
      async queue() {
        state.queue += 1;
        if (state.queueFails) throw state.queueFails();
        return {
          total: 1_000_000,
          missions: Array.from({ length: 100 }, (_, n) => ({
            id: `0b5a0001-0000-4000-8000-${String(state.queue * 1000 + n).padStart(12, '0')}`,
            status: 'ACTIVE',
            brief: { company: `Filler ${n}`, objective: 'x', market: 'y' },
          })),
        };
      },
    },
    counterparties: {
      async catalogue() {
        state.catalogue += 1;
        if (state.catalogueFails) throw state.catalogueFails();
        return {
          total: 1_000_000,
          organisations: Array.from({ length: 50 }, (_, n) => ({
            id: `0c5a0001-0000-4000-8000-${String(state.catalogue * 1000 + n).padStart(12, '0')}`,
            name: `Filler ${n}`,
            country: 'ES',
            identity_status: 'UNKNOWN',
          })),
        };
      },
    },
  }),
}));
import * as route from '../../apps/web/app/api/workspace/search/route';

const tenant = '11111111-1111-4111-8111-111111111111';
const get = (query: string) =>
  route.GET(new Request(`https://corridra.example.invalid/api/workspace/search?${query}`));

beforeEach(() => {
  state.session = { token: 'staff-token' };
  state.queue = 0;
  state.catalogue = 0;
  state.queueFails = null;
  state.catalogueFails = null;
  vi.restoreAllMocks();
});

describe('M1 bounded work per request', () => {
  test('services that always report millions of rows are read within the caps', async () => {
    const response = await get(`tenant=${tenant}&q=zebra&scope=all`);
    expect(response.status).toBe(200);
    expect(state.queue).toBe(paletteLimits.queuePages);
    expect(state.catalogue).toBe(1 + paletteLimits.cataloguePages);
    expect(state.queue + state.catalogue).toBeLessThanOrEqual(8);
    const body = (await response.json()) as { partial: string[] };
    expect(body.partial).toEqual(['missions', 'companies']);
  });
  test('a single scope reads only its own service', async () => {
    await get(`tenant=${tenant}&q=zebra&scope=missions`);
    expect([state.queue, state.catalogue]).toEqual([3, 0]);
    state.queue = 0;
    await get(`tenant=${tenant}&q=zebra&scope=companies`);
    expect([state.queue, state.catalogue]).toEqual([0, 5]);
  });
  test('the answer carries the same headers as before', async () => {
    const response = await get(`tenant=${tenant}&q=zebra`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Corridra-Request-ID')).toBeTruthy();
  });
});

describe('D3 signed out', () => {
  test('a 401 reads nothing', async () => {
    state.session = null;
    const response = await get(`tenant=${tenant}&q=zebra`);
    expect(response.status).toBe(401);
    expect(state.queue + state.catalogue).toBe(0);
  });
});

describe('D1 a refused scope is reported as denied', () => {
  test('a 403 from a service is a 200 with that scope in denied and the other still searched', async () => {
    state.queueFails = () => new DomainError('Access denied', 403);
    const response = await get(`tenant=${tenant}&q=zebra&scope=all`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { denied: string[]; companies: unknown[] };
    expect(body.denied).toEqual(['missions']);
    expect(state.catalogue).toBeGreaterThan(0);
  });
});

describe('D6 an unexpected failure', () => {
  test('is a 500 with the generic message, and the log holds the request id and not the query', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.queueFails = () => new Error('connection lost while searching for zebra-secret');
    const response = await get(`tenant=${tenant}&q=zebra-secret`);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; correlationId: string };
    expect(body.error).toBe('The request could not be completed');
    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain(body.correlationId);
    expect(logged).not.toContain('zebra-secret');
    expect(JSON.stringify(body)).not.toContain('zebra-secret');
  });
});
