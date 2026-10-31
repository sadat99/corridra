import { test, expect, expectNoForbiddenCopy, evidence } from '../fixtures';

// WS-A public site (program 6.A). A-1: no Appendix B wording on the public pages; A-5: the not found page
// has its own title. The server runs without real use, so the request form is a made-up data panel there and
// is excluded by the shared helper; production (real use) shows the live form wording.
const publicPages = [
  '/',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
  '/plan',
  '/sell',
  '/source',
  '/machinery',
  '/enter-market',
  '/business-trips',
  '/trade-missions',
  '/institutions',
  '/network',
  '/corridors',
  '/corridors/bangladesh-china',
  '/corridors/bangladesh-spain',
  '/corridors/bangladesh-eu',
  '/workspace',
  '/signup',
];

test('A-1 public pages carry no test, sample or invented wording and one main heading', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  for (const path of publicPages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('h1'), path).toHaveCount(1);
    await expectNoForbiddenCopy(page);
  }
  // The six road names appear on the home page and on How it works (D5).
  for (const path of ['/', '/how-it-works']) {
    await page.goto(path);
    const steps = page.locator(path === '/' ? '.ac1-steps' : '#main');
    for (const name of ['Define', 'Find', 'Compare', 'Visit', 'Decide', 'Follow through'])
      await expect(steps.getByText(name, { exact: true }).first(), `${path} ${name}`).toBeVisible();
  }
  // About uses the controller wording from the privacy notice exactly (D4).
  const controller =
    'Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with operations in Gulshan, Dhaka, Bangladesh';
  for (const path of ['/about', '/privacy']) {
    await page.goto(path);
    await expect(page.locator('main'), path).toContainText(controller);
  }
  // Corridor pages: the live button opens the request form on that route (CQ-04).
  await page.goto('/corridors/bangladesh-spain');
  const start = page.getByRole('link', { name: 'Start a request on this route', exact: true });
  await expect(start).toHaveAttribute('href', '/plan?companyCountry=BD&marketCode=ES');
  await expect(page.locator('main')).toContainText('buyers and distributors in Spain');
  // The privacy notice opens with a contents list whose links reach their sections (UX-14).
  await page.goto('/privacy');
  const contents = page.getByRole('navigation', { name: 'Contents' });
  const links = contents.getByRole('link');
  expect(await links.count()).toBeGreaterThanOrEqual(15);
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute('href'))))
    await expect(page.locator(String(href)), String(href)).toHaveCount(1);
  await evidence(page, `A-1-privacy-${info.project.name}`);
});

test('A-5 the not found page has its own title and answers 404', async ({ page }, info) => {
  const response = await page.goto('/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found | Corridra');
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Start a request', exact: true }),
  ).toHaveAttribute('href', '/plan');
  await evidence(page, `A-5-${info.project.name}`);
});

test('CQ-53 the home examples row has working previous and next buttons on narrow screens', async ({
  page,
}, info) => {
  await page.goto('/');
  const next = page.getByRole('button', { name: 'Next example' });
  if ((page.viewportSize()?.width ?? 1280) >= 1120) {
    // Side by side on wide screens: no carousel controls.
    await expect(next).toBeHidden();
    return;
  }
  const row = page.locator('#home-proofs');
  await row.scrollIntoViewIfNeeded();
  await expect(next).toBeVisible();
  const box = await next.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Previous example' }).click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await evidence(page, `CQ-53-${info.project.name}`);
});
