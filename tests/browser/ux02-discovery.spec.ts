import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openFineTune(page: Page) {
  const details = page.locator('.ux-fine-tune');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('UX-02 Atlas selects an actual direction and synthetic example without creating records', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/corridors');
  await openFineTune(page);
  await page.getByRole('combobox', { name: 'Your perspective' }).selectOption('institution');
  await expect(page.getByRole('combobox', { name: "I'm trying to" })).toHaveValue('delegations');
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('bangladesh-eu');
  const atlas = page.getByLabel('Route map', { exact: true });
  await expect(atlas).toContainText('The EU is a group of countries');
  await page.getByRole('button', { name: 'Open the sample mission' }).click();
  const example = page.getByRole('region', { name: 'Sample mission' });
  await expect(example).toContainText('Run a multi-company mission');
  await expect(example).toContainText('Give each participant their own goal');
  await example.getByRole('button', { name: '2. Inspect the evidence' }).focus();
  await page.keyboard.press('Enter');
  await expect(example).toContainText('Evidence not established');
  await expect(example).toContainText('Unknown terms stay unknown');
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('spain-bangladesh');
  await expect(atlas).toContainText('Spanish companies entering Bangladesh is a separate route');
  await expect(example).toContainText('No operating offer is announced');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(writes).toEqual([]);
  await example.getByRole('link', { name: 'Start a request on this route' }).click();
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

test('UX-02 route pages show their sections in full and account recovery keeps its real destinations', async ({
  page,
}) => {
  await page.goto('/machinery');
  await expect(page.locator('.ux-public-disclosure')).toHaveCount(0);
  await expect(page.locator('.guide-page-steps li p').first()).toBeVisible();
  await page.locator('#page-next').scrollIntoViewIfNeeded();
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
        ? 'Team members sign in separately'
        : route === '/signup'
          ? 'Create your account to send and follow requests.'
          : ['/forgot-password', '/reset-password'].includes(route)
            ? 'It does not change a team password.'
            : 'missions shared with you.',
    );
    await expect(
      page.getByRole('main').getByRole('link', {
        name: ['/signin', '/signup'].includes(route)
          ? 'Start a request without an account'
          : 'Prepare an example request without an account',
      }),
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

test('UX-02 situation cards preset the role, job and route and prefill the example request', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/corridors');
  await openFineTune(page);
  const group = page.getByRole('group', { name: 'Choose your situation' });
  await expect(group.getByRole('button', { name: /Source from suppliers/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await group.getByRole('button', { name: /Run a trade mission/ }).click();
  await expect(group.getByRole('button', { name: /Run a trade mission/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: 'Plan a mission on this route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=BD&marketCode=CN&job=delegations',
  );
  await group.getByRole('button', { name: /Enter Bangladesh/ }).click();
  await expect(page.getByRole('link', { name: 'Plan a mission on this route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=ES&marketCode=BD&job=market_entry',
  );
  await openFineTune(page);
  await expect(page.getByRole('combobox', { name: 'Route', exact: true })).toHaveValue(
    'spain-bangladesh',
  );
  await expect(group.getByRole('link', { name: /Help locally/ })).toHaveAttribute(
    'href',
    '/network',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(writes).toEqual([]);
});

test('saved request receipt uses the shared cards, copies safely, checks replies and starts a new request', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const code = 'a'.repeat(64);
  await page.addInitScript((receipt) => {
    if (!sessionStorage.getItem('receipt-ui-initialised')) {
      sessionStorage.setItem('corridra-mission-receipt', receipt);
      sessionStorage.setItem('receipt-ui-initialised', 'yes');
    }
  }, code);
  await page.route('**/api/intake/receipt', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ receipt: code });
    await route.fulfill({
      json: {
        status: 'REVIEW_PENDING',
        replies: [{ body: 'We are reviewing your request.', createdAt: '2026-10-21T00:00:00Z' }],
      },
    });
  });
  await page.goto('/plan');
  const saved = page.getByRole('region', { name: 'Keep your private receipt.', exact: true });
  await expect(saved).toBeVisible();
  await expect(saved.getByLabel('Private receipt code', { exact: true })).toHaveValue(code);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(saved).toHaveCSS('padding', '24px');
    await expect(saved.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '20px');
    const input = (await saved.getByLabel('Private receipt code', { exact: true }).boundingBox())!;
    expect(input.height).toBeGreaterThanOrEqual(48);
    const savedBox = (await saved.boundingBox())!;
    const restart = (await page
      .getByRole('button', { name: 'Start another request (save your receipt first)', exact: true })
      .boundingBox())!;
    const lookup = (await page.locator('#receipt-check').boundingBox())!;
    expect(restart.y).toBeGreaterThanOrEqual(savedBox.y + savedBox.height);
    expect(lookup.y).toBeGreaterThanOrEqual(restart.y + restart.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`receipt-${width}.png`),
      fullPage: true,
    });
  }
  await saved.getByRole('button', { name: 'Copy receipt code', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Private receipt code copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
    }),
  );
  await saved.getByRole('button', { name: 'Copy receipt code', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Could not copy the code. Select it and copy it before leaving this page.',
  );
  await saved.getByLabel('Private receipt code', { exact: true }).focus();
  expect(
    await saved
      .getByLabel('Private receipt code', { exact: true })
      .evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
  ).toEqual([0, 64]);
  await page.getByRole('button', { name: 'Check status and replies', exact: true }).click();
  await expect(page.getByText('We are reviewing your request.', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Start another request (save your receipt first)', exact: true })
    .click();
  await expect(saved).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('corridra-mission-receipt'))).toBeNull();
});
