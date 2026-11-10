import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { problems } from './fit';

// W10 Stronger Colours on the public pages, against a production build. The effect is in force when the person chose
// it (the saved choice puts data-contrast="more" on <html> before the first paint) or the device asks
// (prefers-contrast: more). Both ways are measured with axe, including the enhanced contrast rule (7 to 1 for text),
// and the page must not shift, scroll sideways or lose its logo colour. The signed-in pages are measured in
// tests/e2e/verification/revamp-s2/w10-stronger-colours.spec.ts.
// /privacy is added because it holds links inside sentences, which are underlined with the choice on.
const pages = [
  '/',
  '/how-it-works',
  '/corridors',
  '/network',
  '/trust',
  '/plan',
  '/privacy',
] as const;
const widths = [390, 1440] as const;
const standardTags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const summarise = (violations: { id: string; nodes: { html: string }[] }[]) =>
  violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 160)}`);

async function axeClean(page: Page) {
  const standard = await new AxeBuilder({ page }).withTags(standardTags).analyze();
  const enhanced = await new AxeBuilder({ page }).withRules(['color-contrast-enhanced']).analyze();
  return { standard: summarise(standard.violations), enhanced: summarise(enhanced.violations) };
}

const html = (page: Page) => page.locator('html');

for (const path of pages) {
  for (const width of widths) {
    test(`${path} with the saved choice has no axe violations, enhanced contrast included, at ${width}`, async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
      await open(page, path, width);
      await expect(html(page)).toHaveAttribute('data-contrast', 'more');
      expect(await axeClean(page)).toEqual({ standard: [], enhanced: [] });
      expect(await problems(page), `${path} at ${width}`).toEqual([]);
    });

    test(`${path} with only the device setting has no axe violations, enhanced contrast included, at ${width}`, async ({
      page,
    }) => {
      await page.emulateMedia({ contrast: 'more' });
      await open(page, path, width);
      await expect(html(page)).not.toHaveAttribute('data-contrast', /.*/);
      expect(await axeClean(page)).toEqual({ standard: [], enhanced: [] });
      expect(await problems(page), `${path} at ${width}`).toEqual([]);
    });

    test(`${path} keeps the same height with and without the choice, so underlined links shift nothing, at ${width}`, async ({
      page,
    }) => {
      await open(page, path, width);
      const height = () => page.evaluate(() => document.documentElement.scrollHeight);
      const plain = await height();
      await html(page).evaluate((el) => el.setAttribute('data-contrast', 'more'));
      const stronger = await height();
      expect(stronger, path).toBe(plain);
      await html(page).evaluate((el) => el.removeAttribute('data-contrast'));
      expect(await height(), path).toBe(plain);
    });
  }
}

test('the enhanced contrast rule runs here: the default page does not meet it, so a clean result above means something', async ({
  page,
}) => {
  await open(page, '/how-it-works', 1440);
  const { enhanced } = await axeClean(page);
  expect(enhanced.length).toBeGreaterThan(0);
  expect(enhanced[0]).toContain('color-contrast-enhanced');
});

test('the effect really changes the page: darker secondary text, a clearer line, underlined links in text only, the same logo', async ({
  page,
}) => {
  await open(page, '/privacy', 1440);
  const read = () =>
    page.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el) : null;
      };
      const inText = Array.from(document.querySelectorAll<HTMLElement>('main :is(p, li) a')).find(
        (a) =>
          !a.matches('[role], nav a, .primary-link, .button, .button-secondary, .secondary-link'),
      );
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        textTwo: rootStyle.getPropertyValue('--text-2').trim(),
        line: rootStyle.getPropertyValue('--line').trim(),
        brand: rootStyle.getPropertyValue('--brand').trim(),
        inTextLink: inText ? getComputedStyle(inText).textDecorationLine : 'none found',
        navLink: getComputedStyle(document.querySelector('header nav a, nav a') as Element)
          .textDecorationLine,
        primary: style('.primary-link')?.textDecorationLine ?? 'none found',
        logo: style('.brand .brand-mark')?.color ?? 'none found',
      };
    });
  const before = await read();
  await html(page).evaluate((el) => el.setAttribute('data-contrast', 'more'));
  const after = await read();
  expect(after.textTwo).not.toBe(before.textTwo);
  expect(after.line).not.toBe(before.line);
  expect(after.brand).not.toBe(before.brand);
  expect(before.inTextLink).not.toBe('none found');
  expect(after.inTextLink).toBe('underline');
  expect(after.navLink).toBe(before.navLink);
  expect(after.primary).toBe(before.primary);
  // The logo is the brand's own cobalt, whatever the page does with cobalt.
  expect(after.logo).toBe(before.logo);
  await html(page).evaluate((el) => el.removeAttribute('data-contrast'));
  expect(await read()).toEqual(before);
});

test('keyboard focus is a thick ring in the stronger colour, and white on the navy footer', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  await open(page, '/how-it-works', 1440);
  const ring = (selector: string) =>
    page.evaluate((target) => {
      const el = document.querySelector<HTMLElement>(target);
      el?.focus({ focusVisible: true } as FocusOptions);
      const style = el ? getComputedStyle(el) : null;
      return style && { width: style.outlineWidth, colour: style.outlineColor };
    }, selector);
  const onPage = await ring('main a');
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  );
  expect(onPage?.width).toBe('3px');
  expect(brand).not.toBe('');
  const inFooter = await ring('.guide-footer a');
  expect(inFooter?.width).toBe('3px');
  expect(inFooter?.colour).toBe('rgb(255, 255, 255)');
  expect(onPage?.colour).not.toBe(inFooter?.colour);
});

test('the choice is never sent to a server: no cookie and no request carries it', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  const carried: string[] = [];
  page.on('request', (request) => {
    const text = `${request.url()} ${request.postData() ?? ''} ${JSON.stringify(request.headers())}`;
    if (/corridra\.contrast|data-contrast/.test(text)) carried.push(request.url());
  });
  await page.goto('/how-it-works');
  await page.reload();
  expect(carried).toEqual([]);
  expect(JSON.stringify(await context.cookies())).not.toMatch(/contrast/);
});
