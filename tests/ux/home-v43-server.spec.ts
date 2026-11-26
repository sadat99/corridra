import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Home page v4.3 with CORRIDRA_UX_HOME_V43 exactly "true", as the server sends it (owner, 26 Nov 2026, via the
// Guardian: "update as per attachment 100% correctly"). The switch is read when the page is built, and the shared UX
// server is built with it unset, so this spec builds the switch-on app beside it (`.next/home-v43`, through
// CORRIDRA_NEXT_DIST_DIR) and serves that build on its own port, with V42 on as well to show that V43 wins. It checks
// what the layout and Next.js decide: the server HTML and its stylesheet, the header and footer props, the hero image
// route, reading and starting a request with no script, links from other pages into the home with reveal before focus,
// Arabic and Bangla, the old #mission-example address and the dossier at /corridors. The width, zoom and widget matrix
// is in home-v43.spec.ts on the shared build. The Talk number is set here so the link exists.
const web = resolve('apps/web');
const distDir = '.next/home-v43';
const port = 3192;
const origin = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('pnpm', ['exec', 'next', ...args], { cwd: web, env, stdio: 'inherit' });
  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) throw new Error(`next ${args.join(' ')} exited ${code}`);
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  // HOME_V43_REUSE=1: a switch-on server for this build is already listening on the port (a local shortcut).
  if (process.env.HOME_V43_REUSE === '1') return;
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    CORRIDRA_UX_HOME_V42: 'true',
    CORRIDRA_UX_HOME_V43: 'true',
    CORRIDRA_NEXT_DIST_DIR: distDir,
    CORRIDRA_LANGUAGES_REVIEWED: 'ar,bn',
    CORRIDRA_LANGUAGES_PAGES: 'ar,bn',
    CORRIDRA_SUPPORT_WHATSAPP_NUMBER: '+8801700000000',
  };
  // `next build` adds its output's type folder to the app's tsconfig.json; that file is tracked, so it is put back.
  const tsconfig = resolve(web, 'tsconfig.json');
  const kept = readFileSync(tsconfig, 'utf8');
  try {
    await run(['build'], env);
  } finally {
    writeFileSync(tsconfig, kept);
  }
  server = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', `${port}`],
    { cwd: web, env, stdio: 'ignore' },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(origin + '/')).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the switch-on server did not start');
    await new Promise((done) => setTimeout(done, 500));
  }
});
test.afterAll(() => {
  server?.kill();
});

const at = (path: string) => origin + path;
const active = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sixteen = [
  '/source',
  '/machinery',
  '/corridors/bangladesh-china',
  '/corridors#mission-example',
  '/trade-missions',
  '/business-trips',
  '/institutions',
  '/network',
  '/sell',
  '/enter-market',
  '/corridors/bangladesh-eu',
  '/corridors',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
];
const jobPages = [
  '/sell',
  '/source',
  '/machinery',
  '/trade-missions',
  '/business-trips',
  '/enter-market',
];

test('the server HTML holds the v4.3 home, the Solutions header and the pack footer, and links their stylesheet', async ({
  request,
}) => {
  const response = await request.get(at('/'));
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  // V43 wins over V42: the composition itself, not a placeholder.
  expect(main).toMatch(/class="[^"]*\bhv43/);
  expect(main).not.toMatch(/class="[^"]*\bhv42 (?!hv43)/);
  expect(main).toContain('<h1 id="home-title">');
  expect(main).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
  expect(main).toContain('<noscript>');
  expect(main).toContain('id="home-start"');
  expect(main).toContain('action="/plan"');
  // The header and footer props reached the server HTML (no script run).
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  expect(header).toContain('data-v43="true"');
  expect(header).toContain('>Solutions<');
  expect(header).not.toContain('What We Do');
  for (const id of ['service-source', 'service-sell', 'service-delegation', 'inbound'])
    expect(header).toContain(`href="/#${id}"`);
  for (const href of jobPages) expect(header).toContain(`href="${href}"`);
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  expect(footer).toContain('guide-footer-pack');
  const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
  const css = await Promise.all(
    sheets.map(async (sheet) => (await request.get(new URL(sheet, origin).href)).text()),
  );
  for (const rule of ['.hv43', 'data-v43', '.gfp-'])
    expect(
      css.some((text) => text.includes(rule)),
      `a stylesheet linked from the server HTML holds ${rule}`,
    ).toBe(true);
});

