import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInOwner, qaSeed } from '../fixtures';
import type { Page } from '@playwright/test';
import { operatorSlugs } from '../../../../apps/web/lib/operator-urls';

// Wave 6 (docs/revamp/specs/wave6-quality.md), track S4: Q-01 keyboard, Q-02 reflow, Q-03 contrast and
// semantics, Q-05 states and Q-06 busy actions on the team workspace and the owner page. One owner
// sign-in for the whole file (the shared sign-in rate limit): the widths are switched inside the
// tests, so it runs once, at 1280. The contributor board is covered in tests/operator/
// real-network-work.spec.ts, which already holds an invited contributor.
test.describe.configure({ mode: 'serial' });
const once = (name: string) => name === 'w1280';
test.beforeEach(({}, info) => {
  test.skip(!once(info.project.name), 'Runs once, at 1280; it switches widths itself.');
});

let page: Page;
let tenant = '';
test.beforeAll(async ({ browser }, info) => {
  if (!once(info.project.name)) return;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3300' });
  page = await context.newPage();
  await signInOwner(page);
  tenant = qaSeed().tenantId;
});
test.afterAll(async () => {
  await page?.context().close();
});

const sections = Object.entries(operatorSlugs).map(([id, slug]) => ({ id, slug }));
const addresses = [
  { name: 'today', path: () => `/operator?workspace=${tenant}` },
  ...sections.map((s) => ({ name: s.slug, path: () => `/operator/${s.slug}?workspace=${tenant}` })),
  { name: 'owner', path: () => `/operator/owner?workspace=${tenant}` },
];
async function open(path: string) {
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test('Q-03 axe is clean at 390 and 1440 on Today, every section and the owner page', async () => {
  test.setTimeout(600000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const address of addresses) {
      await open(address.path());
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect
        .soft(
          result.violations.map((v) => `${v.id}: ${v.nodes.length}`),
          `${address.name} at ${width}`,
        )
        .toEqual([]);
    }
  }
});

test('Q-02 no sideways scroll at 320 and at 640 (1280 at 200 percent zoom)', async () => {
  test.setTimeout(600000);
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 800 });
    for (const address of addresses) {
      await open(address.path());
      const overflow = await page.evaluate(() => {
        const wide = document.documentElement.scrollWidth - innerWidth;
        const clipped = [
          ...document.querySelectorAll<HTMLElement>('a, button, input, select, textarea'),
        ]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) =>
            (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
          );
        return { wide, clipped };
      });
      expect
        .soft(overflow.wide, `${address.name} at ${width}: sideways scroll`)
        .toBeLessThanOrEqual(1);
      expect
        .soft(overflow.clipped, `${address.name} at ${width}: controls beyond the edge`)
        .toEqual([]);
    }
  }
});

test('Q-01 Tab reaches every control with a visible focus ring, never traps, and a view change lands on its section', async () => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const address of addresses.filter((a) =>
    ['today', 'missions', 'audit', 'owner'].includes(a.name),
  )) {
    await open(address.path());
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    let previous = '';
    for (let step = 0; step < 150; step++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { key: 'BODY', ring: true };
        const style = getComputedStyle(el);
        const ring =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none';
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30);
        return { key: `${el.tagName}:${el.id}:${label}`, ring };
      });
      if (info.key === 'BODY') break;
      expect.soft(info.ring, `${address.name}: no visible focus on ${info.key}`).toBe(true);
      expect.soft(info.key, `${address.name}: focus trapped on ${info.key}`).not.toBe(previous);
      previous = info.key;
      seen.push(info.key);
    }
    expect.soft(seen.length, `${address.name}: Tab found no controls`).toBeGreaterThan(3);
  }
  // A view change inside the workspace (a # link) moves focus to the section that opened.
  await open(`/operator?workspace=${tenant}`);
  await page.evaluate(() => {
    window.location.hash = 'workspace-missions';
  });
  await expect(page.locator('#workspace-missions')).toBeVisible();
  const landed = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { id: el?.id ?? '', inside: !!el?.closest('#workspace-missions') };
  });
  expect.soft(landed.inside, `focus after the view change: ${JSON.stringify(landed)}`).toBe(true);
});
