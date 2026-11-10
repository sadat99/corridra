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

// The three icons the page links: the tab icon, the older .ico (some browsers ask for it) and the phone home screen icon.
const icons = [
  {
    name: 'the tab icon',
    link: 'link[rel="icon"][type="image/svg+xml"]',
    address: iconAddress,
    type: 'image/svg+xml',
  },
  {
    name: 'the older .ico',
    link: 'link[rel="icon"][type="image/x-icon"]',
    address: /^\/favicon\.ico\?favicon\.[A-Za-z0-9_-]+\.ico$/,
    type: /^image\/(?:x-icon|vnd\.microsoft\.icon)$/,
  },
  {
    name: 'the phone home screen icon',
    link: 'link[rel="apple-touch-icon"]',
    address: /^\/apple-icon\.png\?apple-icon\.[A-Za-z0-9_-]+\.png$/,
    type: 'image/png',
  },
] as const;

for (const icon of icons) {
  test(`${icon.name}: its address carries the file hash and it is kept for a year`, async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const href = await page.locator(icon.link).getAttribute('href');
    expect(href).toMatch(icon.address);
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(icon.type);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    // The rule is not kept by other addresses of the site: pages stay as they were.
    const home = await request.get('/');
    expect(home.headers()['cache-control'] ?? '').not.toContain('immutable');
  });
}

test('the page links only the hashed form of each icon, never the bare address', async ({
  page,
}) => {
  await page.goto('/');
  const hrefs = await page
    .locator('head link[rel~="icon"], head link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  for (const href of hrefs)
    expect(href, href).toMatch(/\?(?:icon|favicon|apple-icon)\.[A-Za-z0-9_-]+\./);
});

// A header rule cannot ask for "has a hash" (the hash is in the name of the query), so the bare address, which nothing
// links to, is kept the same way. This records that, so the choice is known and a change to it is deliberate.
test('the bare address of each icon is kept for a year too, and nothing links to it', async ({
  request,
}) => {
  for (const path of ['/icon.svg', '/favicon.ico', '/apple-icon.png']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['cache-control'], path).toBe('public, max-age=31536000, immutable');
  }
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
