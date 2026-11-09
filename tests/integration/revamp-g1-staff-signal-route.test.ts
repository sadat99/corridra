import { beforeEach, describe, expect, it, vi } from 'vitest';

// CRUD G1 follow-up: the route behind the team's "Withdrawn by the customer" line. Read only, the same session and
// tenant rules as the rest of the team API, and it answers with the two facts and nothing else.
const read = vi.fn();
const session = vi.fn();
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    withdrawalSignal: { read },
  }),
}));
const route = async () => await import('../../apps/web/app/api/mission-withdrawal/route');
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '22222222-2222-4222-8222-222222222222';
const get = (query = `tenant=${tenant}&mission=${mission}`, method = 'GET') =>
  new Request(`https://app.corridra.test/api/mission-withdrawal?${query}`, { method });

beforeEach(() => {
  read.mockReset().mockResolvedValue({ withdrawn: true, at: '2026-11-09T10:00:00.000Z' });
  session.mockReset().mockResolvedValue({ token: 'staff-token' });
});

describe('GET /api/mission-withdrawal', () => {
  it('answers the two facts, passes the staff session and tenant, and is never cached', async () => {
    const { GET } = await route();
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ withdrawn: true, at: '2026-11-09T10:00:00.000Z' });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'staff-token', tenantId: tenant }),
      mission,
    );
  });

  it('needs a signed-in staff session', async () => {
    session.mockResolvedValue(null);
    const { GET } = await route();
    expect((await GET(get())).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a tenant or mission that is not an id, before the database', async () => {
    const { GET } = await route();
    for (const query of [
      `tenant=x&mission=${mission}`,
      `tenant=${tenant}`,
      `tenant=${tenant}&mission=1`,
    ])
      expect((await GET(get(query))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('has no write method', async () => {
    const routeModule = await route();
    expect(
      Object.keys(routeModule).filter((key) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(key)),
    ).toEqual([]);
  });
});
