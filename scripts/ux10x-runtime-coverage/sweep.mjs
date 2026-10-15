import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default ?? require('@axe-core/playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.argv[2];
const origin = process.env.SWEEP_ORIGIN ?? 'http://127.0.0.1:3100';
mkdirSync(out, { recursive: true });
const routes = [
  '/',
  '/sell',
  '/source',
  '/machinery',
  '/enter-market',
  '/business-trips',
  '/trade-missions',
  '/how-it-works',
  '/about',
  '/trust',
  '/network',
  '/institutions',
  '/privacy',
  '/corridors',
  '/corridors/bangladesh-china',
  '/corridors/bangladesh-spain',
  '/corridors/bangladesh-eu',
  '/plan',
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/account',
  '/workspace',
  '/coming-soon',
  '/operator/signin',
  '/operator/setup',
  '/operator/forgot-password',
  '/operator/reset-password',
  '/buyer',
  '/client',
  '/programme',
  '/contributor',
  '/operator',
  '/not-a-real-route',
];
const widths = [1440, 1280, 768, 390, 360, 320];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const results = [];
const writes = [];
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(r.method() + ' ' + new URL(r.url()).pathname);
  });
  for (const r of routes) {
    const res = await page.goto(origin + r, { waitUntil: 'networkidle' }).catch(() => null);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const h1 = await page.locator('h1').count();
    results.push({
      route: r,
      width: w,
      status: res?.status() ?? null,
      finalPath: new URL(page.url()).pathname,
      overflowPx: overflow,
      h1,
      axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    });
    if (
      ['/', '/plan', '/workspace', '/operator/signin', '/account'].includes(r) &&
      [1440, 390].includes(w)
    )
      await page.screenshot({
        path: `${out}/${r === '/' ? 'home' : r.slice(1).replace(/\//g, '-')}-${w}.png`,
        fullPage: false,
      });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/sweep.json`, JSON.stringify({ writes, results }, null, 1));
const bad = results.filter((x) => x.axe.length || x.overflowPx > 0);
console.log(
  'checked',
  results.length,
  'writes',
  writes.length,
  'with axe/overflow issues',
  bad.length,
);
for (const b of bad.slice(0, 40))
  console.log(b.route, b.width, 'overflow', b.overflowPx, JSON.stringify(b.axe));
