import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Final walk m3 (25 Nov 2026): /client and /programme opened without a link moved focus to the "link ended" message on
// load, so the first Tab landed on "Try again" and skipped the skip link and the header. The message is still
// announced (it is in an alert), but focus stays where the browser put it: the first Tab reaches the skip link, and
// Tab then follows the reading order of the page.

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'the keyboard is checked once, at the desktop size');
});

/** The focusable elements Tab visits, in order, until it comes back round or `limit` is reached. */
async function tabOrder(page: Page, limit = 40) {
  const seen: { name: string; index: number }[] = [];
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    const now = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const all = [...document.querySelectorAll('*')];
      return {
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
        index: all.indexOf(el),
      };
    });
    if (!now) break;
    if (seen.length && now.index === seen[0]!.index) break;
    seen.push(now);
  }
  return seen;
}

for (const path of ['/client', '/programme'])
  test(`${path} without a link: the first Tab reaches the skip link and Tab follows reading order`, async ({
    page,
  }) => {
    await page.goto(path);
    const alert = page.locator('.ux-state [role="alert"]');
    await expect(alert).toContainText(/link/i);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // Nothing took focus on load.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    const order = await tabOrder(page);
    expect(order[0]?.name).toBe('Skip to content');
    // Each stop comes after the one before it in the page.
    for (let i = 1; i < order.length; i++)
      expect(order[i]!.index, `${order[i - 1]!.name} then ${order[i]!.name}`).toBeGreaterThan(
        order[i - 1]!.index,
      );
    const tryAgain = order.findIndex((stop) => stop.name === 'Try again');
    expect(tryAgain).toBeGreaterThan(1);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

test('/client: after Try again with no link the focus stays on the button and the message stays', async ({
  page,
}) => {
  await page.goto('/client');
  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.focus();
  await retry.press('Enter');
  await expect(page.locator('.ux-state [role="alert"]')).toContainText(/link/i);
  await expect(retry).toBeFocused();
});
