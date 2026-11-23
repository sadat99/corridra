import { expect, test } from '@playwright/test';

// ADR-090. The opt-out page of one emailed introduction, /buyer?stop=1#<token>, on the built app. Opening it sends
// nothing; only the button posts the opt-out. /api/outreach is answered here, so no service is needed.
const token = 'c'.repeat(64);
async function open(page: import('@playwright/test').Page, hash: string, status = 200) {
  const posts: { method: string; body: string | null }[] = [];
  await page.route('**/api/outreach/**', async (route) => {
    posts.push({ method: route.request().method(), body: route.request().postData() });
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { stopped: true } : { error: 'Not found' }),
    });
  });
  await page.goto(`/buyer?stop=1#${hash}`);
  await expect(page.getByRole('heading', { name: 'Stop emails to this address' })).toBeVisible();
  return posts;
}

test('opening the page sends nothing, and the button records the opt-out once', async ({
  page,
}) => {
  const posts = await open(page, token);
  const button = page.getByRole('button', { name: 'Stop These Emails' });
  await expect(button).toBeVisible();
  await expect(page.getByRole('status')).toContainText('we will not email this address again');
  expect(posts).toEqual([]);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Done. We will not email this address again.');
  await expect(button).toHaveCount(0);
  expect(posts).toEqual([{ method: 'POST', body: JSON.stringify({ t: token }) }]);
  expect(await page.locator('main').innerText()).not.toContain('—');
});

test('a link without a usable token, or one the server does not know, says the one shared line', async ({
  page,
}) => {
  const gone =
    'This link does not open. It may be incomplete or replaced. Open the complete link from the email.';
  const none = await open(page, 'not-a-token');
  await expect(page.getByRole('status')).toHaveText(gone);
  await expect(page.getByRole('button', { name: 'Stop These Emails' })).toHaveCount(0);
  expect(none).toEqual([]);
  const unknown = await open(page, token, 404);
  await page.getByRole('button', { name: 'Stop These Emails' }).click();
  await expect(page.getByRole('status')).toHaveText(gone);
  expect(unknown).toHaveLength(1);
});

test('the page fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, token);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
