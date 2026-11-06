import { test, expect, expectNoForbiddenCopy, evidence } from '../fixtures';
import type { Page } from '@playwright/test';

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
    // On the home page the steps are the step list of the example player (concept G).
    for (const name of ['Define', 'Find', 'Compare', 'Visit', 'Decide', 'Follow through']) {
      // On How it works the steps are in two tabs (layout budget): choose the tab that holds the step.
      if (path === '/how-it-works')
        await page
          .getByRole('tab', {
            name: ['Visit', 'Decide', 'Follow through'].includes(name)
              ? 'Meet and Follow Up'
              : 'Before You Meet',
          })
          .click();
      await expect(steps.getByText(name, { exact: true }).first(), `${path} ${name}`).toBeVisible();
    }
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
  const start = page.getByRole('link', { name: 'Start a Request on This Route', exact: true });
  await expect(start).toHaveAttribute('href', '/plan?companyCountry=BD&marketCode=ES');
  await expect(page.locator('main')).toContainText('buyers and distributors in Spain');
  // The privacy notice opens with a contents list whose links reach their sections (UX-14).
  await page.goto('/privacy');
  const contents = page.getByRole('navigation', { name: 'Contents' });
  // On a narrow screen the contents list is collapsed (layout budget): open it, then count the links.
  const disclosure = page.locator('details.privacy-contents-details');
  if (await disclosure.locator('summary').isVisible()) await disclosure.locator('summary').click();
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
    page.getByRole('main').getByRole('link', { name: 'Start a Request', exact: true }),
  ).toHaveAttribute('href', '/plan');
  await evidence(page, `A-5-${info.project.name}`);
});

// Home concept G (owner, 6 Nov 2026) replaced the scrolling examples row with the Mission Player, whose Previous
// Step and Next Step buttons are the examples' controls at every width. CQ-53 keeps its intent on them: working
// previous and next buttons on narrow screens, 44 px targets, no sideways page scroll.
const currentStep = (page: Page) =>
  page
    .getByRole('article', { name: 'Example missions, not real companies' })
    .locator('li[aria-current="step"]')
    .evaluate((li) => Array.from(li.parentElement?.children ?? []).indexOf(li));

test('CQ-53 the home examples row has working previous and next buttons on narrow screens', async ({
  page,
}, info) => {
  await page.goto('/');
  const next = page.getByRole('button', { name: 'Next Step', exact: true });
  const previous = page.getByRole('button', { name: 'Previous Step', exact: true });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeVisible();
  await expect(previous).toBeVisible();
  for (const control of [next, previous]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  // The first press also stops the player, so the step only moves when a button is pressed.
  await next.click();
  const from = await currentStep(page);
  await next.click();
  await expect.poll(() => currentStep(page)).toBe((from + 1) % 6);
  await previous.click();
  await expect.poll(() => currentStep(page)).toBe(from);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await evidence(page, `CQ-53-${info.project.name}`);
});

// Codex review of PR 311: in a right-to-left page (Arabic preview) Next must still move to the next example step.
test('CQ-53 in a right-to-left page Next still moves to the next example', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('article', { name: 'Example missions, not real companies' })
    .evaluate((el) => el.closest('main')?.setAttribute('dir', 'rtl'));
  const next = page.getByRole('button', { name: 'Next Step', exact: true });
  await next.scrollIntoViewIfNeeded();
  await next.click();
  const from = await currentStep(page);
  await next.click();
  await expect.poll(() => currentStep(page)).toBe((from + 1) % 6);
  await page.getByRole('button', { name: 'Previous Step', exact: true }).click();
  await expect.poll(() => currentStep(page)).toBe(from);
});
