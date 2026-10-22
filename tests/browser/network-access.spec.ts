import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Inspect compiled framework responses: a handler's private headers can otherwise
// be replaced by the application-wide header rule.
test('Network invitation, setup and task APIs retain private headers without anonymous access', async ({
  request,
}) => {
  const workspace = '11111111-1111-4111-8111-111111111111';
  for (const path of [
    '/api/workspace/network-invitations?tenant=' + workspace,
    '/api/workspace/network-invitation?tenant=' + workspace,
    '/api/operator-setup?kind=contributor',
    '/api/network/tasks?workspace=' + workspace,
  ]) {
    const response = await request.get(path);
    expect([401, 503], path).toContain(response.status());
    expect(response.headers()['cache-control'], path).toContain('no-store');
    expect(response.headers()['referrer-policy'], path).toBe('no-referrer');
  }
});

test('contributor setup explains verified access and does not collect uninvited credentials', async ({
  page,
}, info) => {
  const response = await page.goto('/contributor/setup');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(
    page.getByRole('heading', { name: 'Set up your contributor access.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account and email verification' })).toHaveAttribute(
    'href',
    '/account',
  );
  await expect(page.getByRole('link', { name: 'Assigned-task access help' })).toHaveAttribute(
    'href',
    '/contributor',
  );
  await expect(page.getByLabel('New contributor password', { exact: true })).toHaveCount(0);
  for (const width of info.project.name === 'desktop' ? [1440, 1920] : [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`contributor-setup-${width}.png`),
      fullPage: true,
    });
  }
});
