import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startTodayFixture } from './team-today-fixture';

// S67 palette layout follow-ups: a narrow window never gets a sideways scrollbar, a landscape phone keeps a usable
// list, and with a 32 px root font (the browser's own default font size, KI-54) no row or line is clipped.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const dialogName = 'Search missions, companies and actions';
const hits = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    id: `0b5a0001-0000-4000-8000-${String(n).padStart(12, '0')}`,
    label: `Madrid Textiles and Fashion Distribution Partners Limited ${n}`,
    detail: 'Finding companies in Spain with a long line of detail that must wrap or clip cleanly',
  }));

/** The same stubs as team-palette-v2.spec.ts: the workspace, who is signed in and the search answer. */
async function stub(page: Page, count: number) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/operator-auth/get-session', (route) =>
    route.fulfill({ json: { user: { id: 'u1' }, session: { id: 's' } } }),
  );
  await page.route('**/api/workspace/search?*', (route) =>
    route.fulfill({ json: { missions: hits(count), companies: [], denied: [], partial: [] } }),
  );
  await page.goto(`${fixture.origin}/operator?owner=on&urls=on&role=owner`);
  await expect(page.locator('header.ux-app-header')).toBeVisible();
}

async function setUp(page: Page, size: { width: number; height: number }, count = 12) {
  await page.setViewportSize(size);
  await stub(page, count);
  await page.keyboard.press('Control+k');
  const box = page.getByRole('dialog', { name: dialogName });
  await expect(box).toBeVisible();
  await box.getByRole('combobox').fill('mad');
  await expect(box.getByRole('option').first()).toBeVisible();
  return box;
}

