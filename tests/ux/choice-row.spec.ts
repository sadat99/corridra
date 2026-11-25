import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Wave 3 unit 08: the shared choice row. Mounted inside the page's own customer wrappers so the global rules that give
// every button 44 px and every label a font size are in force, as on /buyer. Sample words only.
const widths = [320, 390, 768, 1440] as const;
let script = '';
let styles = '';

const entry = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChoiceRow, ChoiceButton } from ${JSON.stringify(resolve('apps/web/components/ux/choice-chip.tsx'))};

function Demo() {
  const [chosen, setChosen] = useState('none');
  return (
    <main id="cr-fixture" lang="en" className="ux-workspace ux-customer">
      <section className="buyer-card">
        <h2 id="cr-question">Would this company be relevant to you?</h2>
        <ChoiceRow labelledBy="cr-question">
          <ChoiceButton variant="primary" icon="check" onClick={() => setChosen('yes')}>Yes, Interested in a conversation about plain trims for a spring line</ChoiceButton>
          <ChoiceButton icon="help" onClick={() => setChosen('info')}>I Need More Information</ChoiceButton>
          <ChoiceButton icon="close" disabled>Not Relevant</ChoiceButton>
        </ChoiceRow>
        <p id="cr-chosen">{chosen}</p>
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
    external: ['/flags/*'],
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
  await page.waitForSelector('#cr-fixture');
}

for (const width of widths)
  test(`at ${width}px the rows are 64 px (72 px from 768), wrap, fit and are axe clean`, async ({
    page,
  }) => {
    await mount(page, width);
    const group = page.getByRole('group', { name: 'Would this company be relevant to you?' });
    await expect(group).toBeVisible();
    const heights = await page
      .locator('.ux-choice')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(width >= 768 ? 72 : 64);
    // The long first row wraps on a phone rather than being cut or widening the page.
    if (width <= 390) expect(heights[0]).toBeGreaterThan(heights[1]);
    // An icon is drawn at its own size beside the words, never at the browser default.
    const icon = await page
      .locator('.ux-choice .corridra-icon')
      .first()
      .evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    expect(icon).toEqual([24, 24]);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    const font = await page
      .locator('.ux-choice')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(font).toBe('16px');
    const found = (await new AxeBuilder({ page }).include('#cr-fixture').analyze()).violations.map(
      (v) => v.id,
    );
    expect(found).toEqual([]);
  });

test('a row acts at once, the group is named by its question and a disabled row does not act', async ({
  page,
}) => {
  await mount(page, 390);
  await page.getByRole('button', { name: 'I Need More Information' }).click();
  await expect(page.locator('#cr-chosen')).toHaveText('info');
  await expect(page.getByRole('button', { name: 'Not Relevant' })).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.ux-choice:focus-visible')).toHaveCount(1);
});
