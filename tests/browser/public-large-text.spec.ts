import { test, expect, type Page } from '@playwright/test';

// Wave 6 Q-02: with the text at twice its size, the public page bodies fit the window at the four widths people use,
// and nothing is cut off or runs out of its own box. The whole page is measured, header and footer included, so a
// shared band, tab row, card or footer link cannot bring the sideways scroll back on a page this test names.
const pages = ['/', '/how-it-works', '/corridors', '/network', '/trust'] as const;
const widths = [320, 390, 768, 1280] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

/** What does not fit: a box past a window edge, text running out of its own box, and any sideways scroll. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    // The right edge of what is in the flow inside a box: its text and its children, not decoration placed on top of it.
    const contentRight = (el: HTMLElement) => {
      let right = 0;
      const range = document.createRange();
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          range.selectNodeContents(node);
          right = Math.max(right, range.getBoundingClientRect().right);
        } else if (node instanceof HTMLElement) {
          const position = getComputedStyle(node).position;
          if (position === 'absolute' || position === 'fixed') continue;
          right = Math.max(right, node.getBoundingClientRect().right);
        }
      }
      return right;
    };
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      const box = el.getBoundingClientRect();
      // Visually hidden helper text (and what is inside it) is one pixel wide on purpose.
      if (box.width < 2 || el.clientWidth < 2) return false;
      for (let up = el.parentElement; up; up = up.parentElement)
        if (up.getBoundingClientRect().width < 2 && getComputedStyle(up).overflowX !== 'visible')
          return false;
      const hidden = getComputedStyle(el).overflowX !== 'visible';
      return box.right > edge + 1 || box.left < -1 || (!hidden && contentRight(el) > box.right + 1);
    });
    // Report the innermost boxes: a parent that only holds an overflowing child is not a second problem.
    const found = offenders
      .filter((el) => !offenders.some((other) => other !== el && el.contains(other)))
      .slice(0, 8)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${(el.textContent ?? '').trim().slice(0, 30)}`,
      );
    const sideways = document.documentElement.scrollWidth - edge;
    return sideways > 0 ? [`sideways scroll ${sideways}px`, ...found] : found;
  });
}

test('with 200% text the home, how it works, corridors, network and trust pages fit at 320, 390, 768 and 1280', async ({
  page,
}) => {
  test.setTimeout(300_000);
  for (const path of pages) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      // The page's own fonts are wider or narrower than the fallback, so measure only once they are in.
      await page.evaluate(() => document.fonts.ready);
      expect(await problems(page), `${path} at ${width}`).toEqual([]);
    }
  }
});

test('at normal text the phone keeps its two-column phase step, with the heading beside the number', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/how-it-works');
  const step = page.locator('.guide-phase li').first();
  await expect(step).toBeVisible();
  expect(
    await step.evaluate((li) => getComputedStyle(li).gridTemplateColumns.split(' ')),
  ).toHaveLength(2);
  const number = await step.locator('.guide-step-number').boundingBox();
  const heading = await step.locator('h3').boundingBox();
  expect(heading!.x).toBeGreaterThan(number!.x + number!.width - 1);
});

// At normal text size these parts of the page keep the layout they had before the large-text fixes. The player's
// request fields stay two columns wide, the caption keeps its controls beside its words, the closing band keeps its
// words and its button side by side, and the phone keeps its two-column phase step (above).
test('at normal text the player fields stay two columns wide at every width', async ({ page }) => {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const columns = await page
      .locator('.ac1-fields')
      .first()
      .evaluate((dl) => getComputedStyle(dl).gridTemplateColumns.split(' ').length);
    expect(columns, `${width}px`).toBe(2);
  }
});

test('at normal text the player caption keeps its controls beside its words', async ({ page }) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const words = await page.locator('.ac1-player-caption p').first().boundingBox();
    const controls = await page.locator('.ac1-player-controls').first().boundingBox();
    // Same row: the controls start within the height of the words, and to the right of them.
    expect(controls!.y, `${width}px`).toBeLessThan(words!.y + words!.height);
    expect(controls!.x, `${width}px`).toBeGreaterThan(words!.x + words!.width - 1);
  }
});

test('at normal text the closing band keeps its words and its button side by side', async ({
  page,
}) => {
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const text = await page.locator('.guide-band h2').first().boundingBox();
    const button = await page.locator('.guide-band .primary-link').first().boundingBox();
    expect(button!.x, `${width}px`).toBeGreaterThan(text!.x + text!.width - 1);
    expect(button!.y, `${width}px`).toBeLessThan(text!.y + text!.height + 120);
  }
});
