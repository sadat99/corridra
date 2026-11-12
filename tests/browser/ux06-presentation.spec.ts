import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

async function openFineTune(page: Page) {
  const details = page.locator('.ux-fine-tune');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('UX-06 the home is one question, and the route explorer and mission guide keep every destination', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
  });
  await page.goto('/');
  await expect(page.locator('.ux-guide-home h1')).toHaveCount(1);
  await expect(
    page.getByRole('navigation', { name: 'Choose your commercial objective' }).getByRole('link'),
  ).toHaveCount(3);
  // The six road steps (D5): Define, Find, Compare, Visit, Decide, Follow through (the example player).
  await expect(page.getByRole('list', { name: 'How a mission works' }).locator('li')).toHaveCount(
    6,
  );
  // The footer has its own How We Label Facts link, so the home's link is found in the page content.
  await expect(
    page.getByRole('main').getByRole('link', { name: 'How we label facts' }),
  ).toHaveAttribute('href', '/trust');
  // Every way to work and every guide page stays reachable from the footer.
  await openFooterGroups(page);
  for (const href of [
    '/sell',
    '/source',
    '/enter-market',
    '/trade-missions',
    '/trust',
    '/network',
    '/institutions',
  ])
    await expect(page.locator(`footer a[href="${href}"]`).first()).toBeVisible();
  // The Ledger footer (owner decision of 6 November 2026) lists How It Works and Explore Every Route once each.
  await expect(page.locator('footer a[href="/how-it-works"]')).toHaveCount(1);
  await expect(page.locator('footer a[href="/corridors"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/corridors');
  await page.getByRole('tab', { name: 'Pick Your Route' }).click(); // the picker is its own tab
  await openFineTune(page);
  await expect(page.getByRole('combobox', { name: 'Route', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/trust');
  await page.locator('details.guide-more > summary').click(); // the closing sections sit behind Show more
  await expect(
    page.getByRole('heading', { name: 'A meeting is not a sale. A contract is not cash.' }),
  ).toBeVisible();
  await expect(page.locator('.outcome-path li')).toHaveCount(11);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(writes).toEqual([]);
});

test('UX-06 the old sample mission link on the home page still arrives at the sample mission', async ({
  page,
}) => {
  await page.goto('/#mission-example');
  await expect(page).toHaveURL(/\/corridors#mission-example$/);
  await expect(page.getByRole('region', { name: 'Sample mission' })).toBeVisible();
});

test('UX-06 legacy example fragment opens the real synthetic flow and close restores focus', async ({
  page,
}) => {
  await page.goto('/corridors#mission-example');
  const example = page.getByRole('region', { name: 'Sample mission' });
  await expect(example.getByRole('button', { name: '2. Inspect the evidence' })).toBeVisible();
  await example.getByRole('button', { name: '2. Inspect the evidence' }).focus();
  await page.keyboard.press('Enter');
  await expect(example.getByText('Evidence not established', { exact: true })).toBeVisible();
  await example.getByRole('button', { name: 'Close the Example' }).click();
  await expect(page.getByRole('button', { name: 'Open the Sample Mission' })).toBeFocused();
  await expect(example.getByRole('button', { name: '2. Inspect the evidence' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(example.getByRole('button', { name: '1. Define the objective' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.getByRole('tab', { name: 'Pick Your Route' }).click(); // the picker is its own tab
  await openFineTune(page);
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('china-bangladesh');
  await expect(page.getByLabel('Route map', { exact: true })).toContainText('China → Bangladesh');
  await expect(page.getByRole('link', { name: 'Plan a Mission on This Route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=CN&marketCode=BD&job=sourcing',
  );
  await page.getByRole('tab', { name: 'Sample Mission' }).click();
  await expect(example).toContainText('No operating offer is announced');
});

test('UX-06 discovery preserves keyboard and content at all required widths and reduced motion', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const observations = [];
  const directory = '.cache/ux06/public-after';
  await mkdir(directory, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1280, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Make market entry deliberate.',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(overflow).toBe(false);
    expect(violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByRole('main').evaluate((node) => node.blur());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    // Capture the initial pointer view separately from the completed keyboard check.
    await page.goto('/');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const skipBox = await page.getByRole('link', { name: 'Skip to content' }).boundingBox();
    expect(skipBox!.y + skipBox!.height).toBeLessThan(0);
    await page.screenshot({
      path: `${directory}/discovery-${width}-${info.project.name}.png`,
      fullPage: true,
    });
    observations.push({
      width,
      overflow,
      axeViolations: violations.length,
      height: await page.evaluate(() => document.documentElement.scrollHeight),
      paint: await page.evaluate(() =>
        performance
          .getEntriesByType('paint')
          .map((p) => ({ name: p.name, milliseconds: p.startTime })),
      ),
    });
  }
  await writeFile(
    `${directory}/observations-${info.project.name}.json`,
    JSON.stringify(
      {
        observations,
        limits:
          'Synthetic public presentation; paint measurements are not field Core Web Vitals or hosted-account acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
});

// On a phone the footer's link groups are disclosures (opening one is one tap); from 701 px every group is open.
const openFooterGroups = async (page: import('@playwright/test').Page) => {
  for (const summary of await page.locator('footer details.guide-footer-details > summary').all())
    if (
      (await summary.isVisible()) &&
      !(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open))
    )
      await summary.click();
};

test('footer keeps four links in each of four groups, collapsed on a phone except Buy Abroad and open from 701 px, at every width', async ({
  page,
}) => {
  for (const width of [1440, 1000, 768, 701, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const footer = page.locator('footer');
    const groups = footer.locator('details.guide-footer-details');
    await expect(groups, `four link groups at ${width}px`).toHaveCount(4);
    // Option B (owner decision, 12 Nov 2026): Buy Abroad starts open; no other group does.
    await expect(groups.first(), `Buy Abroad starts open at ${width}px`).toHaveAttribute(
      'open',
      '',
    );
    for (const group of (await groups.all()).slice(1))
      await expect(group, `no other group starts open at ${width}px`).not.toHaveAttribute(
        'open',
        '',
      );
    const nav = footer.getByRole('navigation', { name: 'Footer', exact: true });
    if (width <= 700) {
      for (const group of await groups.all())
        await expect(group.locator('summary'), `${width}px`).toBeVisible();
      for (const group of (await groups.all()).slice(1))
        await expect(group.getByRole('link').first(), `${width}px`).toBeHidden();
      await openFooterGroups(page);
    } else {
      for (const group of await groups.all())
        await expect(group.locator('summary'), `${width}px`).toBeHidden();
    }
    for (const group of await groups.all()) {
      await expect(group.getByRole('link')).toHaveCount(4);
      for (const link of await group.getByRole('link').all()) await expect(link).toBeVisible();
    }
    await expect(nav.getByRole('link')).toHaveCount(16);
    // The groups never overlap: they stack on a phone and sit in columns on a wide screen.
    const boxes = await groups.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.right <= b.left + 1 ||
          b.right <= a.left + 1 ||
          a.bottom <= b.top + 1 ||
          b.bottom <= a.top + 1;
        expect(apart, `groups do not overlap at ${width}px`).toBe(true);
      }
  }
});
