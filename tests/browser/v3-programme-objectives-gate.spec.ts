import { test, expect } from '@playwright/test';
test('objective reads and writes remain closed before optional schema or provider access', async ({
  request,
}) => {
  for (const view of ['own', 'manage', 'choices']) {
    const r = await request.get('/api/customer-programme-objectives?view=' + view);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-programme-objectives', { data: { action: 'share' } });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