/** What the palette measures: the panel inside the window, nothing wider than the panel, the list's own scroll. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('dialog.ux-palette[open]')!;
    const list = dialog.querySelector<HTMLElement>('.ux-palette-list')!;
    const panel = dialog.getBoundingClientRect();
    const wide = [...dialog.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.getBoundingClientRect().right > panel.right + 0.5,
    ).length;
    const clipped = [
      ...dialog.querySelectorAll<HTMLElement>('.ux-palette-label, .ux-palette-row'),
    ].filter(
      (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
    ).length;
    const rows = [...dialog.querySelectorAll<HTMLElement>('[role="option"]')];
    return {
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      left: panel.left,
      right: panel.right,
      top: panel.top,
      bottom: panel.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflowX: dialog.scrollWidth - dialog.clientWidth,
      listOverflowX: list.scrollWidth - list.clientWidth,
      listHeight: list.clientHeight,
      listScrolls: list.scrollHeight > list.clientHeight,
      wide,
      clipped,
      firstRowHeight: rows[0]?.getBoundingClientRect().height ?? 0,
      rowsTall: rows.filter((r) => r.scrollHeight > r.clientHeight + 1).length,
    };
  });

test.describe('S67 narrow windows', () => {
  for (const width of [280, 320, 360]) {
    test(`at ${width} px wide the panel fits and nothing scrolls sideways`, async ({ page }) => {
      await setUp(page, { width, height: 700 });
      const m = await measure(page);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right).toBeLessThanOrEqual(m.innerWidth);
      expect(m.dialogOverflowX).toBeLessThanOrEqual(0);
      expect(m.listOverflowX).toBeLessThanOrEqual(0);
      expect(m.docOverflow).toBeLessThanOrEqual(0);
      expect(m.wide).toBe(0);
      // The list scrolls up and down on its own; a row is never cut off sideways.
      expect(m.listScrolls).toBe(true);
    });
  }
});

test.describe('S67 a landscape phone', () => {
  for (const size of [
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 568, height: 320 },
  ]) {
    test(`at ${size.width} by ${size.height} the field stays in view and the list has room`, async ({
      page,
    }) => {
      const box = await setUp(page, size);
      const m = await measure(page);
      expect(m.top).toBeGreaterThanOrEqual(0);
      expect(m.bottom).toBeLessThanOrEqual(m.innerHeight);
      expect(m.docOverflow).toBeLessThanOrEqual(0);
      // The panel scrolls as one piece: the field stays in view while every row can be reached.
      await expect(box.getByRole('combobox')).toBeInViewport();
      const first = box.getByRole('option').first();
      await first.scrollIntoViewIfNeeded();
      await expect(first).toBeInViewport({ ratio: 0.5 });
      const last = box.getByRole('option').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport({ ratio: 0.5 });
      await expect(box.getByRole('combobox')).toBeInViewport();
      // The list is not squeezed to a sliver: it is as tall as its rows.
      const after = await measure(page);
      expect(after.listScrolls).toBe(false);
    });
  }
});

// The root font size is the browser's own default font size, so the `em` queries see it too (KI-54): a Chromium
// profile whose preferences set default_font_size 32, not a style rule in the page.
async function atRootFont32(width: number, height: number): Promise<BrowserContext> {
  const dir = mkdtempSync(join(tmpdir(), 'palette-font-'));
  mkdirSync(join(dir, 'Default'), { recursive: true });
  writeFileSync(
    join(dir, 'Default', 'Preferences'),
    JSON.stringify({
      webkit: { webprefs: { default_font_size: 32, default_fixed_font_size: 26 } },
    }),
  );
  return chromium.launchPersistentContext(dir, {
    viewport: { width, height },
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
}

test.describe('S67 a 32 px root font size', () => {
  for (const size of [
    { width: 1280, height: 900 },
    { width: 800, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`at ${size.width} px wide the rows keep their height and no text is clipped`, async () => {
      const context = await atRootFont32(size.width, size.height);
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        await stub(page, 8);
        await page.keyboard.press('Control+k');
        const box = page.getByRole('dialog', { name: dialogName });
        await expect(box).toBeVisible();
        await box.getByRole('combobox').fill('mad');
        await expect(box.getByRole('option').first()).toBeVisible();
        const m = await measure(page);
        // KI-54: the media query itself must see the large default font.
        const wideQuery = await page.evaluate(() => matchMedia('(min-width:64em)').matches);
        expect(wideQuery).toBe(size.width >= 64 * 16 * 2 ? true : false);
        expect(m.rootFont).toBe(32);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.innerWidth);
        expect(m.top).toBeGreaterThanOrEqual(0);
        expect(m.bottom).toBeLessThanOrEqual(m.innerHeight);
        // (The page behind the panel at 32 px and 390 px wide overflows by itself, a separate issue in KI-54.)
        expect(m.dialogOverflowX).toBeLessThanOrEqual(0);
        expect(m.listOverflowX).toBeLessThanOrEqual(0);
        expect(m.wide).toBe(0);
        // A row grows with the text (it was a fixed 56 px) and its words are never cut off.
        expect(m.firstRowHeight).toBeGreaterThan(56);
        expect(m.rowsTall).toBe(0);
        expect(m.clipped).toBe(0);
        // The field and the list both remain in view.
        await expect(box.getByRole('combobox')).toBeInViewport();
        expect(m.listHeight).toBeGreaterThanOrEqual(m.firstRowHeight);
      } finally {
        await context.close();
      }
    });
  }
});

// A classic scrollbar (Windows, Linux) takes width from a narrow panel. Playwright hides scrollbars by default, so
// this launches with them shown and checks the slim bar leaves the words their width.
test.describe('S67 a classic scrollbar in a narrow window', () => {
  test('the list scrollbar is slim and nothing scrolls sideways at 280 px', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'palette-bar-'));
    const context = await chromium.launchPersistentContext(dir, {
      viewport: { width: 280, height: 700 },
      ignoreDefaultArgs: ['--hide-scrollbars'],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await stub(page, 12);
      await page.keyboard.press('Control+k');
      const box = page.getByRole('dialog', { name: dialogName });
      await expect(box).toBeVisible();
      await box.getByRole('combobox').fill('mad');
      await expect(box.getByRole('option').first()).toBeVisible();
      const bar = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('.ux-palette-list')!;
        return {
          width: list.offsetWidth - list.clientWidth,
          scrolls: list.scrollHeight > list.clientHeight,
          sideways: list.scrollWidth - list.clientWidth,
          overflowX: getComputedStyle(list).overflowX,
        };
      });
      expect(bar.scrolls).toBe(true);
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.width).toBeLessThanOrEqual(11);
      expect(bar.sideways).toBeLessThanOrEqual(0);
      expect(bar.overflowX).toBe('hidden');
    } finally {
      await context.close();
    }
  });
});
