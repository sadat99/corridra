import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Navigation v1, order 2a (docs/revamp/specs/navigation-v1.md, boards PublicHeader and PublicMobile): the public
// header and the phone menu. Case ids follow the spec's binding conditions: N1 nothing is lost, N2 five at most per
// level, N3 honest features, N5 words, N6 accessibility and size. Q-02 (wave6-quality) covers the home facts strip.
// The old item to new place table is docs/revamp/specs/navigation-v1/public-reachability.md.
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

// Every destination the header reached before navigation v1, then the new ones.
const oldRoutes = ['/', '/how-it-works', '/corridors', '/signin', '/plan'];
const jobs = [
  ['Sell in a new market', '/sell'],
  ['Source products and suppliers', '/source'],
  ['Procure machinery', '/machinery'],
  ['Run a trade mission', '/trade-missions'],
  ['Plan a business trip', '/business-trips'],
  ['Enter a new market', '/enter-market'],
] as const;
const publicPages = [
  '/',
  '/about',
  '/how-it-works',
  '/corridors',
  '/trust',
  '/network',
  '/privacy',
  '/signin',
  '/signup',
  '/plan',
];

const header = (page: Page) => page.locator('header.public-header');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const menu = (page: Page) => page.getByRole('button', { name: /^(Menu|Close)$/ });
const whatWeDo = (page: Page) => nav(page).getByRole('button', { name: 'What we do' });

/** Header controls that run past either edge of the window. */
const headerOutside = (page: Page) =>
  header(page).evaluate((root) => {
    const edge = document.documentElement.clientWidth;
    return Array.from(root.querySelectorAll<HTMLElement>('a[href], button, summary'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > edge + 1 || box.left < -1);
      })
      .map((el) => el.textContent?.trim());
  });

/** Visible header controls smaller than a 44 px target. */
const smallTargets = (page: Page) =>
  header(page).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('a[href], button, summary'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5);
      })
      .map((el) => el.textContent?.trim()),
  );

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('N1 every old header route is still reachable from the wide bar', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  await expect(header(page).getByRole('link', { name: 'Corridra home' })).toHaveAttribute(
    'href',
    '/',
  );
  for (const [name, href] of [
    ['How it works', '/how-it-works'],
    ['Markets', '/corridors'],
    ['Trust', '/trust'],
    ['Sign in', '/signin'],
  ])
    await expect(nav(page).getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  const start = nav(page).getByRole('link', { name: /^Start a Request/ });
  await expect(start).toHaveAttribute('href', '/plan');
  await expect(start).toBeVisible();
  // The old menu toggle and its target keep their hooks; on a wide screen the toggle is not shown.
  await expect(page.locator('#public-navigation')).toBeVisible();
  await expect(page.locator('header .menu-toggle')).toHaveAttribute(
    'aria-controls',
    'public-navigation',
  );
  await expect(page.locator('header .menu-toggle')).toBeHidden();
  const hrefs = await header(page)
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  for (const route of oldRoutes) expect(hrefs, route).toContain(route);
});

