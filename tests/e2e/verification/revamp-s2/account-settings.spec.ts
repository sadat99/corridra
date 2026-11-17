import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInCustomer } from '../fixtures';

// CX PR 3c (docs/revamp/specs/customer-experience.md): the Account page is a settings layout with sub-tabs, and
// the tools and entry points it used to repeat now live only in All tools. Case ids: CX-02 and CX-04.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CX-04 Account tabs keep ?tab= and Security holds Sign Out at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await signInCustomer(context);
    await page.goto('/account?view=more');
    const tabs = page.getByRole('tablist', { name: 'Account sections' }).getByRole('tab');
    const names = await tabs.allTextContents();
    expect(names).toEqual(['Profile', 'Security', 'Privacy', 'Preferences', 'Workspaces']);
    await expect(page.getByRole('heading', { name: 'Start something' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    await expect(page).toHaveURL(/tab=security/);
    await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

// CI-U4: old links land on the right group, and the reading comfort controls work on the page.
const oldLinks: [string, string][] = [
  ['/account?view=more&tab=notifications', 'Preferences'],
  ['/account?view=more&tab=billing', 'Workspaces'],
  ['/account?view=more&tab=team', 'Workspaces'],
  ['/account?view=more&tab=security', 'Security'],
  ['/account?view=more#account-closure', 'Privacy'],
];
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const)
  test(`CI-U4 old deep links land on the right group at ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await signInCustomer(context);
    for (const [url, name] of oldLinks) {
      await page.goto(url);
      await expect(page.getByRole('tab', { name, exact: true }), url).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await page.goto('/account?view=more&tab=security');
    await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  });

test('CI-U4 reading comfort on the Preferences page works by keyboard and has no accessibility violations', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInCustomer(context);
  await page.goto('/account?view=more&tab=preferences');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Reading comfort', level: 3 })).toBeVisible();
  const colours = panel.getByRole('switch', { name: 'Stronger Colours' });
  await colours.focus();
  await expect(colours).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Enter');
  await expect(colours).toHaveAttribute('aria-checked', 'true');
  const movement = panel.getByRole('switch', { name: 'Less Movement' });
  await movement.focus();
  await page.keyboard.press('Space');
  await expect(movement).toHaveAttribute('aria-checked', 'true');
  const large = panel.getByRole('radio', { name: /Large Text/ });
  await large.click();
  await expect(large).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByText('These choices are kept on this device only.')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.ux-account-settings').analyze();
  expect(results.violations).toEqual([]);
});
