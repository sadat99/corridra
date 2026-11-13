import { expect, type Locator, type Page } from '@playwright/test';
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

// A long section is cut into sub-tabs (L-03). Choose one before touching what is inside it.
export async function openTab(scope: Page | Locator, name: string) {
  const tab = scope.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

// The tool list of the owner controls is folded behind its summary at every width (page length). Open
// the Available tools tab and then the list.
export async function openTools(page: Page) {
  await openTab(page, 'Available tools');
  const fold = page.locator('#workspace-controls details.phone-fold').first();
  if (!(await fold.evaluate((details) => (details as HTMLDetailsElement).open)))
    await fold.locator(':scope > summary').click();
  await expect(fold).toHaveAttribute('open', '');
}

// On a phone the jump links of a panel are folded behind one button (L21); open it before using a link.
// Does nothing from 40rem up, where the button is not shown.
export async function openJumpLinks(scope: Page | Locator) {
  const toggle = scope.locator('.ux-workbench-toggle').first();
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
}
