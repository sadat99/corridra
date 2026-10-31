import { test, expect, evidence } from '../fixtures';
import { canonicalSiteOrigin } from '../../../../apps/web/lib/canonical-origin';

// WS-E platform cases on the verification server (program 6.E): E-1 canonical address, E-2 skip
// link, E-3 locale and direction on the public and contributor shells. The server runs with
// CORRIDRA_UX_SHELLS_V2 on and draft languages offered.

test('E-1: every page names the owned address as canonical; local hosts are never redirected', async ({
  page,
}, info) => {
  for (const path of ['/', '/how-it-works', '/trust', '/contributor', '/operator/signin']) {
    const response = await page.goto(path);
    // The redirect only runs on the production deployment (VERCEL_ENV=production); unit tests in
    // tests/integration/ux-kit.test.ts prove the 308 with path and query from the hosting alias.
    expect(response?.status(), path).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      canonicalSiteOrigin + (path === '/' ? '' : path),
    );
  }
  await evidence(page, `E-1-${info.project.name}`);
});

test('E-2: the skip link is the first stop, sits above the header and moves focus to the page', async ({
  page,
}, info) => {
  const response = await page.goto('/how-it-works');
  expect(response?.status()).toBe(200);
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  // Nothing covers it: the element at its centre is the link itself.
  const onTop = await skip.evaluate((link) => {
    const box = link.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === link || link.contains(hit);
  });
  expect(onTop).toBe(true);
  const box = await skip.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await evidence(page, `E-2-${info.project.name}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('E-3: Arabic sets right to left on the public and contributor shells, with no marketing header in the app', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'ar'));
  let response = await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  // The boot script sets the direction before the page is drawn.
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('#public-navigation')).toHaveCount(1);

  response = await page.goto('/contributor');
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const header = page.locator('header.ux-app-header[data-shell="contributor"]');
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute('dir', 'rtl');
  await expect(header).toContainText('مهامك');
  // D14: no public marketing header inside a signed-in shell.
  await expect(page.locator('#public-navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Start a request' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await evidence(page, `E-3-${info.project.name}`);
});

test('CQ-47 and UX-15: no Sample or Real badge in the public header; Help is reachable at every width', async ({
  page,
}, info) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('.mr-mode')).toHaveCount(0);
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveCount(1);
  await expect(help).toBeVisible();
  const box = await help.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(43.5);
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Need a hand?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  if (info.project.name === 'w390') {
    // On phones Help lives in the header, never floating over the page.
    await expect(page.locator('header .header-help')).toBeVisible();
    await expect(page.locator('.corner-dock:not(.header-help)')).toBeHidden();
  }
  await evidence(page, `UX-15-${info.project.name}`);
});
