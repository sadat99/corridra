import { expect, test } from '@playwright/test';

test('customer workspace API remains closed with no creation control or caller authority', async ({
  request,
}) => {
  for (const response of [
    await request.get('/api/customer-workspaces'),
    await request.post('/api/customer-workspaces', {
      data: {
        name: 'Synthetic forbidden creation',
        commandId: '00000000-0000-4000-8000-000000000000',
        role: 'owner',
        subject: 'forged',
      },
    }),
  ]) {
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Customer workspaces are unavailable' });
  }
});
