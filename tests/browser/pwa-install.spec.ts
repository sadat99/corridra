import { expect, test, type Page } from '@playwright/test';

// The installable application against a production build (owner directive, 13 November 2026). These run on
// Chromium, which is what can install from a browser; Safari on iPhone and iPad is added to the Home Screen
// by hand and is listed as not verified here. Before this work the manifest asked for `display: browser`,
// there was no `/sw.js` and no offline page, so every check below fails on the old code.

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'installability does not depend on the window width');
});

/**
 * Waits until a worker controls the page and has finished taking its copy of the offline page.
 *
 * A page becomes controlled before the worker has finished installing, so a test that went offline at the
 * first sign of a controller would be racing the copy it is about to need. A person is in the same position
 * for the first second of their first visit: until the copy is there the browser shows its own error.
 */
async function ready(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker.controller) return false;
          const cache = await caches.open('corridra-offline-v1');
          const held = (await cache.keys()).map((request) => new URL(request.url).pathname);
          return (
            held.includes('/offline') && held.some((path) => path.startsWith('/_next/static/'))
          );
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test('the manifest is served and asks for a standalone Corridra window', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  const manifest = JSON.parse(await response.text());
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Corridra',
    short_name: 'Corridra',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f8fb',
    theme_color: '#142438',
  });
  // Every icon it names is really there, at the size it claims.
  for (const icon of manifest.icons) {
    const file = await page.request.get(new URL(icon.src, page.url()).href);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()['content-type']).toBe('image/png');
    expect((await file.body()).length).toBeGreaterThan(0);
  }
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
    true,
  );
  // iPhone and iPad read these instead of the manifest.
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Corridra',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test('the worker file is served fresh, as JavaScript, at the root scope', async ({ page }) => {
  await page.goto('/');
  const response = await page.request.get(new URL('/sw.js', page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/javascript/);
  // A worker held in a cache cannot be replaced or retired, so this file is never stored.
  expect(response.headers()['cache-control']).toMatch(/no-store/);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const body = await response.text();
  expect(body).toContain("addEventListener('fetch'");
  expect(body).toContain('/offline');
});

test('one worker registers at the root and controls the page', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const registrations = await page.evaluate(async () => {
    const all = await navigator.serviceWorker.getRegistrations();
    return all.map((registration) => registration.scope);
  });
  expect(registrations).toHaveLength(1);
  expect(registrations[0]).toMatch(/\/$/);
  // The page itself is untouched: the worker passes every answer through from the network.
  await expect(page.getByRole('link', { name: 'Install Corridra' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Need a hand?' })
      .getByRole('link', { name: 'Install Corridra' }),
  ).toHaveAttribute('href', '/install');
});

test('with no network an installed Corridra says so, and shows nothing private', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await ready(page);
  await context.setOffline(true);
  try {
    await page.goto('/sell');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Corridra cannot connect right now.',
    );
    await expect(page.getByText('Reconnect to continue.')).toBeVisible();
    // Trying again asks for the page the person wanted, not the home page.
    await expect(page.getByRole('link', { name: 'Try Again' })).toHaveAttribute('href', '');
    // The page is styled, so the precached stylesheet of the offline page was used.
    const colour = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(colour).not.toBe('rgba(0, 0, 0, 0)');

    // A private page offline shows the same page and never an account: nothing signed-in is stored.
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Corridra cannot connect right now.',
    );
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/Workspace|Requests|Sign Out|Companies|Sign In/i);
    // The shared chrome is not shown here: no link that cannot work, and no reading of who is signed in.
    // The page may be served at any address, so the page itself hides it rather than relying on the address.
    const chrome = page.locator('.site-header, .guide-footer, .site-footer, .corner-dock');
    for (let index = 0, count = await chrome.count(); index < count; index++)
      await expect(chrome.nth(index)).toBeHidden();
    // Back online, Try Again loads the address that was asked for, and the offline page is gone.
    await context.setOffline(false);
    await page.getByRole('link', { name: 'Try Again' }).click();
    await expect(page).toHaveURL(/\/account|\/signin/);
    await expect(page.getByText('Corridra cannot connect right now.')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test('the worker stores only the offline page and its own stylesheets', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  // Pages a person visits are never added to a cache.
  await page.goto('/sell');
  await page.goto('/how-it-works');
  const held = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) entries.push(new URL(request.url).pathname);
    }
    return { names, entries };
  });
  expect(held.names).toEqual(['corridra-offline-v1']);
  expect(held.entries).toContain('/offline');
  for (const entry of held.entries)
    expect(entry === '/offline' || entry.startsWith('/_next/static/'), entry).toBe(true);
  expect(held.entries.some((entry) => entry.startsWith('/account'))).toBe(false);
  expect(held.entries.some((entry) => entry.startsWith('/api'))).toBe(false);
});

test('the install page explains every platform and offers no broken control', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Install Corridra as an app.');
  for (const title of ['Android (Chrome)', 'iPhone and iPad (Safari)', 'Computer (Chrome or Edge)'])
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  // Headless Chromium does not offer an install, so no install button is drawn and nothing claims success.
  await expect(page.getByRole('button', { name: 'Install Corridra' })).toHaveCount(0);
  // No outcome is announced when nothing was asked: the page never claims an install that did not happen.
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See How It Works' })).toHaveAttribute(
    'href',
    '/how-it-works',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
