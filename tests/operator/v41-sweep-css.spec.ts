import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

// Team desk v4.1 final sweep: the real stylesheets of the sweep fixes, measured in a browser on the real cascade
// (markup written to mirror the shapes the pages draw). Switch ON is the desk shell class "ux-desk-frame"; OFF is
// the same page without it. Widths 390 and 1440.
const css = [
  'app/globals.css',
  'app/operator/operator-overview.css',
  'components/ux/page-frame.css',
  'components/ux/dialog.css',
  'components/problem-reports/problem-reports.css',
]
  .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
  .join('\n');

const page_ = (
  on: boolean,
) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>
<div class="site-shell"><main class="ux-workspace ux-operator-home${on ? ' ux-desk-frame' : ''}">
  <header class="ux-page-heading"><h1>Meetings</h1><div class="ux-frame-lead"><p class="ux-frame-helper">One purpose line.</p><div class="ux-frame-primary"><button id="primary" class="primary-link" type="button">Propose Meeting</button></div></div></header>
  <div class="ux-workspace-body">
    <div id="panel" class="workspace-panel ux-panel"><p>Body</p>
      <dialog id="dialog" class="ux-dialog" open><div class="ux-dialog-head"><h2>Propose Meeting</h2><button id="close" type="button" class="ux-dialog-close">Close</button></div></dialog>
    </div>
  </div>
</main></div>
<div class="pr-column"><details class="pr-fold" id="fold"><summary>What Each Status Means</summary><p>Words</p></details></div>
</body></html>`;

async function open(page: Page, on: boolean, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(page_(on));
}
const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

for (const width of [390, 1440]) {
  test(`switch on at ${width}: no outer card round the page, a 44 px dialog Close, the primary on the left edge`, async ({
    page,
  }) => {
    await open(page, true, width);
    const panel = await page.locator('#panel').evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, padding: s.paddingTop, shadow: s.boxShadow };
    });
    expect(panel).toEqual({ border: '0px', padding: '0px', shadow: 'none' });
    const close = await box(page, '#close');
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.width).toBeGreaterThanOrEqual(44);
    const [title, primary] = await Promise.all([box(page, 'h1'), box(page, '#primary')]);
    expect(Math.abs(primary.x - title.x)).toBeLessThanOrEqual(1);
  });

  test(`switch off at ${width}: the panel keeps its card`, async ({ page }) => {
    await open(page, false, width);
    const border = await page
      .locator('#panel')
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).toBe('1px');
  });

  test(`at ${width}: the problem report fold keeps its marker and is at least 44 px tall`, async ({
    page,
  }) => {
    await open(page, true, width);
    const summary = page.locator('#fold > summary');
    expect(await summary.evaluate((el) => getComputedStyle(el).display)).toBe('list-item');
    expect(await summary.evaluate((el) => getComputedStyle(el).listStyleType)).not.toBe('none');
    expect((await box(page, '#fold > summary')).height).toBeGreaterThanOrEqual(44);
  });
}
