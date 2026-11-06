import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MissionMoveService } from '../../packages/missions/src/moves';

// The team's Move route: a command that does not name the version of the Moves the person saw is refused at the
// door, whatever sends it. The pool here fails if anything touches it, so a refusal also proves nothing was written.
const touched = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../apps/web/lib/foundations', () => {
  const pool = new Proxy(
    {},
    {
      get() {
        touched.count += 1;
        throw new Error('the database was reached');
      },
    },
  );
  return {
    foundations: () => ({
      ready: Promise.resolve(),
      provider: { getSession: async () => ({ token: 'staff-token' }) },
      config: { APP_ORIGIN: 'https://corridra.example.invalid' },
      moves: new MissionMoveService(pool as never),
      pulse: { canSend: false },
    }),
  };
});
import * as route from '../../apps/web/app/api/move/staff/route';

const origin = 'https://corridra.example.invalid';
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown) =>
  route.POST(
    new Request(`${origin}/api/move/staff?tenant=${tenant}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const move = { verb: 'Add', object: 'a thing', holder: 'customer' };
const commands = {
  set: { action: 'set', moves: [move] },
  done: { action: 'done', moveId: '33333333-3333-4333-8333-333333333333' },
  clear: { action: 'clear' },
};

describe('the team Move route refuses a command without the version', () => {
  beforeEach(() => {
    touched.count = 0;
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_UX_MOVE_RECORDS', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const [action, body] of Object.entries(commands)) {
    test(`${action} with no version is a 400 and never reaches the database`, async () => {
      const response = await post({ commandId: randomUUID(), missionId: mission, ...body });
      expect(response.status).toBe(400);
      expect(touched.count).toBe(0);
    });
    test(`${action} with a version that is not a whole number is a 400 and never reaches the database`, async () => {
      for (const expectedVersion of [-1, 1.5, '3', null]) {
        const response = await post({
          commandId: randomUUID(),
          missionId: mission,
          expectedVersion,
          ...body,
        });
        expect(response.status).toBe(400);
      }
      expect(touched.count).toBe(0);
    });
  }

  test('a command that names a version passes the door and goes on to the database', async () => {
    const response = await post({
      commandId: randomUUID(),
      missionId: mission,
      expectedVersion: 0,
      ...commands.clear,
    });
    // Past the shape checks it reaches the (failing) pool, so it is not a 400.
    expect(touched.count).toBeGreaterThan(0);
    expect(response.status).not.toBe(400);
  });
});
