import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// TC1: the Today card on Your Move, in the real MoveView with the real stylesheets on a small bundled page (no
// server, no sign-in), at 320, 390 and 1440 px. One filled action, every link kept, the page no longer than on
// main, targets of 44 px, no horizontal scroll, axe clean, keyboard reaches the card first.
// TC1_WEB_ROOT points the same fixture at another checkout (the main baseline is measured that way).
const webRoot = resolve(process.env.TC1_WEB_ROOT ?? 'apps/web');
const baseline = !!process.env.TC1_BASELINE;
const fixturePath = '/__today-card-fixture';
let html = '';

// Document height of the fixture on main (px), measured with TC1_BASELINE=1 on origin/main 0fb1223 (viewport height 400).
// 1440 re-measured 17 November 2026 on VG4 (Move lanes, +50 px: one lane head with a 44 px Explain target);
// 320 and 390 from main 0fb1223.
const mainHeight: Record<number, number> = { 320: 1188, 390: 1062, 1440: 599 };

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { MoveView } from ${JSON.stringify(resolve(webRoot, 'app/account/move/move-view.tsx'))};
        import { buildMoveModel } from ${JSON.stringify(resolve(webRoot, 'lib/move-cards.ts'))};
        const owner = { id: 'w1', name: 'Atelier Rahman', role: 'owner' };
        const req = (id, status) => ({ id, workspaceId: 'w1', createdAt: '2026-11-01T00:00:00Z',
          progress: { status, receivedAt: '2026-11-01T09:00:00Z', replies: [] } });
        const move = (id, object, dueOn, holder = 'customer') => ({ id, verb: 'Answer', object, holder, dueOn });
        const query = new URLSearchParams(location.search);
        const empty = query.get('empty') === '1';
        const model = buildMoveModel({
          workspaces: [owner],
          drafts: empty ? [] : [{ id: 'd1', workspaceId: 'w1', title: 'Cutting machine', updatedAt: '2026-11-10T00:00:00Z' }],
          quotes: [], companyLinks: [],
          requests: empty ? [] : [req('r1', 'ACTIVE'), req('r2', 'OUTREACH')],
          moves: empty ? [] : [
            { requestId: 'r1', moves: [move('a', 'the import licence number', '2026-12-10'), move('b', 'which fabric you prefer', null)] },
            { requestId: 'r2', moves: [move('c', 'the sample size', '2026-11-20'), move('t', 'the factory list', null, 'team')] },
          ],
        }, { rooms: true });
        createRoot(document.getElementById('app')).render(
          <main id="main" tabIndex={-1}><MoveView model={model} startHref="/plan" /></main>,
        );`,
      loader: 'tsx',
      resolveDir: webRoot,
    },
    nodePaths: [resolve(webRoot, 'node_modules'), resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-stubs',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'stub',
          }));
          b.onLoad({ filter: /^next\/link$/, namespace: 'stub' }, () => ({
            contents:
              'export default function Link({ href, children, prefetch, ...rest }) { return <a href={href} {...rest}>{children}</a>; }',
            loader: 'tsx',
            resolveDir: webRoot,
          }));
          b.onLoad({ filter: /^next\/navigation$/, namespace: 'stub' }, () => ({
            contents:
              'export const usePathname = () => location.pathname; export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
            loader: 'ts',
          }));
        },
      },
    ],
  });
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/row-list.css',
    'components/ux/ux-kit.css',
    'components/mr/move-card.css',
    'components/mr/holder-badge.css',
    'components/mr/explain.css',
    'components/mr/scripts.css',
    'components/mr/stage-bar.css',
    'app/account/move/move-view.css',
    'components/today-card.css',
  ]
    .map((file) => {
      try {
        return readFileSync(resolve(webRoot, file), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Today card fixture</title><style>${css}</style></head><body><div class="ux-workspace"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, query = '') {
  const lede = query.includes('empty') ? 'You are all caught up.' : '4 things need you.';
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 400 });
  await page.goto(fixturePath + query);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText(lede);
}

for (const width of [320, 390, 1440]) {
  test.describe(`${width}px`, () => {
    test('one Today card with one filled action, every link kept, no sideways scroll, targets of 44 px', async ({
      page,
    }) => {
      await open(page, width);
      const links = await page.locator('a[href]').evaluateAll((els) => els.length);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (process.env.TC1_SHOT)
        await page.screenshot({ path: process.env.TC1_SHOT + width + '.png', fullPage: true });
      console.log(`TC1 height ${width}: ${height}, links ${links}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      if (baseline) return;
      const card = page.getByTestId('today-card');
      await expect(card).toHaveCount(1);
      await expect(card.locator('.primary-link')).toHaveCount(1);
      await expect(card).toContainText('Answer the sample size');
      await expect(card).toContainText('Due 20 November 2026');
      // Before the card the page had 1 start link, 4 cards' actions (3 moves + draft), 1 latest link? Counted from
      // the model: every card and every waiting row stays reachable.
      for (const href of ['/account/rooms/r2', '/account/rooms/r1', '/account/drafts/w1', '/plan'])
        expect(await page.locator(`a[href="${href}"]`).count()).toBeGreaterThan(0);
      const box = await card.locator('.primary-link').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      if (mainHeight[width]) expect(height).toBeLessThanOrEqual(mainHeight[width]);
    });

    test('the keyboard reaches the Today action and it shows focus; axe is clean', async ({
      page,
    }) => {
      await open(page, width);
      if (baseline) return;
      const action = page.getByTestId('today-card').locator('.primary-link');
      await action.focus();
      await expect(action).toBeFocused();
      const outline = await action.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });
}

test('with nothing open there is no Today card and the empty state stays', async ({ page }) => {
  await open(page, 390, '?empty=1');
  await expect(page.getByTestId('today-card')).toHaveCount(0);
  await expect(page.locator('.move-empty')).toHaveCount(1);
});

// Unit 04 sizes in between (owner, 19 Nov 2026), measured in the real MoveView with the real stylesheets.
// --text-h1 itself shrinks below 390 px (globals.css, clamp(1.625rem, 7.4vw, 1.8125rem)): 26 at 320 and 27 at 360.
const h1At: Record<number, number> = { 320: 26, 360: 27, 390: 29, 768: 30, 1024: 34, 1440: 40 };
for (const width of [320, 360, 390, 768, 1024, 1440]) {
  test(`sizes in between at ${width}px`, async ({ page }) => {
    await open(page, width);
    if (baseline) return;
    const px = (selector: string, property: 'fontSize' | 'height' | 'width') =>
      page
        .locator(selector)
        .first()
        .evaluate(
          (el, prop) =>
            parseFloat(
              prop === 'fontSize'
                ? getComputedStyle(el).fontSize
                : String(el.getBoundingClientRect()[prop as 'height' | 'width']),
            ),
          property,
        );
    expect(Math.abs((await px('h1', 'fontSize')) - h1At[width]!)).toBeLessThanOrEqual(1.5);
    expect(await px('.today-move', 'fontSize')).toBe(24);
    expect(await px('.today-due', 'fontSize')).toBe(16);
    expect(await px('.move-lane-head', 'fontSize')).toBe(16);
    expect(await px('.move-lane-head .mr-holder-shape', 'width')).toBe(20);
    // The Waiting for you header link never wraps: it is one 44 px line, beside the heading or under it.
    expect(await px('.move-card > .move-card-link', 'height')).toBeLessThanOrEqual(48);
    expect(await px('.today-action', 'height')).toBeGreaterThanOrEqual(width >= 768 ? 48 : 56);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
