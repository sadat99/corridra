import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// UI/UX.v4.1 wave V4.1-0, shared pieces: the choice row with an owned icon tile (L2) and the chosen state (L3), and
// the source stamp (L10). Mounted inside the page's own customer wrappers, as tests/ux/choice-row.spec.ts does, so the
// global rules for buttons and text are in force. Sample words only; neither piece is on a screen yet.
const widths = [320, 390, 768, 1440] as const;
let script = '';
let styles = '';

const entry = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChoiceRow, ChoiceButton } from ${JSON.stringify(resolve('apps/web/components/ux/choice-chip.tsx'))};
import { SourceStamp } from ${JSON.stringify(resolve('apps/web/components/ux/source-stamp.tsx'))};

function Demo() {
  const [goal, setGoal] = useState('sell');
  return (
    <main id="v41-fixture" lang="en" className="ux-workspace ux-customer">
      <section className="buyer-card">
        <h2 id="v41-question">What do you want to do?</h2>
        <ChoiceRow labelledBy="v41-question">
          <ChoiceButton ownedIcon="buy" chosen={goal === 'buy'} onClick={() => setGoal('buy')}>Buy Products from suppliers of goods or materials for a spring line of plain trims</ChoiceButton>
          <ChoiceButton ownedIcon="sell" chosen={goal === 'sell'} onClick={() => setGoal('sell')}>Sell Abroad</ChoiceButton>
          <ChoiceButton ownedIcon="trip" chosen={goal === 'trip'} onClick={() => setGoal('trip')}>Lead a Group Trip</ChoiceButton>
          <ChoiceButton ownedIcon="calendar" chosen={false} onClick={() => setGoal('fair')} disabled>Trips, Visits or Fairs</ChoiceButton>
        </ChoiceRow>
        <p id="v41-goal">{goal}</p>
        <SourceStamp source="Sample customs table" date="11 Nov 2026, 09:30 (UTC)" />
        <div style={{ maxInlineSize: '9rem' }}>
          <SourceStamp source="A sample source with a long name that has to wrap inside a narrow column" />
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById('mount')).render(<Demo />);
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

async function mount(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  // KI-26: the page must finish hydrating before its document is replaced, or React can remove the mount node.
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
  await page.waitForSelector('#v41-fixture');
}

const box = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [r.width, r.height];
    }),
  );
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

for (const width of widths)
  test(`at ${width}px the tiles are 44 px, the rows keep their height, nothing is cut and axe is clean`, async ({
    page,
  }) => {
    await mount(page, width);
    await expect(page.getByRole('group', { name: 'What do you want to do?' })).toBeVisible();
    // L2: one owned icon per row, in a 44 px soft square, drawn at the icon's own 24 px.
    expect(await box(page, '.ux-choice .ux-choice-tile')).toEqual(Array(4).fill([44, 44]));
    expect(await box(page, '.ux-choice .ux-choice-tile .corridra-icon')).toEqual(
      Array(4).fill([24, 24]),
    );
    await expect(page.locator('.ux-choice svg')).toHaveCount(4);
    const heights = (await box(page, '.ux-choice')).map(([, h]) => h!);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(width >= 768 ? 72 : 64);
    // The long first row wraps on a phone rather than being cut or widening the page.
    if (width <= 390) expect(heights[0]).toBeGreaterThan(heights[1]!);
    // The radio sits at the end of its row, whole and inside it.
    const ends = await page.locator('.ux-choice').evaluateAll((els) =>
      els.map((el) => {
        const row = el.getBoundingClientRect();
        const radio = el.querySelector('.ux-choice-radio')!.getBoundingClientRect();
        const words = el.querySelector(':scope > span:not([class])')!.getBoundingClientRect();
        return [radio.width, radio.height, radio.right <= row.right, radio.left >= words.right];
      }),
    );
    expect(ends).toEqual(Array(4).fill([20, 20, true, true]));
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    const found = (await new AxeBuilder({ page }).include('#v41-fixture').analyze()).violations.map(
      (v) => v.id,
    );
    expect(found).toEqual([]);
  });

