import { test, expect } from '@playwright/test';
test('organisation profiles remain closed before optional schema or provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-organisation-profiles?workspaceId=00000000-0000-4000-8000-000000000006',
    '/api/customer-organisation-profiles?scope=history&workspaceId=00000000-0000-4000-8000-000000000006',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-organisation-profiles', { data: {} });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
test('the profile page is private and shows a bounded unavailable state while closed', async ({
  request,
}) => {
  const r = await request.get('/account/profile/00000000-0000-4000-8000-000000000006');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
  expect(await r.text()).toContain('Sample company profile is unavailable.');
});
