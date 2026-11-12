import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startTodayFixture } from './team-today-fixture';

// The staff sidebar at laptop and phone heights, with the real stylesheets (the Today fixture): the Admin row
// reads on two lines without wrapping its caption, opening Admin never clips Today, a list that must scroll
// scrolls with a thin themed bar and keeps every focus ring in view, the five Admin pages read as links (a dot,
// not an expander chevron), and nobody loses a route, a role rule, the icon rail or the phone drawer.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Options = {
  width: number;
  height: number;
  role?: string;
  hash?: string;
  /** Open the Admin group first (a click on its summary) when it is not already open. */
  admin?: boolean;
  collapsed?: boolean;
};

async function open(page: Page, options: Options) {
  const { width, height, role = 'owner', hash = '', admin = false, collapsed = false } = options;
  await page.setViewportSize({ width, height });
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
        role,
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  if (collapsed)
    await page.addInitScript(() =>
      window.localStorage.setItem('corridra.leftnav.collapsed', 'true'),
    );
  await page.goto(`${fixture.origin}/operator?owner=on&urls=on&role=${role}${hash}`);
  const sidebar = page.locator('#workspace-navigation');
  if (width < 1024) await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await expect(sidebar).toBeVisible();
  const summary = page.locator('details.ux-team-group > summary');
  if (role === 'owner') {
    await summary.waitFor({ state: 'attached' });
    const details = page.locator('details.ux-team-group');
    if (admin && !(await details.evaluate((el: HTMLDetailsElement) => el.open))) {
      await summary.click();
    }
    await expect(details).toHaveJSProperty('open', admin || hash === '#workspace-settings');
  }
  // The pointer rests away from the sidebar so no row shows its hover fill.
  await page.mouse.move(Math.round(width * 0.7), Math.round(height * 0.5));
  return sidebar;
}

type Box = { top: number; bottom: number; left: number; right: number };
const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((el) => {
    const { top, bottom, left, right } = el.getBoundingClientRect();
    return { top, bottom, left, right };
  });