test('the hero image answers through the Next.js image route', async ({ request }) => {
  const html = await (await request.get(at('/'))).text();
  const hero = html.match(/<img[^>]+>/g)?.find((tag) => tag.includes('corridra-industrial-hero'));
  expect(hero).toBeDefined();
  expect(hero).toContain('alt=""');
  expect(hero).toContain('fetchPriority="high"');
  const src = hero!.match(/ src="([^"]+)"/)![1]!.replaceAll('&amp;', '&');
  expect(src).toContain('/_next/image?url=%2Fcorridra-industrial-hero.webp');
  const image = await request.get(at(src));
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toMatch(/^image\//);
});

test('with no script the page reads, the doors and the request form are native, and a request starts', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(at('/'));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('business partners.');
  await expect(page.locator('input[type="radio"][name="home-route"]')).toHaveCount(4);
  await expect(page.locator('#home-start')).toHaveAttribute('href', '/plan?job=sourcing');
  // The hero action is a plain in-page link to the route choice.
  await expect(page.locator('#hero a[href="#start"]')).toBeVisible();
  // The China example is written out inside the noscript block.
  await expect(page.locator('main noscript')).not.toHaveCount(0);
  // The request form is a real GET form to /plan with named fields.
  const form = page.locator('form[action="/plan"]');
  await expect(form).toHaveAttribute('method', 'get');
  await form.locator('[name="note"]').fill('Steel fittings, 20 tonnes a month');
  await form.locator('#brief-start').click();
  await expect(page).toHaveURL(/\/plan\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('note')).toBe('Steel fittings, 20 tonnes a month');
  expect(url.searchParams.get('job')).toBe('sourcing');
  expect(url.searchParams.get('companyCountry')).toBe('BD');
  expect(url.searchParams.get('marketCode')).toBe('CN');
  await context.close();
});

test('with no script the Solutions links in the header are plain links to the home sections', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/trust'));
  const hrefs = await page
    .locator('header a[href^="/#"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(hrefs).toEqual(
    expect.arrayContaining([
      '/#service-source',
      '/#service-sell',
      '/#service-delegation',
      '/#inbound',
    ]),
  );
  await context.close();
});

test('the Talk link shows where the number is set and goes to WhatsApp', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/'));
  const talk = page.locator('main a[href^="https://wa.me/"]');
  await expect(talk.first()).toBeVisible();
  expect(await talk.count()).toBeGreaterThan(0);
  for (const href of await talk.evaluateAll((links) => links.map((l) => l.getAttribute('href'))))
    expect(href).toBe('https://wa.me/8801700000000');
});

// ---- the header ----------------------------------------------------------------------------------------------------

const solutions = (page: Page) => page.locator('header button[aria-controls="public-jobs"]');
const panel = (page: Page) => page.locator('#public-jobs');

