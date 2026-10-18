import { expect, test } from '@playwright/test';
test('account delivery is closed before optional module and provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-assigned-missions',
    '/api/workspace/customer-mission-delivery',
  ])
    for (const method of ['GET', 'POST']) {
      const r = method === 'GET' ? await request.get(path) : await request.post(path, { data: {} });
      expect(r.status()).toBe(503);
      expect(r.headers()['cache-control']).toBe('no-store');
      expect(r.headers()['referrer-policy']).toBe('no-referrer');
    }
});
