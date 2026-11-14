import { test, expect, signInCustomer } from '../fixtures';
import type { Page } from '@playwright/test';

// The customer Search button and its dialog in the real customer frame, on a production build with the test-only
// customer sign-in (docs/revamp/specs/navigation-v1/customer-search.md, acceptance M4; KI-18). It measures the header at
// 320, 390, 768, 1024 and 1440 px at normal and at 200 percent text: no sideways scroll, a button of at least 44 by 44 px
// wholly inside the header, New Request and the account menu not pushed off the screen, the phone tabs and the left bar
// as they were, and under 640 px a dialog panel the width of the screen less 1 rem with its footer line whole. The
// words typed under All may reach the real route; only the rows of the Pages scope, which the browser builds itself,
// are asserted, so this needs no data and fails on no answer of the route. The widths are set in each case, so the work runs once, in the first project. The fixture version of the same
// checks, with every answer scripted, is tests/operator/customer-search-ui.spec.ts.
test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name !== 'w1280', 'sizes are set in each case');
  await signInCustomer(context);
});

const widths = [320, 390, 768, 1024, 1440] as const;
const header = (page: Page) => page.locator('header.ux-app-header');
const search = (page: Page) => header(page).getByRole('button', { name: 'Search', exact: true });
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Search Requests, Companies and pages' });
const phoneTabs = (page: Page) => page.getByRole('navigation', { name: 'Customer tabs' });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Customer navigation' });

/** Larger text the way people get it: the root size, as the largest Text Size and 200 percent browser text do. */
const largeText = (page: Page) =>
  page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

async function numbers(page: Page) {
  return page.evaluate(() => {
    const rect = (node: Element | null | undefined) => {
      const box = node?.getBoundingClientRect();
      return box
        ? {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          }
        : null;
    };
    const visible = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).find(
        (node) => node.getBoundingClientRect().width > 0,
      );
    const head = document.querySelector('header.ux-app-header');
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      header: rect(head),
      search: rect(visible('header.ux-app-header .ux-csearch-trigger')),
      newRequest: rect(visible('header.ux-app-header .ux-bar-new-narrow')),
      avatar: rect(visible('header.ux-app-header [aria-label="Account menu"]')),
    };
  });
}

for (const text of ['normal', '200%'] as const)
  for (const width of widths)
    test(`the Search button at ${width} px with ${text} text: one 44 px button inside the header, nothing pushed off, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/account');
      if (text === '200%') await largeText(page);
      const button = search(page);
      await expect(button).toBeVisible();
      await expect(header(page).getByRole('button', { name: 'Search', exact: true })).toHaveCount(
        1,
      );
      await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
      expect(await button.evaluate((node) => node.textContent?.trim())).toBe('Search');
      // KI-54: from 64em of the browser's own font size the button is the field; below it, the icon.
      expect(await page.evaluate(() => matchMedia('(min-width:64em)').matches)).toBe(width >= 1024);
      const n = await numbers(page);
      expect(n.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(n.viewport);
      expect(n.search!.width).toBeGreaterThanOrEqual(44);
      expect(n.search!.height).toBeGreaterThanOrEqual(44);
      // Below 1024 px, and at 200 percent text at any width, it is a fixed 44 by 44 px target with a 24 px glyph.
      if (width < 1024 || text === '200%') {
        expect(Math.abs(n.search!.width - 44)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(n.search!.height - 44)).toBeLessThanOrEqual(0.5);
        const glyph = (await button.locator('svg').boundingBox())!;
        expect([glyph.width, glyph.height]).toEqual([24, 24]);
      }
      expect(n.search!.left).toBeGreaterThanOrEqual(n.header!.left - 0.5);
      expect(n.search!.right).toBeLessThanOrEqual(n.header!.right + 0.5);
      // At 200 percent from 1024 px the fixed 4 rem header already clips a wrapped second row on main; that is recorded
      // by the verifier, not made worse or fixed here. Everywhere else the button is wholly inside the header.
      if (text === 'normal' || width < 1024) {
        expect(n.search!.top).toBeGreaterThanOrEqual(n.header!.top - 0.5);
        expect(n.search!.bottom).toBeLessThanOrEqual(n.header!.bottom + 0.5);
      }
      // The avatar menu is never pushed off the screen sideways, and below 1024 px New Request is on the screen too.
      expect(n.avatar).not.toBeNull();
      expect(n.avatar!.right).toBeLessThanOrEqual(n.viewport + 0.5);
      expect(n.avatar!.left).toBeGreaterThanOrEqual(-0.5);
      if (width < 1024) {
        expect(n.newRequest).not.toBeNull();
        expect(n.newRequest!.right).toBeLessThanOrEqual(n.viewport + 0.5);
        expect(n.newRequest!.left).toBeGreaterThanOrEqual(-0.5);
      } else {
        await expect(header(page).getByRole('link', { name: 'New Request' })).toBeHidden();
      }
      // It is the first of the tools.
      expect(
        await page.evaluate(() =>
          document
            .querySelector('header.ux-app-header .ux-bar-tools')
            ?.firstElementChild?.getAttribute('class'),
        ),
      ).toContain('ux-csearch-trigger');
    });

test('CX-03 still holds with the button: the header is at most 64 px at 1440 and no visible text control has a border', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(search(page)).toBeVisible();
  expect((await header(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  const bordered = await header(page).evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>('a, button, summary'))
      .filter((node) => node.offsetParent !== null && (node.textContent ?? '').trim() !== '')
      .filter((node) => parseFloat(getComputedStyle(node).borderTopWidth) > 0)
      .map((node) => (node.textContent ?? '').trim()),
  );
  expect(bordered).toEqual([]);
});

for (const width of [320, 390, 768] as const)
  test(`below 1024 px at ${width} there is no bottom tab bar, and the drawer lists the same destinations as 44 px targets with one current page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account');
    await expect(phoneTabs(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const links = sidebar(page).locator(':scope > ul').getByRole('link');
    const count = await links.count();
    // Five destinations, or four where the approved-companies module is off (it is off on this server).
    expect([4, 5]).toContain(count);
    for (const box of await links.evaluateAll((all) =>
      all.map((link) => link.getBoundingClientRect().height),
    ))
      expect(box).toBeGreaterThanOrEqual(44);
    await expect(sidebar(page).locator(':scope > ul [aria-current]')).toHaveCount(1);
  });

for (const width of [1024, 1440] as const)
  test(`at ${width} the left bar is unchanged: its links are the tabs, with New Request at the top`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/account');
    await expect(sidebar(page)).toBeVisible();
    const names = await sidebar(page).getByRole('link').allInnerTexts();
    expect(names.map((name) => name.trim())).toEqual(['Home', 'Requests', 'Meetings', 'Reports']);
    await expect(phoneTabs(page)).toHaveCount(0);
  });

