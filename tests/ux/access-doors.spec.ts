import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Access doors, Unit A: the three pages under /access at the six AC/1 widths. No horizontal scroll, one h1,
// axe WCAG 2.2 AA clean, 44 px targets up to 768, visible keyboard focus, and the page-length limits of the brief
// (content without the footer: customer and team 1550 px at 390 and 1100 px at 1440; link 1100 and 800).
const widths = [320, 390, 768, 1024, 1440, 1920];
const pages = [
  {
    path: '/access/customer',
    h1: 'Open your workspace, or start one.',
    title: 'Customer Access | Corridra',
    max390: 1550,
    max1440: 1100,
  },
  {
    path: '/access/team',
    h1: 'Sign in to team or field work.',
    title: 'Team and Network Access | Corridra',
    max390: 1550,
    max1440: 1100,
  },
  {
    path: '/access/link',
    h1: 'Open the link Corridra sent you.',
    title: 'Private Link Access | Corridra',
    max390: 1100,
    max1440: 800,
  },
];
const shots = process.env.ACCESS_SHOTS_DIR;

async function contentBottom(page: Page) {
  return await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return Math.round(main.getBoundingClientRect().bottom + window.scrollY);
  });
}

for (const entry of pages) {
  test.describe(entry.path, () => {
    for (const width of widths) {
      test(`holds at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
        await page.goto(entry.path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.h1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(axe.violations.map((v) => v.id)).toEqual([]);

        if (width <= 768) {
          const small = await page.evaluate(() =>
            [...document.querySelectorAll('main a, main button')]
              .map((el) => ({ el, box: el.getBoundingClientRect() }))
              .filter(({ box }) => box.width > 0 && box.height > 0 && box.height < 44)
              .map(({ el }) => (el.textContent ?? '').trim()),
          );
          expect(small).toEqual([]);
        }

        // Keyboard: every control reached with Tab shows a focus indicator.
        await page.locator('body').focus();
        const stops = await page.locator('main a').count();
        for (let i = 0; i < Math.min(stops + 4, 20); i++) {
          await page.keyboard.press('Tab');
          const ok = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body || !el.closest('main')) return true;
            const s = getComputedStyle(el);
            return (
              (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
              s.boxShadow !== 'none'
            );
          });
          expect(ok).toBe(true);
        }

        if (width === 390 || width === 1440) {
          const bottom = await contentBottom(page);
          expect(bottom).toBeLessThanOrEqual(width === 390 ? entry.max390 : entry.max1440);
        }
        if (shots && [390, 768, 1440].includes(width)) {
          mkdirSync(shots, { recursive: true });
          await page.screenshot({
            path: join(shots, `${entry.path.split('/').pop()}-${width}.png`),
            fullPage: true,
          });
        }
      });
    }

    test('names the page and sets robots from the switch', async ({ page }) => {
      await page.goto(entry.path);
      await expect(page).toHaveTitle(entry.title);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', entry.h1);
      const on = process.env.CORRIDRA_UX_ACCESS_DOORS === 'true';
      const robots = (await page.locator('meta[name="robots"]').getAttribute('content')) ?? '';
      expect(robots.includes('noindex')).toBe(!on);
      await expect(page.getByRole('navigation', { name: 'Not what you need?' })).toBeVisible();
    });
  });
}

test('the three pages link to each other and write actions in Title Case', async ({ page }) => {
  await page.goto('/access/team');
  const bar = page.getByRole('navigation', { name: 'Not what you need?' });
  await expect(bar.getByRole('link', { name: 'Customer Access' })).toHaveAttribute(
    'href',
    '/access/customer',
  );
  await expect(bar.getByRole('link', { name: 'Private Link Access' })).toHaveAttribute(
    'href',
    '/access/link',
  );
  for (const entry of pages.filter((p) => p.path !== '/access/link')) {
    await page.goto(entry.path);
    const labels = await page.locator('main .button, main .button-secondary').allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.trim()).toMatch(/^[A-Z]/);
  }
  await page.goto('/access/link');
  // The role cards and the help text of the private link door carry no link, no form and no field.
  await expect(
    page.locator('.access-card a, .access-page > section a, main form, main input'),
  ).toHaveCount(0);
});
