import { test, expect } from '@playwright/test';
import { clippedText, problems, withFoldsOpen } from './fit';
import { hasDynamicSegment, pageRoutes } from '../ux/page-length-lib';
import { generatedRoutes } from '../ux/static-routes';

// W6-A: the Largest Text Size step together with 200 percent browser text (250 percent of the default, a root size
// of 40 px) on every public page, at the phone and the desktop widths, 320 included (WCAG 1.4.10 reflow is defined at 320 CSS px). W10 recorded that this case failed on many
// public components and had no test. The saved step is set the way a person sets it (the saved choice, read before
// the first paint) and the browser text is set on top of it, as the browser setting is.
//
// Every public page route in docs/revamp/COVERAGE.json that needs no fixture, the sign-in and request pages, and
// the corridor pages the build generates. For each page and width: no sideways scroll, nothing past a window
// edge, no text running out of its own box, and no text cut off by a box that hides its overflow, first as the
// page loads and then with every fold on it opened.
//
// What this is not: the root size is injected as a style, so it is not the browser's own 200 percent setting, and
// it does not rescale a media query (which the real setting does); it was run on Chromium only. A second pass forces a
// wider face on every box (KI-28: runners differ in fonts); it gives headroom where the face is installed, and falls back
// to another face where it is not, so it does not prove the result for every runner.
const publicAudiences = new Set(['public', 'public intake and customer identity']);
const routes = [
  ...pageRoutes()
    .filter((entry) => publicAudiences.has(entry.audience) && !hasDynamicSegment(entry.route))
    .map((entry) => entry.route),
  ...generatedRoutes,
].sort();
const widths = [320, 390, 1440] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

test('the route list is the public pages, not a short list', () => {
  expect(routes.length).toBeGreaterThanOrEqual(20);
  for (const path of ['/', '/plan', '/trust', '/how-it-works', '/signin', '/corridors'])
    expect(routes).toContain(path);
});

const faces = [
  ['the product fonts', ''],
  [
    'a wider face forced on every box',
    '* { font-family: "DejaVu Sans", Verdana, sans-serif !important; }',
  ],
] as const;

for (const [face, style] of faces)
  test(`with Largest text and 200% browser text every public page fits at 320, 390 and 1440, ${face}`, async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await page.addInitScript(() => localStorage.setItem('corridra.text-size', 'largest'));
    // Every page and width is measured and every miss is listed, so one run shows the whole picture.
    const failures: string[] = [];
    for (const path of routes) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.addStyleTag({ content: `html { font-size: 250% !important; } ${style}` });
        // The page's own fonts are wider or narrower than the fallback, so measure only once they are in.
        await page.evaluate(() => document.fonts.ready);
        const root = await page.evaluate(() => ({
          step: document.documentElement.getAttribute('data-text-size'),
          fontSize: getComputedStyle(document.documentElement).fontSize,
        }));
        expect(root, `${path} at ${width}: Largest saved, root size 250 percent of 16 px`).toEqual({
          step: 'largest',
          fontSize: '40px',
        });
        // /about holds a row of cards that scrolls sideways by design; the edge test skips what is inside a scroll
        // box there and nowhere else.
        const allowScrollers = path === '/about';
        const misses = [
          ...(await problems(page, { allowScrollers })).map((item) => `does not fit: ${item}`),
          ...(await clippedText(page)).map((item) => `cut off: ${item}`),
          // The same two measures with every fold on the page opened, in one opened state.
          ...(
            await withFoldsOpen(page, async () => [
              ...(await problems(page, { allowScrollers })).map((item) => `does not fit: ${item}`),
              ...(await clippedText(page)).map((item) => `cut off: ${item}`),
            ])
          ).map((item) => `folds open, ${item}`),
        ];
        for (const miss of new Set(misses)) failures.push(`${path} at ${width}: ${miss}`);
      }
    }
    expect(failures).toEqual([]);
  });
