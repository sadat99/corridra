import { test, expect, signInOwner } from '../fixtures';

// Wave 1: the public marketing footer does not sit under a signed-in workspace. The staff workspace
// shows a one-line footer with the privacy notice; public pages and the sign-in page keep the full
// footer. (The customer workspace uses the same rule; it is covered by tests/integration/site-footer-workspace.test.ts.)

test('a signed-in workspace shows a one-line footer with the privacy link, not the marketing footer', async ({
  page,
}) => {
  await signInOwner(page, '/operator');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.locator('footer.guide-footer')).toHaveCount(0);
  const footer = page.locator('footer');
  await expect(footer).toHaveCount(1);
  await expect(footer).toContainText('© 2026 Corridra');
  await expect(footer.getByRole('link', { name: /intake notice|privacy/i })).toHaveAttribute(
    'href',
    '/privacy',
  );
  await expect(footer.getByRole('link', { name: 'Institutions' })).toHaveCount(0);
  const box = (await footer.boundingBox())!;
  expect(box.height).toBeLessThan(120);
});

test('public pages and the staff sign-in page keep the full footer', async ({ page }) => {
  for (const path of ['/', '/about', '/plan', '/operator/signin']) {
    await page.goto(path);
    const footer = page.locator('footer.guide-footer');
    await expect(footer, path).toHaveCount(1);
    for (const href of ['/workspace', '/trust', '/about', '/network', '/institutions', '/privacy'])
      await expect(footer.locator(`a[href="${href}"]`).first(), `${path} ${href}`).toBeVisible();
  }
});
