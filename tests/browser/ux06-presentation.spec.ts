import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

async function openFineTune(page: Page) {
  const details = page.locator('.ux-fine-tune');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('UX-06 discovery prioritizes exploration and preserves the complete mission guide', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
  });
  await page.goto('/');
  const explore = page.getByRole('link', { name: 'Explore a commercial direction' });
  await explore.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#commercial-objective')).toBeInViewport();
  await openFineTune(page);
  await expect(
    page.getByRole('combobox', { name: 'Commercial direction', exact: true }),
  ).toBeVisible();
  const guide = page.locator('.ux-home-guide');
  await expect(guide).not.toHaveAttribute('open', '');
  await guide.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(guide).toHaveAttribute('open', '');
  for (const href of [
    '/sell',
    '/source',
    '/enter-market',
    '/trade-missions',
    '/how-it-works',
    '/trust',
    '/network',
    '/institutions',
    '/plan',
  ]) {
    await expect(guide.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  await expect(
    guide.getByRole('heading', { name: 'A meeting is not a sale. A contract is not cash.' }),
  ).toBeVisible();
  await expect(guide.locator('.outcome-path li')).toHaveCount(11);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await guide.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(guide).not.toHaveAttribute('open', '');
  await expect(guide.locator('summary')).toBeFocused();
  expect(writes).toEqual([]);
});

test('UX-06 legacy example fragment opens the real synthetic flow and close restores focus', async ({
  page,
}) => {
  await page.goto('/#mission-example');
  const example = page.getByRole('region', { name: 'Sample mission' });
  await expect(example.getByRole('button', { name: '2. Inspect the evidence' })).toBeVisible();
  await example.getByRole('button', { name: '2. Inspect the evidence' }).focus();
  await page.keyboard.press('Enter');
  await expect(example.getByText('Evidence not established', { exact: true })).toBeVisible();
  await example.getByRole('button', { name: 'Close the example' }).click();
  await expect(page.getByRole('link', { name: 'See a sample mission' })).toBeFocused();
  await expect(example.getByRole('button', { name: '2. Inspect the evidence' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(example.getByRole('button', { name: '1. Define the objective' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await openFineTune(page);
  await page
    .getByRole('combobox', { name: 'Commercial direction', exact: true })
    .selectOption('china-bangladesh');
  await expect(page.getByLabel('Corridor Atlas', { exact: true })).toContainText(
    'China → Bangladesh',
  );
  await expect(page.getByRole('link', { name: 'Prepare this example request' })).toHaveAttribute(
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
      'Find the right market.Meet the right people.Know what to do next.',
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
