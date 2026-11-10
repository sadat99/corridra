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

/**
 * Fetches an address from the page with a same-origin fetch(), so the browser's own HTTP cache rules apply, and says
 * whether the bytes came over the network (resource timing: a response served from the cache has a transfer size of
 * 0). These checks do not wait for the browser to ask for the tab icon by itself: whether and when a browser requests
 * the favicon of a page depends on the browser and its headless mode (a headless Chromium of one version did not
 * request it at all), so nothing below relies on that request or its timing.
 */
async function fetchFromPage(page: Page, address: string) {
  return page.evaluate(async (target) => {
    const url = new URL(target, location.href).href;
    const seen = () => performance.getEntriesByName(url).length;
    const before = seen();
    const response = await fetch(url);
    await response.arrayBuffer();
    // The timing entry is added when the response has ended.
    for (let wait = 0; wait < 100 && seen() <= before; wait++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const entries = performance.getEntriesByName(url) as PerformanceResourceTiming[];
    if (entries.length <= before) throw new Error(`no timing entry for ${url}`);
    const transferSize = entries[entries.length - 1].transferSize;
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      transferSize,
      fromNetwork: transferSize > 0,
    };
  }, address);
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

async function iconAddresses(page: Page) {
  return Promise.all(
    icons.map(async (icon) => (await page.locator(icon.link).getAttribute('href')) as string),
  );
}

for (const icon of icons) {
  test(`${icon.name}: the first fetch comes over the network and the next one from the browser cache`, async ({
    page,
  }) => {
    await page.goto('/');
    const href = (await page.locator(icon.link).getAttribute('href')) as string;
    // A new address (an extra query) is one this browser has never kept, so the first fetch cannot be a cache hit
    // whether or not the browser asked for the icon by itself; the header rule is the same for it.
    const fresh = `${href}&fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await fetchFromPage(page, fresh);
    expect(first.status).toBe(200);
    expect(first.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(first.fromNetwork, 'the first fetch is a 200 from the network').toBe(true);
    const second = await fetchFromPage(page, fresh);
    expect(second.status).toBe(200);
    expect(second.fromNetwork, 'the second fetch is served from the cache').toBe(false);
    expect(second.transferSize).toBe(0);
  });
}

test('a tap to another page does not fetch the icons again: a later fetch of each is a cache hit', async ({
  page,
}) => {
  await page.goto('/');
  const hrefs = await iconAddresses(page);
  for (const href of hrefs) expect(href).toBeTruthy();
  // Whatever the browser did by itself, after this fetch the icon is in the cache.
  for (const href of hrefs) expect((await fetchFromPage(page, href)).status).toBe(200);
  // A soft navigation inside the site (no full page load).
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
  expect(await iconAddresses(page), 'the icon addresses are the same on the next page').toEqual(
    hrefs,
  );
  for (const href of hrefs) {
    const again = await fetchFromPage(page, href);
    expect(again.fromNetwork, `${href} after a tap`).toBe(false);
    expect(again.transferSize, href).toBe(0);
  }
});

test('a second visit takes each icon from the browser cache, not the network', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const hrefs = await iconAddresses(page);
  for (const href of hrefs) expect((await fetchFromPage(page, href)).status).toBe(200);
  const second = await context.newPage();
  await second.goto('/network');
  expect(await iconAddresses(second)).toEqual(hrefs);
  for (const href of hrefs) {
    const again = await fetchFromPage(second, href);
    expect(again.fromNetwork, `${href} on a second visit`).toBe(false);
    expect(again.transferSize, href).toBe(0);
  }
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
