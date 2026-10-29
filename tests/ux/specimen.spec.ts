import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// AC1-02 specimen. Contract: docs/design-system/README.md section 5 (AC1-02). The shared primitives
// are rendered with the product stylesheet in every state the package requires: default, hover,
// focus, disabled, loading, selected, error, long copy, Bangla and Chinese. The fixture is built in
// the test (no production route) so nothing ships that a visitor could reach.

const widths = [320, 390, 768, 1440];
const here = dirname(fileURLToPath(import.meta.url));
const shotDir = join(here, '..', '..', 'work', 'ux-specimen');

const longToken = 'Reference-Corridra-Quotation-Supplier-Bangladesh-Singapore-0000000000000000';
const bangla = 'আপনার অনুরোধ জমা দেওয়া হয়েছে এবং যাচাই করা হচ্ছে';
const chinese = '您的请求已提交，正在核实中，请稍候查看结果';

const specimen = `
<main id="specimen" class="ux-workspace ux-customer">
  <h1>Primitive specimen</h1>
  <section aria-labelledby="sp-actions">
    <h2 id="sp-actions">Actions</h2>
    <div class="sp-row" data-group="primary">
      <button type="button" class="button">Send request</button>
      <button type="button" class="button" disabled>Send request (disabled)</button>
      <button type="button" class="button" aria-busy="true">Sending request</button>
    </div>
    <div class="sp-row" data-group="secondary">
      <button type="button" class="button-secondary">Save for later</button>
      <button type="button" class="button-secondary" aria-pressed="true">Selected option</button>
      <button type="button" class="button-secondary" disabled>Save (disabled)</button>
      <button type="button" class="button-secondary" data-intent="destructive">Withdraw request</button>
    </div>
    <div class="sp-row" data-group="quiet">
      <a class="text-link" href="#sp-actions">Quiet link action</a>
      <button type="button" class="text-link">Quiet button action</button>
    </div>
    <div class="sp-row" data-group="copy">
      <button type="button" class="button">${longToken}</button>
      <button type="button" class="button-secondary">${bangla}</button>
      <button type="button" class="button-secondary">${chinese}</button>
    </div>
  </section>
  <section aria-labelledby="sp-fields">
    <h2 id="sp-fields">Fields</h2>
    <form onsubmit="return false">
      <label class="field">Company name
        <input type="text" value="Corridra Studio" />
      </label>
      <label class="field">Quantity
        <input type="text" value="" aria-invalid="true" aria-describedby="sp-err" />
        <span class="field-error" id="sp-err" role="alert">Enter a whole number of pieces.</span>
      </label>
      <label class="field">Notes (disabled)
        <textarea disabled>Locked while the request is under review.</textarea>
      </label>
      <label class="field">${longToken}
        <input type="text" value="${longToken}" />
      </label>
      <label class="field">${bangla}
        <input type="text" value="${bangla}" />
      </label>
      <label class="field">${chinese}
        <input type="text" value="${chinese}" />
      </label>
    </form>
  </section>
  <section aria-labelledby="sp-notices">
    <h2 id="sp-notices">Notices, states and status</h2>
    <div class="ux-scope-note"><p>${longToken}</p></div>
    <div class="ux-state" data-state="loading"><p class="ux-state-label">Loading</p><p>Checking your quotations.</p></div>
    <div class="ux-state" data-state="denied"><p class="ux-state-label">Access denied</p><p>${bangla}</p></div>
    <div class="ux-state" data-state="unavailable"><p class="ux-state-label">Unavailable</p><p>${chinese}</p>
      <div class="ux-state-actions"><a class="text-link" href="#sp-notices">Try again</a></div></div>
    <p>
      <span class="ux-status" data-tone="positive">Verified</span>
      <span class="ux-status" data-tone="caution">Needs review</span>
      <span class="ux-status" data-tone="critical">Rejected</span>
      <span class="ux-status" data-tone="info">In progress</span>
      <span class="ux-status" data-tone="unknown">Unknown</span>
    </p>
  </section>
</main>`;

