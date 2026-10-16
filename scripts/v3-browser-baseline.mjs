import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.env.V3_BASELINE_ORIGIN ?? 'http://127.0.0.1:3100';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Local baseline only');
const stage = process.argv[2] ?? 'baseline';
if (!['baseline', 'entry'].includes(stage)) throw new Error('Unknown capture stage');
const out = stage === 'baseline' ? 'docs/v3/phase-0/browser' : 'docs/v3/phase-1/entry/browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const routes =
      stage === 'entry'
        ? ['/', '/plan']
        : [
            '/',
            '/plan',
            '/workspace',
            '/account',
            '/operator/signin',
            '/client',
            '/programme',
            '/buyer',
            '/contributor',
          ];
    for (const route of routes) {
      const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const file = `${route === '/' ? 'home' : route.slice(1).replaceAll('/', '-')}-${width}.png`;
      await page.screenshot({ path: `${out}/${file}`, fullPage: true });
      results.push({
        route,
        width,
        httpStatus: response.status(),
        finalPath: new URL(page.url()).pathname,
        file,
        sha256: createHash('sha256')
          .update(await readFile(`${out}/${file}`))
          .digest('hex'),
        overflowPx: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.map((n) => n.target),
        })),
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  `${out}/observations.json`,
  JSON.stringify(
    {
      baseline: 'e9ed2e53d97f543c30bace29d9ef38d568a65236',
      stage,
      applicationFiles: await Promise.all(
        ['apps/web/components/discovery-experience.tsx', 'apps/web/app/globals.css'].map(
          async (file) => ({
            file,
            sha256: createHash('sha256')
              .update(await readFile(file))
              .digest('hex'),
          }),
        ),
      ),
      scope:
        'Unauthenticated local baseline; denied/private screens only. Protected journey results recorded separately.',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    routeViewportObservations: results.length,
    axeViolations: results.reduce((n, r) => n + r.violations.length, 0),
    overflowing: results.filter((r) => r.overflowPx > 1).length,
  }),
);
