import AxeBuilder from '@axe-core/playwright';
import { test, expect, evidence } from '../fixtures';

// L-01 adoption: the contributor pages get the shared left navigation with two items. Signed out is
// enough to see the frame; it is navigation only and the page still decides what is shown.

test('the contributor shell has a left bar on wide screens and a drawer on phones', async ({
  page,
}, info) => {
  await page.goto('/contributor');
  await expect(page.locator('h1')).toContainText('Your assigned tasks');
  const header = page.locator('header.ux-app-header[data-shell="contributor"]');
  await expect(header).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Contributor sections' });
  const menu = page.getByRole('button', { name: 'Sections', exact: true });
  const wide = info.project.name === 'w1280';
  if (wide) {
    await expect(menu).toBeHidden();
  } else {
    await expect(nav).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: 'Contributor sections' })).toBeVisible();
  }
  await expect(nav).toBeVisible();
  const tasks = nav.getByRole('link', { name: 'Your tasks', exact: true });
  const how = nav.getByRole('link', { name: 'How assigned work works', exact: true });
  await expect(tasks).toHaveAttribute('aria-current', 'page');
  await expect(tasks).toHaveAttribute('href', '/contributor');
  await expect(how).toHaveAttribute('href', '/network');
  for (const link of [tasks, how])
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const axe = await new AxeBuilder({ page })
    .include('#contributor-navigation')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await evidence(page, `contributor-shell-${info.project.name}`);
  if (!wide) {
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
  }
});
