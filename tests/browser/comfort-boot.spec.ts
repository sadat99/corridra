import { test, expect, type Page } from '@playwright/test';

// W7, W10: the saved Text Size, Less Movement and Stronger Colours are put on the page by /language-boot.js before the
// first paint, with no app code needed, are kept in this browser only, and a browser that blocks its storage still
// loads the page. The device's own contrast setting does the same job with no saved choice at all.
const textKey = 'corridra.text-size';
const movementKey = 'corridra.less-movement';
const contrastKey = 'corridra.contrast';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const root = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const durations = Array.from(document.querySelectorAll('body *')).map((el) =>
      Math.max(...getComputedStyle(el).transitionDuration.split(',').map(parseFloat)),
    );
    return {
      fontSize: getComputedStyle(html).fontSize,
      textSize: html.getAttribute('data-text-size'),
      lessMovement: html.getAttribute('data-less-movement'),
      contrast: html.getAttribute('data-contrast'),
      textTwo: getComputedStyle(html).getPropertyValue('--text-2').trim(),
      scrollBehavior: getComputedStyle(html).scrollBehavior,
      longestTransition: Math.max(...durations),
    };
  });

/** Saves the choices, then loads the page again with every app script refused, so only the boot file can act. */
async function loadWithoutApp(page: Page, saved: Record<string, string>) {
  await page.goto('/how-it-works');
  await page.evaluate((values) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, saved);
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
}

test('a saved text size is already in force when the page is parsed, before any app script runs', async ({
  page,
}) => {
  await loadWithoutApp(page, { [textKey]: 'largest' });
  await expect.poll(() => root(page).then((r) => r.fontSize)).toBe('20px');
  expect(await root(page)).toMatchObject({ textSize: 'largest' });
});

test('the large step is 18 px and normal is 16 px with no attribute', async ({ page }) => {
  await loadWithoutApp(page, { [textKey]: 'large' });
  await expect.poll(() => root(page).then((r) => r.fontSize)).toBe('18px');
  await page.unroute('**/_next/static/**/*.js');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/how-it-works');
  expect(await root(page)).toMatchObject({ fontSize: '16px', textSize: null });
});

test('a saved Less Movement is in force before any app script runs: no smooth scrolling, no transition time', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  // Without it the page does scroll smoothly and has transitions, so the checks below can fail.
  expect(await root(page)).toMatchObject({ lessMovement: null, scrollBehavior: 'smooth' });
  expect((await root(page)).longestTransition).toBeGreaterThan(0.001);
  await loadWithoutApp(page, { [movementKey]: 'on' });
  await expect.poll(() => root(page).then((r) => r.scrollBehavior)).toBe('auto');
  const after = await root(page);
  expect(after.lessMovement).toBe('on');
  expect(after.longestTransition).toBeLessThan(0.001);
});

test('a saved Stronger Colours is already in force when the page is parsed, before any app script runs', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  const before = await root(page);
  expect(before.contrast).toBeNull();
  await loadWithoutApp(page, { [contrastKey]: 'more' });
  await expect.poll(() => root(page).then((r) => r.contrast)).toBe('more');
  // The tokens follow the attribute: the secondary text colour is a different, darker colour.
  const after = await root(page);
  expect(after.textTwo).not.toBe('');
  expect(after.textTwo).not.toBe(before.textTwo);
});

test('an old or damaged saved Stronger Colours changes nothing', async ({ page }) => {
  await page.goto('/how-it-works');
  const before = await root(page);
  for (const bad of ['normal', 'on', 'MORE', 'strong'])
    await test.step(`saved ${bad}`, async () => {
      await loadWithoutApp(page, { [contrastKey]: bad });
      expect(await root(page)).toMatchObject({ contrast: null, textTwo: before.textTwo });
      await page.unroute('**/_next/static/**/*.js');
    });
});

test('the device asking for more contrast changes the colours with no saved choice, and stops when it stops asking', async ({
  page,
}) => {
  await page.goto('/how-it-works');
  const before = await root(page);
  await page.emulateMedia({ contrast: 'more' });
  const asked = await root(page);
  expect(asked.contrast).toBeNull();
  expect(asked.textTwo).not.toBe(before.textTwo);
  // The saved choice and the device setting give the very same colours.
  await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'more'));
  expect((await root(page)).textTwo).toBe(asked.textTwo);
  await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
  await page.emulateMedia({ contrast: 'no-preference' });
  expect((await root(page)).textTwo).toBe(before.textTwo);
});

test('an old or damaged saved value is the default', async ({ page }) => {
  await loadWithoutApp(page, { [textKey]: 'enormous', [movementKey]: 'sometimes' });
  await expect.poll(() => root(page).then((r) => r.fontSize)).toBe('16px');
  expect(await root(page)).toMatchObject({ textSize: null, lessMovement: null });
});

test('the choice belongs to one browser: a fresh browser profile starts at Normal', async ({
  page,
  browser,
}) => {
  await loadWithoutApp(page, { [textKey]: 'largest', [movementKey]: 'on' });
  await expect.poll(() => root(page).then((r) => r.textSize)).toBe('largest');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/how-it-works');
  expect(await root(otherPage)).toMatchObject({
    fontSize: '16px',
    textSize: null,
    lessMovement: null,
  });
  await other.close();
});

test('the choices are never sent to a server: no cookie and no request carries them', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('corridra.text-size', 'largest');
    localStorage.setItem('corridra.less-movement', 'on');
    localStorage.setItem('corridra.contrast', 'more');
  });
  const carried: string[] = [];
  page.on('request', (request) => {
    const text = `${request.url()} ${request.postData() ?? ''} ${JSON.stringify(request.headers())}`;
    if (/corridra\.(text-size|less-movement|contrast)|largest/.test(text))
      carried.push(request.url());
  });
  await page.goto('/how-it-works');
  await page.reload();
  expect(carried).toEqual([]);
  expect(JSON.stringify(await context.cookies())).not.toMatch(
    /text-size|less-movement|contrast|largest/,
  );
});

// The home (Two Routes, 17 November 2026) has no Mission Player and nothing that moves by itself, so there is no
// Pause to draw: the page must hold still whatever the Less Movement setting says.
test('nothing on the home moves by itself, with Less Movement saved, cleared or the system setting on', async ({
  page,
}) => {
  const snapshot = () => page.locator('main').innerHTML();
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem('corridra.less-movement', 'on'));
  await page.goto('/');
  await expect(page.locator('.ac1-play, [aria-label*="Pause"]')).toHaveCount(0);
  const saved = await snapshot();
  await page.clock.runFor(30_000);
  expect(await snapshot()).toBe(saved);
  await page.evaluate(() => {
    localStorage.removeItem('corridra.less-movement');
    window.dispatchEvent(new StorageEvent('storage', { key: 'corridra.less-movement' }));
  });
  await page.clock.runFor(30_000);
  expect(await snapshot()).toBe(saved);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(30_000);
  expect(await snapshot()).toBe(saved);
});

test('a browser that blocks its storage still loads the page with no error and the normal size', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A refused request (this server has no sign-in service set up) is not a script error.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(message.text());
  });
  await page.goto('/how-it-works');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await root(page)).toMatchObject({
    fontSize: '16px',
    textSize: null,
    lessMovement: null,
    contrast: null,
  });
  expect(errors).toEqual([]);
});
