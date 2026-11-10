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
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
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
  await expect(menu.getByRole('menuitem', { name: 'Sign Out' })).toBeVisible();
  // This server has no workspace, no billing and no email choices page: these rows are plain text tagged Coming soon, announced as
  // unavailable, and are not links.
  // Notification Settings joins them: its page answers 404 unless Pulse or the customer area is on, which this
  // server does not have, so a link would lead nowhere.
  for (const name of ['Company Profile', 'Plan and Billing', 'Notification Settings']) {
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

test('CX-03 the phone tabs follow the chosen language as the sidebar does, and a new word is marked English', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'bn'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  const links = tabs(page).getByRole('link');
  await expect(links.nth(0)).toHaveText('হোম');
  await expect(links.nth(1)).toHaveText('আমার কাজ');
  await expect(links.nth(3)).toHaveText('ফলাফল');
  // Meetings has no reviewed translation, so it stays English and says so.
  await expect(links.nth(2)).toHaveText('Meetings');
  await expect(links.nth(2).locator('[lang="en"]')).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar(page).getByRole('link').nth(0)).toHaveText('হোম');
});

test('CX-03 the avatar menu never offers a link that does not open', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  const hrefs = (await hrefsOf(menu.getByRole('menuitem'))).filter(
    (href): href is string => !!href && href.startsWith('/'),
  );
  expect(hrefs).toContain('/account?view=more');
  for (const href of hrefs) {
    const response = await page.request.get(href);
    expect(response.status(), `${href} answered ${response.status()}`).toBeLessThan(400);
  }
  void request;
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
  for (const name of ['Chat on WhatsApp', 'Report a Problem', 'Stronger Colours']) {
    const row = menu.getByRole('menuitem', { name: new RegExp(name) });
    await expect(row, name).toHaveAttribute('aria-disabled', 'true');
    await expect(row, name).toContainText('Coming soon');
    await expect(row, name).not.toHaveAttribute('href', /.*/);
  }
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  await expect(menu.getByText('Coming soon')).toHaveCount(3);
  // Text Size and Less Movement are real controls now, not Coming soon rows.
  await expect(menu.getByRole('menuitem', { name: /Text Size|Less Movement/ })).toHaveCount(0);
  await expect(menu.getByRole('group', { name: 'Text Size' })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /Less Movement/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

/** The root text size and the two choices on <html>, as the page shows them right now. */
const comfort = (page: Page) =>
  page.evaluate(() => ({
    fontSize: getComputedStyle(document.documentElement).fontSize,
    textSize: document.documentElement.getAttribute('data-text-size'),
    lessMovement: document.documentElement.getAttribute('data-less-movement'),
  }));

test('W7 Text Size has three steps in the Help menu: each changes the text, shows its state in words and aria, survives a reload, and the menu stays open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  expect(await comfort(page)).toEqual({ fontSize: '16px', textSize: null, lessMovement: null });
  const trigger = header(page).getByRole('button', { name: 'Help and accessibility' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  const group = menu.getByRole('group', { name: 'Text Size' });
  const radio = (name: string) => group.getByRole('menuitemradio', { name, exact: true });
  await expect(group.getByRole('menuitemradio')).toHaveCount(3);
  await expect(radio('A, Normal Text')).toHaveAttribute('aria-checked', 'true');
  await expect(group).toContainText('Normal');
  for (const [name, word, size, attribute] of [
    ['A, Large Text', 'Large', '18px', 'large'],
    ['A, Largest Text', 'Largest', '20px', 'largest'],
    ['A, Normal Text', 'Normal', '16px', null],
  ] as const) {
    await radio(name).click();
    await expect(radio(name)).toHaveAttribute('aria-checked', 'true');
    await expect(group.locator('.ux-textsize-current')).toHaveText(word);
    expect(await comfort(page), name).toMatchObject({ fontSize: size, textSize: attribute });
    // Choosing a step keeps the menu open and keeps focus on the button just chosen.
    await expect(menu).toBeVisible();
    await expect(radio(name)).toBeFocused();
    for (const other of ['A, Normal Text', 'A, Large Text', 'A, Largest Text'].filter(
      (n) => n !== name,
    ))
      await expect(radio(other)).toHaveAttribute('aria-checked', 'false');
  }
  // The choice is kept in this browser: it is in place after a reload and after moving to another page.
  await radio('A, Largest Text').click();
  await page.reload();
  expect(await comfort(page)).toMatchObject({ fontSize: '20px', textSize: 'largest' });
  await trigger.click();
  await expect(radio('A, Largest Text')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.goto('/account/meetings');
  expect(await comfort(page)).toMatchObject({ fontSize: '20px' });
});

test('W7 Less Movement is a switch in the Help menu that stops movement and stays open, and the OS setting is never undone by it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Help and accessibility' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  const toggle = menu.getByRole('menuitemcheckbox', { name: /Less Movement/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toContainText('Off');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('On');
  await expect(menu).toBeVisible();
  expect(await comfort(page)).toMatchObject({ lessMovement: 'on' });
  // The same effect as the system setting: no transition time left and no smooth scrolling.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  expect(
    await page.evaluate(() => parseFloat(getComputedStyle(document.body).transitionDuration)),
  ).toBeLessThan(0.001);
  await page.reload();
  expect(await comfort(page)).toMatchObject({ lessMovement: 'on' });
  await trigger.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await comfort(page)).toMatchObject({ lessMovement: null });
  // With the system setting on and Less Movement off, motion is still reduced.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
});

test('W7 the two controls work by keyboard, are at least 44 px, and Escape returns focus to the Help button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const trigger = header(page).getByRole('button', { name: 'Help and accessibility' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  await expect(menu).toBeVisible();
  const first = menu.getByRole('group', { name: 'Text Size' }).getByRole('menuitemradio').first();
  // Arrow keys walk every row, including the three steps and the switch.
  for (
    let guard = 0;
    guard < 20 && !(await first.evaluate((el) => el === document.activeElement));
    guard++
  )
    await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(
    menu.getByRole('menuitemradio', { name: 'A, Large Text', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toBeVisible();
  const toggle = menu.getByRole('menuitemcheckbox', { name: /Less Movement/ });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  for (const control of [...(await menu.getByRole('menuitemradio').all()), toggle]) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('W7 choosing a step or Less Movement sends nothing to a server and sets no cookie', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  const cookiesBefore = JSON.stringify(await context.cookies());
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' || new URL(request.url()).pathname.startsWith('/api'))
      sent.push(`${request.method()} ${request.url()}`);
  });
  await menu.getByRole('menuitemradio', { name: 'A, Largest Text', exact: true }).click();
  await menu.getByRole('menuitemcheckbox', { name: /Less Movement/ }).click();
  await menu.getByRole('menuitemradio', { name: 'A, Normal Text', exact: true }).click();
  await menu.getByRole('menuitemcheckbox', { name: /Less Movement/ }).click();
  expect(sent).toEqual([]);
  expect(JSON.stringify(await context.cookies())).toBe(cookiesBefore);
});

test('W7 a browser that will not save says so once, and the choice still holds for the page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A refused request (this test server has no email or other services) is not a script error.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  // One live region is in the menu all the time and is empty until a save fails, so the note is announced when it
  // appears. It takes no room while empty, and it is never shown on load.
  const note = menu.locator('[aria-live="polite"]');
  await expect(note).toHaveCount(1);
  await expect(note).toBeEmpty();
  expect((await note.boundingBox())!.height).toBe(0);
  await menu.getByRole('menuitemradio', { name: 'A, Largest Text', exact: true }).click();
  expect(await comfort(page)).toMatchObject({ fontSize: '20px', textSize: 'largest' });
  await expect(note).toHaveText(
    'This browser cannot save your choice. It lasts until you leave this page.',
  );
  // A second refused save does not add a second note.
  await menu.getByRole('menuitemcheckbox', { name: /Less Movement/ }).click();
  await expect(menu.locator('[aria-live="polite"]')).toHaveCount(1);
  await expect(
    menu.getByText('This browser cannot save your choice. It lasts until you leave this page.'),
  ).toHaveCount(1);
  // The note is the last thing in the Make It Easier to Read group, after Less Movement.
  const order = await menu.evaluate((panel) => {
    const nodes = Array.from(
      panel.querySelectorAll('[role="menuitemcheckbox"], [aria-live="polite"]'),
    );
    return nodes.map((el) => (el.getAttribute('aria-live') ? 'note' : 'switch'));
  });
  expect(order.slice(-2)).toEqual(['switch', 'note']);
  await expect(
    menu.getByRole('menuitemradio', { name: 'A, Largest Text', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('W7 the save note stays while any choice is unsaved: Less Movement refused, Text Size saved, the note is still there', async ({
  page,
}) => {
  // Only Less Movement is refused by this browser; Text Size saves normally.
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'corridra.less-movement') throw new Error('blocked');
      setItem.call(this, key, value);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  const note = menu.locator('[aria-live="polite"]');
  const words = 'This browser cannot save your choice. It lasts until you leave this page.';
  await expect(note).toBeEmpty();
  await menu.getByRole('menuitemcheckbox', { name: /Less Movement/ }).click();
  await expect(note).toHaveText(words);
  await menu.getByRole('menuitemradio', { name: 'A, Large Text', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('corridra.text-size'))).toBe('large');
  await expect(note).toHaveText(words);
  // Turning Less Movement off removes its saved value, which this browser allows, so the last unsaved choice is gone
  // and the note empties.
  await menu.getByRole('menuitemcheckbox', { name: /Less Movement/ }).click();
  await expect(note).toBeEmpty();
});

test('W7 at the largest text on a short screen the Help menu scrolls inside the window and its last row can be reached', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/account');
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  const menu = page.getByRole('menu', { name: 'Help and accessibility' });
  await menu.getByRole('menuitemradio', { name: 'A, Largest Text', exact: true }).click();
  const toggle = menu.getByRole('menuitemcheckbox', { name: /Less Movement/ });
  await toggle.click();
  const panel = await menu.evaluate((el) => ({
    bottom: el.getBoundingClientRect().bottom,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(panel.bottom).toBeLessThanOrEqual(768);
  expect(panel.overflowY).toBe('auto');
  // The note under Less Movement scrolls into view inside the window.
  const note = menu.locator('[aria-live="polite"]');
  await note.scrollIntoViewIfNeeded();
  const box = (await note.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(768);
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('W7 with Less Movement on the busy ring runs once and rests, and with it off it still spins', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const ring = () =>
    page.evaluate(() => {
      let button = document.getElementById('w7-busy');
      if (!button) {
        button = document.createElement('button');
        button.id = 'w7-busy';
        button.className = 'button';
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Sending request';
        document.querySelector('main')!.append(button);
      }
      return getComputedStyle(button, '::after').animationIterationCount;
    });
  expect(await ring()).toBe('infinite');
  await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
  await page
    .getByRole('menu', { name: 'Help and accessibility' })
    .getByRole('menuitemcheckbox', { name: /Less Movement/ })
    .click();
  expect(await ring()).toBe('1');
});

for (const width of [320, 390, 768, 1440]) {
  test(`W7 at the largest text size the Help menu fits at ${width}: no sideways scroll, no clipped row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/account');
    await page.evaluate(() => localStorage.setItem('corridra.text-size', 'largest'));
    await page.reload();
    expect((await comfort(page)).fontSize).toBe('20px');
    const phone = width < 640;
    await header(page)
      .getByRole('button', { name: phone ? 'Account menu' : 'Help and accessibility' })
      .click();
    const menu = page.getByRole('menu', {
      name: phone ? 'Account menu' : 'Help and accessibility',
    });
    await expect(menu.getByRole('group', { name: 'Text Size' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const clipped = await menu.evaluate((panel) =>
      Array.from(panel.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
        .filter((el) => getComputedStyle(el).display !== 'inline')
        .map((el) => `${el.tagName}.${el.className} ${(el.textContent ?? '').slice(0, 30)}`),
    );
    expect(clipped).toEqual([]);
  });
}

test('W7 on a phone the avatar menu holds the same two controls, and they work there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account');
  await header(page).getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await menu.getByRole('menuitemradio', { name: 'A, Large Text', exact: true }).click();
  expect(await comfort(page)).toMatchObject({ fontSize: '18px', textSize: 'large' });
  const toggle = menu.getByRole('menuitemcheckbox', { name: /Less Movement/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: /Stronger Colours/ })).toContainText(
    'Coming soon',
  );
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

test('CX-03 the notifications panel groups Needs You, Updates and Earlier, marks all read with one server call, and counts unread for assistive technology', async ({
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
      // Mark All Read is one server call with nothing but {all:true}; the server picks the recipient.
      const body = route.request().postDataJSON() as { all?: boolean };
      posted.push(JSON.stringify(body));
      for (const item of items) item.readAt ??= '2026-11-05T09:00:00Z';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ marked: 3, unread: 0 }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(items),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const bell = header(page).getByRole('button', { name: 'Inbox', exact: true });
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
  expect(posted).toEqual(['{"all":true}']);
  // The bell counts again while the panel is still open.
  await expect(bell).not.toHaveAccessibleDescription('3 unread');
  await expect(bell.locator('.ux-bar-count')).toHaveCount(0);
  await expect(panel.getByRole('group', { name: 'Earlier' })).toContainText('Team invitation');
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
});

test('CX-03 a full list of 30 asks the server how many are unread, so the bell and Mark All Read cover older items too', async ({
  page,
}) => {
  // The newest 30 are all read, but 12 older items are unread: the list alone would say nothing is waiting.
  let unread = 12;
  const full = Array.from({ length: 30 }, (_, index) =>
    inboxItem(String(index + 1), 'REPLY_POSTED', `Reply ${index + 1}`, '2026-11-04T11:00:00Z'),
  );
  const posted: string[] = [];
  await page.route('**/api/customer-inbox**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      posted.push(JSON.stringify(request.postDataJSON()));
      unread = 0;
      return route.fulfill({ json: { marked: 12, unread: 0 } });
    }
    if (url.searchParams.get('count') === '1') return route.fulfill({ json: { unread } });
    return route.fulfill({ json: full });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const bell = header(page).getByRole('button', { name: 'Inbox', exact: true });
  await expect(bell).toHaveAccessibleDescription('12 unread');
  await bell.click();
  const panel = page.locator('.ux-notice-panel');
  await panel.getByRole('button', { name: 'Mark All Read' }).click();
  await expect(panel.getByRole('button', { name: 'Mark All Read' })).toHaveCount(0);
  expect(posted).toEqual(['{"all":true}']);
  await expect(bell.locator('.ux-bar-count')).toHaveCount(0);
});

test('CX-03 opening one notification keeps focus in the panel, so Escape still closes it and returns to the bell', async ({
  page,
}) => {
  const items = [inboxItem('1', 'REPLY_POSTED', 'New reply', null)];
  await page.route('**/api/customer-inbox', async (route) => {
    if (route.request().method() === 'POST') {
      items[0]!.readAt = '2026-11-05T09:00:00Z';
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
  const bell = header(page).getByRole('button', { name: 'Inbox', exact: true });
  await bell.click();
  const panel = page.locator('.ux-notice-panel');
  await panel.getByRole('button', { name: 'New reply' }).click();
  // The item moves from Updates to Earlier, which replaces its button; focus must stay inside the panel.
  await expect(panel.getByRole('group', { name: 'Earlier' })).toContainText('New reply');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.ux-notice-panel'))).toBe(
    true,
  );
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

test('the Meetings tab opens a real page: it says what it is for, has no Coming soon line, and never claims there are no requests when none were read', async ({
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
  // The requests list is read only where the workspaces and requests modules are on; where they are not, the page
  // says the list is not available and never claims there are no requests.
  await expect(page.locator('main')).not.toContainText('You have no requests yet');
  await expect(page.locator('main')).toContainText('Your requests list is not available here yet');
  // The placeholder is gone for good: no line, no tag, no Coming soon words in the page.
  // (Other menu entries that are still Coming soon keep their tag, in the menus and not in the page.)
  await expect(page.locator('main .ux-soon-line')).toHaveCount(0);
  await expect(page.locator('main .ux-soon-tag')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Coming soon');
  await expect(page.locator('main')).not.toContainText('One list of all your meetings');
  await expect(page.locator('main')).toContainText(
    'This page lists every meeting and visit the Corridra team has set up for your requests.',
  );
  // Nothing was read here, so there are no meeting groups, no empty message and no count of meetings.
  await expect(page.locator('main')).not.toContainText(
    'No meetings or visits are ready to show yet',
  );
  await expect(page.locator('main h2')).toHaveCount(0);
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
