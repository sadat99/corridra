import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Visual grammar PR 1 (17 November 2026): the Explain hint. Every symbol keeps its visible word; the
// explanation opens on hover, keyboard focus and tap, never only through a title, closes on Escape and
// stays open while the pointer moves onto it (WCAG 1.4.13). Without JavaScript, CSS shows it on hover
// and focus. Its own esbuild fixture, mounted the way mr-specimen.spec.ts mounts the teaching layer, so
// no production route changes for the test.

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Road, Explain } from ${JSON.stringify(resolve('apps/web/components/mr/index.ts'))};

function App() {
  return (
    <main id="mr-explain-fixture" lang="en" className="ux-workspace ux-customer">
      <h1>Explain fixture</h1>
      <Road status="MEETINGS" records={{ compare: true, decide: false }} />
      <label>
        Outside field <input id="outside" />
      </label>
      <p id="corner" style={{ position: 'fixed', insetBlockEnd: 0, insetInlineEnd: 0, margin: 0 }}>
        <Explain name="Corner" text="An explanation in the bottom end corner of the screen, long enough to need room on both sides.">
          <span className="mr-road-key" data-key="later" />
        </Explain>
      </p>
    </main>
  );
}
const mount = document.getElementById('mount');
// No JavaScript: the server HTML alone, never hydrated.
if (window.location.hash === '#static') mount.innerHTML = renderToStaticMarkup(<App />);
else createRoot(mount).render(<App />);
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});

