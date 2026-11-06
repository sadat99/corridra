import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInCustomer } from '../fixtures';
import type { Page } from '@playwright/test';

// Navigation v1, the customer shell (docs/revamp/specs/navigation-v1.md, boards CustomerDesktop, CustomerMobile and
// UtilityMenus), run on a production build with the test-only customer sign-in. Supersedes the CX PR 1 shell cases
// that described the left drawer and the account menu at the foot of the bar; the case ids are kept.
// Case ids: L-01 (sidebar from 1024 px, labelled bottom tabs below), CX-02 (every old destination is still
// reachable), CX-03 (the header row and its menus), CX-06 (no banner, no eyebrow, no tab row).
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Customer navigation' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Customer tabs' });
const header = (page: Page) => page.locator('header.ux-app-header');
// Companies appears only where the approved-companies module is on, and Home is Your Move only with its switch,
// neither of which is on this server. So the five tabs are four here, and Home is /account.
const destinations: [string, string][] = [
  ['Home', '/account'],
  ['Requests', '/account?view=work'],
  ['Meetings', '/account/meetings'],
  ['Reports', '/account?view=results'],
];
const hrefsOf = (links: ReturnType<Page['getByRole']>) =>
  links.evaluateAll((all) => all.map((a) => a.getAttribute('href')));

test.beforeEach(async ({ context }) => {
  await signInCustomer(context);
});

