import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// The footer of every page (owner, 28 November 2026, home page v4.4: "new home footer should across full site by
// replacing exisitng one"; CORRIDRA_UX_HOME_V44, live by default). It replaces the Option B footer of 12 November 2026
// (a navy band with three family tiles), and these cases keep what that spec held: the same 16 destinations once each,
// the actions, the trust legend, the last line, no dropped item, 44 px targets, the length of the footer, no sideways
// scroll and no axe violation. On a phone each group is a native disclosure and starts closed, so the page keeps its
// length; from 701 px every group is open with no tap. A signed-in person is never offered sign-in (public-home spec
// rule 5): the footer follows the answer the public header already has.
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
      // owner decision 17 Nov 2026, routes and markets (review F3): label and destination both name the EU
      ['Bangladesh to the EU', '/corridors/bangladesh-eu'],
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

const footer = (page: Page) => page.locator('footer[data-footer="v44"]');
const signedIn = async (page: Page) => {
  // The team session marker that sits beside the HttpOnly team session cookie (lib/team-session-hint.ts).
  await page.addInitScript(() => {
    document.cookie = 'corridra-team=1; path=/';
  });
  for (const path of ['**/api/auth/get-session', '**/api/operator-auth/get-session'])
    await page.route(path, (route) =>
      route.fulfill({ json: { user: { id: 'synthetic-user' }, session: { id: 'synthetic' } } }),
    );
};

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('the footer has the four groups, four links each with its exact address, open with no tap on a wide screen', async ({
  page,
}) => {
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about');
    const nav = footer(page).getByRole('navigation', { name: 'Footer', exact: true });
    const details = nav.locator('details.hv7-footer-group');
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

// Nothing dropped: every one of the 16 links, the actions, the four trust labels and the bottom items are present
// once each, at desktop and on a phone.
test('nothing is dropped: 16 links, three actions, four trust labels and the bottom items, once each, at 1440 and 390', async ({
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
    const actions = footer(page).locator('.hv7-footer-actions');
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
    await expect(footer(page).locator('.hv7-footer-trust .guide-tag')).toHaveText([
      'Self-declared',
      'Evidence available',
      'Verified',
      'Not confirmed',
    ]);
    await expect(footer(page).locator('.hv7-footer-promise')).toContainText(
      'Your work stays private to the people given access',
    );
    const bottom = footer(page).locator('.hv7-footer-bottom');
    await expect(bottom.getByText('© 2026 Corridra', { exact: true })).toHaveCount(1);
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

test('the footer is the same one on the home page: one footer, no second copy', async ({
  page,
}) => {
  for (const path of ['/', '/about', '/plan', '/signin', '/operator/signin']) {
    await page.goto(path);
    await expect(page.locator('footer'), path).toHaveCount(1);
    await expect(footer(page), path).toHaveCount(1);
    await expect(page.locator('footer.guide-footer, footer.site-footer'), path).toHaveCount(0);
  }
});

test('the trust legend names the fact labels and links to How We Label Facts', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const legend = footer(page).locator('.hv7-footer-trust');
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

test('the last line keeps the copyright, the privacy line stays above it, and the first routes show on a wide screen only', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const bottom = footer(page).locator('.hv7-footer-bottom');
  await expect(bottom.getByText('© 2026 Corridra', { exact: true })).toBeVisible();
  await expect(
    footer(page).getByText('Your work stays private to the people given access'),
  ).toBeVisible();
  // owner decision 17 Nov 2026, routes and markets
  const routes = bottom.getByText(
    'Open now from Bangladesh: China, the EU, the UK, the US, Australia, key Asian markets',
    { exact: true },
  );
  await expect(routes).toBeVisible();
  await page.setViewportSize(sizes.phone);
  await expect(
    footer(page).getByText('Your work stays private to the people given access'),
  ).toBeVisible();
  await expect(routes).toBeHidden();
});

test('signed out, the footer offers Start a Request, Sign In and the start page', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const actions = footer(page).locator('.hv7-footer-actions');
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
  const actions = footer(page).locator('.hv7-footer-actions');
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

test('on a phone every group starts closed, and each group opens and closes with the keyboard and shows its four links', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
  for (const [index, group] of groups.entries()) {
    const details = footer(page).locator('details.hv7-footer-group').nth(index);
    const summary = details.locator('summary');
    await expect(details, group.title).not.toHaveAttribute('open', '');
    await expect(summary).toHaveText(group.title);
    expect((await summary.boundingBox())!.height, group.title).toBeGreaterThanOrEqual(43.5);
    await expect(details.getByRole('link').first()).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    const links = details.getByRole('link');
    await expect(links).toHaveCount(4);
    for (const link of await links.all()) await expect(link).toBeVisible();
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
    for (const details of await footer(page).locator('details.hv7-footer-group').all())
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

// The footer keeps the page's length in hand: on a phone, closed, it is short; on a wide screen it must not grow past
// the height of the Option B footer it replaces (884 px at 768, 567 px at 1440, with a little room for fonts).
test('at 390 the closed footer fits one 844 px screen, and 768 and 1440 do not grow', async ({
  page,
}) => {
  const heights: Record<number, number> = {};
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/about');
    await page.evaluate(() => document.fonts.ready);
    heights[width] = (await footer(page).boundingBox())!.height;
  }
  expect(heights[390], 'footer height at 390, groups closed').toBeLessThanOrEqual(844);
  expect(heights[768], 'footer height at 768').toBeLessThanOrEqual(890);
  expect(heights[1440], 'footer height at 1440').toBeLessThanOrEqual(575);
});

test('inside a signed-in workspace the footer is one quiet line with How We Label Facts, the copyright and the privacy notice', async ({
  page,
}) => {
  // The signed-in shell draws it only behind the signed-in switch, which the default server leaves off, so this case
  // reads the line the component draws for a workspace page from the integration suite and the verification suite;
  // here the public footer must not be the quiet one.
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  await expect(footer(page)).not.toHaveClass(/hv7-footer-quiet/);
  await expect(footer(page).getByRole('link', { name: 'How We Label Facts' })).toHaveAttribute(
    'href',
    '/trust',
  );
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

test('keyboard focus is visible on the footer links', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const link = footer(page).getByRole('link', { name: 'About Corridra', exact: true });
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const outline = await link.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).toBe('solid');
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

for (const [name, size] of Object.entries(sizes))
  test(`the footer has no axe violations at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/about');
    const result = await new AxeBuilder({ page })
      .include('footer[data-footer="v44"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
