import { expect, test } from '@playwright/test';

test('customer collaboration stays closed for both reads and forged invitation or revocation requests', async ({
  request,
}) => {
  const workspaceId = '00000000-0000-4000-8000-000000000000';
  const responses = [
    await request.get('/api/customer-workspace-access?workspaceId=' + workspaceId),
  ];
  for (const action of ['invite', 'accept', 'revoke'])
    responses.push(
      await request.post('/api/customer-workspace-access', {
        data: { action, workspaceId, commandId: workspaceId, subject: 'forged', role: 'owner' },
      }),
    );
  for (const response of responses) {
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(await response.json()).toEqual({ error: 'Customer workspaces are unavailable' });
  }
});
