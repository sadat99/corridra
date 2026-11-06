import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// Layout budget, Phase 2b-i (docs/revamp/specs/layout-budget.md): How it works, Routes and the three route pages
// are cut into tabs with the shared SubTabs. About left the tabs for one Editorial page (owner, 6 November 2026);
// its anchors, disclosures and length are checked in about-editorial.spec.ts. Each tab fits 2.0 desktop screens (1440 x 900) and 3.0 phone
// screens (390 x 844), footer included (owner decision of 6 November 2026). Nothing is removed: every word stays in the server HTML, an old #address opens the tab that
// holds it, an in-page link opens its own target's tab, and a hidden panel is never shown by a page rule.
const tabbed = [
  { path: '/how-it-works', tabs: ['before-you-meet', 'meet-and-follow-up'] },
  { path: '/corridors', tabs: ['routes', 'route', 'sample'] },
  { path: '/corridors/bangladesh-china', tabs: ['help', 'availability', 'work'] },
  { path: '/corridors/bangladesh-spain', tabs: ['help', 'availability', 'work'] },
  { path: '/corridors/bangladesh-eu', tabs: ['help', 'availability', 'work'] },
] as const;
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));
const choose = (page: Page, id: string) => page.locator(`[role="tab"][data-tab="${id}"]`).click();

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

for (const { path, tabs } of tabbed) {
  for (const [name, size] of Object.entries(sizes))
    test(`${path}: every tab is within its page budget at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      for (const id of tabs) {
        await choose(page, id);
        expect(await screens(page), `${path} ${id} ${name}`).toBeLessThanOrEqual(
          name === 'phone' ? 3.0 : 2.0,
        );
      }
    });

  test(`${path}: keeps every word, one panel shown at a time, and never shows a hidden panel`, async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    const served = await (await page.request.get(path)).text();
    await page.goto(path);
    const same = await page.evaluate((html) => {
      // Country names in the route pickers are filled in by the browser's own locale data after the page loads
      // (the server sends codes), so the options of a select are left out of the comparison.
      const text = (node: Element | null) => {
        const copy = node?.cloneNode(true) as Element | undefined;
        copy?.querySelectorAll('select option').forEach((option) => option.remove());
        return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
      };
      const sent = new DOMParser().parseFromString(html, 'text/html');
      return { page: text(document.querySelector('main')), sent: text(sent.querySelector('main')) };
    }, served);
    expect(same.page).toBe(same.sent);
    // Every tab has its panel in the page; only the chosen one is displayed, and no rule overrides [hidden].
    const panels = await page.evaluate(() =>
      [...document.querySelectorAll('.ux-subtabs-panel')].map((panel) => ({
        hidden: (panel as HTMLElement).hidden,
        display: getComputedStyle(panel).display,
      })),
    );
    expect(panels).toHaveLength(tabs.length);
    expect(panels.filter((panel) => !panel.hidden)).toHaveLength(1);
    for (const panel of panels.filter((item) => item.hidden)) expect(panel.display).toBe('none');
  });

  test(`${path}: ?tab= opens a tab and the arrow keys move between tabs`, async ({ page }) => {
    await page.setViewportSize(sizes.desktop);
    const last = tabs[tabs.length - 1];
    await page.goto(`${path}?tab=${last}`);
    await expect(page.locator(`[role="tab"][data-tab="${last}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.locator(`[role="tab"][data-tab="${last}"]`).focus();
    await page.keyboard.press('Home');
    await expect(page.locator(`[role="tab"][data-tab="${tabs[0]}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  // Any in-page link must open the tab that holds its target with no manual tab click.
  test(`${path}: every link to a place in the page opens the tab that holds it`, async ({
    page,
  }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto(path);
    const hashes = await page
      .locator('main a[href^="#"]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')!))]);
    for (const hash of hashes) {
      await page.goto(path);
      await page.locator(`main a[href="${hash}"]`).first().click();
      await expect(page.locator(hash), `${path} ${hash}`).toBeVisible();
    }
  });

  for (const [name, size] of Object.entries(sizes))
    test(`${path}: no axe violations in any tab at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      for (const id of tabs) {
        await choose(page, id);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          result.violations.map((v) => `${id} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`),
        ).toEqual([]);
      }
    });

  for (const [name, size] of Object.entries(sizes))
    test(`${path}: keeps its primary action above the fold at ${name}`, async ({ page }) => {
      // Routes is a chooser: on a phone the list of routes comes first and its start link follows the cards
      // (it is above the fold on a wide screen).
      test.skip(path === '/corridors' && name === 'phone', 'the chooser comes first on a phone');
      await page.setViewportSize(size);
      await page.goto(path);
      // Routes opens on the list of routes, whose way to start a request is the /plan link. The home is not
      // tabbed any more (concept G); its first-screen check is in home-concept-g.spec.ts.
      const action = page
        .locator(path === '/corridors' ? 'main a[href="/plan"]' : 'main a.primary-link')
        .first();
      await expect(action).toBeVisible();
      const box = (await action.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    });
}

// An old address lands on its content: the tab that holds it opens, then the element is shown.
const oldAddresses: [string, string, string][] = [
  ['/corridors#mission-example', 'sample', '#mission-example'],
  ['/corridors#commercial-objective', 'route', '#commercial-objective'],
  ['/corridors#directions-title', 'routes', '#directions-title'],
];
for (const [address, tab, target] of oldAddresses)
  test(`${address} opens the ${tab} tab and shows ${target}`, async ({ page }) => {
    await page.setViewportSize(sizes.desktop);
    await page.goto(address);
    await expect(page.locator(`[role="tab"][data-tab="${tab}"]`), `${address} tab`).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator(target)).toBeVisible();
  });
