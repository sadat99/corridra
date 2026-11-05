import { test, expect, signInCustomer } from '../fixtures';
import type { Page } from '@playwright/test';

// CX PR 1, the customer shell (docs/revamp/specs/customer-experience.md and layout-budget.md): a left bar at
// 1024 px and wider, a left drawer below it, a slim one-row header, and no eyebrow or amber banner. Run on a
// production build with the test-only customer sign-in. Case ids: L-01, CX-02, CX-03, CX-06.
const bar = (page: Page) => page.getByRole('navigation', { name: 'Customer navigation' });
const header = (page: Page) => page.locator('header.ux-app-header');
// The destinations every customer page had before the bar, in their order (Companies appears only where
// the approved-companies module is on, which it is not on this server).
const destinations: [string, string][] = [
  ['Home', '/account'],
  ['Requests', '/account?view=work'],
  ['Reports', '/account?view=results'],
  ['Account', '/account?view=more'],
];

test.beforeEach(async ({ context }) => {
  await signInCustomer(context);
});

test('L-01 at 1440 the destinations are a left bar beside the page, with the same names and addresses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(bar(page)).toBeVisible();
  const links = bar(page).getByRole('link');
  await expect(links).toHaveText(destinations.map(([name]) => name));
  expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))).toEqual(
    destinations.map(([, href]) => href),
  );
  await expect(bar(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const beside = await page.evaluate(() => {
    const nav = document
      .querySelector('nav[aria-label="Customer navigation"]')!
      .getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    return { barRight: nav.right, barTop: nav.top, mainLeft: main.left };
  });
  expect(beside.barRight).toBeLessThanOrEqual(beside.mainLeft + 1);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
});

test('L-01 at 390 the bar is a drawer: a menu button opens it, focus stays inside, Escape closes it and returns focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  const opener = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(opener).toBeVisible();
  const panel = page.locator('.ux-leftnav-panel');
  await expect(panel).toHaveAttribute('data-open', 'false');
  expect((await panel.boundingBox())!.x + (await panel.boundingBox())!.width).toBeLessThanOrEqual(
    1,
  );
  await opener.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('dialog', { name: /./ })).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ux-leftnav-panel'))).toBe(
      true,
    );
  }
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(opener).toBeFocused();
  await opener.click();
  await bar(page).getByRole('link', { name: 'Requests' }).click();
  await expect(page).toHaveURL(/\/account\?view=work/);
  await expect(panel).toHaveAttribute('data-open', 'false');
});

test('CX-06 no amber banner, no eyebrow and no tab row on a customer page', async ({ page }) => {
  for (const path of ['/account', '/account?view=work', '/account?view=more']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('.ux-testmode')).toHaveCount(0);
    await expect(page.locator('main .ux-page-heading .label')).toHaveCount(0);
    await expect(page.locator('.guide-tabs')).toHaveCount(0);
  }
});

test('CX-03 the header is one slim row with no bordered text buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const box = (await header(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(64);
  const bordered = await header(page).evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>('a, button, summary'))
      .filter((node) => node.offsetParent !== null && (node.textContent ?? '').trim() !== '')
      .filter((node) => parseFloat(getComputedStyle(node).borderTopWidth) > 0)
      .map((node) => (node.textContent ?? '').trim()),
  );
  expect(bordered).toEqual([]);
  await expect(header(page).getByRole('link', { name: 'New request' })).toBeVisible();
});

test('CX-03 the account menu holds the name, the language, the website, the privacy notice and Sign out, and works by keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Account menu' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('qa-customer@example.invalid');
  await expect(menu.getByRole('group', { name: /Language/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Corridra website' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(menu.getByRole('menuitem', { name: 'Privacy notice' })).toHaveAttribute(
    'href',
    '/privacy',
  );
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await expect(menu).toContainText(/Preview workspace|stays private/);
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toMatch(
    /^menuitem/,
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

test('CX-03 the inbox is an icon with its unread count for assistive technology', async ({
  page,
}) => {
  const item = (id: string, readAt: string | null) => ({
    id,
    type: 'REPLY_POSTED',
    payload: { title: 'New reply' },
    readAt,
    createdAt: '2026-11-04T10:00:00Z',
  });
  await page.route('**/api/customer-inbox', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([item('1', null), item('2', null), item('3', '2026-11-04T11:00:00Z')]),
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const inbox = header(page).getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toBeVisible();
  await expect(inbox).toHaveAccessibleDescription('2 unread');
  await expect(inbox).toContainText('2');
});

test('CX-02 every header action from before is still reachable: inbox, language, website, help, and the same destinations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(header(page).getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
  // The help button lives in the corner dock, outside the header, and stays on the page.
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu.getByRole('group', { name: /Language/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Corridra website' })).toBeVisible();
  const hrefs = await bar(page)
    .getByRole('link')
    .evaluateAll((all) => all.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(destinations.map(([, href]) => href));
});
