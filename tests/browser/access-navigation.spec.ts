import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
test('operator setup explains verified invitation requirements without collecting anonymous credentials', async ({
  page,
}) => {
  await page.goto('/operator/setup');
  await expect(page.getByRole('heading', { name: 'Set up your operator access.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your operator invitation' })).toContainText(
    'unavailable',
  );
  await expect(page.getByLabel('New operator password', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Customer account and email verification' }),
  ).toHaveAttribute('href', '/account');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('the start page offers three plain choices and links each kind of person to the right place', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  if (await page.getByRole('button', { name: 'Menu', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await nav.getByRole('link', { name: 'Start here', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Plan a mission', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(
    main.getByRole('link', { name: 'See a sample mission', exact: true }),
  ).toHaveAttribute('href', '/#mission-example');
  await expect(main.getByRole('link', { name: 'Open my account', exact: true })).toHaveAttribute(
    'href',
    '/account',
  );
  await expect(main.getByRole('link', { name: 'Team sign-in', exact: true })).toHaveAttribute(
    'href',
    '/operator',
  );
  await expect(
    main.getByRole('link', { name: 'Set up your team account', exact: true }),
  ).toHaveAttribute('href', '/operator/setup');
  await expect(
    main.getByRole('link', { name: 'Local helper sign-in', exact: true }),
  ).toHaveAttribute('href', '/contributor');
  // Plain words: none of the old role and tool jargon on the first page a visitor opens.
  const text = await main.innerText();
  for (const jargon of ['Synthetic', 'operator tools', 'Workspace roles', 'production activation'])
    expect(text).not.toContain(jargon);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await main.getByRole('link', { name: 'Team sign-in', exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
  await expect(page.getByRole('main')).toContainText('not configured');
});
test('protected access entries explain unavailable configuration and offer a way back', async ({
  page,
}) => {
  for (const route of ['/operator', '/operator/signin', '/contributor']) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText(/not configured/);
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Back to Corridra' }),
    ).toHaveAttribute('href', '/');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('invited network and private sharing help have connected recovery paths', async ({ page }) => {
  await page.goto('/network');
  await page.getByRole('link', { name: 'Already invited? Open assigned-task access' }).click();
  await expect(page).toHaveURL(/\/contributor$/);
  await expect(page.getByRole('heading', { name: 'Your assigned tasks.' })).toBeVisible();
  for (const route of ['/client', '/programme']) {
    await page.goto(route);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('private link');
    await expect(page.getByRole('link', { name: 'Customer account', exact: true })).toHaveAttribute(
      'href',
      '/account',
    );
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Back to Corridra' }),
    ).toBeVisible();
  }
});

test('UX-01 invitation outage can be retried without collecting credentials or changing identity', async ({
  page,
}) => {
  await page.goto('/operator/setup');
  const invitation = page.getByRole('region', { name: 'Your operator invitation' });
  await expect(invitation.getByRole('alert')).toContainText('unavailable');
  await expect(invitation.getByLabel('New operator password', { exact: true })).toHaveCount(0);
  const request = page.waitForResponse((response) =>
    response.url().endsWith('/api/operator-setup'),
  );
  await invitation.getByRole('button', { name: 'Check invitation again' }).click();
  expect((await request).request().method()).toBe('GET');
  await expect(invitation.getByRole('alert')).toContainText('unavailable');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('the start page holds at every width without overflow or accessibility problems', async ({
  page,
}) => {
  await mkdir('.cache/ux06/public-after', { recursive: true });
  await page.goto('/workspace');
  for (const width of [1440, 1280, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `.cache/ux06/public-after/start-${width}.png` });
  }
});
