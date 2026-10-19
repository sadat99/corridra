import { test, expect } from '@playwright/test';
const scope =
  'workspaceId=00000000-0000-4000-8000-000000000006&programmeId=00000000-0000-4000-8000-000000000007';
test('programme coordination remains closed before optional schema or provider access', async ({
  request,
}) => {
  for (const path of [
    '/api/customer-programme-coordination?view=report&' + scope,
    '/api/customer-programme-coordination?view=tasks&' + scope,
    '/api/customer-programme-coordination?view=records&registrationId=00000000-0000-4000-8000-0000000000a1',
  ]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(503);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
  }
  const r = await request.post('/api/customer-programme-coordination', { data: {} });
  expect(r.status()).toBe(503);
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
});
test('the planner and participant pages stay private and omit coordination while closed', async ({
  request,
}) => {
  for (const path of [
    '/account/delegations/00000000-0000-4000-8000-000000000006',
    '/account/delegations',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toContain('no-store');
    const html = await r.text();
    expect(html).not.toContain('Coordinate and report');
    expect(html).not.toContain('Share feedback and results');
  }
});