/** The scrolling list's facts: its scroll and client heights and widths and its scrollbar properties. */
const listFacts = (page: Page) =>
  page.evaluate(() => {
    const nav = document.querySelector('#workspace-navigation') as HTMLElement;
    const style = getComputedStyle(nav);
    return {
      scrollHeight: nav.scrollHeight,
      clientHeight: nav.clientHeight,
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      scrollTop: nav.scrollTop,
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

/** The sidebar's own box without its scrollbar, as the viewport sees it. */
const listBox = (page: Page): Promise<Box> =>
  page.locator('#workspace-navigation').evaluate((nav) => {
    const { top, left } = nav.getBoundingClientRect();
    return {
      top,
      left,
      bottom: top + nav.clientHeight,
      right: left + nav.clientWidth,
    };
  });

/** The focus ring is 3 px with a 2 px offset: 5 px of room inside the scroller keeps it uncut. */
const ring = 5;
const insideWithRing = (box: Box, area: Box) => ({
  top: box.top - area.top,
  bottom: area.bottom - box.bottom,
  left: box.left - area.left,
  right: area.right - box.right,
});

const todayLink = (page: Page) => page.locator('#workspace-navigation > ul > li:first-child a');
const adminSummary = (page: Page) => page.locator('details.ux-team-group > summary');
const collapseButton = (page: Page) => page.locator('.ux-leftnav-collapse');

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r = 0, g = 0, b = 0]: number[]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

test.describe('the Admin row', () => {
  for (const [width, height] of [
    [1440, 900],
    [1024, 560],
  ] as const) {
    test(`reads on two lines at ${width}x${height}: the name, then the caption, neither wrapped or cut`, async ({
      page,
    }) => {
      await open(page, { width, height });
      const facts = await page.evaluate(() => {
        const summary = document.querySelector('details.ux-team-group > summary') as HTMLElement;
        const label = summary.querySelector(':scope > span') as HTMLElement;
        const caption = summary.querySelector('.ux-team-caption') as HTMLElement;
        const chevron = summary.querySelector('.ux-team-chevron') as SVGElement;
        const lineOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight);
        const rect = (el: Element) => el.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(caption);
        const nav = document.querySelector('#workspace-navigation') as HTMLElement;
        const background = parseColor(getComputedStyle(nav).backgroundColor);
        function parseColor(value: string) {
          return (value.match(/[\d.]+/g) ?? []).map(Number);
        }
        return {
          summaryHeight: rect(summary).height,
          labelHeight: rect(label).height,
          labelLine: lineOf(label),
          captionHeight: rect(caption).height,
          captionLine: lineOf(caption),
          captionWidth: rect(caption).width,
          captionTextWidth: textRange.getBoundingClientRect().width,
          overflowing: Array.from(summary.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter((child) => child.scrollWidth > child.clientWidth + 1)
            .map((child) => child.className || child.tagName),
          captionTop: rect(caption).top,
          labelBottom: rect(label).bottom,
          captionRight: rect(caption).right,
          chevronLeft: rect(chevron).left,
          captionColor: parseColor(getComputedStyle(caption).color),
          captionOpacity: getComputedStyle(caption).opacity,
          navBackground: background,
        };
      });
      expect(facts.summaryHeight).toBeGreaterThanOrEqual(44);
      expect(facts.summaryHeight).toBeGreaterThanOrEqual(60 - 0.5);
      expect(facts.labelHeight).toBeLessThanOrEqual(facts.labelLine * 1.5);
      expect(facts.captionHeight).toBeLessThanOrEqual(facts.captionLine * 1.5);
      expect(facts.overflowing).toEqual([]);
      expect(facts.captionTop).toBeGreaterThanOrEqual(facts.labelBottom - 0.5);
      expect(facts.captionRight).toBeLessThanOrEqual(facts.chevronLeft);
      expect(facts.captionWidth - facts.captionTextWidth).toBeGreaterThanOrEqual(16);
      expect(facts.captionOpacity).toBe('1');
      const [a, b] = [luminance(facts.captionColor), luminance(facts.navBackground)];
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('a hover fills the Admin row and does not underline it', async ({ page }) => {
    await open(page, { width: 1440, height: 900 });
    await adminSummary(page).hover();
    for (const selector of ['summary', 'summary > span', 'summary > .ux-team-caption'])
      expect(
        await page
          .locator(`details.ux-team-group > ${selector}`)
          .evaluate((el) => getComputedStyle(el).textDecorationLine),
        selector,
      ).toBe('none');
  });
});

test.describe('opening Admin at a tall window', () => {
  for (const height of [900, 800]) {
    test(`fits with no scrollbar and Today in view at 1440x${height}`, async ({ page }) => {
      await open(page, { width: 1440, height, admin: true });
      const facts = await listFacts(page);
      expect(facts.scrollHeight).toBeLessThanOrEqual(facts.clientHeight);
      const area = await listBox(page);
      const today = await boxOf(todayLink(page));
      expect(today.top).toBeGreaterThanOrEqual(area.top);
      expect(today.bottom).toBeLessThanOrEqual(area.bottom);
    });
  }
});

test.describe('opening Admin at a short window', () => {
  for (const [width, height] of [
    [1440, 636],
    [1440, 560],
    [1280, 560],
    [1024, 560],
  ] as const) {
    test(`scrolls on its own with Today and every focus ring in view at ${width}x${height}`, async ({
      page,
    }) => {
      await open(page, { width, height, admin: true });
      let facts = await listFacts(page);
      expect(facts.scrollTop).toBe(0);
      expect(facts.scrollbarWidth).toBe('thin');
      expect(facts.scrollbarColor).not.toBe('auto');
      expect(facts.scrollWidth).toBeLessThanOrEqual(facts.clientWidth);
      expect(facts.pageOverflow).toBeLessThanOrEqual(0);
      // At the top, Today is whole with room for its ring.
      const area = await listBox(page);
      let room = insideWithRing(await boxOf(todayLink(page)), area);
      expect(room.top).toBeGreaterThanOrEqual(ring);
      expect(room.left).toBeGreaterThanOrEqual(ring);
      // Tabbing through all eleven stops brings each one fully into view with its ring uncut.
      await todayLink(page).focus();
      const names: string[] = [];
      for (let stop = 0; stop < 11; stop += 1) {
        const focused = page.locator('#workspace-navigation :focus');
        await expect(focused).toHaveCount(1);
        names.push((await focused.getAttribute('title')) ?? '');
        room = insideWithRing(await boxOf(focused), await listBox(page));
        expect(room.top, `stop ${stop} top`).toBeGreaterThanOrEqual(ring);
        expect(room.bottom, `stop ${stop} bottom`).toBeGreaterThanOrEqual(ring);
        expect(room.left, `stop ${stop} left`).toBeGreaterThanOrEqual(ring);
        expect(room.right, `stop ${stop} right`).toBeGreaterThanOrEqual(ring);
        if (stop < 10) await page.keyboard.press('Tab');
      }
      expect(new Set(names).size).toBe(11);
      // The collapse button stays below the list and in the window.
      const list = await boxOf(page.locator('#workspace-navigation'));
      const collapse = await boxOf(collapseButton(page));
      expect(collapse.top).toBeGreaterThanOrEqual(list.bottom - 1);
      expect(collapse.bottom).toBeLessThanOrEqual(height);
      facts = await listFacts(page);
      expect(facts.scrollWidth).toBeLessThanOrEqual(facts.clientWidth);
      expect(facts.pageOverflow).toBeLessThanOrEqual(0);
    });
  }

  test('opening the page on an Admin page leaves the list at the top', async ({ page }) => {
    await open(page, { width: 1440, height: 560, hash: '#workspace-settings' });
    expect((await listFacts(page)).scrollTop).toBe(0);
    const area = await listBox(page);
    expect((await boxOf(todayLink(page))).top).toBeGreaterThanOrEqual(area.top + ring);
  });
});

test.describe('Admin closed at a short window', () => {
  for (const [width, height] of [
    [1024, 560],
    [1440, 560],
  ] as const) {
    test(`shows every row and the collapse button with no scrollbar at ${width}x${height}`, async ({
      page,
    }) => {
      await open(page, { width, height });
      const facts = await listFacts(page);
      expect(facts.scrollHeight).toBeLessThanOrEqual(facts.clientHeight);
      const area = await listBox(page);
      const links = page.locator('#workspace-navigation > ul > li a');
      await expect(links).toHaveCount(5);
      for (const target of [...(await links.all()), adminSummary(page)]) {
        const box = await boxOf(target);
        expect(box.top).toBeGreaterThanOrEqual(area.top);
        expect(box.bottom).toBeLessThanOrEqual(area.bottom);
      }
      const collapse = await boxOf(collapseButton(page));
      expect(collapse.top).toBeGreaterThanOrEqual(area.bottom);
      expect(collapse.bottom).toBeLessThanOrEqual(height);
    });
  }
});

test.describe('the five Admin pages', () => {
  test('read as links inside a group: a dot, no expander chevron, one shared left edge', async ({
    page,
  }) => {
    await open(page, { width: 1440, height: 900, admin: true });
    const subs = page.locator('details.ux-team-group ul a');
    await expect(subs).toHaveCount(5);
    expect(
      await subs.evaluateAll((els) => els.map((el) => el.querySelectorAll('svg').length)),
    ).toEqual([0, 0, 0, 0, 0]);
    const dot = await subs.evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el, '::before');
        return { content: style.content, radius: style.borderRadius, width: style.width };
      }),
    );
    for (const entry of dot) {
      expect(entry.content).not.toBe('none');
      expect(entry.radius).toBe('50%');
      expect(entry.width).toBe('4px');
    }
    const edges = await subs.evaluateAll((els) =>
      els.map((el) => el.querySelector('span')!.getBoundingClientRect().left),
    );
    const adminEdge = await adminSummary(page).evaluate(
      (el) => el.querySelector(':scope > span')!.getBoundingClientRect().left,
    );
    for (const edge of edges) expect(Math.abs(edge - edges[0]!)).toBeLessThanOrEqual(1);
    expect(edges[0]! - adminEdge).toBeGreaterThanOrEqual(8);
    expect(
      await subs.evaluateAll((els) => els.map((el) => el.querySelector('span')!.textContent)),
    ).toEqual(['Health', 'Readiness', 'Audit', 'People and access', 'Settings']);
    for (const target of [...(await subs.all()), adminSummary(page)])
      expect(await boxOf(target).then((b) => b.bottom - b.top)).toBeGreaterThanOrEqual(44);
  });

  test('the Admin row keeps its one chevron, which turns when the group opens', async ({
    page,
  }) => {
    await open(page, { width: 1440, height: 900 });
    const chevron = page.locator('details.ux-team-group > summary svg.ux-team-chevron');
    await expect(chevron).toHaveCount(1);
    const closed = await chevron.evaluate((el) => getComputedStyle(el).transform);
    await adminSummary(page).click();
    await expect
      .poll(() => chevron.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(closed);
  });
});

test.describe('the Admin chevron in a right-to-left page', () => {
  test('points the reading direction when closed and turns down when open, once the transition has settled', async ({
    page,
  }) => {
    await open(page, { width: 1440, height: 900 });
    // The frame carries the page's direction, as the Arabic page does (ws-e/team-quality Q-04).
    await page.locator('.ux-leftnav-frame').evaluate((el) => el.setAttribute('dir', 'rtl'));
    await page.addStyleTag({ content: '.ux-team-chevron { transition: none !important; }' });
    const chevron = page.locator('details.ux-team-group > summary svg.ux-team-chevron');
    const transform = () => chevron.evaluate((el) => getComputedStyle(el).transform);
    expect(await transform()).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    await adminSummary(page).click();
    await expect(page.locator('details.ux-team-group')).toHaveJSProperty('open', true);
    // rotate(90deg) is matrix(cos, sin, -sin, cos): (0, 1, -1, 0).
    const open90 = (await transform()).match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
    expect(open90.map((n) => Math.round(n))).toEqual([0, 1, -1, 0, 0, 0]);
  });
});

test.describe('the phone drawer', () => {
  for (const [width, height] of [
    [768, 900],
    [390, 844],
  ] as const) {
    test(`keeps the caption on one line and every target at 44 px at ${width}x${height}`, async ({
      page,
    }) => {
      await open(page, { width, height, admin: true });
      const facts = await page.evaluate(() => {
        const caption = document.querySelector('.ux-team-caption') as HTMLElement;
        const lineHeight = parseFloat(getComputedStyle(caption).lineHeight);
        const targets = Array.from(
          document.querySelectorAll('#workspace-navigation a, #workspace-navigation summary'),
        ).map((el) => el.getBoundingClientRect().height);
        return { lines: caption.getBoundingClientRect().height / lineHeight, targets };
      });
      expect(facts.lines).toBeLessThanOrEqual(1.5);
      expect(facts.targets).toHaveLength(11);
      for (const height of facts.targets) expect(height).toBeGreaterThanOrEqual(44);
    });
  }

  test('scrolls in its own panel at 390x560 and reaches the last page, with the page behind inert', async ({
    page,
  }) => {
    await open(page, { width: 390, height: 560, admin: true });
    const panel = page.locator('.ux-leftnav-panel');
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.locator('.ux-leftnav-page')).toHaveJSProperty('inert', true);
    const last = page.locator('details.ux-team-group ul li:last-child a');
    for (let press = 0; press < 40; press += 1) {
      if (await last.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(last).toBeFocused();
    const room = insideWithRing(await boxOf(last), await boxOf(panel));
    expect(room.top).toBeGreaterThanOrEqual(0);
    expect(room.bottom).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveAttribute('data-open', 'false');
    await expect(page.locator('[data-leftnav-opener]')).toBeFocused();
    await expect(page.locator('.ux-leftnav-page')).toHaveJSProperty('inert', false);
  });
});

test.describe('the icon rail', () => {
  for (const [width, height] of [
    [1440, 560],
    [1024, 560],
  ] as const) {
    test(`shows icons only at ${width}x${height}, keeps tooltips and widens when Admin is clicked`, async ({
      page,
    }) => {
      await open(page, { width, height, collapsed: true });
      await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
      const facts = await page.evaluate(() => {
        const size = (el: Element) => {
          const { width, height } = el.getBoundingClientRect();
          return { width, height };
        };
        return {
          spans: Array.from(
            document.querySelectorAll(
              '#workspace-navigation a > span, #workspace-navigation summary > span',
            ),
          ).map(size),
          caption: size(document.querySelector('.ux-team-caption')!),
          summary: size(document.querySelector('details.ux-team-group > summary')!),
          titles: Array.from(document.querySelectorAll('#workspace-navigation a')).map((el) =>
            el.getAttribute('title'),
          ),
        };
      });
      for (const span of facts.spans) {
        expect(span.width).toBeLessThanOrEqual(1);
        expect(span.height).toBeLessThanOrEqual(1);
      }
      expect(facts.caption.width).toBeLessThanOrEqual(1);
      expect(facts.caption.height).toBeLessThanOrEqual(1);
      expect(Math.abs(facts.summary.height - 44)).toBeLessThanOrEqual(0.5);
      for (const title of facts.titles) expect(title).toBeTruthy();
      await expect(page.locator('details.ux-team-group ul')).toBeHidden();
      await expect(page.locator('details.ux-team-group ul a')).toHaveCount(5);
      const list = await listFacts(page);
      expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight);
      await adminSummary(page).click();
      await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'false');
      await expect(page.locator('details.ux-team-group')).toHaveJSProperty('open', true);
      await expect(page.locator('details.ux-team-group ul a').first()).toBeVisible();
    });
  }
});

test.describe('roles that are not shown Admin', () => {
  for (const role of ['operator', 'reviewer', 'viewer']) {
    test(`${role} sees no Admin, no group and no audit page, and nothing scrolls`, async ({
      page,
    }) => {
      const sidebar = await open(page, { width: 1440, height: 560, role });
      await expect(sidebar.getByText('Admin')).toHaveCount(0);
      await expect(sidebar.locator('details')).toHaveCount(0);
      await expect(page.locator('a[href*="/operator/audit"]')).toHaveCount(0);
      await expect(sidebar.locator('ul > li a')).toHaveCount(5);
      const facts = await listFacts(page);
      expect(facts.scrollHeight).toBeLessThanOrEqual(facts.clientHeight);
    });
  }
});

test.describe('reload and keyboard', () => {
  test('an Admin page opens its group on load and Space and Enter toggle it with focus kept', async ({
    page,
  }) => {
    await open(page, { width: 1440, height: 900, hash: '#workspace-settings' });
    const details = page.locator('details.ux-team-group');
    await expect(details).toHaveJSProperty('open', true);
    await expect(adminSummary(page)).toHaveAttribute('aria-current', 'true');
    await expect(
      page.locator('details.ux-team-group ul').getByRole('link', { name: 'Settings', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(details).toHaveJSProperty('open', true);
    await adminSummary(page).focus();
    await page.keyboard.press('Space');
    await expect(details).toHaveJSProperty('open', false);
    await expect(adminSummary(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await expect(adminSummary(page)).toBeFocused();
  });

  test('the collapsed choice survives a reload', async ({ page }) => {
    await open(page, { width: 1440, height: 900 });
    await collapseButton(page).click();
    await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
    await page.reload();
    await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
    expect(
      await page.evaluate(() => window.localStorage.getItem('corridra.leftnav.collapsed')),
    ).toBe('true');
  });
});

test.describe('axe on the sidebar', () => {
  const violations = async (page: Page) =>
    (
      await new AxeBuilder({ page })
        .include('#workspace-navigation')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()
    ).violations.map((violation) => violation.id);

  test('has no violations, Admin open and closed, at a short window', async ({ page }) => {
    await open(page, { width: 1440, height: 560 });
    expect(await violations(page)).toEqual([]);
    await adminSummary(page).click();
    await expect(page.locator('details.ux-team-group')).toHaveJSProperty('open', true);
    expect(await violations(page)).toEqual([]);
  });

  test('has no violations in the open phone drawer', async ({ page }) => {
    await open(page, { width: 390, height: 560, admin: true });
    expect(await violations(page)).toEqual([]);
  });
});
