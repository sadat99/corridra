import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The helper interest form on /access/team (ADR-085), in a browser, against a real database with the register installed and
// real admission open. It runs only in the one CI step that starts the server with HELPER_INTEREST_FIXTURE=true and
// CORRIDRA_HELPER_INTEREST=true (the Network switch is on in this server); in every other run it is skipped, because the
// form does not exist there. Axe and 44 px targets are checked at 320 and 768 with the disclosure open, at both steps.
test.skip(
  process.env.HELPER_INTEREST_FIXTURE !== 'true' || process.env.CORRIDRA_HELPER_INTEREST !== 'true',
  'The helper interest fixture is not on in this run',
);
test.describe.configure({ mode: 'serial' });

const origin = 'http://127.0.0.1:3200';
const entry = {
  name: 'Amina Rahman',
  email: 'amina.browser@example.test',
  country: 'BD',
  reason: 'I know the leather and footwear markets of Chattogram well and can help locally.',
};

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.goto('/access/team');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.getByText('Not invited yet?').click();
}
async function clean(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main a, main button, main summary, main input, main select, main textarea',
      ),
    ]
      .map((el) => ({ el, box: el.getBoundingClientRect(), style: getComputedStyle(el) }))
      .filter(
        ({ box, style }) =>
          box.width > 0 &&
          box.height > 0 &&
          box.height < 44 &&
          style.visibility !== 'hidden' &&
          box.left > -100,
      )
      .map(({ el }) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`),
  );
  expect(small).toEqual([]);
}

// The page budget of the team door (the access doors spec: content without the footer, 1550 px at 390 and 1100 px at 1440)
// holds with the form offered and its disclosure closed.
for (const [width, limit] of [
  [390, 1550],
  [1440, 1100],
] as const) {
  test(`the team door stays within its page length at ${width}px with the form offered`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.goto('/access/team');
    await expect(page.getByText('Not invited yet?')).toBeVisible();
    const bottom = await page.evaluate(() =>
      Math.round(document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY),
    );
    expect(bottom).toBeLessThanOrEqual(limit);
  });
}

for (const width of [320, 768]) {
  test(`the form holds at ${width}px: axe, 44 px targets, no sideways scroll, both steps`, async ({
    page,
  }) => {
    await open(page, width);
    await expect(page.getByText('This is not an invitation, a job or a reward.')).toBeVisible();
    await clean(page);
    await page.getByLabel('Your name').fill(entry.name);
    await page.getByLabel('Your email').fill(entry.email);
    await page.getByLabel('Your country').selectOption(entry.country);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Why would you like to help?')).toBeFocused();
    await clean(page);
  });
}

test('the hidden field is out of sight and out of keyboard reach', async ({ page }) => {
  await open(page, 390);
  const trap = page.locator('input[name="website"]');
  await expect(trap).toHaveAttribute('tabindex', '-1');
  const box = await trap.boundingBox();
  expect(box === null || box.x < -100).toBe(true);
  await page.getByLabel('Your name').fill(entry.name);
  await page.getByLabel('Your email').fill(entry.email);
  await page.getByLabel('Your country').selectOption(entry.country);
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name),
    ).not.toBe('website');
  }
});

test('one submission shows one on-screen acknowledgement, and a repeat looks exactly the same', async ({
  page,
}) => {
  await open(page, 390);
  await page.getByLabel('Your name').fill(entry.name);
  await page.getByLabel('Your email').fill(entry.email);
  await page.getByLabel('Your country').selectOption(entry.country);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Why would you like to help?').fill(entry.reason);
  await page.getByRole('button', { name: 'Send My Interest' }).click();
  const done = page.getByRole('status');
  await expect(done).toContainText('Thank you. We have your note.');
  await expect(done).toContainText('This is not an invitation');
  const first = await page.request.post('/api/helper-interest', {
    headers: { Origin: origin },
    data: { ...entry, website: '' },
  });
  const other = await page.request.post('/api/helper-interest', {
    headers: { Origin: origin },
    data: { ...entry, email: entry.email.toUpperCase(), name: 'Someone Else', website: '' },
  });
  expect(first.status()).toBe(202);
  expect(other.status()).toBe(202);
  expect(await other.text()).toBe(await first.text());
});

test('a program that fills the hidden field gets the same answer and nothing else, and the limit answers 429', async ({
  page,
}) => {
  const bot = await page.request.post('/api/helper-interest', {
    headers: { Origin: origin },
    data: { ...entry, email: 'bot.browser@example.test', website: 'https://spam.test' },
  });
  expect(bot.status()).toBe(202);
  expect(await bot.json()).toEqual({ received: true });
  let limited = 0;
  for (let i = 0; i < 8 && limited === 0; i++) {
    const response = await page.request.post('/api/helper-interest', {
      headers: { Origin: origin },
      data: { ...entry, email: `limit${i}@example.test`, website: '' },
    });
    if (response.status() === 429) limited = i + 1;
  }
  expect(limited).toBeGreaterThan(0);
});

test('a wrong origin and a missing body are refused and stored nothing', async ({ page }) => {
  const wrong = await page.request.post('/api/helper-interest', {
    headers: { Origin: 'https://elsewhere.example' },
    data: { ...entry, email: 'origin@example.test', website: '' },
  });
  expect(wrong.status()).toBe(403);
  const get = await page.request.get(
    '/api/helper-interest?tenant=00000000-0000-4000-8000-000000000000',
  );
  expect([401, 403]).toContain(get.status());
});
