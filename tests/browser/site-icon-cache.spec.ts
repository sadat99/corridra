import { test, expect, type Page } from '@playwright/test';

// W10 Data Saver for everyone (owner decision, 10 Nov 2026), against a production build. The site icon is kept for a
// year because its address carries a hash of the file, and no link fetches another page in the background. The
// signed-in pages (the contributor tabs) are measured in tests/e2e/verification/ws-e/field-helper.spec.ts.
const iconAddress = /^\/icon\.svg\?icon\.[A-Za-z0-9_-]+\.svg$/;

test.beforeEach(({}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'the headers and the cache do not depend on the width',
  );
});

async function iconRequests(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const seen = new Map<string, { url: string; status: number; cached: boolean }>();
  const urls = new Map<string, string>();
  cdp.on('Network.requestWillBeSent', (event: { requestId: string; request: { url: string } }) => {
    urls.set(event.requestId, event.request.url);
  });
  cdp.on(
    'Network.responseReceived',
    (event: {
      requestId: string;
      response: {
        url: string;
        status: number;
        fromDiskCache?: boolean;
        fromPrefetchCache?: boolean;
      };
    }) => {
      if (new URL(event.response.url).pathname !== '/icon.svg') return;
      seen.set(event.requestId, {
        url: event.response.url,
        status: event.response.status,
        cached: Boolean(event.response.fromDiskCache || event.response.fromPrefetchCache),
      });
    },
  );
  cdp.on('Network.requestServedFromCache', (event: { requestId: string }) => {
    const url = urls.get(event.requestId);
    if (url && new URL(url).pathname === '/icon.svg')
      seen.set(event.requestId, { url, status: 200, cached: true });
  });
  return {
    all: () => [...seen.values()],
    network: () => [...seen.values()].filter((entry) => !entry.cached),
  };
}

test('the site icon address carries the file hash and is kept for a year', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  expect(href).toMatch(iconAddress);
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/svg+xml');
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  // The route is not kept by other addresses of the site: pages stay as they were.
  const home = await request.get('/');
  expect(home.headers()['cache-control'] ?? '').not.toContain('immutable');
});

test('the icon is fetched once and a tap to another page does not fetch it again', async ({
  page,
}) => {
  const icon = await iconRequests(page);
  await page.goto('/');
  await expect.poll(() => icon.all().length, { message: 'the icon loaded' }).toBeGreaterThan(0);
  expect(icon.network()).toHaveLength(1);
  expect(icon.all()[0].status).toBe(200);
  const before = icon.all().length;
  // A soft navigation inside the site (no full page load): the icon is not asked for again from the network.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    (window as unknown as { __softNavigation: boolean }).__softNavigation = true;
  });
  await page.locator('header a[href="/how-it-works"]').first().click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.locator('main h1').first()).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __softNavigation?: boolean }).__softNavigation,
    ),
    'the tap was a soft navigation',
  ).toBe(true);
  await page.waitForTimeout(1500);
  expect(icon.network()).toHaveLength(1);
  expect(icon.all().length).toBeGreaterThanOrEqual(before);
});

test('a second visit takes the icon from the browser cache, not the network', async ({
  page,
  context,
}) => {
  const first = await iconRequests(page);
  await page.goto('/');
  await expect.poll(() => first.all().length).toBeGreaterThan(0);
  expect(first.network()).toHaveLength(1);
  const second = await context.newPage();
  const again = await iconRequests(second);
  await second.goto('/network');
  await expect.poll(() => again.all().length).toBeGreaterThan(0);
  expect(again.network()).toHaveLength(0);
});

test('a page view fetches no other page in the background', async ({ page }) => {
  const background: string[] = [];
  page.on('request', (request) => {
    const headers = request.headers();
    if (new URL(request.url()).searchParams.has('_rsc') || headers['next-router-prefetch'])
      background.push(request.url());
  });
  for (const path of ['/', '/how-it-works', '/plan', '/network']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    // Links scroll into view where prefetching would start; give it the time it would need.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
  expect(background).toEqual([]);
});