test('wide header: Solutions opens four rows and the six job pages, Escape returns focus, a press outside closes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/about'));
  await expect(solutions(page)).toHaveText('Solutions');
  await expect(solutions(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeHidden();
  await solutions(page).focus();
  await page.keyboard.press('Enter');
  await expect(solutions(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toBeVisible();
  const rows = panel(page).locator('> ul > li > a');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Source From');
  await expect(rows.nth(0)).toContainText('China');
  await expect(rows.nth(0)).toContainText('Suppliers, machinery and factory visits');
  await expect(rows.nth(1)).toContainText('Sell Abroad');
  await expect(rows.nth(2)).toContainText('Organise a Delegation');
  await expect(rows.nth(3)).toContainText('Do Business in');
  await expect(rows.nth(3)).toContainText('Bangladesh');
  expect(await rows.evaluateAll((links) => links.map((l) => l.getAttribute('href')))).toEqual([
    '/#service-source',
    '/#service-sell',
    '/#service-delegation',
    '/#inbound',
  ]);
  // The six job pages are one step down, under More Ways to Work, with the existing "Something else?" link.
  const more = panel(page).locator('details.public-more');
  await more.locator('summary').click();
  expect(
    await more.locator('ul a').evaluateAll((links) => links.map((l) => l.getAttribute('href'))),
  ).toEqual(expect.arrayContaining(jobPages));
  await expect(more.locator('ul a')).toHaveCount(6);
  await expect(more.locator('a[href="/plan"]')).toHaveCount(1);
  // Escape closes the panel and returns focus to Solutions, from inside the panel too.
  await rows.nth(1).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(solutions(page)).toBeFocused();
  // A press outside closes it.
  await solutions(page).click();
  await expect(panel(page)).toBeVisible();
  await page
    .locator('h1')
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(panel(page)).toBeHidden();
  // The bar order: Solutions, How It Works, Markets, Trust, then Sign In and Start a Request.
  const bar = page.locator('header .public-nav > :is(button, a)');
  await expect(bar.nth(0)).toHaveText('Solutions');
  await expect(bar.nth(1)).toHaveText('How It Works');
  await expect(bar.nth(2)).toHaveText('Markets');
  await expect(bar.nth(3)).toHaveText('Trust');
  await expect(page.locator('header a.nav-cta')).toHaveAttribute('href', '/plan');
  await expect(page.locator('header .public-nav-faq')).toBeHidden();
});

test('from another page a Solutions row lands on the home section and focuses it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [from, name, id] of [
    ['/sell', 'Sell Abroad', 'service-sell'],
    ['/trust', 'Organise a Delegation', 'service-delegation'],
    ['/corridors', 'Do Business in', 'inbound'],
  ] as const) {
    await page.goto(at(from));
    await solutions(page).click();
    await panel(page)
      .getByRole('link', { name: new RegExp(name) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/#${id}$`));
    await expect.poll(() => active(page)).toBe(id);
    await expect(page.locator(`#${id}`)).toBeInViewport();
    await expect(panel(page)).toBeHidden();
  }
});

test('on the home page a menu link closes the menu, opens a collapsed target first, then focuses it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/'));
  // The page listens for the request once its chunk has loaded and hydrated.
  await page.waitForLoadState('networkidle');
  // A target inside a closed disclosure: the question list's second block is closed on load.
  await expect(page.locator('details:has(#faq)')).not.toHaveAttribute('open', '');
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('corridra:anchor', { detail: { id: 'faq' } })),
  );
  await expect(page.locator('details:has(#faq)')).toHaveAttribute('open', '');
  await expect.poll(() => active(page)).toBe('faq');
  // A target inside the long route block, which is not drawn until it is asked for.
  await expect(page.locator('#route-delegation')).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('corridra:anchor', { detail: { id: 'route-delegation' } }),
    ),
  );
  await expect(page.locator('#route-delegation')).toHaveCount(1);
  await expect.poll(() => active(page)).toBe('route-delegation');
  // A header row on the home page itself.
  await solutions(page).click();
  await panel(page)
    .getByRole('link', { name: /Sell Abroad/ })
    .click();
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => active(page)).toBe('service-sell');
  await expect(page.locator('#service-sell')).toBeInViewport();
});

test('a link with a hash opens what hides it before it takes focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of ['route-sell', 'faq', 'questions', 'markets', 'inbound']) {
    await page.goto(at(`/#${id}`));
    await expect.poll(() => active(page), id).toBe(id);
  }
});

test('phone header: 60 px and solid, the sheet shows Solutions, the job pages one step down, FAQs, Sign In and Start a Request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(at('/'));
  const header = page.locator('header.public-header');
  expect((await header.boundingBox())!.height).toBe(60);
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(150);
  const sticky = await header.boundingBox();
  expect(sticky!.y).toBe(0);
  expect(sticky!.height).toBe(60);
  expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(
    /rgba\(.*, 0\)/,
  );
  const menu = page.locator('button.menu-toggle');
  await menu.click();
  const nav = page.locator('#public-navigation');
  await expect(nav).toBeVisible();
  await expect(panel(page).locator('.public-sol-label')).toHaveText('Solutions');
  const rows = panel(page).locator('> ul > li > a');
  await expect(rows).toHaveCount(4);
  // Titles only in the sheet.
  await expect(panel(page).locator('.public-job-line').first()).toBeHidden();
  await expect(panel(page).locator('details.public-more')).not.toHaveAttribute('open', '');
  const order = await nav.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('a, summary, button')]
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
  const index = (label: string) => order.findIndex((text) => text.startsWith(label));
  expect(index('Source From')).toBeLessThan(index('More Ways to Work'));
  expect(index('More Ways to Work')).toBeLessThan(index('How It Works'));
  expect(index('How It Works')).toBeLessThan(index('Markets'));
  expect(index('Markets')).toBeLessThan(index('Trust'));
  expect(index('Trust')).toBeLessThan(index('FAQs'));
  expect(index('FAQs')).toBeLessThan(index('Sign In'));
  expect(index('Sign In')).toBeLessThan(index('Start a Request'));
  expect(index('Start a Request')).toBeLessThan(index('Help'));
  // Escape closes the sheet and returns focus to the Menu button; Tab stays inside while it is open.
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('header'))).toBe(true);
  // A row closes the sheet and focuses the section.
  await rows.nth(1).click();
  await expect(nav).toBeHidden();
  await expect.poll(() => active(page)).toBe('service-sell');
});

