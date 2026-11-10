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
  // W7, W10: Text Size (three steps), Stronger Colours and Less Movement are real; Data Saver is still plain text tagged
  // Coming soon.
  const comfort = page.locator('section', {
    has: page.getByRole('heading', { name: 'Make it easier to read' }),
  });
  await expect(comfort.getByRole('group', { name: 'Text Size' })).toBeVisible();
  await expect(comfort.getByRole('radio')).toHaveCount(3);
  await expect(comfort.getByRole('radio', { name: 'Normal', exact: true })).toBeChecked();
  // The switch is named by "Less Movement" alone (its On or Off word is not read twice) and described by the hint.
  const lessMovement = comfort.getByRole('switch', { name: 'Less Movement', exact: true });
  await expect(lessMovement).not.toBeChecked();
  await expect(lessMovement).toHaveAccessibleDescription(
    'Stops animation and anything that moves by itself.',
  );
  // Stronger Colours is the second switch, named by its words alone and described by its own hint.
  await expect(comfort.getByRole('switch')).toHaveCount(2);
  const strongerColours = comfort.getByRole('switch', { name: 'Stronger Colours', exact: true });
  await expect(strongerColours).not.toBeChecked();
  await expect(strongerColours).toHaveAccessibleDescription(
    'Darker text, clearer lines and underlined links.',
  );
  // One live region for a failed save is in the card all the time, empty and taking no room, and flush with the hint.
  const note = comfort.getByRole('status');
  await expect(note).toHaveCount(1);
  await expect(note).toBeEmpty();
  expect((await note.boundingBox())!.height).toBe(0);
  const hintBox = (await comfort
    .getByText('Stops animation and anything that moves by itself.')
    .boundingBox())!;
  const saverBox = (await comfort.locator('p', { hasText: 'Data Saver' }).boundingBox())!;
  expect(saverBox.y - (hintBox.y + hintBox.height)).toBeGreaterThanOrEqual(11.5);
  const group = (await comfort.getByRole('group', { name: 'Text Size' }).boundingBox())!;
  const row = (await lessMovement.locator('xpath=ancestor::label').boundingBox())!;
  expect(group.width).toBeLessThanOrEqual(640.5);
  expect(row.width).toBeLessThanOrEqual(640.5);
  await expect(
    comfort.getByText('Stops animation and anything that moves by itself.'),
  ).toBeVisible();
  await expect(comfort.getByText('Data Saver')).toBeVisible();
  await expect(comfort.locator('.ux-soon-tag')).toHaveText(['Coming soon']);
  await expect(comfort.locator('p', { hasText: 'Data Saver' }).locator('.ux-soon-tag')).toHaveText(
    'Coming soon',
  );
  for (const role of ['button', 'checkbox', 'switch', 'radio', 'link'] as const)
    await expect(comfort.getByRole(role, { name: 'Data Saver' })).toHaveCount(0);
  for (const choice of await page.locator('.me-textsize-choice').all())
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(75.5);
  await comfort.getByRole('radio', { name: 'Largest', exact: true }).check();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    '20px',
  );
  await lessMovement.check();
  await expect(page.locator('html')).toHaveAttribute('data-less-movement', 'on');
  await expect(lessMovement).toBeChecked();
  await strongerColours.check();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
  await expect(strongerColours).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('corridra.contrast'))).toBe('more');
  await expect(page.getByRole('link', { name: 'About assigned work' })).toBeVisible();
  const axeMe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axeMe.violations.map((v) => v.id)).toEqual([]);
  // Text is at the largest step here, so each width is also measured at the largest text.
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
