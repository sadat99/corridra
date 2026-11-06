import { beforeEach, describe, expect, test, vi } from 'vitest';

// The palette's search route (Sensitive: yes): a visitor with no session is refused, a bad workspace id, an
// unknown scope or an over-long query is a 400, and none of them reaches the database. The services here fail
// if touched, so a refusal also proves nothing was read.
const state = vi.hoisted(() => ({ session: null as null | { token: string }, touched: 0 }));
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
      provider: { getSession: async () => state.session },
      missions: trap,
      counterparties: trap,
    }),
  };
});
import * as route from '../../apps/web/app/api/workspace/search/route';

const tenant = '11111111-1111-4111-8111-111111111111';
const get = (query: string) =>
  route.GET(new Request(`https://corridra.example.invalid/api/workspace/search?${query}`));

beforeEach(() => {
  state.session = { token: 'staff-token' };
  state.touched = 0;
});

describe('the palette search route refuses at the door', () => {
  test('no session is a 401 and reads nothing', async () => {
    state.session = null;
    const response = await get(`tenant=${tenant}&q=mad`);
    expect(response.status).toBe(401);
    expect(state.touched).toBe(0);
  });
  test('a missing or malformed workspace id is a 400', async () => {
    expect((await get('q=mad')).status).toBe(400);
    expect((await get('tenant=not-a-uuid&q=mad')).status).toBe(400);
    expect(state.touched).toBe(0);
  });
  test('an unknown scope or a query over 80 characters is a 400', async () => {
    expect((await get(`tenant=${tenant}&q=mad&scope=people`)).status).toBe(400);
    expect((await get(`tenant=${tenant}&q=${'a'.repeat(81)}`)).status).toBe(400);
    expect(state.touched).toBe(0);
  });
  test('an empty query answers with nothing and reads nothing', async () => {
    const response = await get(`tenant=${tenant}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ missions: [], companies: [], denied: [], partial: [] });
    expect(state.touched).toBe(0);
  });
  test('answers are never cached and carry a request id', async () => {
    const response = await get(`tenant=${tenant}&q=m`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Corridra-Request-ID')).toBeTruthy();
  });
});
