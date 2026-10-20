import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('three V3 product entries open real validated requests without creating records', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname);
  });
  for (const [label, job] of [
    ['Find Buyers & Partners', 'buyers'],
    ['Find Suppliers & Products', 'sourcing'],
    ['Organise a Delegation', 'delegations'],
  ]) {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    const choices = page.getByRole('navigation', { name: 'Choose your commercial objective' });
    await expect(choices.getByRole('link')).toHaveCount(3);
    const entry = choices.getByRole('link', { name: new RegExp(label) });
    await expect(entry).toHaveAttribute('href', `/plan?job=${job}`);
    await entry.click();
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      job,
    );
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await expect(
      page.getByText('Real customer mission admission is unavailable.', { exact: false }).first(),
    ).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('V3 entry remains keyboard accessible and cannot replace an unfinished request', async ({
  page,
}) => {
  await page.goto('/plan?job=sourcing');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'sourcing',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where?', exact: true })).toBeFocused();
  await page.goto('/');
  const choices = page.getByRole('navigation', { name: 'Choose your commercial objective' });
  await choices.getByRole('link').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where?', exact: true })).toBeVisible();
  await expect(
    page.getByText('Your saved choices take precedence over link suggestions.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
    'sourcing',
  );
  await page.goto('/');
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('link', { name: 'Something else? Tell us your business goal' }),
  ).toHaveAttribute('href', '/plan');
});
