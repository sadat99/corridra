import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('About explains the product, audience, process and commercial boundaries', async ({
  page,
}, info) => {
  await page.goto('/about');
  for (const heading of [
    'Why Corridra exists',
    'What a mission means',
    'Who it is for',
    'How the work progresses',
    'Where we focus',
    'What makes progress credible',
    'Working with Corridra',
  ])
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Start a request', exact: true }).first(),
  ).toHaveAttribute('href', '/plan');
  for (const width of info.project.name === 'desktop' ? [1440, 1920] : [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`about-${width}.png`), fullPage: true });
  }
});

test('Privacy explains account data, private requests, retention and the deferred scan status', async ({
  page,
}, info) => {
  await page.goto('/privacy');
  for (const heading of [
    'Who is responsible',
    'Your account',
    'What a request contains',
    'Drafts and account activation',
    'Who can see the work',
    'Files and deferred scanning',
    'Retention and deletion requests',
    'Replies and next steps',
  ])
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'sadat@obsidianglobal.studio', exact: true }),
  ).toHaveAttribute('href', 'mailto:sadat@obsidianglobal.studio');
  for (const width of info.project.name === 'desktop' ? [1440, 1920] : [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`privacy-${width}.png`), fullPage: true });
  }
});