test('N1 What we do opens the six jobs, each to its page, and Something else to the request page', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  const panel = page.locator('#public-jobs');
  await expect(panel).toBeHidden();
  await whatWeDo(page).click();
  await expect(whatWeDo(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('What do you need to do?')).toBeVisible();
  for (const [name, href] of jobs) {
    const link = panel.getByRole('link', { name: new RegExp(`^${name}`) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
  }
  await expect(
    panel.getByRole('link', { name: 'Something else? Tell us your business goal' }),
  ).toHaveAttribute('href', '/plan');
  await expect(panel.getByText('No account needed to begin')).toBeVisible();
  await panel.getByRole('link', { name: /^Procure machinery/ }).click();
  await expect(page).toHaveURL('/machinery');
  await expect(page.locator('#public-jobs')).toBeHidden();
});

test('N1 every old header route is reachable from the phone menu, with Sign in and Start a Request in its bar', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
  await expect(nav(page)).toBeHidden();
  await expect(menu(page)).toHaveText('Menu');
  await menu(page).click();
  await expect(menu(page)).toHaveText('Close');
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
  // The sheet opens with What we do expanded.
  await expect(whatWeDo(page)).toHaveAttribute('aria-expanded', 'true');
  for (const [name, href] of jobs)
    await expect(nav(page).getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
      'href',
      href,
    );
  for (const [name, href] of [
    ['How it works', '/how-it-works'],
    ['Markets', '/corridors'],
    ['Trust', '/trust'],
    ['Sign in', '/signin'],
  ]) {
    const link = nav(page).getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
  }
  const start = nav(page).getByRole('link', { name: /^Start a Request/ });
  await expect(start).toHaveAttribute('href', '/plan');
  // Sign in and Start a Request sit side by side in the bar at the foot of the window.
  const signIn = await nav(page).getByRole('link', { name: 'Sign in', exact: true }).boundingBox();
  const startBox = await start.boundingBox();
  expect(Math.abs(signIn!.y - startBox!.y)).toBeLessThan(2);
  expect(startBox!.y + startBox!.height).toBeGreaterThan(sizes.phone.height - 48);
  await expect(header(page).getByRole('link', { name: 'Corridra home' })).toHaveAttribute(
    'href',
    '/',
  );
  await nav(page).getByRole('link', { name: 'Markets', exact: true }).click();
  await expect(page).toHaveURL('/corridors');
  await expect(nav(page)).toBeHidden();
});

test('N1 signed in, the header opens the workspace instead of Sign in, on a wide screen and in the phone menu', async ({
  page,
}) => {
  await page.route('**/api/operator-auth/get-session', (route) =>
    route.fulfill({ json: { user: { id: 'synthetic-user' }, session: { id: 'synthetic' } } }),
  );
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const workspace = nav(page).getByRole('link', { name: 'Team workspace', exact: true });
  await expect(workspace).toHaveAttribute('href', '/operator');
  await expect(workspace).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.setViewportSize(sizes.phone);
  await menu(page).click();
  await expect(workspace).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
});

test('N2 each header level holds five items or fewer', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  const top = await nav(page)
    .locator(':scope > a, :scope > button')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  expect(top).toEqual(['What we do', 'How it works', 'Markets', 'Trust']);
  const actions = nav(page).locator('.public-nav-actions > :is(a, button, details)');
  expect(await actions.count()).toBeLessThanOrEqual(5);
});

test('N3 nothing the boards show that does not work yet is offered: no WhatsApp, Data saver or Español', async ({
  page,
}) => {
  for (const size of Object.values(sizes)) {
    await page.setViewportSize(size);
    await page.goto('/');
    if (await menu(page).isVisible()) await menu(page).click();
    else await whatWeDo(page).click();
    const text = await header(page).innerText();
    for (const word of ['WhatsApp', 'Data saver', 'Español', 'Listen'])
      expect(text, `${word} at ${size.width}`).not.toContain(word);
    // Every link goes somewhere real.
    const hrefs = await header(page)
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.filter((href) => !href.startsWith('/'))).toEqual([]);
  }
});

test('N5 the menu words are the boards words, written as shown, with no text-transform and no em dash', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  await whatWeDo(page).click();
  const found = await header(page).evaluate((root) => ({
    transformed: Array.from(root.querySelectorAll('*'))
      .filter((el) => getComputedStyle(el).textTransform !== 'none')
      .map((el) => el.textContent?.trim()),
    text: (root as HTMLElement).innerText,
  }));
  expect(found.transformed).toEqual([]);
  expect(found.text).not.toContain('—');
  await expect(nav(page).getByRole('link', { name: /^Start a Request/ })).toContainText(
    'Start a Request',
  );
  await page.setViewportSize(sizes.phone);
  await expect(menu(page)).toHaveText('Menu');
  await menu(page).click();
  await expect(menu(page)).toHaveText('Close');
});