test('phone sheet at 320 wide with text at 200 per cent keeps Start a Request in reach and never scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(at('/about'));
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.locator('button.menu-toggle').click();
  await expect(page.locator('#public-navigation')).toBeVisible();
  expect(await noSideways(page)).toBe(0);
  await expect(page.locator('header a.nav-cta')).toBeInViewport();
});

test('the request page keeps its header and its compact footer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/plan'));
  await expect(page.locator('header .public-nav-what')).toHaveText('What We Do');
  await expect(page.locator('header[data-v43]')).toHaveCount(0);
  await expect(page.locator('footer.guide-footer-compact')).toHaveCount(1);
  await expect(page.locator('footer.guide-footer-pack')).toHaveCount(0);
  await expect(page.locator('footer a[href="/signin"]')).toHaveCount(1);
});

// ---- the footer ----------------------------------------------------------------------------------------------------

test('the pack footer: four groups, the sixteen destinations once each, the Bangladesh guide in the legal row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/about'));
  const footer = page.locator('footer.guide-footer-pack');
  await expect(footer).toBeVisible();
  for (const title of ['Solutions', 'Explore', 'Already working with us?'])
    await expect(footer.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const hrefs = await footer
    .locator('a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  for (const href of sixteen)
    expect(
      hrefs.filter((h) => h === href),
      href,
    ).toHaveLength(1);
  for (const href of [
    '/#service-source',
    '/#service-sell',
    '/#service-delegation',
    '/#inbound',
    '/#questions',
  ])
    expect(
      hrefs.filter((h) => h === href),
      href,
    ).toHaveLength(1);
  expect(hrefs).toEqual(
    expect.arrayContaining(['/account', '/operator', '/contributor', '/workspace']),
  );
  const legal = footer.locator('.gfp-legal');
  await expect(legal.locator('a[href="/corridors/bangladesh-china"]')).toContainText('Guide');
  await expect(legal.locator('a[href="/privacy"]')).toHaveCount(1);
  await expect(legal.locator('.lang-switcher')).toBeVisible();
  await expect(legal.locator('.guide-footer-copy')).toHaveText('© 2026 Corridra');
  await expect(footer).toContainText('Suppliers and programme members can use the private link');
  // Wide: every group is open without a tap and the three columns fit the page.
  expect(await noSideways(page)).toBe(0);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await noSideways(page), String(width)).toBe(0);
  }
});

test('the footer on a phone folds Explore, keeps Solutions open and every link is a 44 px target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(at('/about'));
  const groups = page.locator('footer.guide-footer-pack details.gfp-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('open', '');
  await expect(groups.nth(1)).not.toHaveAttribute('open', '');
  await groups.nth(1).locator('summary').click();
  await expect(groups.nth(1)).toHaveAttribute('open', '');
  const small = await page.locator('footer.guide-footer-pack a').evaluateAll((links) =>
    links
      .filter((link) => link.getClientRects().length > 0)
      .map((link) => ({
        href: link.getAttribute('href'),
        height: link.getBoundingClientRect().height,
      }))
      .filter((link) => link.height < 43.5),
  );
  expect(small).toEqual([]);
});

test('signed in, the footer offers the workspace and never a sign-in row', async ({ page }) => {
  await page.addInitScript(() => {
    document.cookie = 'corridra-team=1; path=/';
  });
  for (const path of ['**/api/auth/get-session', '**/api/operator-auth/get-session'])
    await page.route(path, (route) =>
      route.fulfill({ json: { user: { id: 'synthetic-user' }, session: { id: 'synthetic' } } }),
    );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/about'));
  const access = page.locator('footer.guide-footer-pack .gfp-access');
  await expect(
    access.getByRole('link', { name: 'Open Your Workspace', exact: true }),
  ).toHaveAttribute('href', /^\/(account|operator)$/);
  await expect(access.locator('a[href="/contributor"], a[href="/signin"]')).toHaveCount(0);
});

// ---- other languages -----------------------------------------------------------------------------------------------

for (const [code, dir] of [
  ['ar', 'rtl'],
  ['bn', 'ltr'],
] as const) {
  test(`in ${code} the page keeps lang and dir, shows English for words that are not translated, has no sideways scroll and no axe violation`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at('/'));
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    // The v4.3 words are English only: an untranslated word shows English, never a blank.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('business partners.');
    expect(await page.locator('main').innerText()).not.toMatch(/home\.v43\./);
    await expect(solutions(page).or(page.locator('button.menu-toggle')).first()).toBeVisible();
    // 200 per cent text, then the reading check.
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    expect(await noSideways(page)).toBe(0);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    // The footer keeps its language switcher with the Bangla option.
    await page.goto(at('/about'));
    await page.locator('footer .lang-switcher > summary').click();
    await expect(page.locator('footer .lang-switcher button[lang="bn"]')).toBeVisible();
  });
}

