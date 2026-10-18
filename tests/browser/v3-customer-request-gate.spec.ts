import { expect, test } from '@playwright/test';

test('private customer requests remain independently closed with private response headers', async ({
  request,
}) => {
  for (const response of [
    await request.get('/api/customer-requests'),
    await request.get('/api/customer-requests?after=forged&pageSize=10000'),
    await request.post('/api/customer-requests', {
      data: { commandId: 'forged', workspaceId: 'forged', subject: 'forged', role: 'owner' },
    }),
  ]) {
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(await response.json()).toEqual({ error: 'Customer requests are unavailable' });
  }
});
