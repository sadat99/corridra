import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// The Ledger footer (owner decision of 6 November 2026): a full-width navy band with the promise and two actions,
// four link groups of four, the trust legend and one quiet line. On a phone each group is a native disclosure;
// from 701 px every group is open with no tap and one copy of each link. A signed-in person is never offered
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
    title: 'Sell and Expand',
    links: [
      ['Sell in a New Market', '/sell'],
      ['Enter a New Market', '/enter-market'],
      ['Plan a Business Trip', '/business-trips'],
      ['Bangladesh to Spain', '/corridors/bangladesh-spain'],
    ],
  },
  {
    title: 'Groups and Partners',
    links: [
      ['Run a Trade Mission', '/trade-missions'],
      ['For Institutions', '/institutions'],
      ['Join the Corridra Network', '/network'],
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

test('the footer has four groups of four links, each with its exact address, open with no tap on a wide screen', async ({
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
  await expect(workspace).toBeVisible();
  // The same place the header offers: the customer account, or the team workspace for a team member.
  expect(['/account', '/operator']).toContain(await workspace.getAttribute('href'));
  await expect(footer(page).getByRole('link', { name: /sign in/i })).toHaveCount(0);
  await expect(footer(page).locator('a[href="/signin"]')).toHaveCount(0);
  await expect(actions).not.toContainText('Already working with us?');
  await expect(actions.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
});

test('on a phone each group opens and closes with the keyboard and shows its four links in two columns', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
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
    // Open every group on a phone so its links are measured too.
    for (const summary of await footer(page).locator('summary').all())
      if (await summary.isVisible()) await summary.click();
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

test('no sideways scroll at 320, 390, 768 and 1440, with every group open on a phone', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/about']) {
      await page.goto(path);
      for (const summary of await footer(page).locator('summary').all())
        if (await summary.isVisible()) await summary.click();
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
  test(`the footer has no axe violations at ${name}, with a group open on a phone`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/about');
    const summary = footer(page).locator('summary').first();
    if (await summary.isVisible()) await summary.click();
    const result = await new AxeBuilder({ page })
      .include('footer.guide-footer')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
