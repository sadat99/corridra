import { expect, test, type Page } from '@playwright/test';
import { configuredServer } from './access-server';

// W1-B: /access/customer is one clear choice (owner board, screen 03). With customer sign-in configured (the shared
// test server has none, so this spec starts its own server on the same build with sign-in and all three customer
// switches on), the two doors "I am new here" and "I have an account" sit in the first screen at 390 and 1440 with one
// cobalt action (Start a Request) and one outlined action (Sign In); the three invitation and programme cards sit in
// one closed disclosure; and every destination the page had is still in the page. Measured on the production build.
const door = configuredServer(3112);
const base = door.base;

test.beforeAll(() => door.start());
test.afterAll(() => door.stop());

async function open(page: Page, width: number) {
  const height = width < 700 ? 844 : 900;
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/access/customer`);
  return height;
}

for (const width of [390, 1440]) {
  test(`two doors, one primary action in the first screen at ${width}px`, async ({ page }) => {
    const height = await open(page, width);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 2, name: 'I am new here' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: 'I have an account' })).toBeVisible();
    const start = main.getByRole('link', { name: 'Start a Request', exact: true });
    await expect(start).toHaveAttribute('href', '/plan');
    await expect(start).toHaveClass(/\bbutton\b/);
    const signIn = main.getByRole('link', { name: 'Sign In', exact: true });
    await expect(signIn).toHaveAttribute('href', '/signin');
    for (const link of [start, signIn]) {
      const box = (await link.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Create Account stays one tap from the new-here door.
    await expect(main.getByRole('link', { name: 'Create Account', exact: true })).toHaveAttribute(
      'href',
      '/signup',
    );
    // Cobalt is the only filled action: one filled button and one outlined button (Sign In), down from five buttons.
    await expect(main.locator('.button')).toHaveCount(1);
    await expect(
      main.locator('.button, .button-secondary, .primary-link, button[type="submit"]'),
    ).toHaveCount(2);
  });
}

test('the other ways to join are one closed disclosure and keep every card and destination', async ({
  page,
}) => {
  await open(page, 390);
  const main = page.locator('main');
  const more = main.locator('details.access-more');
  await expect(more).toHaveCount(1);
  expect(await more.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
  await expect(more.locator('summary')).toHaveText('I was invited, or I am in a programme');
  const ways: Array<[string, string]> = [
    ['Accept Invitation', '/signin'],
    ['Register or Apply', '/account/delegations'],
    ['Start As an Organiser', '/account/delegations/organise'],
  ];
  // Closed, the links are in the page but not in the accessibility tree, so they are found by their text.
  for (const [name, href] of ways)
    await expect(more.locator('a', { hasText: new RegExp(`^${name}$`) })).toHaveAttribute(
      'href',
      href,
    );
  for (const title of ['Workspace invitation', 'Delegation programme', 'Organising a delegation'])
    await expect(more.locator('h2', { hasText: title })).toHaveCount(1);
  await more.locator('summary').click();
  for (const [name, href] of ways)
    await expect(more.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  for (const [name] of ways)
    await expect(more.getByRole('link', { name, exact: true })).toBeVisible();
  // Reachable by keyboard: the summary takes focus and Enter closes it again.
  await more.locator('summary').focus();
  await page.keyboard.press('Enter');
  expect(await more.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
});

test('the account-free request and the other two doors are still linked', async ({ page }) => {
  await open(page, 390);
  await expect(
    page.locator('main').getByRole('link', { name: 'Start a Request', exact: true }),
  ).toHaveAttribute('href', '/plan');
  const bar = page.getByRole('navigation', { name: 'Not what you need?' });
  await expect(bar.getByRole('link', { name: 'Team and Network Access' })).toHaveAttribute(
    'href',
    '/access/team',
  );
  await expect(bar.getByRole('link', { name: 'Private Link Access' })).toHaveAttribute(
    'href',
    '/access/link',
  );
});

test('the page is shorter than before: at most 1.6 screens at 390 and 1 screen at 1440', async ({
  page,
}) => {
  const height = await open(page, 390);
  const bottom = await page.evaluate(() =>
    Math.round(document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY),
  );
  expect(bottom).toBeLessThanOrEqual(Math.round(height * 1.6));
  const tall = await open(page, 1440);
  const bottomWide = await page.evaluate(() =>
    Math.round(document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY),
  );
  expect(bottomWide).toBeLessThanOrEqual(tall);
});
