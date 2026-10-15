import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('UX-02 Atlas selects an actual direction and synthetic example without creating records', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Your perspective' }).selectOption('institution');
  await expect(page.getByRole('combobox', { name: "I'm trying to" })).toHaveValue('delegations');
  await page
    .getByRole('combobox', { name: 'Commercial direction', exact: true })
    .selectOption('bangladesh-eu');
  const atlas = page.getByLabel('Corridor Atlas', { exact: true });
  await expect(atlas).toContainText('EU is a trade-bloc scope');
  await expect(atlas).toContainText('Customer operations');
  await expect(atlas).toContainText('Not available');
  await page.getByRole('link', { name: 'See a synthetic mission example' }).click();
  const example = page.getByRole('region', { name: 'Synthetic mission example' });
  await expect(example).toContainText('Run a multi-company mission');
  await expect(example).toContainText('Give each participant an independent objective');
  await example.getByRole('button', { name: '2. Inspect the evidence' }).focus();
  await page.keyboard.press('Enter');
  await expect(example).toContainText('Evidence not established');
  await expect(example).toContainText('Unknown terms stay unknown');
  await page
    .getByRole('combobox', { name: 'Commercial direction', exact: true })
    .selectOption('spain-bangladesh');
  await expect(atlas).toContainText('selectively configurable');
  await expect(example).toContainText('No operating offer is announced');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(writes).toEqual([]);
  await example.getByRole('link', { name: 'Continue with an invented request' }).click();
  await expect(page).toHaveURL('/plan?companyCountry=ES&marketCode=BD&job=delegations');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'delegations',
  );
});

test('UX-02 saved draft choices survive reload and take precedence over entry suggestions', async ({
  page,
}) => {
  await page.goto('/plan?job=sourcing&companyCountry=BD&marketCode=CN');
  await page
    .getByRole('combobox', { name: 'Commercial job', exact: true })
    .selectOption('machinery_procurement');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .selectOption('JP');
  await page
    .getByRole('combobox', { name: 'Which market is involved?', exact: true })
    .selectOption('KE');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByLabel('Your offer or requirement')
    .fill('原始机器要求。 কাল্পনিক পরীক্ষামূলক তথ্য।');
  await page.getByText('Budget context (optional)', { exact: true }).click();
  await page.getByLabel('Budget in original currency (optional)', { exact: true }).fill('1.234');
  await page.getByRole('combobox', { name: 'Original currency', exact: true }).selectOption('BHD');
  await page.reload();
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
    '原始机器要求。 কাল্পনিক পরীক্ষামূলক তথ্য।',
  );
  const summary = page.getByRole('complementary', { name: 'Your example request' });
  await expect(summary).toContainText('Procure machinery');
  await expect(summary).toContainText('Japan');
  await expect(summary).toContainText('Kenya');
  await expect(summary).toContainText('1.234 BHD');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
  ).toHaveValue('JP');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'machinery_procurement',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('UX-02 expired and corrupt drafts recover to a usable form without claiming admission', async ({
  page,
}) => {
  await page.goto('/plan');
  await page.getByLabel('Sell in a new market', { exact: true }).check();
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('corridra-mission-draft')!);
    saved.at = Date.now() - 86400001;
    sessionStorage.setItem('corridra-mission-draft', JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue('');
  await expect(page.getByText('Drafts expire after 24 hours.', { exact: false })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('corridra-mission-draft', '{broken'));
  await page.reload();
  await expect(
    page.getByText('A saved draft could not be restored.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check this step.' })).toBeFocused();
  await page.getByLabel('Source suppliers', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where?', exact: true })).toBeFocused();
  await expect(
    page.getByText('Real customer mission admission is unavailable.', { exact: false }).first(),
  ).toBeVisible();
});

test('UX-02 native route disclosures and account recovery keep their real destinations', async ({
  page,
}) => {
  await page.goto('/machinery');
  const scope = page.locator('.ux-public-disclosure summary').first();
  await scope.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ux-public-disclosure').first()).toHaveAttribute('open', '');
  await page.getByRole('link', { name: 'Next step', exact: true }).click();
  await expect(page.locator('#page-next')).toBeInViewport();
  for (const route of [
    '/signup',
    '/signin',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
  ]) {
    await page.goto(route);
    await expect(page.getByRole('main')).toContainText(
      route === '/signin'
        ? 'Customer identity is separate'
        : ['/forgot-password', '/reset-password'].includes(route)
          ? 'It does not change an operator password or authenticator.'
          : 'missions explicitly shared with you.',
    );
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: 'Prepare an invented example request without an account' }),
    ).toHaveAttribute('href', '/plan');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test('UX-02 blocked draft storage is visible and does not discard current form entries', async ({
  page,
}) => {
  await page.goto('/plan?job=machinery_procurement&companyCountry=BD&marketCode=CN');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Synthetic storage denial', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('This browser could not save the draft.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByLabel('Your offer or requirement')
    .fill('Invented requirement retained while storage is denied.');
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
    'Invented requirement retained while storage is denied.',
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
    'Invented requirement retained while storage is denied.',
  );
});
