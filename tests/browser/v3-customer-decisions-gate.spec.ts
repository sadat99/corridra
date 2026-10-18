import { expect, test } from '@playwright/test';
test('decision disclosure APIs remain closed before optional schema and provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-decisions?resourceId=00000000-0000-4000-8000-000000000001',
    '/api/workspace/customer-decision-disclosures?tenant=00000000-0000-4000-8000-000000000001',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const post = await request.post('/api/workspace/customer-decision-disclosures', { data: {} });
  expect(post.status()).toBe(503);
  expect((await request.post('/api/customer-decisions', { data: {} })).status()).toBe(405);
});
