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
    await page.getByRole('tab', { name: 'Current Availability' }).click(); // each card is a tab
    await expect(page.getByRole('heading', { name: 'Current availability' })).toBeVisible();
    await expect(page.getByText('Available now', { exact: true })).toBeVisible();
    await expect(page.getByText('What happens', { exact: true })).toBeVisible();
    await expect(page.getByText('Not offered', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a Request on This Route' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.locator('body').innerText()).not.toContain('—');
  }
  await page.getByRole('tab', { name: 'Where the Work Happens' }).click();
  await expect(
    page.getByText('The EU is a group of countries, not one market and not all of Europe.', {
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
  await page.getByRole('tab', { name: 'Pick Your Route' }).click(); // the picker is its own tab
  await page.getByRole('combobox', { name: 'My company is in', exact: true }).selectOption('JP');
  await page.getByRole('combobox', { name: 'I want to reach', exact: true }).selectOption('KE');
  await expect(page.getByLabel('Route map', { exact: true })).toContainText(
    'No operating offer is announced',
  );
  await page.getByRole('link', { name: 'Plan a Mission on This Route', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Commercial job', exact: true })
    .selectOption('machinery_procurement');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based? (required)', exact: true }),
  ).toHaveValue('Japan');
  await expect(page.locator('form.intake-form input[name="companyCountry"]')).toHaveValue('JP');
  await expect(
    page.getByRole('combobox', { name: 'Which market is involved? (required)', exact: true }),
  ).toHaveValue('Kenya');
  await expect(page.locator('form.intake-form input[name="marketCode"]')).toHaveValue('KE');
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
  // The footer's link groups start collapsed (layout budget): open the group, then one tap.
  for (const group of await page.locator('footer details.guide-footer-details').all())
    await group.locator('summary').click();
  await page
    .getByRole('navigation', { name: 'Footer solutions' })
    .getByRole('link', { name: 'Procure machinery', exact: true })
    .click();
  await expect(page).toHaveURL('/machinery');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A machine is useful only if it fits the work.',
  );
  await page.goto('/business-trips');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Give each day a commercial purpose.',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('main').getByRole('link', { name: 'Plan a Business Trip' }).click();
  await expect(page).toHaveURL('/plan?job=business_trips');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'business_trips',
  );
  await expect(page.getByText('বাংলায় সংক্ষিপ্ত নির্দেশনা', { exact: true })).toBeVisible();
});
