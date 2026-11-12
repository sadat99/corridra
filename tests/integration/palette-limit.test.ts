import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  paletteLimit,
  resetPaletteLimit,
  spendPaletteSearch,
} from '../../apps/web/lib/palette-limit';
import {
  describeStatus,
  outcomeForStatus,
  phaseOf,
  type StatusInput,
} from '../../apps/web/lib/ux/palette-status';

// S67: one palette search reads up to eight pages, so a person is limited before any page is read. A limited
// search is a calm "try again" and never an empty result. The services below fail if touched.
const state = vi.hoisted(() => ({ user: 'user-a', touched: 0 }));
vi.mock('../../apps/web/lib/foundations', () => {
  const trap = new Proxy(
    {},
    {
      get() {
        state.touched += 1;
        throw new Error('a service was reached');
      },
    },
  );
  return {
    foundations: () => ({
      ready: Promise.resolve(),
      provider: { getSession: async () => ({ token: `token-${state.user}`, userId: state.user }) },
      missions: trap,
      counterparties: trap,
    }),
  };
});
import * as route from '../../apps/web/app/api/workspace/search/route';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const get = (tenant: string, q = '') =>
  route.GET(
    new Request(`https://corridra.example.invalid/api/workspace/search?tenant=${tenant}&q=${q}`),
  );

beforeEach(() => {
  resetPaletteLimit();
  state.user = 'user-a';
  state.touched = 0;
});

describe('the sliding window', () => {
  test('allows the limit, then refuses with the seconds to wait, then allows again', () => {
    for (let n = 0; n < paletteLimit.searches; n++)
      expect(spendPaletteSearch('k', 1_000 + n)).toEqual({ allowed: true });
    const refused = spendPaletteSearch('k', 1_000 + paletteLimit.searches);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(spendPaletteSearch('k', 1_000 + paletteLimit.windowMs + 1)).toEqual({ allowed: true });
  });
  test('a refused search does not extend the wait', () => {
    for (let n = 0; n < paletteLimit.searches; n++) spendPaletteSearch('k', 0);
    for (let n = 0; n < 100; n++) spendPaletteSearch('k', 5_000);
    expect(spendPaletteSearch('k', paletteLimit.windowMs + 1)).toEqual({ allowed: true });
  });
  test('one person never spends another person or workspace allowance', () => {
    for (let n = 0; n < paletteLimit.searches; n++) spendPaletteSearch('a|t1', 0);
    expect(spendPaletteSearch('a|t1', 1).allowed).toBe(false);
    expect(spendPaletteSearch('b|t1', 1).allowed).toBe(true);
    expect(spendPaletteSearch('a|t2', 1).allowed).toBe(true);
  });
  test('memory stays bounded for many people', () => {
    for (let n = 0; n < paletteLimit.maxKeys + 500; n++) spendPaletteSearch(`p${n}`, n);
    expect(spendPaletteSearch('p-new', 100_000).allowed).toBe(true);
  });
});

describe('the route', () => {
  test('past the limit it answers 429 with Retry-After before any page is read', async () => {
    for (let n = 0; n < paletteLimit.searches; n++) await get(tenantA);
    const response = await get(tenantA, 'mad');
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(state.touched).toBe(0);
    const body = await response.json();
    expect(body.error).toMatch(/try again/i);
    expect(JSON.stringify(body)).not.toContain('mad');
  });
  test('another person, and another workspace, are not limited by it', async () => {
    for (let n = 0; n < paletteLimit.searches + 3; n++) await get(tenantA);
    expect((await get(tenantB)).status).toBe(200);
    state.user = 'user-b';
    expect((await get(tenantA)).status).toBe(200);
  });
  test('a bad request is still a 400 and a visitor still a 401 before the limit counts', async () => {
    expect((await get('not-a-uuid')).status).toBe(400);
  });
});

describe('the palette says "try again", not "no match"', () => {
  const input = (phase: StatusInput['phase']): StatusInput => ({
    scope: 'all',
    text: 'mad',
    phase,
    count: 0,
    denied: [],
    partial: [],
    offline: false,
    notReady: false,
  });
  test('429 is its own outcome and phase', () => {
    expect(outcomeForStatus(429)).toBe('limited');
    expect(phaseOf(true, { kind: 'limited' })).toBe('limited');
    expect(outcomeForStatus(500)).toBe('failed');
  });
  test('a limited search is never confused with a denied one', () => {
    expect(outcomeForStatus(429)).not.toBe(outcomeForStatus(403));
    const limited = JSON.stringify(describeStatus(input('limited')));
    const denied = JSON.stringify(describeStatus(input('denied')));
    expect(limited).not.toMatch(/role|access|owner or admin/i);
    expect(denied).not.toMatch(/try again|paused/i);
    expect(describeStatus(input('denied')).retry).toBe(false);
  });
  test('the view offers a retry, has no block and never reads as empty', () => {
    const view = describeStatus(input('limited'));
    expect(view.retry).toBe(true);
    expect(view.block).toBeNull();
    const words = JSON.stringify(view);
    expect(words).toMatch(/try again/i);
    expect(words).not.toMatch(/no match|nothing found/i);
  });
});
