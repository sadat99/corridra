import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const stage = process.argv[2];
if (!['baseline', 'after'].includes(stage))
  throw new Error('Usage: node scripts/ux10x-browser-evidence.mjs baseline|after');
const out = `.cache/ux10x/${stage}/screenshots`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  headless: true,
});
const results = [];
for (const width of [1440, 1280, 768, 390, 360, 320]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  for (const route of [
    '/workspace',
    '/operator',
    '/operator/signin',
    '/operator/setup',
    '/client',
  ]) {
    await page.goto('http://127.0.0.1:3100' + route);
    await page.getByRole('main').waitFor();
    await page.waitForTimeout(250);
    const label = route.slice(1).replaceAll('/', '-');
    await page.screenshot({ path: `${out}/${label}-${width}.png`, fullPage: true });
    const axe = await new AxeBuilder({ page }).analyze();
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigation: performance.getEntriesByType('navigation').map((x) => ({
        responseEnd: x.responseEnd,
        domContentLoaded: x.domContentLoadedEventEnd,
        load: x.loadEventEnd,
      })),
      paint: performance
        .getEntriesByType('paint')
        .map((x) => ({ name: x.name, startTime: x.startTime })),
    }));
    results.push({
      route,
      width,
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
      ...metrics,
    });
  }
  await context.close();
}
await browser.close();
await writeFile(
  `.cache/ux10x/${stage}/browser-measurements.json`,
  JSON.stringify(results, null, 2) + '\n',
);
console.log(`${results.length} route/viewport observations captured`);