test('N6 the current page is marked with aria-current on the wide bar and in the phone menu', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/how-it-works');
  await expect(nav(page).getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav(page).getByRole('link', { name: 'Markets', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/source');
  await whatWeDo(page).click();
  await expect(
    nav(page).getByRole('link', { name: /^Source products and suppliers/ }),
  ).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize(sizes.phone);
  await page.goto('/trust');
  await menu(page).click();
  await expect(nav(page).getByRole('link', { name: 'Trust', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('N6 the phone menu keeps focus inside, makes the page inert, closes on Escape and returns focus to Menu', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/');
  await menu(page).click();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await expect(page.locator('footer.guide-footer')).toHaveAttribute('inert', '');
  // Forty Tabs go round the sheet more than once and never leave the header.
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('header.public-header'))),
      `Tab ${index + 1}`,
    ).toBe(true);
  }
  // Shift+Tab from the first control (the logo) goes to the last (Start a Request), and Tab goes back.
  const home = header(page).getByRole('link', { name: 'Corridra home' });
  await home.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(nav(page).getByRole('link', { name: /^Start a Request/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeFocused();
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(nav(page)).toBeHidden();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('N6 the phone menu closes and the page is usable again when the logo opens the home page', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/about');
  await menu(page).click();
  await header(page).getByRole('link', { name: 'Corridra home' }).click();
  await expect(page).toHaveURL('/');
  await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(nav(page)).toBeHidden();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('N6 the What we do panel closes on Escape and returns focus to its button, and closes on a press outside', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  await whatWeDo(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#public-jobs')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('#public-jobs')).toBeHidden();
  await expect(whatWeDo(page)).toBeFocused();
  await whatWeDo(page).click();
  await expect(page.locator('#public-jobs')).toBeVisible();
  await page.mouse.click(10, 600);
  await expect(page.locator('#public-jobs')).toBeHidden();
  await expect(whatWeDo(page)).toHaveAttribute('aria-expanded', 'false');
});

test('N6 every header control is at least 44 px, with the panel open and with the phone menu open', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/');
  await whatWeDo(page).click();
  expect(await smallTargets(page), '1440').toEqual([]);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    expect(await smallTargets(page), `${width} closed`).toEqual([]);
    await menu(page).click();
    expect(await smallTargets(page), `${width} open`).toEqual([]);
  }
});

test('N6 the help dock stays and Listen is never in the header', async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/');
  await expect(header(page).getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  await expect(header(page).getByRole('button', { name: /listen/i })).toHaveCount(0);
  await page.setViewportSize(sizes.desktop);
  await expect(page.locator('.corner-dock:not(.header-help)')).toBeVisible();
  await expect(header(page).getByRole('button', { name: /listen/i })).toHaveCount(0);
});

for (const [name, size] of Object.entries(sizes))
  test(`N6 the header has no axe violations at ${name}, with the menu or the panel open`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    if (await menu(page).isVisible()) await menu(page).click();
    else await whatWeDo(page).click();
    const result = await new AxeBuilder({ page })
      .include('header.public-header')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });

test('N6 no sideways scroll at 320, 390, 768 and 1440 on every public page, menu closed and open', async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of publicPages) {
      await page.goto(path);
      const wide = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
      expect(await wide(), `${path} at ${width}`).toBe(false);
      if (await menu(page).isVisible()) {
        await menu(page).click();
        expect(await wide(), `${path} at ${width}, menu open`).toBe(false);
        expect(await headerOutside(page), `${path} at ${width}, menu open`).toEqual([]);
      }
    }
  }
});

test('N6 with 200% text the header keeps every control on the screen, closed and open', async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of publicPages) {
      await page.goto(path);
      await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
      expect(await headerOutside(page), `${path} at ${width}`).toEqual([]);
      // Large text moves even a wide window to the Menu layout rather than pushing the bar off the screen.
      await expect(menu(page), `${path} at ${width}`).toBeVisible();
      await menu(page).click();
      expect(await headerOutside(page), `${path} at ${width}, menu open`).toEqual([]);
      await expect(nav(page).getByRole('link', { name: /^Start a Request/ })).toBeInViewport();
    }
  }
});

test('Q-02 the home facts strip reflows at 320, 390, 768, 1280 and 1440 with 200% text, with nothing cut off', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const problems = await page.locator('section.ac1-facts').evaluate((section) => {
      const edge = document.documentElement.clientWidth;
      return Array.from(section.querySelectorAll<HTMLElement>('*'))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          if (box.width === 0) return false;
          // Past the window, or text running out of its own box (which also scrolls the page sideways).
          return box.right > edge + 1 || box.left < -1 || el.scrollWidth > el.clientWidth + 1;
        })
        .filter((el) => el.clientWidth > 0)
        .map((el) => `${el.tagName}.${el.className} ${el.textContent?.trim().slice(0, 30)}`);
    });
    expect(problems, `${width}px`).toEqual([]);
    // Every label and the link to How We Label Facts are still there.
    await expect(page.locator('section.ac1-facts .ac1-truth li')).toHaveCount(4);
    await expect(
      page.locator('section.ac1-facts').getByRole('link', { name: /How We Label Facts/ }),
    ).toBeVisible();
  }
});
