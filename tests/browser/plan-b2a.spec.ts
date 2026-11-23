import { expect, test, type Page } from '@playwright/test';

// B2a plan flow (owner decisions of 23 November 2026): no "draft" wording, Clear Answers with a confirm step, a
// summary that never covers the receipt check, one translated step line, one "(required)" marker and an error
// banner that follows the fields. Selectors come from apps/web/app/plan/intake.tsx and plan-progress.tsx.

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const answers = {
  companyCountry: 'BD',
  marketCode: 'CN',
  market: 'China',
  job: 'sourcing',
  objective: 'Source suppliers',
  whenNeeded: 'Within three months',
  attendance: 'No',
  offer: 'Cotton knit T-shirts, 180 gsm, for retail',
  parameters: 'Sizes S to XL, combed cotton, reactive dye',
  outcomes: ['Qualified conversations'],
  name: 'Sample Person',
  company: 'Sample Company',
  email: 'person@example.com',
};

// Each call seeds once: init scripts pile up on a page and run in order on every load, so a later call must win
// over an earlier one, and a reload must not put the answers back after the form cleared them.
let seeds = 0;

/** Opens /plan with answers already saved in this tab, on the given step (0 to 4). */
async function openSaved(page: Page, step: number, draft: Record<string, unknown> = answers) {
  seeds += 1;
  await page.addInitScript(
    ([saved, at, seed]) => {
      if (Number(sessionStorage.getItem('b2a-test-seed') ?? 0) >= seed) return;
      sessionStorage.setItem('b2a-test-seed', String(seed));
      sessionStorage.setItem(
        'corridra-mission-draft',
        JSON.stringify({
          version: 2,
          draft: saved,
          step: at,
          key: 'b2a-test-key',
          at: Date.now(),
        }),
      );
    },
    [draft, step, seeds] as const,
  );
  await page.goto('/plan');
  await expect(page.locator('.plan-progress-line')).toContainText(`Step ${step + 1} of 5`);
}

const mainText = (page: Page) => page.locator('#main').evaluate((main) => main.textContent ?? '');

test('D-001 no step of the request form says draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const step of [0, 1, 2, 3, 4]) {
    await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
    await openSaved(page, step);
    expect(await mainText(page), `step ${step + 1}`).not.toMatch(/draft/i);
  }
  await expect(page.locator('.ux-draft-notice')).toHaveText(
    'Your earlier answers from this tab are back. Your saved choices take precedence over link suggestions.',
  );
});

test('D-001 the notices for answers that could not be brought back do not say draft', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('corridra-mission-draft', '{broken'));
  await page.goto('/plan');
  await expect(page.locator('.ux-draft-notice')).toBeVisible();
  expect(await mainText(page)).not.toMatch(/draft/i);
  await page.addInitScript(() =>
    sessionStorage.setItem('corridra-mission-draft', JSON.stringify({ at: 1, key: 'old' })),
  );
  await page.goto('/plan');
  await expect(page.locator('.ux-draft-notice')).toBeVisible();
  expect(await mainText(page)).not.toMatch(/draft/i);
});

test('D-009 Clear Answers asks first, Cancel keeps the answers and only the confirm clears', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSaved(page, 1);
  await expect(page.getByRole('button', { name: 'Clear Draft' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear Answers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear your answers?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This removes everything you entered in this tab.');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.plan-progress-line')).toHaveText(
    'Step 2 of 5: Where · Next: Details',
  );
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('corridra-mission-draft') ?? '{}').draft?.offer,
    ),
  ).toBe(answers.offer);
  await page.getByRole('button', { name: 'Clear Answers', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear Answers', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.plan-progress-line')).toHaveText('Step 1 of 5: Goal · Next: Where');
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('corridra-mission-draft') ?? '{}').draft?.offer,
    ),
  ).toBe('');
});

test('D-009 Escape closes the confirm step without clearing, and focus returns to Clear Answers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSaved(page, 1);
  const clear = page.getByRole('button', { name: 'Clear Answers', exact: true });
  await clear.click();
  const dialog = page.getByRole('dialog', { name: 'Clear your answers?' });
  await expect(dialog).toBeVisible();
  // The close button carries the form's own word. This build offers English only; the six translated words are
  // checked in tests/integration/plan-b2a.test.ts and, in German, in tests/operator/ux-plan-languages.spec.ts.
  await expect(dialog.locator('.ux-dialog-close')).toHaveText('Close');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(clear).toBeFocused();
  await expect(page.locator('.plan-progress-line')).toHaveText(
    'Step 2 of 5: Where · Next: Details',
  );
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('corridra-mission-draft') ?? '{}').draft?.offer,
    ),
  ).toBe(answers.offer);
});

for (const size of [
  { width: 1280, height: 537 },
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
])
  test(`D-006 the summary never covers the receipt check at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openSaved(page, 2);
    await expect(page.locator('.ux-brief-summary')).toBeVisible();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += 40) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const overlap = await page.evaluate(() => {
        // The sticky summary box a person sees, against the receipt check, at every scroll position.
        const summary = document.querySelector('.ux-brief-summary')!.getBoundingClientRect();
        const receipt = document.querySelector('#receipt-check')!.getBoundingClientRect();
        if (!receipt.height || !summary.height) return 0;
        const wide = Math.min(summary.right, receipt.right) - Math.max(summary.left, receipt.left);
        const tall = Math.min(summary.bottom, receipt.bottom) - Math.max(summary.top, receipt.top);
        return wide > 0 && tall > 0 ? Math.round(tall) : 0;
      });
      expect(overlap, `scrolled to ${y}`).toBe(0);
    }
  });

test('D-008 the step line is one piece of text from one template', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [step, words] of [
    [0, 'Step 1 of 5: Goal · Next: Where'],
    [4, 'Step 5 of 5: Contact'],
  ] as const) {
    await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
    await openSaved(page, step);
    const line = page.locator('.plan-progress-line');
    await expect(line).toHaveText(words);
    expect(await line.evaluate((p) => p.childNodes.length)).toBe(1);
  }
});

test('D-011 the required marker on the results step is the lowercase one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSaved(page, 3);
  await expect(page.locator('.intake-form .ux-required')).toHaveText('(required)');
  expect(await mainText(page)).not.toContain('(Required)');
});

test('D-012 the error banner goes once the fields are fixed, before Continue is pressed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSaved(page, 2);
  const budget = page.locator('details', { has: page.locator('#brief-budgetAmount') });
  await budget.locator('summary').click();
  await page.locator('#brief-budgetAmount').fill('500');
  await page.locator('.plan-action-bar button.primary-link').click();
  const banner = page.getByRole('alert').filter({ hasText: 'Check this step.' });
  await expect(banner).toBeVisible();
  await expect(page.locator('#budgetAmount-error')).toBeVisible();
  // The problem named on the amount is fixed in the currency field beside it.
  await budget.locator('select').selectOption('USD');
  await expect(page.locator('#budgetAmount-error')).toHaveCount(0);
  await expect(banner).toHaveCount(0);
});
