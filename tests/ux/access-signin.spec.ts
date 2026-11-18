import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { configuredServer } from './access-server';

// W1-B: /signin is one calm form (owner board, screen 03). With customer sign-in configured: the one primary button,
// Sign In, sits in the first screen at 390 and 1440; the other ways in (Create an Account, Verify Your Email, the
// invited operator sign-in) sit in one closed "More ways in" disclosure; a failed sign-in shows an icon, the words and
// a red field edge without saying whether the address has an account; the password can be shown; and the form still
// sends the same two fields to the same place. Measured on the production build.
const door = configuredServer(3113);
const base = door.base;

test.beforeAll(() => door.start());
test.afterAll(() => door.stop());

async function open(page: Page, width: number) {
  const height = width < 700 ? 844 : 900;
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/signin`);
  return height;
}

for (const width of [390, 1440]) {
  test(`one primary action in the first screen at ${width}px, other actions quieter`, async ({
    page,
  }) => {
    const height = await open(page, width);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in.');
    await expect(page.locator('main')).toContainText(
      'See your requests and the missions shared with you.',
    );
    const submit = page.locator('main form button.primary-link');
    await expect(submit).toHaveText('Sign In');
    const box = (await submit.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // Down from five full-width actions in the form (Sign In, Forgot, Create, Verify, Invited Operator) to one.
    await expect(page.locator('main form.operator-form > :is(a, button)')).toHaveCount(1);
    await expect(
      page.locator('main .button, main .button-secondary, main .primary-link'),
    ).toHaveCount(1);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    if (width <= 768) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main a, main button, main summary')]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box: b }) => b.width > 0 && b.height > 0 && b.height < 44)
          .map(({ el }) => (el.textContent ?? '').trim()),
      );
      expect(small).toEqual([]);
    }
  });
}

test('More ways in is one closed disclosure and keeps every destination', async ({ page }) => {
  await open(page, 390);
  const more = page.locator('main form details.account-more');
  await expect(more).toHaveCount(1);
  expect(await more.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
  await expect(more.locator('summary')).toHaveText('More ways in');
  const ways: Array<[string, string]> = [
    ['Create an Account', '/signup'],
    ['Verify Your Email', '/verify-email'],
    ['Invited Operator Sign-in', '/operator/signin'],
  ];
  // Closed, the links are in the page but not in the accessibility tree, so they are found by their text.
  for (const [name, href] of ways)
    await expect(more.locator('a', { hasText: new RegExp(`^${name}$`) })).toHaveAttribute(
      'href',
      href,
    );
  await more.locator('summary').click();
  for (const [name, href] of ways) {
    await expect(more.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(more.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  const form = page.locator('main form');
  await expect(form.getByRole('link', { name: 'Forgot Your Password?' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
  await expect(form.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
  // The one "Not a customer?" line replaces the older "Not a Customer?" disclosure (owner board screen 03 and the
  // owner's 18 November "unsolicited redundancy"): both other doors stay one tap away, and the disclosure is gone.
  await expect(page.getByText('Not a Customer?', { exact: true })).toHaveCount(0);
  const line = page.getByRole('navigation', { name: 'Not a customer?' });
  await expect(line.getByRole('link', { name: 'Team and Network Access' })).toHaveAttribute(
    'href',
    '/access/team',
  );
  await expect(line.getByRole('link', { name: 'Private Link Access' })).toHaveAttribute(
    'href',
    '/access/link',
  );
});

test('a return address is carried to the links in More ways in', async ({ page }) => {
  await page.goto(`${base}/signin?returnTo=%2Fplan`);
  const more = page.locator('main form details.account-more');
  await expect(more.locator('a', { hasText: /^Create an Account$/ })).toHaveAttribute(
    'href',
    '/signup?returnTo=%2Fplan',
  );
  await expect(more.locator('a', { hasText: /^Verify Your Email$/ })).toHaveAttribute(
    'href',
    '/verify-email?returnTo=%2Fplan',
  );
});

test('Show and Hide change only how the password is drawn', async ({ page }) => {
  await open(page, 390);
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('a long private phrase');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('a long private phrase');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('a failed sign-in shows an icon, the words and a red edge, and sends the same two fields', async ({
  page,
}) => {
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/sign-in/email', async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' }),
    });
  });
  await open(page, 390);
  await page.getByLabel('Email', { exact: true }).fill('someone@example.com');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.locator('main form button.primary-link').click();
  const banner = page.locator('main p.ux-error-summary');
  await expect(banner).toHaveText(
    'That email and password do not match. Check both and try again.',
  );
  await expect(banner.locator('svg')).toHaveCount(1);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.locator('#account-password-hint')).toHaveText('Check your password.');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ email: 'someone@example.com', password: 'not the password' });
  expect(Object.keys(sent[0]!).sort()).toEqual(['email', 'password']);
  // The words are the same whatever the address, so they never say whether it has an account.
  await page.getByLabel('Email', { exact: true }).fill('nobody-at-all@example.org');
  await page.locator('main form button.primary-link').click();
  await expect(banner).toHaveText(
    'That email and password do not match. Check both and try again.',
  );
});

const mismatch = 'That email and password do not match. Check both and try again.';
async function failWith(page: Page, status: number | 'abort') {
  await page.route('**/sign-in/email', (route) =>
    status === 'abort'
      ? route.abort()
      : route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Provider words' }),
        }),
  );
  await open(page, 390);
  await page.getByLabel('Email', { exact: true }).fill('someone@example.com');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.locator('main form button.primary-link').click();
  await expect(page.locator('main p.ux-error-summary')).toBeVisible();
}

for (const status of [429, 500, 'abort'] as const) {
  test(`a ${status} failure keeps its own banner and does not mark the fields or show the password hint`, async ({
    page,
  }) => {
    await failWith(page, status);
    await expect(page.locator('main p.ux-error-summary')).not.toHaveText(mismatch);
    await expect(page.getByLabel('Email', { exact: true })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByLabel('Password', { exact: true })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.locator('#account-password-hint')).toHaveCount(0);
  });
}

test('a 403 shows the mismatch sentence, and Verify Your Email stays in More ways in', async ({
  page,
}) => {
  await failWith(page, 403);
  await expect(page.locator('main p.ux-error-summary')).toHaveText(mismatch);
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  const more = page.locator('main form details.account-more');
  expect(await more.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
  await more.locator('summary').click();
  await expect(more.getByRole('link', { name: 'Verify Your Email', exact: true })).toHaveAttribute(
    'href',
    '/verify-email',
  );
});
