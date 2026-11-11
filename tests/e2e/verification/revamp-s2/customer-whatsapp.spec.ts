import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInCustomer, signInOwner } from '../fixtures';
import type { BrowserContext, Locator, Page } from '@playwright/test';

// Chat on WhatsApp in the signed-in customer menus and rail (docs/revamp/specs/workflow-intelligence.md, W9).
// Port 3302 is the same app with a made-up support number (scripts/qa/verification-server.ts); port 3300 has none.
// The wa.me address is never contacted: every request to it is aborted. At 640 px and wider the link is in the
// Help and accessibility menu; below, it is in the Get Help group of the Account menu. At 1024 px and wider the
// rail foot has Help on WhatsApp too.
const href = 'https://wa.me/6500000000';
const header = (page: Page) => page.locator('header.ux-app-header');
const width = (page: Page) => page.viewportSize()!.width;

async function blockWhatsapp(context: BrowserContext) {
  const requested: string[] = [];
  await context.route('https://wa.me/**', (route) => {
    requested.push(route.request().url());
    return route.abort();
  });
  return requested;
}

/** The trigger and the menu that hold the Get Help group at this width. */
function helpMenu(page: Page) {
  const wide = width(page) >= 640;
  const name = wide ? 'Help and accessibility' : 'Account menu';
  const trigger = header(page).getByRole('button', { name });
  const menu = page.getByRole('menu', { name });
  const row = menu.getByRole('group', { name: 'Get Help' }).getByRole('menuitem', {
    name: /^Chat on WhatsApp/,
  });
  return { trigger, menu, row };
}

/** The words of a foot row in the collapsed rail, and whether they are shown beside the icon (W6-A). */
async function collapseRail(page: Page) {
  await page.locator('.ux-leftnav-collapse').click();
  await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
}
const railLabel = (row: Locator) => row.locator(':scope > .ux-rail-label');
async function expectNameShown(row: Locator, words: string[]) {
  const label = railLabel(row);
  await expect(label).toBeInViewport({ ratio: 1 });
  for (const word of words) await expect(label).toContainText(word);
  const rail = (await row.page().locator('.ux-leftnav-rail').boundingBox())!;
  const box = (await label.boundingBox())!;
  expect(box.x, 'the name sits beside the rail, not inside it').toBeGreaterThanOrEqual(
    rail.x + rail.width - 1,
  );
  expect(box.x + box.width, 'and inside the window').toBeLessThanOrEqual(
    row.page().viewportSize()!.width,
  );
  const colours = await label.evaluate((el) => {
    const style = getComputedStyle(el);
    return { text: style.color, back: style.backgroundColor };
  });
  expect(colours.text, 'the words have a fill of their own to read against').not.toBe(colours.back);
}
const expectNameHidden = (row: Locator) =>
  expect(railLabel(row)).not.toBeInViewport({ ratio: 0.01 });