async function mount(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.evaluate((html) => {
    document.body.innerHTML = html;
    document.body.className = '';
    const style = document.createElement('style');
    style.textContent =
      '.sp-row{display:flex;flex-wrap:wrap;gap:var(--space-4);margin-block:var(--space-4)}#specimen form{display:grid;gap:var(--space-5)}';
    document.head.append(style);
  }, specimen);
}

for (const width of widths) {
  test(`AC1-02 specimen at ${width}px`, async ({ page }) => {
    await mount(page, width);
    mkdirSync(shotDir, { recursive: true });

    // 1. No horizontal overflow, from the page or from any control, field or notice.
    const overflow = await page.evaluate(() => {
      const view = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > view) out.push('page');
      for (const el of document.querySelectorAll('#specimen *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > view + 1 || r.left < -1))
          out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`);
      }
      return out;
    });
    expect(overflow, 'elements wider than the viewport').toEqual([]);

    // 2. Every control is at least 44 px in both directions (quiet links are exempt in running text).
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('#specimen :is(button, input, textarea, select)')]
        .filter((el) => !(el as HTMLButtonElement).disabled)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').slice(0, 24)}`),
    );
    expect(small, 'targets under 44 px').toEqual([]);

    // 3. Keyboard focus is visible on every enabled control (outline or ring).
    const controls = await page
      .locator(
        '#specimen :is(a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]))',
      )
      .all();
    for (const control of controls) {
      await control.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const visible = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
        const ring = s.boxShadow !== 'none' && /\d/.test(s.boxShadow);
        return outline || ring;
      });
      const label = await control.evaluate((el) =>
        (el.textContent || el.id || el.tagName).slice(0, 30),
      );
      expect(visible, `focus ring on ${label}`).toBe(true);
    }

    // 4. States read as states without colour alone: disabled is dimmed, busy and selected are marked.
    const states = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement;
      const op = (el: HTMLElement) => parseFloat(getComputedStyle(el).opacity);
      const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
      const border = (el: HTMLElement) => getComputedStyle(el).borderTopColor;
      const normal = q('.button-secondary:not([aria-pressed]):not([data-intent]):not(:disabled)');
      return {
        disabledDimmed: op(q('.button:disabled')) < 1 && op(q('.button-secondary:disabled')) < 1,
        selectedDiffers:
          bg(q('.button-secondary[aria-pressed="true"]')) !== bg(normal) ||
          border(q('.button-secondary[aria-pressed="true"]')) !== border(normal),
        destructiveDiffers:
          border(q('[data-intent="destructive"]')) !== border(normal) ||
          getComputedStyle(q('[data-intent="destructive"]')).color !==
            getComputedStyle(normal).color,
        busyDiffers:
          getComputedStyle(q('.button[aria-busy="true"]'), '::after').content !== 'none' ||
          q('.button[aria-busy="true"]').style.cursor === 'progress' ||
          getComputedStyle(q('.button[aria-busy="true"]')).cursor === 'progress',
      };
    });
    expect(states).toEqual({
      disabledDimmed: true,
      selectedDiffers: true,
      destructiveDiffers: true,
      busyDiffers: true,
    });

    // 5. Mixed-script copy keeps a readable line height and wraps inside its box.
    const copy = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('#specimen :is(button, label, p, span)')) {
        const text = el.textContent || '';
        if (!/[ঀ-৿一-鿿]/.test(text)) continue;
        const s = getComputedStyle(el);
        const lh =
          s.lineHeight === 'normal' ? 1.2 : parseFloat(s.lineHeight) / parseFloat(s.fontSize);
        if (lh < 1.3) bad.push(`${el.tagName.toLowerCase()} lh ${lh.toFixed(2)}`);
      }
      return bad;
    });
    expect(copy, 'Bangla and Chinese line height under 1.3').toEqual([]);

    // 6. Accessibility: contrast, names and roles on the specimen itself.
    const axe = await new AxeBuilder({ page }).include('#specimen').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    await page.screenshot({ path: join(shotDir, `specimen-${width}.png`), fullPage: true });
  });
}
