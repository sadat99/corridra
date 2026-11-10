import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { problems } from './fit';
import { measureColours, weakEdges, weakRings } from './ring-contrast';

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
      const inText = Array.from(
        document.querySelectorAll<HTMLElement>('main :is(p, dd, figcaption) a'),
      ).find(
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

// The navy regions: the footer, the band, the Mission Player. The ring there is white with a navy edge, except where an
// element is filled light inside them (the selected tab), whose ring must show on its own fill.
const navyRegions = '.guide-footer, .guide-band, .ac1-player';
const navyEdges = ['.ac1-play', '.guide-footer .guide-footer-actions .primary-link'];

for (const way of ['the saved choice', 'the device setting'] as const) {
  for (const width of widths) {
    test(`with ${way} the focus ring of every focusable element in the navy regions reaches 3 to 1 on what it is drawn on, at ${width}`, async ({
      page,
    }) => {
      if (way === 'the saved choice')
        await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
      else await page.emulateMedia({ contrast: 'more' });
      const found: string[] = [];
      for (const path of pages) {
        await open(page, path, width);
        // The footer groups are closed on a phone: their summaries are focusable and measured as they are.
        const { rings } = await measureColours(page, navyRegions);
        expect(rings.length, `${path} has focusable elements in the navy regions`).toBeGreaterThan(
          5,
        );
        expect(weakRings(rings), `${path} at ${width}`).toEqual([]);
        found.push(...rings.map((row) => row.element));
        if (path === '/') {
          // The elements the finding named are really among those measured, so this cannot pass by measuring nothing.
          const names = rings.map((row) => row.element).join('\n');
          expect(names).toMatch(/ac1-record-tabs|button\S*\[aria-selected=true\]/);
          expect(names).toMatch(/\[aria-selected=true\]/);
          expect(names).toMatch(/\[aria-selected=false\]/);
          expect(names).toMatch(/ac1-play/);
          expect(names).toMatch(/guide-footer-actions|primary-link/);
          expect(names).toMatch(/^a.*guide-band|^a\.primary-link/m);
        }
      }
      expect(found.length).toBeGreaterThan(50);
    });
  }
}

test('the ring on the selected tab of the Mission Player is navy on white, not white on white (the failing case)', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  await open(page, '/', 1440);
  const { rings } = await measureColours(page, '.ac1-record-tabs');
  const selected = rings.find((row) => row.element.includes('[aria-selected=true]'));
  const other = rings.find((row) => row.element.includes('[aria-selected=false]'));
  // The navy of the player (--brand-deep) on the white of the selected tab.
  expect(selected?.ring).toBe('rgb(20, 36, 56)');
  expect(selected?.backdrop).toBe('rgb(255 255 255)');
  expect(selected?.ratio).toBeGreaterThanOrEqual(7);
  expect(other?.ring).toBe('rgb(255, 255, 255)');
  expect(weakRings(rings)).toEqual([]);
});

test('the ring check can fail: a white ring drawn on the white selected tab is measured as 1 to 1', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  await open(page, '/', 1440);
  await page.addStyleTag({
    content:
      "html[data-contrast='more'] .ac1-record-tabs button[aria-selected='true']:focus-visible { outline-color: #fff !important; }",
  });
  const { rings } = await measureColours(page, '.ac1-record-tabs');
  expect(weakRings(rings)).toHaveLength(1);
  expect(weakRings(rings)[0]).toContain('[aria-selected=true]');
  expect(rings.find((row) => row.element.includes('[aria-selected=true]'))?.ratio).toBe(1);
});

for (const way of ['the saved choice', 'the device setting'] as const) {
  test(`with ${way} an action filled control on navy shows its boundary at 3 to 1 and keeps its label at 7 to 1`, async ({
    page,
  }) => {
    if (way === 'the saved choice')
      await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
    else await page.emulateMedia({ contrast: 'more' });
    await open(page, '/', 1440);
    const { edges } = await measureColours(page, navyRegions, navyEdges);
    expect(edges.map((row) => row.element).join('\n')).toMatch(/ac1-play/);
    expect(edges.map((row) => row.element).join('\n')).toMatch(/primary-link/);
    expect(weakEdges(edges)).toEqual([]);
    for (const row of edges) expect(row.backdrop, row.element).toBe('rgb(20 36 56)');
  });
}

test('without the white edge the same controls are only 1.91 to 1 on navy, so the boundary check can fail', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  await open(page, '/', 1440);
  await page.addStyleTag({
    content:
      "html[data-contrast='more'] :is(.ac1-play, .guide-footer .guide-footer-actions .primary-link) { border-color: var(--action) !important; }",
  });
  const { edges } = await measureColours(page, navyRegions, navyEdges);
  expect(weakEdges(edges)).toHaveLength(edges.length);
  // 1.91 to 1 by exact colours; the canvas reads each colour in whole steps, so allow a hundredth.
  for (const row of edges) expect(row.edgeRatio, row.element).toBeCloseTo(1.91, 1);
});

// Underlines belong to links in running text. A row, a tile or a badge made of a link is not text and is not underlined.
test('links in running text and standalone text links are underlined, a row link and a link with a badge are not', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));
  await open(page, '/privacy', 1440);
  const underlined = (selector: string) =>
    page.evaluate((target) => {
      const links = Array.from(document.querySelectorAll<HTMLElement>(target));
      return links.map((a) => getComputedStyle(a).textDecorationLine);
    }, selector);
  const inParagraph = await underlined('main p a:not([role], .primary-link, .button)');
  expect(inParagraph.length).toBeGreaterThan(0);
  expect(new Set(inParagraph)).toEqual(new Set(['underline']));
  // A row link is a link directly in a list item, as a whole row or tile: the mode adds no underline to it. The contents
  // list of this page is made of such links, so the mode must leave them as they were.
  const contents = 'main li > a:not(.text-link)';
  const withMode = await underlined(contents);
  expect(withMode, 'the privacy page has a contents list of links').not.toHaveLength(0);
  await html(page).evaluate((el) => el.removeAttribute('data-contrast'));
  expect(withMode).toEqual(await underlined(contents));
  await html(page).evaluate((el) => el.setAttribute('data-contrast', 'more'));
  // A made-up standalone text link and a made-up link carrying a badge, on a page that has main.
  const result = await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const make = (html: string) => {
      const box = document.createElement('p');
      box.innerHTML = html;
      main.append(box);
      return box.querySelector('a') as HTMLElement;
    };
    const lone = document.createElement('a');
    lone.className = 'text-link';
    lone.href = '#x';
    lone.textContent = 'Standalone';
    main.append(lone);
    const row = document.createElement('ul');
    row.innerHTML = '<li><a href="#r">Sell in a new market <span>Spain</span></a></li>';
    main.append(row);
    const badge = make('<a href="#y">Name <span class="status-badge">New</span></a>');
    const inline = make('Words with <a href="#z">a link</a> inside.');
    return {
      lone: getComputedStyle(lone).textDecorationLine,
      badge: getComputedStyle(badge).textDecorationLine,
      row: getComputedStyle(row.querySelector('a') as HTMLElement).textDecorationLine,
      inline: getComputedStyle(inline).textDecorationLine,
    };
  });
  expect(result).toEqual({ lone: 'underline', badge: 'none', row: 'none', inline: 'underline' });
});
