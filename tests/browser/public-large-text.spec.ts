import { test, expect, type Page } from '@playwright/test';
import { problems } from './fit';

// Wave 6 Q-02: with the text at twice its size, the public page bodies fit the window at the four widths people use,
// and nothing is cut off or runs out of its own box. The whole page is measured, header and footer included, so a
// shared band, tab row, card or footer link cannot bring the sideways scroll back on a page this test names.
const pages = ['/', '/how-it-works', '/corridors', '/network', '/trust', '/plan'] as const;
const widths = [320, 390, 768, 1280] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

/** What does not fit with every closed fold on the page opened; the folds that were closed are closed again after. */
async function problemsWithFoldsOpen(page: Page) {
  const closed = await page.evaluateHandle(() => {
    const folds = Array.from(document.querySelectorAll('details')).filter((fold) => !fold.open);
    for (const fold of folds) fold.open = true;
    return folds;
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
  const stillClosed = await page.locator('details:not([open])').count();
  const found = await problems(page);
  await page.evaluate((folds) => {
    for (const fold of folds) fold.open = false;
  }, closed);
  await closed.dispose();
  return stillClosed > 0 ? [`${stillClosed} fold(s) did not open`, ...found] : found;
}

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
  await expect(currentWord(page)).toHaveText('Contact');
}

const currentWord = (page: Page) => page.locator('.guide-journey-bar li[aria-current="step"] b');

// The request page above is measured on its first step, with the goal cards. Here the form is walked on: the
// attendance row on the where step, and the contact step, whose word sits at the far end of the step bar.
test('with 200% text the request form fits at 320, 390, 768 and 1280 on its where and contact steps', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await openPlanLarge(page);
    await expect(currentWord(page)).toHaveText('Goal');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(currentWord(page)).toHaveText('Where');
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

test('on a 320 px phone with 200% text the current step word has its own line under the dots on the first and last step', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openPlanLarge(page);
  const bar = page.locator('.guide-journey-bar');
  await expect(bar).toHaveAttribute('aria-label', 'Request steps');
  /** Where the current word sits: from the bar's start edge, inside the bar, below the dots; connectors hidden. */
  const place = () =>
    bar.evaluate((list) => {
      const box = list.getBoundingClientRect();
      const word = list.querySelector('li[aria-current="step"] b')!.getBoundingClientRect();
      const dots = Array.from(list.querySelectorAll('span')).map((dot) =>
        dot.getBoundingClientRect(),
      );
      return {
        startGap: Math.round(word.left - box.left),
        inside: word.right <= box.right + 0.5 && word.bottom <= box.bottom + 0.5,
        belowDots: word.top >= Math.max(...dots.map((dot) => dot.bottom)) - 0.5,
        connector: getComputedStyle(list.querySelector('li')!, '::after').display,
      };
    });
  const compact = { startGap: 0, inside: true, belowDots: true, connector: 'none' };
  await expect(currentWord(page)).toHaveText('Goal');
  expect(await place(), 'step 1').toEqual(compact);
  expect(await problems(page), 'step 1').toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await continueToContact(page);
  expect(await place(), 'step 5').toEqual(compact);
  expect(await problems(page), 'step 5').toEqual([]);
  // Every word stays in the list for screen readers; only the current one shows.
  await expect(bar.locator('li b')).toHaveText(['Goal', 'Where', 'Details', 'Results', 'Contact']);
  await expect(bar.locator('li[aria-current="step"] span')).toHaveText('5');
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

// At normal text size these parts of the page keep the layout they had before the large-text fixes. The player's
// request fields stay two columns wide, the caption keeps its controls beside its words, the closing band keeps its
// words and its button side by side, and the phone keeps its two-column phase step (above).
test('at normal text the player fields stay two columns wide at every width', async ({ page }) => {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const columns = await page
      .locator('.ac1-fields')
      .first()
      .evaluate((dl) => getComputedStyle(dl).gridTemplateColumns.split(' ').length);
    expect(columns, `${width}px`).toBe(2);
  }
});

test('at normal text the player caption keeps its controls beside its words', async ({ page }) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const words = await page.locator('.ac1-player-caption p').first().boundingBox();
    const controls = await page.locator('.ac1-player-controls').first().boundingBox();
    // Same row: the controls start within the height of the words, and to the right of them.
    expect(controls!.y, `${width}px`).toBeLessThan(words!.y + words!.height);
    expect(controls!.x, `${width}px`).toBeGreaterThan(words!.x + words!.width - 1);
  }
});

test('at normal text the closing band keeps its words and its button side by side', async ({
  page,
}) => {
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const text = await page.locator('.guide-band h2').first().boundingBox();
    const button = await page.locator('.guide-band .primary-link').first().boundingBox();
    expect(button!.x, `${width}px`).toBeGreaterThan(text!.x + text!.width - 1);
    expect(button!.y, `${width}px`).toBeLessThan(text!.y + text!.height + 120);
  }
});
