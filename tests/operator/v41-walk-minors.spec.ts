import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Final walk m2 (25 Nov 2026): /operator/signin while signed out logged a console error, a 401 from the invitation
// hint's check of the customer session. Signed out is the expected state there, so the page stays quiet: no console
// error, no failed request, and the sign-in form, links and axe result are as they were.

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400)
      problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return problems;
}

for (const address of ['/operator/signin', '/operator/signin?next=%2Fcontributor'])
  test(`signed out, ${address} logs no console error and no failed request`, async ({ page }) => {
    const problems = watch(page);
    let setupAsked = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/operator-setup') setupAsked += 1;
    });
    await page.goto(address);
    await expect(page.getByRole('form', { name: /sign-in/ })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    // The hint's check runs after load and again on focus; let both answer (the page holds a live connection, so
    // "network idle" never comes).
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1500);
    expect(problems).toEqual([]);
    // Signed out, the invitation hint is not drawn and asks nothing.
    await expect(page.getByRole('region', { name: 'Pending team invitation' })).toHaveCount(0);
    expect(setupAsked).toBe(0);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

// A browser that holds a customer session still has its invitation looked up, as before: the hint asks once on load.
test('with a customer session cookie the invitation hint still asks', async ({ page, context }) => {
  await context.addCookies([
    {
      name: '__Secure-neon-auth.session_token',
      value: 'invented-stale-token',
      domain: '127.0.0.1',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const asked = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/operator-setup',
  );
  await page.goto('/operator/signin');
  await asked;
  await expect(page.getByLabel('Email')).toBeVisible();
});
