import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { HelperInterestService } from '../../packages/auth/src/helper-interest';
import { POST } from '../../apps/web/app/api/helper-interest/route';

// The route reads its services through foundations(); a build without a database has none.
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));

// ADR-085. The public route answers 404, as if it did not exist, unless both switches are "true" and the module is
// installed and open. Each case fails on a build without the route.
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
  test('answers 404 with everything off, with only one switch on, and with the Network switch off', async () => {
    for (const env of [
      {},
      { CORRIDRA_HELPER_INTEREST: 'true' },
      { CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'false' },
      { CORRIDRA_HELPER_INTEREST: 'TRUE', CORRIDRA_NETWORK_ENABLED: 'true' },
      { CORRIDRA_HELPER_INTEREST: '1', CORRIDRA_NETWORK_ENABLED: 'true' },
    ]) {
      vi.unstubAllEnvs();
      vi.stubEnv('CORRIDRA_HELPER_INTEREST', '');
      vi.stubEnv('CORRIDRA_NETWORK_ENABLED', '');
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const response = await POST(request());
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });

  test('answers 404 with both switches on when the application has no database', async () => {
    vi.stubEnv('CORRIDRA_HELPER_INTEREST', 'true');
    vi.stubEnv('CORRIDRA_NETWORK_ENABLED', 'true');
    expect((await POST(request())).status).toBe(404);
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
