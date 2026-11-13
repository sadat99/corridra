import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// The footer, Option B (owner decision of 12 November 2026, locked mockups revision 2; it replaces the Ledger layout
// of 6 November): a full-width navy band with the logo, promise and actions on the left, three family tiles (Buy
// Abroad, Groups and Trips, Sell and Expand) and the Corridra links as one row, the trust legend and one quiet line.
// On a phone each group is a native disclosure and Buy Abroad starts open; from 701 px every group is open with no
// tap and one copy of each link. A signed-in person is never offered
// sign-in (public-home spec rule 5): the footer follows the answer the public header already has.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

const groups = [
  {
    title: 'Buy Abroad',
    links: [
      ['Source Products and Suppliers', '/source'],
      ['Procure Machinery', '/machinery'],
      ['Bangladesh to China', '/corridors/bangladesh-china'],
      ['See a Sample Mission', '/corridors#mission-example'],
    ],
  },
  {
    title: 'Groups and Trips',
    links: [
      ['Run a Trade Mission', '/trade-missions'],
      ['Plan a Business Trip', '/business-trips'],
      ['For Institutions', '/institutions'],
      ['Join the Corridra Network', '/network'],
    ],
  },
  {
    title: 'Sell and Expand',
    links: [
      ['Sell in a New Market', '/sell'],
      ['Enter a New Market', '/enter-market'],
      ['Bangladesh to Spain', '/corridors/bangladesh-spain'],
      ['Explore Every Route', '/corridors'],
    ],
  },
  {
    title: 'Corridra',
    links: [
      ['How It Works', '/how-it-works'],
      ['About Corridra', '/about'],
      ['Trust and Evidence', '/trust'],
      // The notice keeps its honest name: the test intake wording while real use is off.
      [/^(Privacy Notice|Test Intake Notice)$/, '/privacy'],
    ],
  },
] as const;

// Every destination the earlier footer had: the six ways to work and its company links.
const earlierDestinations = [
  '/source',
  '/machinery',
  '/trade-missions',
  '/business-trips',
  '/sell',
  '/enter-market',
  '/workspace',
  '/corridors#mission-example',
  '/trust',
  '/about',
  '/network',
  '/institutions',
  '/privacy',
];

const footer = (page: Page) => page.locator('footer.guide-footer');
const signedIn = async (page: Page) => {
  for (const path of ['**/api/auth/get-session', '**/api/operator-auth/get-session'])
    await page.route(path, (route) =>
      route.fulfill({ json: { user: { id: 'synthetic-user' }, session: { id: 'synthetic' } } }),
    );
};

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('the footer has three family tiles and the Corridra row, four links each with its exact address, open with no tap on a wide screen', async ({
  page,
}) => {
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    const nav = footer(page).getByRole('navigation', { name: 'Footer', exact: true });
    const details = nav.locator('details.guide-footer-details');
    await expect(details).toHaveCount(4);
    for (const [index, group] of groups.entries()) {
      const box = details.nth(index);
      await expect(box.locator('summary'), `${width}px`).toBeHidden();
      await expect(box.getByRole('heading', { name: group.title, exact: true })).toBeVisible();
      await expect(box.getByRole('link')).toHaveCount(4);
      for (const [position, [name, href]] of group.links.entries()) {
        const link = box.getByRole('link').nth(position);
        await expect(link, `${width}px ${href}`).toBeVisible();
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveText(name);
      }
    }
    // One copy of each link: nothing is rendered twice for the phone.
    await expect(nav.getByRole('link')).toHaveCount(16);
    // The families are tiles of unequal width: Buy Abroad is the widest.
    const widths = await nav
      .locator('details[data-family]')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
    expect(widths, `${width}px`).toHaveLength(3);
    expect(widths[0]!, `${width}px`).toBeGreaterThan(widths[1]! + 1);
  }
});

