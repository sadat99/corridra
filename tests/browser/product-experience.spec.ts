import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
test('corridor pages explain the actual direction, status and geographic limits', async ({
  page,
}) => {
  for (const [slug, name] of [
    ['bangladesh-china', 'Bangladesh–China'],
    ['bangladesh-spain', 'Bangladesh–Spain'],
    ['bangladesh-eu', 'Bangladesh–EU'],
  ]) {
    await page.goto(`/corridors/${slug}`);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current availability' })).toBeVisible();
    await expect(page.getByText('Structurally supported', { exact: true })).toBeVisible();
    await expect(page.getByText('Being piloted', { exact: true })).toBeVisible();
    await expect(page.getByText('Operationally available', { exact: true })).toBeVisible();
    await expect(page.getByText('Not yet available', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.locator('body').innerText()).not.toContain('—');
  }
  await expect(
    page.getByText('The EU is a trade-bloc scope, not a country and not all of Europe.', {
      exact: false,
    }),
  ).toBeVisible();
  const response = await page.goto('/corridors/an-unsupported-corridor');
  expect(response?.status()).toBe(404);
});
test('global selector retains an unsupported operating direction and opens the actual adaptive short brief', async ({
  page,
}, info) => {
  await page.goto('/corridors');
  await page.getByRole('combobox', { name: 'Company country', exact: true }).selectOption('JP');
  await page.getByRole('combobox', { name: 'Target market', exact: true }).selectOption('KE');
  await expect(page.getByRole('status')).toContainText('No operating offer is announced');
  await page.getByRole('link', { name: 'Prepare a test brief', exact: true }).click();
  await page.getByLabel('Source suppliers', { exact: true }).check();
  await page
    .getByRole('combobox', { name: 'Commercial job', exact: true })
    .selectOption('machinery_procurement');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
  ).toHaveValue('JP');
  await expect(
    page.getByRole('combobox', { name: 'Which market is involved?', exact: true }),
  ).toHaveValue('KE');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your offer or requirement').fill('原始机械部件采购要求，保留供应商原文。');
  await page
    .getByLabel('Technical purpose (optional)', { exact: true })
    .fill('Synthetic production equipment evaluation');
  await page
    .getByLabel('Key technical parameters (optional)', { exact: true })
    .fill('Capacity and utilities to be reviewed');
  await page.getByText('Budget context (optional)', { exact: true }).click();
  await page.getByLabel('Budget in original currency (optional)', { exact: true }).fill('1.234');
  await page.getByRole('combobox', { name: 'Original currency', exact: true }).selectOption('BHD');
  await page
    .getByLabel('Budget basis, such as total equipment budget', { exact: true })
    .fill('Original equipment budget');
  await expect(page.getByLabel('Required quantity (optional)', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
    '原始机械部件采购要求，保留供应商原文。',
  );
  await page.getByText('Budget context (optional)', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Original currency', exact: true })).toHaveValue(
    'BHD',
  );
  await expect(
    page.getByText('Real customer mission admission is unavailable.', { exact: false }).first(),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  await mkdir('.cache/v2-part-03', { recursive: true });
  await page.screenshot({
    path: `.cache/v2-part-03/adaptive-intake-${info.project.name}.png`,
    fullPage: true,
  });
});
test('job-first navigation exposes machinery and commercial trips with real entry points', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByText('Solutions', { exact: true }).click();
  await page.getByRole('link', { name: 'Procure machinery', exact: true }).click();
  await expect(page).toHaveURL('/machinery');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A machine is useful only if it fits the work.',
  );
  await page.goto('/business-trips');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Give each day a commercial purpose.',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'Prepare a business-trip test brief' }).click();
  await expect(page).toHaveURL('/plan?job=business_trips');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'business_trips',
  );
  await expect(page.getByText('বাংলায় সংক্ষিপ্ত নির্দেশনা', { exact: true })).toBeVisible();
});
