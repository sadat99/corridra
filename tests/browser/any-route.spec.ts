import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The platform is multi-corridor. Two routes are spotlighted, but any pair of countries works.
async function openAnyRoute(page: import('@playwright/test').Page) {
  await page.goto('/');
  const atlas = page.getByLabel('Corridor Atlas', { exact: true });
  await atlas.getByText('Another route? Pick any two countries', { exact: true }).click();
  return atlas;
}

test('any pair of countries shows on the world map with an honest, non-operating status', async ({
  page,
}) => {
  const atlas = await openAnyRoute(page);
  await atlas.getByLabel('Your company is in', { exact: true }).selectOption('JP');
  await atlas.getByLabel('You want to reach', { exact: true }).selectOption('KE');
  await expect(atlas.getByRole('heading', { name: 'Japan → Kenya' })).toBeVisible();
  await expect(atlas).toContainText('No operating offer is announced for this route yet.');
  await expect(atlas.getByRole('link', { name: 'Plan a mission on this route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=JP&marketCode=KE',
  );
  // The world outline loads on demand and highlights both countries.
  await expect(atlas.locator('.ux-map-from')).toHaveCount(1);
  await expect(atlas.locator('.ux-map-to')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // The plan link keeps both countries.
  await atlas.getByRole('link', { name: 'Plan a mission on this route' }).click();
  await expect(page).toHaveURL('/plan?companyCountry=JP&marketCode=KE');
  const summary = page.getByRole('complementary', { name: 'Your example request' });
  await expect(summary).toContainText('Japan');
  await expect(summary).toContainText('Kenya');
});

test('the European Union is drawn as its member states and a small country still gets a marker', async ({
  page,
}) => {
  const atlas = await openAnyRoute(page);
  await atlas.getByLabel('Your company is in', { exact: true }).selectOption('JP');
  await atlas.getByLabel('You want to reach', { exact: true }).selectOption('EU');
  await expect(atlas.getByRole('heading', { name: 'Japan → European Union' })).toBeVisible();
  // 26 members have an outline. Malta is too small at this scale and is shown as a marker.
  await expect(atlas.locator('.ux-map-to')).toHaveCount(26);
  await expect(atlas.locator('.ux-map-to-point')).toHaveCount(1);
  // Singapore has no outline at this scale, so it is shown as a point.
  await atlas.getByLabel('Your company is in', { exact: true }).selectOption('SG');
  await atlas.getByLabel('You want to reach', { exact: true }).selectOption('KE');
  await expect(atlas.getByRole('heading', { name: 'Singapore → Kenya' })).toBeVisible();
  await expect(atlas.locator('.ux-map-from')).toHaveCount(0);
  await expect(atlas.locator('.ux-map-pin')).toHaveCount(2);
});

test('a spotlight pair chosen freely snaps to its corridor and clearing returns to the default', async ({
  page,
}) => {
  const atlas = await openAnyRoute(page);
  await atlas.getByLabel('Your company is in', { exact: true }).selectOption('BD');
  await atlas.getByLabel('You want to reach', { exact: true }).selectOption('CN');
  await expect(atlas.getByRole('heading', { name: 'Bangladesh → China' })).toBeVisible();
  await expect(atlas.getByRole('link', { name: /Read this corridor.s scope/ })).toHaveAttribute(
    'href',
    '/corridors/bangladesh-china',
  );
  await atlas.getByLabel('Your company is in', { exact: true }).selectOption('JP');
  await atlas.getByLabel('You want to reach', { exact: true }).selectOption('KE');
  await atlas.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(atlas.getByRole('heading', { name: 'Bangladesh → China' })).toBeVisible();
  await expect(atlas.getByRole('button', { name: 'Bangladesh and China' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('home and corridors pages offer a third wing for any other route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Plan a mission on another route' })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(page.getByRole('link', { name: 'Pick two countries on the map' })).toHaveAttribute(
    'href',
    '/corridors',
  );
  await page.goto('/corridors');
  await expect(page.getByRole('heading', { name: 'Any other route' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
