import type { Page } from '@playwright/test';

// Shared fit measurement for the text size specs (public-large-text, comfort-text-size).
/** What does not fit: a box past a window edge, text running out of its own box, and any sideways scroll. */
export async function problems(page: Page, options: { allowScrollers?: boolean } = {}) {
  return page.evaluate((allowScrollers) => {
    const edge = document.documentElement.clientWidth;
    // The right edge of what is in the flow inside a box: its text and its children, not decoration placed on top of it.
    // Content that is not rendered, which is the content of every closed disclosure, is skipped: it can keep a stale
    // box nobody sees. problemsWithFoldsOpen measures that content with every fold open.
    const contentRight = (el: HTMLElement) => {
      let right = 0;
      const range = document.createRange();
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          range.selectNodeContents(node);
          right = Math.max(right, range.getBoundingClientRect().right);
        } else if (node instanceof HTMLElement) {
          if (!node.checkVisibility()) continue;
          const position = getComputedStyle(node).position;
          if (position === 'absolute' || position === 'fixed') continue;
          right = Math.max(right, node.getBoundingClientRect().right);
        }
      }
      return right;
    };
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      if (!el.checkVisibility()) return false;
      const box = el.getBoundingClientRect();
      // Visually hidden helper text (and what is inside it) is one pixel wide on purpose.
      if (box.width < 2 || el.clientWidth < 2) return false;
      // A page may hold a row that scrolls sideways by design (its own scroll box, which is still measured against
      // the window edge). Only a caller that asks for it skips what is inside one, for the edge test.
      let inScroller = false;
      if (allowScrollers)
        for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
          const overflowX = getComputedStyle(up).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') inScroller = true;
        }
      for (let up = el.parentElement; up; up = up.parentElement)
        if (up.getBoundingClientRect().width < 2 && getComputedStyle(up).overflowX !== 'visible')
          return false;
      const hidden = getComputedStyle(el).overflowX !== 'visible';
      const outside = !inScroller && (box.right > edge + 1 || box.left < -1);
      return outside || (!hidden && contentRight(el) > box.right + 1);
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
  }, options.allowScrollers === true);
}

/** What does not fit with every closed fold on the page opened; the folds that were closed are closed again after. */
export async function problemsWithFoldsOpen(
  page: Page,
  options: { allowScrollers?: boolean } = {},
) {
  const closed = await page.evaluateHandle(() => {
    const folds = Array.from(document.querySelectorAll('details')).filter((fold) => !fold.open);
    for (const fold of folds) fold.open = true;
    return folds;
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
  const stillClosed = await page.locator('details:not([open])').count();
  const found = await problems(page, options);
  await page.evaluate((folds) => {
    for (const fold of folds) fold.open = false;
  }, closed);
  await closed.dispose();
  return stillClosed > 0 ? [`${stillClosed} fold(s) did not open`, ...found] : found;
}

/**
 * Text that a box cuts off: a visible box that clips its overflow (hidden, clip or an ellipsis) and holds text
 * that is wider or taller than the box shows. Visually hidden helper text is one pixel on purpose and is skipped.
 * `problems` finds text that runs out of a box that does not clip; this finds text a box hides.
 */
export async function clippedText(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!el.checkVisibility()) continue;
      const style = getComputedStyle(el);
      const clipsX = style.overflowX !== 'visible' || style.textOverflow === 'ellipsis';
      const clipsY = style.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      if (el.clientWidth < 2 || el.clientHeight < 2) continue;
      if (!(el.textContent ?? '').trim()) continue;
      // A scroll container shows its overflow by scrolling; only a box that cannot scroll hides it.
      const scrolls = (value: string) => value === 'auto' || value === 'scroll';
      const cutX = clipsX && !scrolls(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
      const cutY = clipsY && !scrolls(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      if (cutX || cutY)
        found.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${(el.textContent ?? '').trim().slice(0, 30)} (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
        );
    }
    // Report the innermost boxes only.
    return found.slice(0, 8);
  });
}
