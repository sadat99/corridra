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
    expect(names[0]).toBe('Profile');
    expect(names).toContain('Security');
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