test('L-01 at 1440 the destinations are a sidebar beside the page, with New Request at its top and no Menu button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(sidebar(page)).toBeVisible();
  const links = sidebar(page).getByRole('link');
  await expect(links).toHaveText(destinations.map(([name]) => name));
  expect(await hrefsOf(links)).toEqual(destinations.map(([, href]) => href));
  await expect(sidebar(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const newRequest = page.locator('.ux-leftnav-panel').getByRole('link', { name: 'New Request' });
  await expect(newRequest).toBeVisible();
  expect(['/plan', '/account?view=work#customer-workspaces']).toContain(
    await newRequest.getAttribute('href'),
  );
  expect((await newRequest.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
  const beside = await page.evaluate(() => {
    const nav = document
      .querySelector('nav[aria-label="Customer navigation"]')!
      .getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    return { barRight: nav.right, mainLeft: main.left };
  });
  expect(beside.barRight).toBeLessThanOrEqual(beside.mainLeft + 1);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
  await expect(tabs(page)).toBeHidden();
  // Help on WhatsApp has no owner-configured number: plain text with a tag, never a link.
  const whatsapp = page.locator('.ux-rail-soon');
  await expect(whatsapp).toContainText('Help on WhatsApp');
  await expect(whatsapp).toContainText('Coming soon');
  await expect(whatsapp.getByRole('link')).toHaveCount(0);
  await expect(whatsapp.getByRole('button')).toHaveCount(0);
});

for (const width of [320, 390, 768]) {
  test(`L-01 at ${width} the destinations are labelled bottom tabs, 48 px high, with no Menu button and no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account');
    await expect(tabs(page)).toBeVisible();
    const links = tabs(page).getByRole('link');
    await expect(links).toHaveText(destinations.map(([name]) => name));
    expect(await hrefsOf(links)).toEqual(destinations.map(([, href]) => href));
    await expect(tabs(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const box of await links.evaluateAll((all) =>
      all.map((a) => a.getBoundingClientRect().toJSON()),
    ))
      expect(box.height).toBeGreaterThanOrEqual(47.5);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
    await expect(page.locator('.ux-leftnav-rail')).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The last of the page is not hidden behind the tabs.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const clear = await page.evaluate(() => {
      const tabsTop = document.querySelector('.ux-customer-tabs')!.getBoundingClientRect().top;
      const main = document.querySelector('main')!.getBoundingClientRect();
      return main.bottom <= tabsTop + 1;
    });
    expect(clear).toBe(true);
    await tabs(page).getByRole('link', { name: 'Requests' }).click();
    await expect(page).toHaveURL(/\/account\?view=work/);
  });
}

test('CX-06 no amber banner, no eyebrow and no tab row on a customer page', async ({ page }) => {
  for (const path of ['/account', '/account?view=work', '/account?view=more']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('.ux-testmode')).toHaveCount(0);
    await expect(page.locator('main .ux-page-heading .label')).toHaveCount(0);
    await expect(page.locator('.guide-tabs')).toHaveCount(0);
  }
});

test('CX-03 the header is one slim row with no bordered text buttons, and New Request is in the sidebar, not the header, from 1024 px', async ({
  page,
}) => {
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
  await expect(header(page).getByRole('link', { name: 'New Request' })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header(page).getByRole('link', { name: 'New Request' })).toBeVisible();
});

test('CX-03 the avatar menu is Account, Company Profile, Plan and Billing, Notification Settings and Sign Out, honest about what is not real yet, and works by keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Account menu' });
  await expect(trigger).toBeVisible();
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('qa-customer@example.invalid');
  await expect(menu).toContainText(/Preview workspace|stays private/);
  await expect(menu.getByRole('menuitem', { name: 'Account', exact: true })).toHaveAttribute(
    'href',
    '/account?view=more',
  );
  await expect(menu.getByRole('menuitem', { name: 'Notification Settings' })).toHaveAttribute(
    'href',
    '/account/notifications',
  );
  await expect(menu.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();
  // This server has no workspace and no billing: both rows are plain text tagged Coming soon, announced as
  // unavailable, and are not links.
  for (const name of ['Company Profile', 'Plan and Billing']) {
    const row = menu.getByRole('menuitem', { name: new RegExp(name) });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText('Coming soon');
    await expect(row).not.toHaveAttribute('href', /.*/);
  }
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toMatch(
    /^menuitem/,
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

test('CX-03 the language menu offers the languages in their own names and the choice applies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Language' });
  await expect(trigger).toBeVisible();
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Language' });
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(menu.getByRole('menuitemradio', { name: 'বাংলা' })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Español' })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: '中文' })).toBeVisible();
});

test('CX-02 Help and accessibility: real things are links or switches, the rest is plain text tagged Coming soon', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Help and accessibility' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  for (const group of ['Get Help', 'Make It Easier to Read', 'About Corridra'])
    await expect(menu.getByRole('group', { name: group })).toBeVisible();
  const link = (name: string) => menu.getByRole('menuitem', { name, exact: true });
  await expect(link('See How It Works')).toHaveAttribute('href', '/how-it-works');
  await expect(link('How We Label Facts')).toHaveAttribute('href', '/trust');
  await expect(link('Corridra Website')).toHaveAttribute('href', '/');
  await expect(link('Privacy Notice')).toHaveAttribute('href', '/privacy');
  for (const name of [
    'Chat on WhatsApp',
    'Report a Problem',
    'Text Size',
    'Stronger Colours',
    'Less Movement',
  ]) {
    const row = menu.getByRole('menuitem', { name: new RegExp(name) });
    await expect(row, name).toHaveAttribute('aria-disabled', 'true');
    await expect(row, name).toContainText('Coming soon');
    await expect(row, name).not.toHaveAttribute('href', /.*/);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('reading aloud started from Help can be stopped from Help again', async ({ page }) => {
  // A browser voice that keeps speaking until it is cancelled, so the test sees the state between.
  await page.addInitScript(() => {
    const synth = window.speechSynthesis;
    const counts = { speak: 0, cancel: 0 };
    (window as unknown as { __speech: typeof counts }).__speech = counts;
    synth.speak = () => {
      counts.speak += 1;
    };
    synth.cancel = () => {
      counts.cancel += 1;
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Help and accessibility' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  await menu.getByRole('menuitemcheckbox', { name: 'Listen to This Page' }).click();
  const speech = () =>
    page.evaluate(
      () => (window as unknown as { __speech: { speak: number; cancel: number } }).__speech,
    );
  expect((await speech()).speak).toBe(1);
  await trigger.click();
  const stop = menu.getByRole('menuitemcheckbox', { name: 'Stop Reading' });
  await expect(stop).toHaveAttribute('aria-checked', 'true');
  const cancelledBefore = (await speech()).cancel;
  await stop.click();
  expect((await speech()).cancel).toBe(cancelledBefore + 1);
  expect((await speech()).speak).toBe(1);
});

const inboxItem = (id: string, type: string, title: string, readAt: string | null) => ({
  id,
  type,
  payload: { title },
  readAt,
  createdAt: '2026-11-04T10:00:00Z',
});

test('CX-03 the notifications panel groups Needs You, Updates and Earlier, marks all read with the existing read call, and counts unread for assistive technology', async ({
  page,
}) => {
  const items = [
    inboxItem('1', 'TEAM_INVITE', 'Team invitation', null),
    inboxItem('2', 'REPLY_POSTED', 'New reply', null),
    inboxItem('3', 'REPORT_PUBLISHED', 'Report ready', null),
    inboxItem('4', 'REPLY_POSTED', 'Old reply', '2026-11-04T11:00:00Z'),
  ];
  const posted: string[] = [];
  await page.route('**/api/customer-inbox', async (route) => {
    if (route.request().method() === 'POST') {
      const id = (route.request().postDataJSON() as { id: string }).id;
      posted.push(id);
      const item = items.find((one) => one.id === id);
      if (item) item.readAt = '2026-11-05T09:00:00Z';
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(items),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const bell = header(page).getByRole('button', { name: 'Notifications', exact: true });
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAccessibleDescription('3 unread');
  expect((await bell.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await bell.click();
  const panel = page.locator('.ux-notice-panel');
  await expect(panel.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Needs You' })).toContainText('Team invitation');
  await expect(panel.getByRole('group', { name: 'Updates' })).toContainText('New reply');
  await expect(panel.getByRole('group', { name: 'Updates' })).toContainText('Report ready');
  await expect(panel.getByRole('group', { name: 'Earlier' })).toContainText('Old reply');
  // Needs You is first in the document order.
  const order = await panel.locator('h3').allTextContents();
  expect(order).toEqual(['Needs You', 'Updates', 'Earlier']);
  // Unread is a dot and a tint with words for assistive technology, not a colour alone.
  await expect(panel.locator('li[data-unread="true"] .ux-notice-dot')).toHaveCount(3);
  await expect(panel.locator('li[data-unread="true"] .sr-only').first()).toContainText('Unread');
  await panel.getByRole('button', { name: 'Mark All Read' }).click();
  await expect(panel.getByRole('button', { name: 'Mark All Read' })).toHaveCount(0);
  expect(posted.sort()).toEqual(['1', '2', '3']);
  await expect(panel.getByRole('group', { name: 'Earlier' })).toContainText('Team invitation');
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
});

test('CX-02 every destination the customer menus reached before is still reachable from the new navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const reached = new Set<string>();
  for (const href of await hrefsOf(sidebar(page).getByRole('link'))) reached.add(href!);
  reached.add((await page.locator('.ux-rail-new').getAttribute('href'))!);
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  for (const href of await hrefsOf(
    page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem'),
  ))
    if (href) reached.add(href);
  await page.keyboard.press('Escape');
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  for (const href of await hrefsOf(
    page.getByRole('menu', { name: 'Help and accessibility' }).getByRole('menuitem'),
  ))
    if (href) reached.add(href);
  // Home, Requests, Reports, Account, New Request, the website, the privacy notice and Help's How It Works.
  for (const old of [
    '/account',
    '/account?view=work',
    '/account?view=results',
    '/account?view=more',
    '/',
    '/privacy',
    '/how-it-works',
  ])
    expect(reached.has(old), `${old} is no longer reachable`).toBe(true);
  expect(
    ['/plan', '/account?view=work#customer-workspaces'].some((href) => reached.has(href)),
  ).toBe(true);
  // All tools stays linked from the Account page where the navigation switch is on (checked in
  // tests/integration/revamp-nav-customer-model.test.ts); this server has that switch off.
});

test('CX-02 on a phone the language and help menus are inside the avatar menu, so nothing is lost when the row is narrow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await expect(header(page).getByRole('button', { name: 'Language' })).toBeHidden();
  await expect(header(page).getByRole('button', { name: 'Help and accessibility' })).toBeHidden();
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'See How It Works' })).toHaveAttribute(
    'href',
    '/how-it-works',
  );
  await expect(menu.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();
  // The whole menu is on screen.
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
});

test('the Meetings tab opens a page that says what it is, with the combined list marked Coming soon and not a link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await sidebar(page).getByRole('link', { name: 'Meetings' }).click();
  await expect(page).toHaveURL(/\/account\/meetings$/);
  await expect(page.locator('main h1')).toHaveText('Meetings');
  await expect(sidebar(page).getByRole('link', { name: 'Meetings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const soon = page.locator('.ux-soon-line');
  await expect(soon).toContainText('One list of all your meetings');
  await expect(soon).toContainText('Coming soon');
  await expect(soon.getByRole('link')).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`axe finds nothing on the customer shell at ${width}, menus closed and with the avatar and help menus open`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/account');
    await expect(page.locator('main h1').first()).toBeVisible();
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(await scan()).toEqual([]);
    await header(page).getByRole('button', { name: 'Account menu' }).click();
    expect(await scan()).toEqual([]);
    await page.keyboard.press('Escape');
    const help = header(page).getByRole('button', { name: 'Help and accessibility' });
    if (await help.isVisible()) {
      await help.click();
      expect(await scan()).toEqual([]);
    }
  });
}
