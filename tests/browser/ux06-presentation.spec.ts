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
  // The six road steps (D5): Define, Find, Compare, Visit, Decide, Follow through.
  await expect(page.getByRole('list', { name: 'How a mission works' }).locator('li')).toHaveCount(
    6,
  );
  await expect(page.getByRole('link', { name: 'How we label facts' })).toHaveAttribute(
    'href',
    '/trust',
  );
  // Every way to work and every guide page stays reachable from the footer.
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
  // How it works and Routes live in the header, so the footer does not repeat them.
  await expect(page.locator('footer a[href="/how-it-works"]')).toHaveCount(0);
  await expect(page.locator('footer a[href="/corridors"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/corridors');
  await openFineTune(page);
  await expect(page.getByRole('combobox', { name: 'Route', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/trust');
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
  await example.getByRole('button', { name: 'Close the example' }).click();
  await expect(page.getByRole('button', { name: 'Open the sample mission' })).toBeFocused();
  await expect(example.getByRole('button', { name: '2. Inspect the evidence' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(example.getByRole('button', { name: '1. Define the objective' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await openFineTune(page);
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('china-bangladesh');
  await expect(page.getByLabel('Route map', { exact: true })).toContainText('China → Bangladesh');
  await expect(page.getByRole('link', { name: 'Plan a mission on this route' })).toHaveAttribute(
    'href',
    '/plan?companyCountry=CN&marketCode=BD&job=sourcing',
  );
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

test('footer keeps equal link groups together on tablets and stacks them on phones', async ({
  page,
}) => {
  for (const width of [1440, 1000, 768, 701, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const footer = page.locator('footer');
    const first = footer.getByRole('navigation', { name: 'Footer solutions', exact: true });
    const second = footer.getByRole('navigation', { name: 'About Corridra', exact: true });
    await expect(first.getByRole('link')).toHaveCount(6);
    await expect(second.getByRole('link')).toHaveCount(6);
    const a = (await first.boundingBox())!;
    const b = (await second.boundingBox())!;
    if (width > 700) {
      expect(Math.abs(a.y - b.y), `link groups share a row at ${width}px`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(a.width - b.width),
        `link columns are equal at ${width}px`,
      ).toBeLessThanOrEqual(1);
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      if (width <= 1000) {
        const brand = (await footer.locator('.guide-footer-brand').boundingBox())!;
        expect(a.y).toBeGreaterThanOrEqual(brand.y + brand.height);
      }
    } else {
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    }
  }
});
