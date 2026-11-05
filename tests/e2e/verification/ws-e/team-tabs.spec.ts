import { test, expect, signInOwner } from '../fixtures';

// L-03 on the real team pages: choosing a tab shows that tab's panel and only that one, at every width
// (a layout rule that gives a panel its own display must never show a hidden panel).
const routes: [string, string[]][] = [
  ['/operator/controls', ['people', 'invite', 'tools']],
  ['/operator/readiness', ['deferred', 'blocked', 'rules']],
  ['/operator/delivery', ['programmes', 'publication', 'access', 'experience']],
  ['/operator/owner', ['status', 'gaps', 'technical']],
];

// One sign-in for the whole check; the widths are set on the page itself, so it runs once, not once per project.
test('each team tab shows its own panel and no other, at 1440 and 390', async ({ page }, info) => {
  test.skip(info.project.name !== 'w1280', 'sets its own widths');
  test.setTimeout(300000);
  const seed = await signInOwner(page);
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [route, tabs] of routes) {
      for (const tab of tabs) {
        await page.goto(`${route}?workspace=${seed.tenantId}&tab=${tab}`);
        const selected = page.locator('[role="tab"][aria-selected="true"]');
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('data-tab', tab);
        // Exactly one panel is shown: the one the selected tab controls.
        const visible = page.locator('[role="tabpanel"]:visible');
        await expect(visible, `${route} ${tab} at ${width}`).toHaveCount(1);
        await expect(visible).toHaveAttribute('data-subtab', tab);
      }
    }
  }
});
