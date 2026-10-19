import { test, expect } from '@playwright/test';
const workspace = 'workspaceId=00000000-0000-4000-8000-000000000006';
test('programme templates remain closed before optional schema or provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-programme-templates?view=list&' + workspace,
    '/api/customer-programme-templates?view=capture&' +
      workspace +
      '&programmeId=00000000-0000-4000-8000-000000000007',
  ]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-programme-templates', { data: {} });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
test('the delegation planner stays private and omits templates while closed', async ({
  request,
}) => {
  const r = await request.get('/account/delegations/00000000-0000-4000-8000-000000000006');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  expect(await r.text()).not.toContain('Repeatable programme templates');
});
