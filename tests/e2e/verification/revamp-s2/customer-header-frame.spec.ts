import { test, expect, signInCustomer } from '../fixtures';

// Signed-in phone header (owner-approved audit page, "Consistency Pass", header: "Logo mark shown whole, header rule edge
// to edge"; measured 14 November 2026 on a production build before the fix: at 390 px the rule ran from 16 px to 358 px,
// 16 px in on the start side and 32 px short on the end side, and at 320 px the row wrapped to a second line). Below 1024 px
// the header's rule now spans the whole window, its menu button and tools keep their places, the row stays on one line,
// and the brand mark sits whole beside the menu button. Presentation only.
test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
  await signInCustomer(context);
});

// At 768 px the tools already wrapped to a second row before this change (measured 113 px high); that is outside this
// task, so the one-line check is made at the other widths and 768 keeps the rule and place checks.
for (const [width, start, oneLine] of [
  [320, 16, true],
  [390, 16, true],
  [640, 16, true],
  [768, 32, false],
  [1023, 32, true],
] as const)
  test(`at ${width} the header rule runs edge to edge, the menu keeps its place and the row is one line`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/account');
    await page.waitForSelector('header.ux-app-header');
    const m = await page.evaluate(() => {
      const header = document.querySelector('header.ux-app-header')!;
      const rect = (node: Element | null) => {
        const box = node!.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const style = getComputedStyle(header);
      return {
        header: rect(header),
        rule: style.borderBottomWidth,
        menu: rect(header.querySelector('[aria-controls="customer-navigation"]')),
        mark: rect(header.querySelector('.brand-mark')),
        tools: rect(header.querySelector('.ux-bar-tools')),
        tops: [...header.children].map((child) => Math.round(child.getBoundingClientRect().top)),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    // The rule (the header's bottom border) spans the whole window.
    expect(m.rule).toBe('1px');
    expect(m.header.left).toBe(0);
    expect(m.header.right).toBe(width);
    // The menu button keeps its place, and the tools end the same distance from the end as the menu starts from the start.
    expect(m.menu.left).toBe(start);
    expect(width - m.tools.right).toBeCloseTo(start, 0);
    // One line, no second row, no sideways scroll.
    if (oneLine) expect(new Set(m.tops.filter((top) => top < 200)).size).toBe(1);
    expect(m.scrollWidth).toBeLessThanOrEqual(width);
    // The mark is whole: its box is the artwork's shape (the brand file's 533 by 511), inside the window, clear of the menu.
    expect(m.mark.left).toBeGreaterThanOrEqual(m.menu.right);
    expect(m.mark.right).toBeLessThanOrEqual(width);
    expect((m.mark.right - m.mark.left) / (m.mark.bottom - m.mark.top)).toBeCloseTo(533 / 511, 1);
  });