async function mount(
  page: Page,
  width: number,
  options: { static?: boolean; height?: number } = {},
) {
  await page.setViewportSize({ width, height: options.height ?? 900 });
  await page.goto(options.static ? '/plan#static' : '/plan');
  await expect(
    page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }),
  ).toBeEnabled();
  await page.evaluate(
    ({ css }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#mr-explain-fixture .mr-explain');
  if (!options.static)
    await expect(page.locator('.mr-explain').first()).toHaveAttribute('data-js', '');
}

const item = (page: Page, word: string) =>
  page
    .locator('.mr-explain')
    .filter({ has: page.getByRole('button', { name: word, exact: true }) });
const popup = (page: Page, word: string) => item(page, word).getByRole('tooltip');
const legend = [
  ['Done', say('mr.explain.state.done')],
  ['Now', say('mr.explain.state.now')],
  ['Later', say('mr.explain.state.later')],
  ['Not tracked yet', say('mr.explain.state.notTracked')],
] as const;

test.describe('Explain with a mouse and a keyboard', () => {
  test('keyboard focus shows the sentence, Escape closes it, the name is the visible word', async ({
    page,
  }) => {
    await mount(page, 1440);
    for (const [word] of legend) await expect(popup(page, word)).toBeHidden();
    await page.locator('h1').click();
    await page.keyboard.press('Tab');
    for (const [word, hint] of legend) {
      const button = page.getByRole('button', { name: word, exact: true });
      await expect(button).toBeFocused();
      await expect(button).toHaveAccessibleName(word);
      // The sentence alone, so a screen reader does not say the word twice.
      await expect(button).toHaveAccessibleDescription(hint);
      await expect(popup(page, word)).toBeVisible();
      await expect(popup(page, word).locator('.mr-explain-text')).toHaveText(hint);
      await page.keyboard.press('Escape');
      await expect(popup(page, word)).toBeHidden();
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(popup(page, word)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(popup(page, word)).toBeHidden();
      await page.keyboard.press('Tab');
    }
    await expect(page.locator('.mr-explain [title], .mr-explain[title]')).toHaveCount(0);
  });

  test('Escape is kept from the page only while an explanation is open', async ({ page }) => {
    await mount(page, 1440);
    await page.evaluate(() => {
      (window as unknown as { escapes: number }).escapes = 0;
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') (window as unknown as { escapes: number }).escapes += 1;
      });
    });
    const escapes = () => page.evaluate(() => (window as unknown as { escapes: number }).escapes);
    await page.locator('h1').click();
    await page.keyboard.press('Tab');
    await expect(popup(page, 'Done')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page, 'Done')).toBeHidden();
    expect(await escapes()).toBe(0);
    await page.keyboard.press('Escape');
    expect(await escapes()).toBe(1);
  });

  test('a hover still waiting to open does not take over a hint opened by focus', async ({
    page,
  }) => {
    await mount(page, 1440);
    await page.getByRole('button', { name: 'Done', exact: true }).hover();
    await page.getByRole('button', { name: 'Later', exact: true }).focus();
    await page.waitForTimeout(400);
    await expect(popup(page, 'Later')).toBeVisible();
    await expect(popup(page, 'Done')).toBeHidden();
  });

  test('Escape closes a hover-only hint and still reaches the focused field', async ({ page }) => {
    await mount(page, 1440);
    await page.evaluate(() => {
      (window as unknown as { escapes: number }).escapes = 0;
      document.getElementById('outside')!.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented)
          (window as unknown as { escapes: number }).escapes += 1;
      });
    });
    await page.locator('#outside').focus();
    await page.getByRole('button', { name: 'Done', exact: true }).hover();
    await expect(popup(page, 'Done')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page, 'Done')).toBeHidden();
    await expect(page.locator('#outside')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(1);
  });

  test('a cancelled touch does not stop the next keyboard focus from opening it', async ({
    page,
  }) => {
    await mount(page, 1440);
    const later = page.getByRole('button', { name: 'Later', exact: true });
    await later.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    await later.dispatchEvent('pointercancel', { pointerType: 'touch', bubbles: true });
    await page.locator('#outside').focus();
    // The four holder shapes (PR 3) sit between the step shapes and the field.
    for (const word of [
      'Supplier or Buyer',
      'Workspace owner or admin',
      'Corridra team',
      'With you',
    ]) {
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByRole('button', { name: word, exact: true })).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Not tracked yet', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(later).toBeFocused();
    await expect(popup(page, 'Later')).toBeVisible();
  });

  test('pressing on the sentence keeps it open and focus on the button', async ({ page }) => {
    await mount(page, 1440);
    await page.locator('h1').click();
    await page.keyboard.press('Tab');
    const done = page.getByRole('button', { name: 'Done', exact: true });
    await expect(popup(page, 'Done')).toBeVisible();
    await popup(page, 'Done').locator('.mr-explain-text').click();
    await expect(popup(page, 'Done')).toBeVisible();
    await expect(done).toBeFocused();
  });

  test('hover opens, moving onto the explanation keeps it open, leaving both closes it', async ({
    page,
  }) => {
    await mount(page, 1440);
    await page.getByRole('button', { name: 'Done', exact: true }).hover();
    await expect(popup(page, 'Done')).toBeVisible();
    await popup(page, 'Done').hover();
    await page.waitForTimeout(300);
    await expect(popup(page, 'Done')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(popup(page, 'Done')).toBeHidden();
  });

  test('one explanation at a time, and a popup without room flips and stays on screen', async ({
    page,
  }) => {
    await mount(page, 768, { height: 600 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(popup(page, 'Done')).toBeVisible();
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(popup(page, 'Later')).toBeVisible();
    await expect(popup(page, 'Done')).toBeHidden();
    await page.getByRole('button', { name: 'Corner', exact: true }).click();
    await expect(popup(page, 'Corner')).toBeVisible();
    await expect(item(page, 'Corner')).toHaveAttribute('data-side', 'top');
    const box = (await popup(page, 'Corner').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(768);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
  });

  test('axe is clean with an explanation open, also in forced colours', async ({ page }) => {
    await mount(page, 1440);
    await page.getByRole('button', { name: 'Not tracked yet', exact: true }).click();
    await expect(popup(page, 'Not tracked yet')).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('#mr-explain-fixture').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(popup(page, 'Not tracked yet')).toBeVisible();
    const forced = await new AxeBuilder({ page }).include('#mr-explain-fixture').analyze();
    expect(forced.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    const border = await popup(page, 'Not tracked yet').evaluate(
      (el) => getComputedStyle(el).borderTopStyle,
    );
    expect(border).toBe('solid');
  });
});

test.describe('Explain without JavaScript', () => {
  test('the server HTML shows the sentence on hover and on keyboard focus', async ({ page }) => {
    await mount(page, 1440, { static: true });
    await expect(page.locator('.mr-explain[data-js]')).toHaveCount(0);
    await expect(popup(page, 'Done')).toBeHidden();
    await page.getByRole('button', { name: 'Done', exact: true }).hover();
    await expect(popup(page, 'Done')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(popup(page, 'Done')).toBeHidden();
    await page.locator('h1').click();
    await page.keyboard.press('Tab');
    await expect(popup(page, 'Done')).toBeVisible();
    await expect(popup(page, 'Done').locator('.mr-explain-text')).toHaveText(
      say('mr.explain.state.done'),
    );
  });
});

test.describe('Explain on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a tap toggles it, a tap outside closes it, and 320 px has no sideways scroll', async ({
    page,
  }) => {
    await mount(page, 320);
    const done = page.getByRole('button', { name: 'Done', exact: true });
    await done.tap();
    await expect(popup(page, 'Done')).toBeVisible();
    await done.tap();
    await expect(popup(page, 'Done')).toBeHidden();
    await done.tap();
    await expect(popup(page, 'Done')).toBeVisible();
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);
    const box = (await popup(page, 'Done').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.locator('h1').tap();
    await expect(popup(page, 'Done')).toBeHidden();
    // A rotated phone or a resized window closes an open hint, so no stale position is kept.
    await done.tap();
    await expect(popup(page, 'Done')).toBeVisible();
    await page.setViewportSize({ width: 568, height: 320 });
    await expect(popup(page, 'Done')).toBeHidden();
    await page.setViewportSize({ width: 320, height: 900 });
    const small = await page.evaluate(
      () =>
        [...document.querySelectorAll('.mr-explain-trigger')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width < 44 || r.height < 44).length,
    );
    expect(small).toBe(0);
  });
});

// Visual grammar PR 3: the holder shapes in the Road legend, at the four widths.
const holderKeys = [
  ['you', 'With you', say('mr.explain.holder.you')],
  ['team', 'Corridra team', say('mr.explain.holder.team')],
  ['owner', 'Workspace owner or admin', say('mr.explain.holder.owner')],
  ['third', 'Supplier or Buyer', say('mr.explain.holder.third')],
] as const;

test.describe('Road legend holder shapes', () => {
  for (const width of [320, 390, 768, 1440]) {
    test(`four explained holder shapes, distinct, no sideways scroll, axe clean at ${width}`, async ({
      page,
    }) => {
      await mount(page, width);
      for (const [holder, word, hint] of holderKeys) {
        const button = page.getByRole('button', { name: word, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveAccessibleDescription(hint);
        await expect(button.locator(`.mr-holder-shape[data-holder="${holder}"]`)).toBeVisible();
      }
      const look = async (holder: string) =>
        page
          .locator(`.mr-road-keys[data-keys="holders"] .mr-holder-shape[data-holder="${holder}"]`)
          .evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              radius: style.borderTopLeftRadius,
              topRight: style.borderTopRightRadius,
              bottom: style.borderBottomLeftRadius,
              bottomRight: style.borderBottomRightRadius,
              width: parseFloat(style.width),
              height: parseFloat(style.height),
              transform: style.transform,
            };
          });
      const diamond = await look('owner');
      const dome = await look('third');
      expect(diamond.transform).not.toBe('none');
      expect(dome.transform).toBe('none');
      // A true half-disc: half as tall as wide, a semicircle on top, a flat edge below.
      expect(dome.height).toBeCloseTo(dome.width / 2, 1);
      // Computed radii are the specified 999px; the drawn radius is scaled by the CSS overlap rule.
      const rTL = parseFloat(dome.radius);
      const rTR = parseFloat(dome.topRight);
      const scale = Math.min(
        1,
        dome.width / (rTL + rTR),
        dome.height / (rTL + parseFloat(dome.bottom)),
      );
      expect(rTL).toBe(rTR);
      expect(rTL * scale).toBeCloseTo(dome.width / 2, 1);
      expect(parseFloat(dome.bottom)).toBe(0);
      expect(parseFloat(dome.bottomRight)).toBe(0);
      expect(dome.radius).not.toBe((await look('team')).radius);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const rows = await page.evaluate(() => ({
        road: document.querySelector('.mr-road-wrap')!.getBoundingClientRect().height,
        holders: document
          .querySelector('.mr-road-keys[data-keys="holders"]')!
          .getBoundingClientRect().height,
      }));
      console.log(`page height ${width}: ${height}, road ${rows.road}, holder row ${rows.holders}`);
      await page.getByRole('button', { name: 'Supplier or Buyer', exact: true }).focus();
      await expect(popup(page, 'Supplier or Buyer')).toBeVisible();
      const axe = await new AxeBuilder({ page }).include('#mr-explain-fixture').analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
