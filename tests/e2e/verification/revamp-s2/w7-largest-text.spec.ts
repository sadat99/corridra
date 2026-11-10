import { test, expect, qaSeed, signInCustomer, signInOwner } from '../fixtures';
import type { Page } from '@playwright/test';

// W7: at the largest Text Size (125 percent) every signed-in page a person reaches still fits the screen at the four
// widths people use, and the Help and account menus stay inside the screen. The widths are set in each case, so the
// work runs once, in the first project.
const widths = [320, 390, 768, 1440] as const;
const customerPages = [
  '/account',
  '/account?view=work',
  '/account?view=results',
  '/account?view=more',
  '/account/meetings',
] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'sizes are set in each case');
});

/** Saves the largest step before any page script runs, as a person who chose it would have. */
const chooseLargest = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('corridra.text-size', 'largest'));

/** Every box that reaches past the right edge of the window, for a message that names the offender. */
const pastTheEdge = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 && box.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed'
        );
      })
      .slice(0, 4)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
      ),
  );

async function expectFits(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    `${path} at ${width}: text is at the largest step`,
  ).toBe('20px');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(
    wide,
    `${path} at ${width} scrolls sideways: ${(await pastTheEdge(page)).join(' | ')}`,
  ).toBe(false);
}

test('at the largest text no customer page scrolls sideways at 320, 390, 768 and 1440', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await signInCustomer(context);
  await chooseLargest(page);
  for (const path of customerPages) for (const width of widths) await expectFits(page, path, width);
});

test('at the largest text Team Today and the helper pages do not scroll sideways at 320, 390, 768 and 1440', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const seed = await signInOwner(page, '/operator');
  await chooseLargest(page);
  for (const path of [
    '/operator',
    `/contributor?workspace=${seed.tenantId}`,
    `/contributor/me?workspace=${seed.tenantId}`,
  ])
    for (const width of widths) await expectFits(page, path, width);
});

/** The open menu panel stays whole inside the window: at least 8 px from the left and right edges on a phone. */
async function expectPanelInside(page: Page, name: string, width: number, where: string) {
  const menu = page.getByRole('menu', { name });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const margin = width < 640 ? 8 : 0;
  expect(box.x, `${where}: ${name} left edge at ${width}`).toBeGreaterThanOrEqual(margin - 0.5);
  expect(box.x + box.width, `${where}: ${name} right edge at ${width}`).toBeLessThanOrEqual(
    width - margin + 0.5,
  );
}

test('at the largest text the customer menus stay inside the screen at 320, 390 and 768', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signInCustomer(context);
  await chooseLargest(page);
  for (const width of [320, 390, 768] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account');
    const name = width < 640 ? 'Account menu' : 'Help and accessibility';
    await page.locator('header.ux-app-header').getByRole('button', { name }).click();
    await expectPanelInside(page, name, width, 'customer');
    await page.keyboard.press('Escape');
  }
});

test('at the largest text the team menus stay inside the screen at 320, 390 and 768', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page, '/operator');
  await chooseLargest(page);
  for (const width of [320, 390, 768] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/operator');
    const header = page.locator('header.ux-app-header');
    for (const name of width < 640
      ? (['Account menu'] as const)
      : (['Help and accessibility', 'Account menu'] as const)) {
      await header.getByRole('button', { name }).click();
      await expectPanelInside(page, name, width, 'team');
      await page.keyboard.press('Escape');
    }
  }
});
