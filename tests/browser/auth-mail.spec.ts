import { expect, test } from '@playwright/test';

// The public test server does not set CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED, so the webhook receiver
// must not exist, and its private headers must still be on the compiled route.
test('the mail webhook does not exist while its switch is off, and sends private headers', async ({
  request,
}) => {
  const post = await request.post('/api/auth-mail', {
    data: { event_type: 'send.otp' },
    headers: { 'x-neon-signature': 'a..b', 'x-neon-signature-kid': 'k', 'x-neon-timestamp': '1' },
  });
  expect(post.status()).toBe(404);
  expect(await post.text()).not.toContain('send.otp');
  expect(post.headers()['cache-control']).toContain('no-store');
  expect(post.headers()['referrer-policy']).toBe('no-referrer');
  const get = await request.get('/api/auth-mail');
  expect(get.status()).toBe(405);
  expect(get.headers()['cache-control']).toContain('no-store');
  expect(get.headers()['referrer-policy']).toBe('no-referrer');
});
