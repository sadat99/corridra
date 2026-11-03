import { test, expect } from '@playwright/test';
test('programme projections remains closed before optional schema or provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-programme-projections?registrationId=00000000-0000-4000-8000-000000000004',
    '/api/customer-programme-projections?workspaceId=00000000-0000-4000-8000-000000000006&programmeId=00000000-0000-4000-8000-000000000005',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-programme-projections', { data: {} });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