test.describe('with a support number set (port 3302)', () => {
  test.use({ baseURL: 'http://127.0.0.1:3302' });
  let requested: string[] = [];

  test.beforeEach(async ({ context, page }) => {
    await signInCustomer(context);
    requested = await blockWhatsapp(context);
    await page.goto('/account');
    await expect(page.locator('main h1').first()).toBeVisible();
  });

  test('Chat on WhatsApp is a safe external link in the menu, and the other Coming soon rows stay', async ({
    page,
  }) => {
    const { trigger, menu, row } = helpMenu(page);
    await trigger.click();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Chat on WhatsApp');
    await expect(row).toHaveAccessibleName(/^Chat on WhatsApp.*opens WhatsApp outside Corridra/);
    await expect(row).toHaveAttribute('href', href);
    await expect(row).toHaveAttribute('target', '_blank');
    await expect(row).toHaveAttribute('rel', /noopener/);
    await expect(row).toHaveAttribute('rel', /noreferrer/);
    await expect(row).not.toContainText('Coming soon');
    await expect(row).not.toHaveAttribute('aria-disabled', 'true');
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    // The row replaced the placeholder in place: the group is still four rows, and nothing else changed.
    await expect(menu.getByRole('group', { name: 'Get Help' }).getByRole('menuitem')).toHaveCount(
      4,
    );
    // No problem report module in this database, so the probe is off and Report a Problem is exactly Coming soon.
    await expect(menu.locator('a[href*="problem-reports"]')).toHaveCount(0);
    const soon = menu.getByRole('menuitem', { name: /Report a Problem/ });
    await expect(soon).toHaveAttribute('aria-disabled', 'true');
    await expect(soon).toContainText('Coming soon');
    await expect(soon).not.toHaveAttribute('href', /.*/);
    // Text Size, Stronger Colours and Less Movement are real controls, not placeholders (W7, W10), and WhatsApp
    // did not change them.
    await expect(menu.getByRole('group', { name: 'Text Size' })).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox', { name: /Stronger Colours/ })).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox', { name: /Less Movement/ })).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: /Text Size|Stronger Colours|Less Movement/ }),
    ).toHaveCount(0);
    // Report a Problem is the one Coming soon row left in the Help groups (the phone Account menu also holds
    // account rows of its own, so the count is taken per group).
    await expect(
      menu.getByRole('group', { name: 'Get Help' }).getByText('Coming soon'),
    ).toHaveCount(1);
    await expect(
      menu.getByRole('group', { name: 'Make It Easier to Read' }).getByText('Coming soon'),
    ).toHaveCount(0);
  });

  test('the keyboard reaches the row, and Escape closes the menu and returns to the button', async ({
    page,
  }) => {
    const { trigger, menu, row } = helpMenu(page);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    for (
      let step = 0;
      step < 40 && !(await row.evaluate((el) => el === document.activeElement));
      step++
    )
      await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('choosing it opens WhatsApp in a new tab at exactly the address, and focus returns to the button', async ({
    page,
  }) => {
    const { trigger, menu, row } = helpMenu(page);
    await trigger.click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), row.click()]);
    // The new tab asks for exactly that address and nothing else (the request is aborted, so its own URL is an
    // error page).
    await expect.poll(() => requested).toContain(href);
    expect(requested.every((url) => url === href)).toBe(true);
    expect(popup).not.toBe(page);
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    // This page was left where it was.
    expect(new URL(page.url()).pathname).toBe('/account');
  });

  test('the open menu has no accessibility violations', async ({ page }) => {
    const { trigger, row } = helpMenu(page);
    await trigger.click();
    await expect(row).toBeVisible();
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(violations).toEqual([]);
  });

  test('from 1024 px the rail foot is a Help on WhatsApp link, and it survives the collapsed rail', async ({
    page,
  }) => {
    test.skip(width(page) < 1024, 'the rail is shown from 1024 px');
    const foot = page.locator('.ux-rail-foot');
    const link = foot.getByRole('link', { name: /^Help on WhatsApp/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(/opens WhatsApp outside Corridra/);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.locator('.ux-rail-soon')).toHaveCount(0);
    // It comes before the Collapse button in the page order, as it does on screen.
    expect(
      await page.evaluate(() => {
        const help = document.querySelector('.ux-rail-help')!;
        const collapse = document.querySelector('.ux-leftnav-collapse')!;
        return !!(help.compareDocumentPosition(collapse) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    await page.locator('.ux-leftnav-collapse').click();
    await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
    const collapsed = page
      .locator('.ux-rail-foot')
      .getByRole('link', { name: /^Help on WhatsApp/ });
    await expect(collapsed).toHaveAttribute('href', href);
    const box = (await collapsed.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    await expect(
      collapsed.locator('span', { hasText: 'Help on WhatsApp' }).first(),
    ).not.toBeInViewport({
      ratio: 0.01,
    });
  });

  test('in the collapsed rail the name shows on hover and on keyboard focus, stays while the pointer is on it, and Esc and leaving close it', async ({
    page,
  }) => {
    test.skip(width(page) < 1024, 'the rail is shown from 1024 px');
    const link = page.locator('.ux-rail-foot a.ux-rail-help');
    // Expanded: the words are in the row already and nothing floats.
    await link.hover();
    expect(await railLabel(link).evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
    await collapseRail(page);
    await page.mouse.move(5, 5);
    await expectNameHidden(link);
    // Hover shows it; the pointer can cross onto the words without them closing.
    await link.hover();
    await expectNameShown(link, ['Help on WhatsApp']);
    const words = (await railLabel(link).boundingBox())!;
    await page.mouse.move(words.x + words.width / 2, words.y + words.height / 2, { steps: 8 });
    await expectNameShown(link, ['Help on WhatsApp']);
    // Esc closes them without moving focus or the pointer, and they stay closed until the pointer comes back.
    await page.keyboard.press('Escape');
    await expectNameHidden(link);
    await page.mouse.move(5, 5);
    await link.hover();
    await expectNameShown(link, ['Help on WhatsApp']);
    await page.mouse.move(5, 5);
    await expectNameHidden(link);
    // Keyboard focus shows them too, and moving focus away closes them.
    await page.keyboard.press('Shift');
    await link.focus();
    await expect(link).toBeFocused();
    await expectNameShown(link, ['Help on WhatsApp']);
    await page.keyboard.press('Escape');
    await expectNameHidden(link);
    await expect(link).toBeFocused();
    await page.locator('.ux-leftnav-collapse').focus();
    await expectNameHidden(link);
    // The accessible name has the words once (the visible words and the new-tab note, nothing doubled).
    const name = await link.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(name.match(/Help on WhatsApp/g)).toHaveLength(1);
    await expect(link).toHaveAccessibleName(/^Help on WhatsApp \(opens WhatsApp outside Corridra/);
  });

  test('with the rail expanded the name shows no tip and takes no key: the first Escape closes an open menu', async ({
    page,
  }) => {
    test.skip(width(page) < 1024, 'the rail is shown from 1024 px');
    const link = page.locator('.ux-rail-foot a.ux-rail-help');
    const { trigger, menu } = helpMenu(page);
    await trigger.click();
    await expect(menu).toBeVisible();
    await link.hover();
    await expect(link).not.toHaveAttribute('data-tip', /.*/);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('the public header is unchanged: no WhatsApp text on a public page', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.locator('header').first()).not.toContainText(/whatsapp/i);
    await expect(page.locator('header a[href*="wa.me"]')).toHaveCount(0);
  });
});

test.describe('without a support number (port 3300)', () => {
  test.beforeEach(async ({ context, page }) => {
    await signInCustomer(context);
    await page.goto('/account');
    await expect(page.locator('main h1').first()).toBeVisible();
  });

  test('every surface says Coming soon and nothing links to WhatsApp', async ({ page }) => {
    await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
    const { trigger, menu } = helpMenu(page);
    await trigger.click();
    const row = menu.getByRole('menuitem', { name: /Chat on WhatsApp/ });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText('Coming soon');
    await expect(row).not.toHaveAttribute('href', /.*/);
    await page.keyboard.press('Escape');
    if (width(page) >= 1024) {
      const soon = page.locator('.ux-rail-soon');
      await expect(soon).toContainText('Help on WhatsApp');
      await expect(soon).toContainText('Coming soon');
      await expect(soon.getByRole('link')).toHaveCount(0);
      await expect(soon.getByRole('button')).toHaveCount(0);
    }
  });

  test('in the collapsed rail the Coming soon row shows its words on hover only, and it is not a keyboard stop', async ({
    page,
  }) => {
    test.skip(width(page) < 1024, 'the rail is shown from 1024 px');
    const soon = page.locator('.ux-rail-foot p.ux-rail-soon');
    await expect(soon).not.toHaveAttribute('tabindex', /.*/);
    await collapseRail(page);
    await page.mouse.move(5, 5);
    await expectNameHidden(soon);
    await soon.hover();
    await expectNameShown(soon, ['Help on WhatsApp', 'Coming soon']);
    await page.keyboard.press('Escape');
    await expectNameHidden(soon);
    await page.mouse.move(5, 5);
    await soon.hover();
    await expectNameShown(soon, ['Help on WhatsApp', 'Coming soon']);
    await page.mouse.move(5, 5);
    await expectNameHidden(soon);
    // The words are in the page for assistive technology all the while.
    await expect(soon).toContainText('Help on WhatsApp');
    await expect(soon.getByRole('link')).toHaveCount(0);
  });

  test('the page carries no trace of a WhatsApp address', async ({ page }) => {
    const html = await page.content();
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('whatsappHref');
    const source = await (await page.request.get('/account')).text();
    expect(source).not.toContain('wa.me');
    expect(source).not.toContain('whatsappHref');
  });
});

test.describe('the team Help menu with a support number set (port 3302)', () => {
  test.use({ baseURL: 'http://127.0.0.1:3302' });

  test('Chat on WhatsApp is the same safe external link for the signed-in team', async ({
    page,
  }) => {
    test.skip(width(page) < 640, 'the team Help menu is in the header from 640 px');
    await signInOwner(page);
    await expect(page.locator('header.ux-team-header')).toBeVisible();
    const trigger = page
      .locator('header.ux-team-header')
      .getByRole('button', { name: 'Help and accessibility' });
    await trigger.click();
    const row = page
      .getByRole('menu', { name: 'Help and accessibility' })
      .getByRole('menuitem', { name: /^Chat on WhatsApp/ });
    await expect(row).toHaveAttribute('href', href);
    await expect(row).toHaveAttribute('target', '_blank');
    await expect(row).toHaveAttribute('rel', /noopener/);
    await expect(row).toHaveAccessibleName(/opens WhatsApp outside Corridra/);
    await expect(row).not.toContainText('Coming soon');
  });
});
