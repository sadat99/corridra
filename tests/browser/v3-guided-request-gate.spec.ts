import { test, expect } from '@playwright/test';
test('guided request drafts remain closed before optional schema or provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-mission-drafts?workspaceId=00000000-0000-4000-8000-000000000006',
    '/api/customer-mission-drafts?workspaceId=00000000-0000-4000-8000-000000000006&draftId=00000000-0000-4000-8000-000000000007',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-mission-drafts', { data: {} });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
test('the guided request page is private and shows a bounded unavailable state while closed', async ({
  request,
}) => {
  const r = await request.get('/account/drafts/00000000-0000-4000-8000-000000000006');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
  expect(await r.text()).toContain('Guided sample requests are unavailable.');
});
test('the original single-page request path stays available', async ({ request }) => {
  const r = await request.get('/account/request/00000000-0000-4000-8000-000000000006');
  expect(r.status()).toBe(200);
  expect(await r.text()).toContain('unavailable');
});
