import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The public test server has no mission mail installed, so the real call is refused. These tests
// prove the page, its privacy headers, what the button does and what each answer says.
const request = '0b7c4c8a-3f4e-4f0a-9d6e-2f6f1c5b8a11';
const token = 'A'.repeat(43);
const origin = 'http://127.0.0.1:3100';

test('the mute page is private, not indexed, and does nothing until the button is pressed', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/mission-mail/mute', async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"muted":true}' });
  });
  const response = await page.goto(`/mute/${request}#t=${token}`);
  const headers = response!.headers();
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toContain('noindex');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page).toHaveTitle(/Mute messages/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Mute messages about this request.',
  );
  // The token is read once and then removed from the address.
  await expect(
    page.getByRole('button', { name: 'Mute messages about this request' }),
  ).toBeVisible();
  expect(page.url()).toBe(`${origin}/mute/${request}`);
  // Opening the page, like a link scanner would, muted nothing.
  expect(calls).toBe(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations, `axe ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await page.getByRole('button', { name: 'Mute messages about this request' }).click();
  await expect(page.getByRole('status')).toContainText(
    'We will not send more messages about this request.',
  );
  await expect(page.getByRole('link', { name: 'Go to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
  expect(calls).toBe(1);
});

test('a refused or failed answer says so plainly and keeps the button', async ({ page }) => {
  const area = () => page.getByRole('region', { name: 'Mute messages', exact: true });
  await page.route('**/api/mission-mail/mute', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"x"}' }),
  );
  await page.goto(`/mute/${request}#t=${token}`);
  await page.getByRole('button', { name: 'Mute messages about this request' }).click();
  await expect(area().getByRole('alert')).toHaveText('This link is not valid or has expired.');
  await page.unroute('**/api/mission-mail/mute');
  await page.route('**/api/mission-mail/mute', (route) => route.abort());
  await page.getByRole('button', { name: 'Mute messages about this request' }).click();
  await expect(area().getByRole('alert')).toContainText('We could not do that just now.');
  await expect(
    page.getByRole('button', { name: 'Mute messages about this request' }),
  ).toBeEnabled();
});

test('a link with no token or a malformed one cannot be used, and a bad address is not found', async ({
  page,
}) => {
  const area = () => page.getByRole('region', { name: 'Mute messages', exact: true });
  await page.goto(`/mute/${request}`);
  await expect(area().getByRole('status')).toContainText('This link is incomplete.');
  await expect(area().getByRole('button')).toHaveCount(0);
  await page.goto(`/mute/${request}#t=too-short`);
  await expect(area().getByRole('status')).toContainText('This link is incomplete.');
  const missing = await page.goto('/mute/not-a-request');
  expect(missing!.status()).toBe(404);
});

test('the mute route answers every refusal the same way and accepts nothing from another origin', async ({
  request: api,
}) => {
  const post = (data: unknown, headers: Record<string, string> = { origin }) =>
    api.post('/api/mission-mail/mute', { data, headers });
  const same = { error: 'This link is not valid or has expired.' };
  for (const response of [
    await post({ requestId: request, token }),
    await post({ requestId: request, token: 'short' }),
    await post({ requestId: 'nope', token }),
    await post({ requestId: request, token, extra: true }),
    await post({ requestId: request, token }, { origin: 'https://evil.example' }),
    await post({ requestId: request, token }, {}),
  ]) {
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(same);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect((await api.get('/api/mission-mail/mute')).status()).toBe(405);
});
