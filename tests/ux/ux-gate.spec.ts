import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// AC/1 UX quality gate. Contract: docs/design-system/README.md (section 8) and the AC/1 master
// contract sections 10 and 12. It measures every static route at the AC/1 widths and fails when any
// count rises above tests/ux/ux-baseline.json. Lower the baseline when you fix debt; never raise it.
// Signed-in screens are covered by the protected operator suite, not here.

const widths = [320, 390, 768, 1024, 1440, 1920];
const touchWidth = 768;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const appDir = join(root, 'apps/web/app');
const baselinePath = join(here, 'ux-baseline.json');
const reportDir = join(root, 'work/ux-gate');

function staticRoutes(directory: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (
        entry.startsWith('[') ||
        entry.startsWith('(') ||
        entry.startsWith('_') ||
        entry === 'api'
      )
        continue;
      if (entry.startsWith('.')) continue;
      routes.push(...staticRoutes(path));
    } else if (entry === 'page.tsx') {
      const route = '/' + relative(appDir, directory).split('\\').join('/');
      routes.push(route === '/' ? '/' : route.replace(/\/$/, ''));
    }
  }
  return routes.sort();
}

type Counts = Record<string, number>;
const baseline: Record<string, Counts> = JSON.parse(readFileSync(baselinePath, 'utf8'));
const update = process.env.UX_UPDATE_BASELINE === '1';
const measured: Record<string, Counts> = {};

async function measure(page: Page, width: number): Promise<Counts> {
  const counts: Counts = {};
  const add = (key: string, n: number) => {
    if (n > 0) counts[key] = (counts[key] ?? 0) + n;
  };
  const dom = await page.evaluate(
    ({ minTarget }) => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const interactive = [
        ...document.querySelectorAll(
          'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary',
        ),
      ].filter(visible);
      // Inline links inside running text are exempt from target size (WCAG 2.5.8 exception).
      const inline = (el: Element) =>
        el.tagName === 'A' &&
        !!el.parentElement &&
        ['P', 'LI', 'DD', 'SPAN', 'SMALL'].includes(el.parentElement.tagName) &&
        (el.parentElement.textContent ?? '').trim().length >
          (el.textContent ?? '').trim().length + 1;
      const smallTargets = interactive.filter((el) => {
        if (inline(el)) return false;
        // Visually hidden until focused (skip links); their focused state is checked by the browser suite.
        const box = el.getBoundingClientRect();
        if (box.width <= 1 && box.height <= 1) return false;
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return false;
        const r = el.getBoundingClientRect();
        return r.width < minTarget || r.height < minTarget;
      }).length;
      // AC/1: capsules are for status badges only; actions and navigation use 8 px corners.
      const pillControls = interactive.filter((el) => {
        const r = el.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius);
        return r.height >= 32 && r.width > r.height && radius >= r.height / 2 - 1;
      }).length;
      // AC/1: one primary decision per action region.
      const regions = [
        ...document.querySelectorAll('main section, main form, main aside, main nav'),
      ];
      const crowdedRegions = regions.filter((region) => {
        const direct = [
          ...region.querySelectorAll('.primary-link, .button:not(.button-secondary)'),
        ].filter(
          (el) =>
            visible(el) && el.closest('main section, main form, main aside, main nav') === region,
        );
        return direct.length > 1;
      }).length;
      const tinyText = [...document.querySelectorAll('main *, header *, footer *')].filter((el) => {
        if (!visible(el)) return false;
        const own = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim(),
        );
        return own && parseFloat(getComputedStyle(el).fontSize) < 12;
      }).length;
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1 ? 1 : 0,
        smallTargets,
        pillControls,
        crowdedRegions,
        tinyText,
        focusables: interactive.length,
      };
    },
    { minTarget: width <= touchWidth ? 44 : 24 },
  );
  add('overflow', dom.overflow);
  add('smallTargets', dom.smallTargets);
  add('pillControls', dom.pillControls);
  add('crowdedRegions', dom.crowdedRegions);
  add('tinyText', dom.tinyText);

  // Keyboard: every element reached by Tab shows a visible focus indicator.
  let invisibleFocus = 0;
  await page.locator('body').focus();
  for (let i = 0; i < Math.min(dom.focusables, 30); i++) {
    await page.keyboard.press('Tab');
    const shown = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return true;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      return outline || s.boxShadow !== 'none';
    });
    if (!shown) invisibleFocus++;
  }
  add('invisibleFocus', invisibleFocus);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  for (const violation of axe.violations) add(`axe:${violation.id}`, violation.nodes.length);
  return counts;
}

for (const route of staticRoutes(appDir)) {
  test(`AC/1 UX gate ${route}`, async ({ page }) => {
    test.setTimeout(180_000);
    const totals: Counts = {};
    let finalPath = route;
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      finalPath = new URL(page.url()).pathname;
      if (!response || response.status() >= 400) {
        totals.unavailable = (totals.unavailable ?? 0) + 1;
        continue;
      }
      if (width === 390 || width === 1440) {
        mkdirSync(reportDir, { recursive: true });
        const name =
          (route === '/' ? 'home' : route.slice(1).replaceAll('/', '_')) + `_${width}.png`;
        await page.screenshot({ path: join(reportDir, name), fullPage: true });
      }
      for (const [key, value] of Object.entries(await measure(page, width))) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
    if (finalPath !== route) totals[`redirectsTo:${finalPath}`] = 1;
    measured[route] = totals;
    if (update) return;
    const allowed = baseline[route];
    expect(
      allowed,
      `${route} has no UX baseline entry; new routes start clean (run with UX_UPDATE_BASELINE=1 only to record existing debt)`,
    ).toBeDefined();
    for (const [key, value] of Object.entries(totals)) {
      if (key.startsWith('redirectsTo:')) continue;
      expect(value, `${route}: ${key} rose above the UX baseline`).toBeLessThanOrEqual(
        allowed[key] ?? 0,
      );
    }
  });
}

test.afterAll(() => {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify(measured, null, 2) + '\n');
  if (update) {
    const merged = { ...baseline, ...measured };
    const sorted = Object.fromEntries(
      Object.keys(merged)
        .sort()
        .map((k) => [k, Object.fromEntries(Object.entries(merged[k]).sort())]),
    );
    writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  }
});