test('in Arabic the open Solutions panel and the sheet mirror', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corridra.language', 'ar'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/about'));
  await solutions(page).click();
  // English words on an Arabic page are islands that keep their own order beside the Arabic place name.
  const title = panel(page).locator('.public-job-title').first();
  await expect(title).toHaveAttribute('lang', 'en');
  await expect(title).toHaveAttribute('dir', 'ltr');
  const box = await panel(page).boundingBox();
  const button = await solutions(page).boundingBox();
  // In a right-to-left page the panel hangs from the button's right edge side, never off the screen.
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(button!.x + button!.width).toBeGreaterThan(720);
});

// ---- /corridors -------------------------------------------------------------------------------------------------

test('the old #mission-example address on the home page still redirects to /corridors#mission-example', async ({
  page,
}) => {
  await page.goto(at('/#mission-example'));
  await expect(page).toHaveURL(/\/corridors#mission-example$/);
  await expect(page.locator('#mission-example')).toBeVisible();
});

test('the sample counterparty dossier opens inside the sample mission, toggles and resets, and sends nothing', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/corridors#mission-example'));
  const dossier = page.locator('#mission-example section.ux-dossier');
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText('Sample data');
  await expect(dossier).toContainText('Potential Fit');
  await expect(dossier).toContainText('Self-declared');
  await expect(dossier).toContainText('Next Action');
  page.on('request', (request) => {
    if (request.method() !== 'GET' || /\/api\//.test(request.url())) requests.push(request.url());
  });
  const save = dossier.getByRole('button', { name: 'Save to Shortlist' });
  await save.click();
  await expect(dossier.getByRole('button', { name: 'Remove from Shortlist' })).toBeVisible();
  await expect(dossier.getByRole('status')).toContainText('Kept on this page only');
  await dossier.getByRole('button', { name: 'Remove from Shortlist' }).click();
  await expect(save).toBeVisible();
  // The market choice changes the prefilled request link (a valid pair, then none for Key Asian Markets).
  const request = dossier.getByRole('link', { name: 'Start a Request for This Route' });
  await expect(request).toHaveAttribute(
    'href',
    '/plan?job=sourcing&companyCountry=BD&marketCode=CN',
  );
  await dossier.getByRole('group', { name: 'Market' }).getByRole('button', { name: /EU/ }).click();
  await expect(request).toHaveAttribute('href', '/plan?job=buyers&companyCountry=BD&marketCode=EU');
  await dossier
    .getByRole('group', { name: 'Market' })
    .getByRole('button', { name: /Key Asian Markets/ })
    .click();
  await expect(request).toHaveAttribute('href', '/plan?job=buyers');
  // Reload: the shortlist is gone.
  await save.click();
  await page.reload();
  await expect(dossier.getByRole('button', { name: 'Save to Shortlist' })).toBeVisible();
  expect(requests).toEqual([]);
  // A visible way back to the home markets section, which takes focus there.
  await dossier.getByRole('link', { name: 'Back to the Markets Section' }).click();
  await expect(page).toHaveURL(/\/#markets$/);
  await expect.poll(() => active(page)).toBe('markets');
});

test('the request page accepts a link with a valid pair and ignores one with an invalid pair', async ({
  browser,
}) => {
  // A fresh browser context for each link: the form remembers earlier answers from the same tab.
  const cases = [
    ['/plan?job=sourcing&companyCountry=BD&marketCode=CN', 'BD', 'CN'],
    // A region and an undecided place are not countries, so the pair is ignored and nothing breaks.
    ['/plan?job=sourcing&companyCountry=OTHER&marketCode=REGION', '', ''],
    // Half a pair is ignored too.
    ['/plan?job=sourcing&companyCountry=BD', '', ''],
  ] as const;
  for (const [path, company, market] of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(at(path));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The Where step holds the pair; its two fields are on the page once the form reaches it.
    await page
      .getByRole('button', { name: /^(Continue|Next)/ })
      .first()
      .click();
    await expect(page.getByText('Where is the company based?')).toBeVisible();
    const value = (name: string) =>
      page
        .locator(`input[name="${name}"]`)
        .inputValue()
        .catch(() => '');
    expect(await value('companyCountry'), path).toBe(company);
    expect(await value('marketCode'), path).toBe(market);
    await context.close();
  }
});