// Nothing dropped (owner rule for Option B): every one of the 16 links, the three actions, the four trust labels and
// the four bottom items are present once each, at desktop and on a phone.
test('nothing is dropped: 16 links, three actions, four trust labels and four bottom items, once each, at 1440 and 390', async ({
  page,
}) => {
  const hrefs = groups.flatMap((group) => group.links.map(([, href]) => href));
  expect(new Set(hrefs).size).toBe(16);
  for (const size of Object.values(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/about');
    const nav = footer(page).getByRole('navigation', { name: 'Footer', exact: true });
    for (const href of hrefs)
      await expect(nav.locator(`a[href="${href}"]`), `${size.width}px ${href}`).toHaveCount(1);
    const actions = footer(page).locator('.guide-footer-actions');
    for (const [name, href] of [
      ['Start a Request', '/plan'],
      ['Sign In', '/signin'],
      ['Open Your Workspace', '/workspace'],
    ] as const) {
      const link = actions.getByRole('link', { name, exact: true });
      await expect(link, `${size.width}px ${name}`).toHaveCount(1);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toBeVisible();
    }
    await expect(footer(page).locator('.guide-footer-legend .guide-tag')).toHaveText([
      'Self-declared',
      'Evidence available',
      'Verified',
      'Not confirmed',
    ]);
    const bottom = footer(page).locator('.guide-footer-bottom');
    for (const words of [
      '© 2026 Corridra',
      'Your work stays private to the people given access',
      'First routes: Bangladesh to China, Spain and the EU',
    ])
      await expect(
        bottom.getByText(words, { exact: true }),
        `${size.width}px ${words}`,
      ).toHaveCount(1);
    // The language switcher is drawn only when two or more languages are offered; never twice.
    expect(await bottom.locator('.lang-switcher').count(), `${size.width}px`).toBeLessThanOrEqual(
      1,
    );
  }
});

test('every destination of the earlier footer is still in the footer', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  for (const href of earlierDestinations)
    await expect(footer(page).locator(`a[href="${href}"]`).first(), href).toBeVisible();
});

test('the trust legend names the fact labels and links to How We Label Facts', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const legend = footer(page).locator('.guide-footer-legend');
  await expect(legend).toContainText('Every fact says where it comes from:');
  await expect(legend.locator('.guide-tag')).toHaveText([
    'Self-declared',
    'Evidence available',
    'Verified',
    'Not confirmed',
  ]);
  await expect(
    footer(page).getByRole('link', { name: 'How We Label Facts', exact: true }),
  ).toHaveAttribute('href', '/trust');
});

test('the last line keeps the copyright and the privacy line, and the first routes on a wide screen only', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const bottom = footer(page).locator('.guide-footer-bottom');
  await expect(bottom.getByText('© 2026 Corridra', { exact: true })).toBeVisible();
  await expect(
    bottom.getByText('Your work stays private to the people given access', { exact: true }),
  ).toBeVisible();
  await expect(
    bottom.getByText('First routes: Bangladesh to China, Spain and the EU', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize(sizes.phone);
  await expect(
    bottom.getByText('Your work stays private to the people given access', { exact: true }),
  ).toBeVisible();
  await expect(
    bottom.getByText('First routes: Bangladesh to China, Spain and the EU', { exact: true }),
  ).toBeHidden();
});

test('signed out, the footer offers Start a Request, Sign In and the start page', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const actions = footer(page).locator('.guide-footer-actions');
  await expect(actions.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(actions.getByRole('link', { name: 'Sign In', exact: true })).toHaveAttribute(
    'href',
    '/signin',
  );
  await expect(actions).toContainText('Already working with us?');
  await expect(
    actions.getByRole('link', { name: 'Open Your Workspace', exact: true }),
  ).toHaveAttribute('href', '/workspace');
});

test('signed in, the footer opens the workspace and never offers sign-in', async ({ page }) => {
  await signedIn(page);
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const actions = footer(page).locator('.guide-footer-actions');
  const workspace = actions.getByRole('link', { name: 'Open Your Workspace', exact: true });
  // The same place the header offers: the customer account, or the team workspace for a team member. The footer
  // first renders signed out (like the header) and switches once the session answer arrives, so wait for it.
  await expect(workspace).toHaveAttribute('href', /^\/(account|operator)$/);
  await expect(workspace).toBeVisible();
  await expect(footer(page).getByRole('link', { name: /sign in/i })).toHaveCount(0);
  await expect(footer(page).locator('a[href="/signin"]')).toHaveCount(0);
  await expect(actions).not.toContainText('Already working with us?');
  await expect(actions.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
});

test('on a phone Buy Abroad starts open, and each group opens and closes with the keyboard and shows its four links in two columns', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
  // Buy Abroad starts open; the keyboard closes it, so every group is then checked from closed.
  const first = footer(page).locator('details.guide-footer-details').first();
  await expect(first).toHaveAttribute('open', '');
  await expect(first.getByRole('link').first()).toBeVisible();
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first).not.toHaveAttribute('open', '');
  for (const [index, group] of groups.entries()) {
    const details = footer(page).locator('details.guide-footer-details').nth(index);
    const summary = details.locator('summary');
    await expect(summary).toHaveText(group.title);
    expect((await summary.boundingBox())!.height, group.title).toBeGreaterThanOrEqual(51.5);
    await expect(details.getByRole('link').first()).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    const links = details.getByRole('link');
    for (const link of await links.all()) await expect(link).toBeVisible();
    const lefts = await links.evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().left)),
    );
    expect(new Set(lefts).size, `${group.title} in two columns`).toBe(2);
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.getByRole('link').first()).toBeHidden();
  }
});

