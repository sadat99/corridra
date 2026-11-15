import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { HelperInterestService } from '../../packages/auth/src/helper-interest';
import { POST } from '../../apps/web/app/api/helper-interest/route';

// The route reads its services through foundations(). Here they are a working stub, so a 404 can only come from the
// switches themselves: with the stub the request would be answered 202. Remove the switch check from the route and the
// switch cases below fail. `services` is null for the case of a build without a database.
const calls: string[] = [];
let services: unknown = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));
const working = () => ({
  ready: Promise.resolve(),
  config: { APP_ORIGIN: 'http://localhost' },
  helperInterest: {
    offered: async () => {
      calls.push('offered');
      return true;
    },
    globalBudget: async () => {
      calls.push('globalBudget');
    },
    submit: async () => {
      calls.push('submit');
      return { received: true };
    },
  },
});
const request = () =>
  new Request('http://localhost/api/helper-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify({
      name: 'Amina Rahman',
      email: 'amina@example.test',
      country: 'BD',
      reason: 'I know the leather market in Chattogram well.',
      website: '',
    }),
  });
afterEach(() => vi.unstubAllEnvs());

describe('the public route', () => {
  test('answers 202 with both switches on and a working service, so the 404s below are the switches', async () => {
    services = working();
    calls.length = 0;
    vi.stubEnv('CORRIDRA_HELPER_INTEREST', 'true');
    vi.stubEnv('CORRIDRA_NETWORK_ENABLED', 'true');
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true });
    expect(calls).toEqual(['offered', 'globalBudget', 'submit']);
  });

  test('answers 404 and touches nothing with everything off, one switch only, Network off, "TRUE" and "1"', async () => {
    for (const env of [
      {},
      { CORRIDRA_HELPER_INTEREST: 'true' },
      { CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'false' },
      { CORRIDRA_HELPER_INTEREST: 'TRUE', CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_HELPER_INTEREST: '1', CORRIDRA_NETWORK_ENABLED: 'true' },
    ]) {
      services = working();
      calls.length = 0;
      vi.unstubAllEnvs();
      vi.stubEnv('CORRIDRA_HELPER_INTEREST', '');
      vi.stubEnv('CORRIDRA_NETWORK_ENABLED', '');
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const response = await POST(request());
      expect(response.status, JSON.stringify(env)).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
      expect(calls).toEqual([]);
    }
  });

  test('answers 404 with both switches on when the application has no database', async () => {
    services = null;
    vi.stubEnv('CORRIDRA_HELPER_INTEREST', 'true');
    vi.stubEnv('CORRIDRA_NETWORK_ENABLED', 'true');
    expect((await POST(request())).status).toBe(404);
  });

  test('answers 404 with both switches on when the register is not open, before any budget is spent', async () => {
    const closed = working();
    closed.helperInterest.offered = async () => false;
    services = closed;
    calls.length = 0;
    vi.stubEnv('CORRIDRA_HELPER_INTEREST', 'true');
    vi.stubEnv('CORRIDRA_NETWORK_ENABLED', 'true');
    expect((await POST(request())).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe('a database without the module', () => {
  test('the form is not offered and a submission is a 404, so the page and the route hide', async () => {
    const f = await fixture();
    try {
      const service = new HelperInterestService(f.runtime, 'no-module-secret');
      const on = { CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'true' };
      expect(await service.offered(on)).toBe(false);
      expect(await service.installed()).toBe(false);
      await expect(
        service.submit({
          name: 'Amina Rahman',
          email: 'amina@example.test',
          country: 'BD',
          reason: 'I know the leather market in Chattogram well.',
          website: '',
        }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await f.close();
    }
  });
});
