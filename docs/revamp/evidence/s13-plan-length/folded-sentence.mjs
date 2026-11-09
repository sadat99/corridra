// Estimate for "folding the availability sentence too": hides the test notice's availability sentence with an injected
// style at 390 x 844 and measures the document height. An estimate by CSS, not a built variant. Usage: node folded-sentence.mjs [baseUrl]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'http://localhost:3100';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const out = { base, width: 390, height: 844, variants: [] };
for (const [name, css] of [
  ['as built', ''],
  ['availability sentence hidden', '.intake-notice-compact > p { display: none !important; }'],
]) {
  const page = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  ).newPage();
  await page.goto(`${base}/plan`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (css) await page.addStyleTag({ content: css });
  const document_ = await page.evaluate(() => document.documentElement.scrollHeight);
  out.variants.push({ name, document: document_, screens: +(document_ / 844).toFixed(2) });
  if (css) await page.screenshot({ path: join(here, 'folded-sentence-390.png'), fullPage: true });
  await page.close();
}
await browser.close();
writeFileSync(join(here, 'folded-sentence.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.variants));
