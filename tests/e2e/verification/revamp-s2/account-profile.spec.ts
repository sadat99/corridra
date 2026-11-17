import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInCustomer } from '../fixtures';

// ADR-086 (CI-U1): My Profile in the Profile group. This server runs with customer workspaces off, so the card is the
// read-only verified email and name: it never asks /api/customer-personal-profile, offers no name edit and stays axe clean.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const)
  test(`CI-U1 the Profile card with personal details off at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await signInCustomer(context);
    const asked: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/customer-personal-profile'))
        asked.push(request.url());
    });
    await page.goto('/account?view=more');
    const card = page.locator('section.ux-account-profile');
    await expect(
      card.getByRole('heading', { name: 'Profile and Identity', level: 2 }),
    ).toBeVisible();
    await expect(card.getByText('Verified account email')).toBeVisible();
    await expect(
      card.getByText('Your email address is verified. This does not verify your company.'),
    ).toBeVisible();
    // The panel would ask on mount; give the page time to hydrate and any such request to start (the account page
    // polls elsewhere, so the network never goes idle).
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    expect(asked).toEqual([]);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await expect(card.getByText('Loading your details...')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('section.ux-account-profile').analyze();
    expect(results.violations).toEqual([]);
  });
