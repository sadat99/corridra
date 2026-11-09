// Usage: node measure.mjs <label> [baseUrl]. Measures /plan (production build) and writes <label>-<width>.png and <label>.json here.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const [label = 'run', base = 'http://localhost:3100'] = process.argv.slice(2);
const sizes = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
  { width: 1780, height: 900 },
];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const out = { label, base, results: [] };
for (const { width, height } of sizes) {
  const page = await (
    await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    })
  ).newPage();
  await page.goto(`${base}/plan`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => {
    const h = (s) => document.querySelector(s)?.getBoundingClientRect().height ?? null;
    return {
      document: document.documentElement.scrollHeight,
      header: h('header'),
      head: h('.guide-plan-head'),
      notice: h('.guide-plan-top'),
      form: h('form.intake-form'),
      receipt: h('#receipt-check'),
      summary: h('.ux-brief-summary'),
      footer: h('footer.guide-footer'),
    };
  });
  await page.screenshot({ path: join(here, `${label}-${width}.png`), fullPage: true });
  out.results.push({ width, height, ...m, screens: +(m.document / height).toFixed(2) });
  await page.close();
}
await browser.close();
writeFileSync(join(here, `${label}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.results));
