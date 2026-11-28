import { test, expect, signInOwner } from '../fixtures';

// Wave 1: the public marketing footer does not sit under a signed-in workspace. The staff workspace
// shows a one-line footer with the privacy notice; public pages and the sign-in page keep the full
// footer. Since 28 Nov 2026 both are the new home footer (CORRIDRA_UX_HOME_V44, live by default), which replaces the
// footer of every page. (The customer workspace uses the same rule; it is covered by tests/integration/site-footer-workspace.test.ts.)

test('a signed-in workspace shows a one-line footer with the privacy link, not the marketing footer', async ({
  page,
}) => {
  await signInOwner(page, '/operator');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.locator('footer.guide-footer')).toHaveCount(0);
  await expect(page.locator('footer[data-footer="v44"]')).toHaveCount(1);
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
    const footer = page.locator('footer[data-footer="v44"]');
    await expect(footer, path).toHaveCount(1);
    // On the request page the four link groups are folded into one disclosure to open.
    for (const summary of await footer.locator('details.hv7-footer-fold > summary').all())
      if (!(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)))
        await summary.click();
    for (const href of ['/workspace', '/trust', '/about', '/network', '/institutions', '/privacy'])
      await expect(footer.locator(`a[href="${href}"]`).first(), `${path} ${href}`).toBeVisible();
  }
});