test('L3: the chosen row is stated to a screen reader and shown by edge, fill and a filled radio', async ({
  page,
}) => {
  await mount(page, 390);
  const selected = await token(page, '--selected');
  const selectedSurface = await token(page, '--selected-surface');
  const look = (name: string) =>
    page.getByRole('button', { name }).evaluate((el) => {
      const s = getComputedStyle(el);
      const radio = el.querySelector('.ux-choice-radio')!;
      const tile = el.querySelector('.ux-choice-tile')!;
      return {
        pressed: el.getAttribute('aria-pressed'),
        edge: s.borderTopColor,
        inner: s.boxShadow,
        fill: s.backgroundColor,
        tile: getComputedStyle(tile).backgroundColor,
        dot: getComputedStyle(radio, '::after').content,
        dotFill: getComputedStyle(radio, '::after').backgroundColor,
        height: el.getBoundingClientRect().height,
      };
    });
  const before = await look('Sell Abroad');
  expect(before.pressed).toBe('true');
  expect(before.edge).toBe(selected);
  expect(before.inner).toContain('inset');
  expect(before.fill).toBe(selectedSurface);
  expect(before.tile).toBe(selectedSurface);
  expect(before.dot).not.toBe('none');
  expect(before.dotFill).toBe(selected);
  const other = await look('Lead a Group Trip');
  expect(other.pressed).toBe('false');
  expect(other.edge).not.toBe(selected);
  expect(other.inner).toBe('none');
  expect(other.fill).not.toBe(selectedSurface);
  expect(other.dot).toBe('none');
  await expect(page.locator('.ux-choice[aria-pressed="true"]')).toHaveCount(1);

  // Choosing another row moves the state, acts at once and changes no row's size.
  await page.getByRole('button', { name: 'Lead a Group Trip' }).click();
  await expect(page.locator('#v41-goal')).toHaveText('trip');
  await expect(
    page.getByRole('button', { name: 'Lead a Group Trip', pressed: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sell Abroad', pressed: false })).toBeVisible();
  expect((await look('Sell Abroad')).height).toBe(before.height);
  expect((await look('Lead a Group Trip')).height).toBe(other.height);
  await expect(page.getByRole('button', { name: 'Trips, Visits or Fairs' })).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.ux-choice:focus-visible')).toHaveCount(1);
});

test('L3 holds without colour: forced colours keep the edge, the tile and the radio dot', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await mount(page, 390);
  const seen = await page.locator('.ux-choice').evaluateAll((els) =>
    els.map((el) => {
      const radio = el.querySelector('.ux-choice-radio')!;
      const dot = getComputedStyle(radio, '::after');
      return {
        edge: getComputedStyle(el).borderTopWidth,
        tile: getComputedStyle(el.querySelector('.ux-choice-tile')!).borderTopWidth,
        ring: getComputedStyle(radio).borderTopWidth,
        dot:
          dot.content !== 'none' && dot.backgroundColor === getComputedStyle(radio).borderTopColor,
      };
    }),
  );
  expect(seen.map((s) => [s.edge, s.tile, s.ring])).toEqual(Array(4).fill(['2px', '1px', '2px']));
  expect(seen.map((s) => s.dot)).toEqual([false, true, false, false]);
  const dots = await page
    .locator('.ux-source-stamp-dot')
    .evaluateAll((els) =>
      els.map(
        (el) => getComputedStyle(el).backgroundColor === getComputedStyle(el.parentElement!).color,
      ),
    );
  expect(dots).toEqual([true, true]);
});

test('L10: the source stamp is a 12 px mono label line with a small dot and wraps', async ({
  page,
}) => {
  await mount(page, 320);
  const stamps = page.locator('.ux-source-stamp');
  await expect(stamps).toHaveCount(2);
  await expect(stamps.first()).toHaveText('Sample customs table · 11 Nov 2026, 09:30 (UTC)');
  const type = await stamps.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.fontSize, s.fontWeight, s.textTransform, /mono/i.test(s.fontFamily)];
  });
  expect(type).toEqual(['12px', '500', 'none', true]);
  expect(await box(page, '.ux-source-stamp-dot')).toEqual(Array(2).fill([6, 6]));
  // The dot is drawn, not read out; the long source wraps inside its narrow column.
  await expect(page.locator('.ux-source-stamp-dot[aria-hidden="true"]')).toHaveCount(2);
  const narrow = await stamps.nth(1).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const column = el.parentElement!.getBoundingClientRect();
    const dot = el.querySelector('.ux-source-stamp-dot')!.getBoundingClientRect();
    return [r.right <= column.right + 0.5, r.height > 34, dot.top - r.top < 12];
  });
  expect(narrow).toEqual([true, true, true]);
});
