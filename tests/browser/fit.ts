import type { Page } from '@playwright/test';

// Shared fit measurement for the text size specs (public-large-text, comfort-text-size).
/** What does not fit: a box past a window edge, text running out of its own box, and any sideways scroll. */
export async function problems(page: Page) {
  return page.evaluate(() => {
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