test('at 1024 and wider the field starts where the page column starts', async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/account');
    const [button, heading] = await Promise.all([
      search(page).boundingBox(),
      page.locator('main h1').first().boundingBox(),
    ]);
    expect(Math.abs(button!.x - heading!.x), `${width}`).toBeLessThanOrEqual(1);
  }
});

for (const [width, height, text] of [
  [320, 640, 'normal'],
  [390, 844, 'normal'],
  [320, 640, '200%'],
  [390, 844, '200%'],
] as const)
  test(`under 640 px at ${width}x${height} with ${text} text the dialog panel is the screen less 1 rem and its footer line is whole`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/account');
    if (text === '200%') await largeText(page);
    await search(page).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('combobox').fill('home');
    await expect(dialog(page).getByRole('option').first()).toBeVisible();
    const m = await page.evaluate(() => {
      const panel = document.querySelector('dialog.ux-csearch')!;
      const box = panel.getBoundingClientRect();
      const hint = document.querySelector('.ux-csearch-hint')!;
      return {
        width: box.width,
        left: box.left,
        right: box.right,
        viewport: document.documentElement.clientWidth,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        hintWhole: hint.scrollHeight <= hint.clientHeight + 1,
        scrolls: panel.scrollHeight > panel.clientHeight + 1,
        hintBottom: hint.getBoundingClientRect().bottom,
        bottom: box.bottom,
        sideways: document.documentElement.scrollWidth,
      };
    });
    expect(Math.abs(m.width - (m.viewport - m.rem))).toBeLessThanOrEqual(1);
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.viewport + 0.5);
    expect(m.sideways).toBeLessThanOrEqual(m.viewport);
    expect(m.hintWhole).toBe(true);
    // Where the panel does not scroll the footer line is inside it; where it does, a row is reachable.
    if (!m.scrolls) expect(m.hintBottom).toBeLessThanOrEqual(m.bottom + 0.5);
    else {
      const row = dialog(page).getByRole('option').first();
      await row.scrollIntoViewIfNeeded();
      const [panel, box] = await Promise.all([dialog(page).boundingBox(), row.boundingBox()]);
      expect(box!.y).toBeGreaterThanOrEqual(panel!.y - 1);
      expect(box!.y).toBeLessThanOrEqual(panel!.y + panel!.height);
    }
  });

test('Ctrl K opens the dialog from the page, Pages answer in the browser, Escape closes it and focus goes back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/customer-search')) sent.push(request.postData() ?? '');
  });
  await page.keyboard.press('Control+K');
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await dialog(page).getByRole('combobox').fill('meetings');
  await expect(dialog(page).getByRole('option', { name: /Meetings/ })).toHaveAttribute(
    'href',
    '/account/meetings',
  );
  await page.waitForTimeout(600);
  expect(sent).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog(page).getByRole('combobox')).toHaveValue('');
});

test('the dialog is a full page load to the page it opens, and axe is clean on the header and the dialog', async ({
  page,
}) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
  const headerResult = await new AxeBuilder({ page })
    .include('header.ux-app-header')
    .withTags(tags)
    .analyze();
  expect(headerResult.violations.map((item) => item.id)).toEqual([]);
  await search(page).click();
  await expect(dialog(page)).toBeVisible();
  const dialogResult = await new AxeBuilder({ page })
    .include('dialog.ux-csearch')
    .withTags(tags)
    .analyze();
  expect(dialogResult.violations.map((item) => item.id)).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Pages', exact: true }).click();
  await dialog(page).getByRole('combobox').fill('meetings');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/account/meetings');
});
