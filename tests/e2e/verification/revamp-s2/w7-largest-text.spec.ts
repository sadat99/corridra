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

// W6-A: the Inbox and Help icons used to have no size of their own: they were what was left of the 44 px button
// box, which is 12 px or less once the text is large. They are 1.75 rem now, so they follow the text size, and the
// buttons keep at least 44 by 44 px. Measured at Normal, at Largest, and at Largest with the browser text at 200
// percent (a root size of 40 px, injected as a style, which is not the browser's own setting).
test('the Inbox and Help icons follow the text size and the buttons keep 44 px targets', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await signInCustomer(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const header = page.locator('header.ux-app-header');
  const buttons = {
    Inbox: header.getByRole('button', { name: 'Inbox', exact: true }),
    Help: header.getByRole('button', { name: 'Help and accessibility', exact: true }),
  };
  const measure = async (name: keyof typeof buttons) => {
    const button = buttons[name];
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const icon = (await button.locator('.corridra-icon').first().boundingBox())!;
    const root = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    return {
      root,
      icon: icon.width,
      iconHeight: icon.height,
      width: box.width,
      height: box.height,
    };
  };
  const seen: Record<string, number[]> = { Inbox: [], Help: [] };
  const cases = [
    { name: 'Normal', root: 16, style: '' },
    { name: 'Largest', root: 20, style: '' },
    {
      name: 'Largest with 200% browser text',
      root: 40,
      style: 'html { font-size: 250% !important; }',
    },
  ] as const;
  for (const step of cases) {
    await setStep(page, step.name === 'Normal' ? 'normal' : 'largest');
    if (step.style) await page.addStyleTag({ content: step.style });
    for (const name of ['Inbox', 'Help'] as const) {
      const m = await measure(name);
      const label = `${name} at ${step.name}`;
      expect(m.root, `${label}: root size`).toBe(step.root);
      // 1.75 rem: 28, 35 and 70 px. Never the 12 px it was.
      expect(m.icon, `${label}: icon width`).toBeCloseTo(1.75 * step.root, 0);
      expect(m.iconHeight, `${label}: icon height`).toBeCloseTo(1.75 * step.root, 0);
      expect(m.icon, `${label}: icon is not 12 px`).not.toBe(12);
      expect(m.width, `${label}: target width`).toBeGreaterThanOrEqual(44);
      expect(m.height, `${label}: target height`).toBeGreaterThanOrEqual(44);
      seen[name].push(m.icon);
    }
  }
  // Each icon grows with the text: larger at Largest than at Normal, larger again at 200 percent.
  for (const name of ['Inbox', 'Help'] as const) {
    expect(seen[name][1], `${name}: Largest is larger than Normal`).toBeGreaterThan(seen[name][0]);
    expect(seen[name][2], `${name}: 200% is larger than Largest`).toBeGreaterThan(seen[name][1]);
  }
  // Back to Normal: the size returns with it.
  await setStep(page, 'normal');
  for (const name of ['Inbox', 'Help'] as const)
    expect((await measure(name)).icon, `${name} after returning to Normal`).toBeCloseTo(28, 0);
});

// W6-A: the Language card is folded into the "Make it easier to read" card, so the Me page is one card shorter. No
// control is lost (language shows only when more than one language is offered, as the chip always did), the page
// stays inside the layout budget at 390 by 844 (target 1.5 screens, hard limit 2.0), and the heading, the three
// Text Size radios and the two switches are in the one card.
test('the Me page holds language, reading and the switches in one card and stays within the page budget', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const seed = await signInOwner(page, '/operator');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/contributor/me?workspace=${seed.tenantId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Me.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Make it easier to read', level: 2 }),
  });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('radio')).toHaveCount(3);
  await expect(card.getByRole('switch')).toHaveCount(2);
  await expect(card.getByRole('switch', { name: 'Stronger Colours', exact: true })).toBeVisible();
  await expect(card.getByRole('switch', { name: 'Less Movement', exact: true })).toBeVisible();
  // The Language card is gone as its own card. Its chip, when offered, is in this one and names itself.
  await expect(page.getByRole('heading', { name: 'Language', exact: true })).toHaveCount(0);
  const chip = page.locator('.lang-switcher');
  if (await chip.count()) await expect(card.locator('.lang-switcher')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Your private link', level: 2 })).toBeVisible();
  const screens = (await page.evaluate(() => document.documentElement.scrollHeight)) / 844;
  info.annotations.push({ type: 'me-page-screens', description: `${screens.toFixed(2)} screens` });
  expect(screens, 'Me at 390 by 844, hard limit').toBeLessThanOrEqual(2);
});
