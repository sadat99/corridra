import { expect, type Page } from '@playwright/test';
// The workspace shows one panel at a time, chosen by the URL hash. Open one the way a link does.
export async function openSection(page: Page, id: string) {
  // Wait for the scoped workspace to mount after sign-in/reload before changing its fragment.
  await expect(page.locator('#workspace-navigation')).toBeAttached();
  await expect(page.locator('#' + id)).toBeAttached();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, id);
  await expect(page.locator('#' + id)).toBeVisible();
}
