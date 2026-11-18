import { test, expect, type Page } from '@playwright/test';
import { problems, problemsWithFoldsOpen } from './fit';

// Wave 6 Q-02: with the text at twice its size, the public page bodies fit the window at the four widths people use,
// and nothing is cut off or runs out of its own box. The whole page is measured, header and footer included, so a
// shared band, tab row, card or footer link cannot bring the sideways scroll back on a page this test names.
const pages = ['/', '/how-it-works', '/corridors', '/network', '/trust', '/plan'] as const;
const widths = [320, 390, 768, 1280] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('with 200% text the home, how it works, corridors, network, trust and request pages fit at 320, 390, 768 and 1280', async ({
  page,
}) => {
  test.setTimeout(300_000);
  for (const path of pages) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      // The page's own fonts are wider or narrower than the fallback, so measure only once they are in.
      await page.evaluate(() => document.fonts.ready);
      expect(await problems(page), `${path} at ${width}`).toEqual([]);
      expect(await problemsWithFoldsOpen(page), `${path} at ${width}, every fold open`).toEqual([]);
    }
  }
});

/** Opens the request form on its first step with an empty draft, with the text at twice its size. */
async function openPlanLarge(page: Page) {
  await page.goto('/plan?job=sourcing&companyCountry=BD&marketCode=CN');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.evaluate(() => document.fonts.ready);
}

/** Answers the where, details and results steps, from the where step on, and lands on the contact step. */
async function continueToContact(page: Page) {
  const form = page.locator('form.intake-form');
  await form.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your offer or requirement').fill('Cotton fabric for shirts.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.locator('.guide-options input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(currentWord(page)).toHaveText('Step 5 of 5: Contact');
}

// UI/UX.v4 (owner 18 Nov 2026, "Progress as words"): the step is a line of words, "Step N of M: Name · Next: Name".
const currentWord = (page: Page) => page.locator('.plan-progress-line');

// The request page above is measured on its first step, with the goal cards. Here the form is walked on: the
// attendance row on the where step, and the contact step, whose word sits at the far end of the step bar.
test('with 200% text the request form fits at 320, 390, 768 and 1280 on its where and contact steps', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await openPlanLarge(page);
    await expect(currentWord(page)).toHaveText('Step 1 of 5: Goal · Next: Where');
    await page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }).click();
    await expect(currentWord(page)).toHaveText('Step 2 of 5: Where · Next: Details');
    await expect(page.locator('form.intake-form .guide-options-row .choice')).toHaveCount(3);
    expect(await problems(page), `/plan where step at ${width}`).toEqual([]);
    expect(
      await problemsWithFoldsOpen(page),
      `/plan where step at ${width}, every fold open`,
    ).toEqual([]);
    await continueToContact(page);
    expect(await problems(page), `/plan contact step at ${width}`).toEqual([]);
    expect(
      await problemsWithFoldsOpen(page),
      `/plan contact step at ${width}, every fold open`,
    ).toEqual([]);
  }
});

test('on a 320 px phone with 200% text the progress words fit on the first and last step, and the step list stays for screen readers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openPlanLarge(page);
  const line = currentWord(page);
  const steps = page.locator('ol.sr-only[aria-label="Request steps"]');
  /** The line stays inside the window and wraps instead of pushing the page sideways. */
  const fits = () =>
    line.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5;
    });
  await expect(line).toHaveText('Step 1 of 5: Goal · Next: Where');
  expect(await fits(), 'step 1').toBe(true);
  expect(await problems(page), 'step 1').toEqual([]);
  await page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }).click();
  await continueToContact(page);
  await expect(line).toHaveText('Step 5 of 5: Contact');
  expect(await fits(), 'step 5').toBe(true);
  expect(await problems(page), 'step 5').toEqual([]);
  // Every step stays in the list for screen readers, and the current one is announced.
  await expect(steps.locator('li')).toHaveText(['Goal', 'Where', 'Details', 'Results', 'Contact']);
  await expect(steps.locator('li[aria-current="step"]')).toHaveText('Contact');
});

test('at normal text the phone keeps its two-column phase step, with the heading beside the number', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-it-works');
  const step = page.locator('.guide-phase li').first();
  await expect(step).toBeVisible();
  expect(
    await step.evaluate((li) => getComputedStyle(li).gridTemplateColumns.split(' ')),
  ).toHaveLength(2);
  const number = await step.locator('.guide-step-number').boundingBox();
  const heading = await step.locator('h3').boundingBox();
  expect(heading!.x).toBeGreaterThan(number!.x + number!.width - 1);
});

// At normal text size the home keeps its layout: the two big doors sit side by side from 768 px and stack below it,
// and the closing section keeps its button under its words. (The Mission Player, its caption and the closing band of
// concept G were replaced by Two Routes on 17 November 2026.)
test('at normal text the two big doors sit side by side from 768 px and stack below it', async ({
  page,
}) => {
  for (const [width, columns] of [
    [320, 1],
    [390, 1],
    [768, 2],
    [1024, 2],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const found = await page
      .locator('.tr-doors-big')
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(found, `${width}px`).toBe(columns);
  }
});