test('every footer control is at least a 44 px target, at 390 and 1440', async ({ page }) => {
  for (const size of Object.values(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/about');
    // Open every group on a phone so its links are measured too (Buy Abroad is open already).
    for (const details of await footer(page).locator('details.guide-footer-details').all())
      if ((await details.locator('summary').isVisible()) && !(await details.getAttribute('open')))
        await details.locator('summary').click();
    const small = await footer(page)
      .locator('a, summary, button')
      .evaluateAll((items) =>
        items
          .filter((item) => {
            const box = item.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          })
          .filter((item) => {
            const box = item.getBoundingClientRect();
            return box.width < 43.5 || box.height < 43.5;
          })
          .map((item) => item.textContent?.trim()),
      );
    expect(small, `${size.width}px`).toEqual([]);
  }
});

// L14 (owner, 13 November 2026): on a phone the footer with Buy Abroad open was about 1.15 screens tall. It now fits
// one 844 px screen at 390 wide. The groups, their order and Buy Abroad as the largest tile are unchanged; wider
// screens must not grow (their heights before L14: 884 px at 768, 567 px at 1440, with a little room for fonts).
test('at 390 the footer with Buy Abroad open fits one 844 px screen, and 768 and 1440 do not grow', async ({
  page,
}) => {
  const heights: Record<number, number> = {};
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/about');
    await page.evaluate(() => document.fonts.ready);
    if (width === 390)
      await expect(footer(page).locator('details.guide-footer-details').first()).toHaveAttribute(
        'open',
        '',
      );
    heights[width] = (await footer(page).boundingBox())!.height;
  }
  expect(heights[390], 'footer height at 390, Buy Abroad open').toBeLessThanOrEqual(844);
  expect(heights[768], 'footer height at 768').toBeLessThanOrEqual(890);
  expect(heights[1440], 'footer height at 1440').toBeLessThanOrEqual(575);
});

// L14 (owner, 13 November 2026, Meetings page at 1908 x 831): the quiet footer of the signed-in shell (How We Label
// Facts, the copyright, the privacy notice) floated mid-page on a short page. It now sits at the bottom of the window
// with no scrollbar added. The shell only draws it behind the signed-in switch, which the default server leaves off,
// so the case swaps the full footer of a short page (the not-found page) for the quiet one and measures the real
// shell and its real stylesheet. The signed-in pages themselves are covered by the verification suite.
for (const size of [
  { width: 1908, height: 831 },
  { width: 390, height: 844 },
])
  test(`the quiet signed-in footer sits at the bottom of a short page at ${size.width} x ${size.height}, with no scrollbar added`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/this-page-does-not-exist');
    // After hydration, so the page does not put its own footer back.
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const full = document.querySelector('footer.guide-footer')!;
      const quiet = document.createElement('footer');
      quiet.className = 'site-footer';
      quiet.innerHTML =
        '<span><a href="/trust">How We Label Facts</a></span><span>\u00a9 2026 Corridra</span><span><a href="/privacy">Privacy and request notice</a></span>';
      full.replaceWith(quiet);
    });
    const box = await page.locator('footer.site-footer').boundingBox();
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(
      scrollHeight,
      'the page is shorter than the window, so no scrollbar',
    ).toBeLessThanOrEqual(size.height);
    expect(
      box!.y + box!.height,
      'the footer ends at the bottom of the window',
    ).toBeGreaterThanOrEqual(size.height - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    // The page column keeps the width it had (the shell's content width), not the width of its words.
    const widths = await page.evaluate(() =>
      [...document.querySelector('.site-shell')!.children]
        .filter((child) => !['fixed'].includes(getComputedStyle(child).position))
        .map((child) => Math.round(child.getBoundingClientRect().width)),
    );
    expect(new Set(widths).size, `column widths ${widths.join(', ')}`).toBe(1);
  });

test('no sideways scroll at 320, 390, 768 and 1440, with every group open on a phone', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/about']) {
      await page.goto(path);
      for (const details of await footer(page).locator('details').all())
        if (
          (await details.locator('summary').isVisible()) &&
          (await details.getAttribute('open')) === null
        )
          await details.locator('summary').click();
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide, `${path} at ${width}px`).toBe(false);
    }
  }
});

test('keyboard focus is visible on the navy band', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const link = footer(page).getByRole('link', { name: 'About Corridra', exact: true });
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const outline = await link.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
  });
  expect(outline.style).toBe('solid');
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  // White on the navy band (the page's cobalt ring would not show there).
  expect(outline.color).toBe('rgb(255, 255, 255)');
});

for (const [name, size] of Object.entries(sizes))
  test(`the footer has no axe violations at ${name}, with Buy Abroad open on a phone`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/about');
    const result = await new AxeBuilder({ page })
      .include('footer.guide-footer')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
