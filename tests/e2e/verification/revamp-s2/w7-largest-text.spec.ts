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

/**
 * A wider face than the product fonts, forced on every box. Runners have different fonts installed, and long
 * unbreakable text (an email address, a code) measures wider with some of them, so the pages are also measured with
 * this one to prove the layout does not depend on the runner's font.
 */
const wideFont = '* { font-family: "DejaVu Sans", Verdana, sans-serif !important; }';
const fonts = [
  { name: 'the product fonts', style: '' },
  { name: 'a wider fallback font', style: wideFont },
] as const;

/** Every box that reaches past the right edge of the window, for a message that names the offender. */
const pastTheEdge = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > innerWidth && getComputedStyle(el).position !== 'fixed';
      })
      .slice(0, 4)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent ?? '').trim().slice(0, 40)}" right=${Math.round(el.getBoundingClientRect().right * 10) / 10}`,
      ),
  );

/** No sideways scroll at all: not one pixel, so a one pixel overshoot on a runner with other fonts cannot slip by. */
async function expectFits(page: Page, path: string, width: number, style: string) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path);
  if (style) await page.addStyleTag({ content: style });
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    `${path} at ${width}: text is at the largest step`,
  ).toBe('20px');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(
    over,
    `${path} at ${width} scrolls sideways by ${over}px: ${(await pastTheEdge(page)).join(' | ')}`,
  ).toBeLessThanOrEqual(0);
}

for (const font of fonts) {
  test(`at the largest text no customer page scrolls sideways at 320, 390, 768 and 1440, with ${font.name}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await signInCustomer(context);
    await chooseLargest(page);
    for (const path of customerPages)
      for (const width of widths) await expectFits(page, path, width, font.style);
  });

  test(`at the largest text Team Today and the helper pages do not scroll sideways at 320, 390, 768 and 1440, with ${font.name}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const seed = await signInOwner(page, '/operator');
    await chooseLargest(page);
    for (const path of [
      '/operator',
      `/contributor?workspace=${seed.tenantId}`,
      `/contributor/me?workspace=${seed.tenantId}`,
    ])
      for (const width of widths) await expectFits(page, path, width, font.style);
  });
}

/** Sets the saved text size for this browser and loads the page again, as a person who chose it would have. */
async function setStep(page: Page, step: 'normal' | 'largest') {
  await page.evaluate((value) => {
    if (value === 'normal') localStorage.removeItem('corridra.text-size');
    else localStorage.setItem('corridra.text-size', value);
  }, step);
  await page.reload();
}

/** The open menu panel stays whole inside the window on every side: 8 px from the left and right edges on a phone. */
async function expectPanelInside(
  page: Page,
  name: string,
  size: { width: number; height: number },
  where: string,
) {
  const menu = page.getByRole('menu', { name });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const margin = size.width < 640 ? 8 : 0;
  const at = `${where}: ${name} at ${size.width}x${size.height}`;
  expect(box.x, `${at}, left edge`).toBeGreaterThanOrEqual(margin - 0.5);
  expect(box.x + box.width, `${at}, right edge`).toBeLessThanOrEqual(size.width - margin + 0.5);
  expect(box.y, `${at}, top edge`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${at}, bottom edge`).toBeLessThanOrEqual(size.height + 0.5);
}

// Phone sizes with a short and a tall window, and 768 where the Help menu is in the header row.
const menuSizes = [
  { width: 320, height: 568 },
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 844 },
] as const;
const steps = ['normal', 'largest'] as const;

test('the customer menus stay inside the screen on every side at normal and the largest text', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await signInCustomer(context);
  await page.goto('/account');
  for (const step of steps) {
    await setStep(page, step);
    for (const size of menuSizes) {
      await page.setViewportSize(size);
      const name = size.width < 640 ? 'Account menu' : 'Help and accessibility';
      await page.locator('header.ux-app-header').getByRole('button', { name }).click();
      await expectPanelInside(page, name, size, `customer, ${step}`);
      await page.keyboard.press('Escape');
    }
  }
});

test('the team menus stay inside the screen on every side at normal and the largest text', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInOwner(page, '/operator');
  await page.goto('/operator');
  for (const step of steps) {
    await setStep(page, step);
    for (const size of menuSizes) {
      await page.setViewportSize(size);
      const header = page.locator('header.ux-app-header');
      for (const name of size.width < 640
        ? (['Account menu'] as const)
        : (['Help and accessibility', 'Account menu'] as const)) {
        await header.getByRole('button', { name }).click();
        await expectPanelInside(page, name, size, `team, ${step}`);
        await page.keyboard.press('Escape');
      }
    }
  }
});
