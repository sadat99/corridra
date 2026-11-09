import AxeBuilder from '@axe-core/playwright';
import { test, expect, evidence, signInOwner } from '../fixtures';

// Navigation v1, the field helper shell (FieldHelper board): below 1024 px a helper with a workspace link sees four
// labelled bottom tabs (Today, Tasks, Messages, Me) and no hamburger; Messages says Coming soon and is not a link;
// Today narrows the same task list; Me holds language, reading aloud, the private-link note and Sign Out. Wide
// screens keep the left bar. One sign-in per width keeps inside the sign-in rate limit.
test('the field helper has four bottom tabs on a phone and the left bar on a wide screen', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const seed = await signInOwner(page, '/operator');
  const address = `/contributor?workspace=${seed.tenantId}`;
  await page.goto(address);
  const wide = info.project.name === 'w1280';
  const tabs = page.getByRole('navigation', { name: 'Helper tabs' });
  if (wide) {
    await expect(tabs).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Contributor sections' })).toBeVisible();
    return;
  }
  await expect(tabs).toBeVisible();
  // No hamburger: the tabs replace the drawer.
  await expect(page.getByRole('button', { name: 'Sections', exact: true })).toHaveCount(0);
  for (const name of ['Today', 'Tasks', 'Me'])
    await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Messages' })).toHaveCount(0);
  await expect(tabs.getByText('Messages', { exact: true })).toBeVisible();
  await expect(tabs.getByText('Coming soon')).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Tasks', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const box of await tabs
    .locator('a, [aria-disabled="true"]')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height)))
    expect(box).toBeGreaterThanOrEqual(48);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await evidence(page, `field-tasks-${info.project.name}`);

  await tabs.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(/view=today/);
  await expect(page.getByRole('heading', { level: 1, name: 'Today.' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await tabs.getByRole('link', { name: 'Me', exact: true }).click();
  await expect(page).toHaveURL(/\/contributor\/me\?workspace=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Me.' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Me', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: 'Sign Out of Assigned Work' })).toBeVisible();
  await expect(page.getByText('Text Size')).toBeVisible();
  await expect(page.getByText('Data Saver')).toBeVisible();
  await expect(page.getByRole('link', { name: 'About assigned work' })).toBeVisible();
  const axeMe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axeMe.violations.map((v) => v.id)).toEqual([]);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await evidence(page, `field-me-${info.project.name}`);

  // Tasks again from Me, and the old address still lands on the task page.
  await page.setViewportSize({ width: 390, height: 800 });
  await tabs.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/contributor\\?workspace=${seed.tenantId}$`));
});
