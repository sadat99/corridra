import { test, expect, type Page } from '@playwright/test';

// Wave 6 Q-02 guard: the large-text rules must not move the public pages at the normal (100%) text size, except for the
// two changes the verification record lists (the closing band text box at 1024 and up, and the /network band at 768). Each fact below was measured on main before the Q-02 styles and is asserted unchanged here.
const widths = [320, 390, 768, 1024, 1280, 1440] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

test('footer: promise, actions and link columns keep their normal-size layout', async ({
  page,
}) => {
  // Drawn columns of the footer at 100%, equal on main (the footer boxes were identical in the comparison against main).
  // The footer of every page (home v4.4): each group is one column of links, and the actions are one column too.
  const expected: Record<number, { lists: number[]; actions: number[] }> = {
    320: { lists: [1, 1, 1, 1], actions: [1] },
    390: { lists: [1, 1, 1, 1], actions: [1] },
    768: { lists: [1, 1, 1, 1], actions: [1] },
    1024: { lists: [1, 1, 1, 1], actions: [1] },
    1280: { lists: [1, 1, 1, 1], actions: [1] },
    1440: { lists: [1, 1, 1, 1], actions: [1] },
  };
  for (const width of widths) {
    await open(page, '/network', width);
    const facts = await page.evaluate(() => {
      const columns = (el: Element) =>
        getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
      const drawn = (selector: string) =>
        Array.from(document.querySelectorAll(selector)).filter(
          (el) => el.getBoundingClientRect().width > 2,
        );
      return {
        lists: drawn('.hv7-footer-group ul').map(columns),
        actions: drawn('.hv7-footer-actions').map(columns),
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(facts.sideways, `footer at ${width}`).toBeLessThanOrEqual(0);
    expect({ lists: facts.lists, actions: facts.actions }, `footer columns at ${width}`).toEqual(
      expected[width],
    );
  }
});

test('closing band: at normal size the words and the button sit side by side from 701 px up, on one row', async ({
  page,
}) => {
  for (const [path, width] of [
    ['/', 1024],
    ['/', 1280],
    ['/', 1440],
    ['/how-it-works', 1280],
    ['/trust', 1440],
  ] as const) {
    await open(page, path, width);
    const band = await page.evaluate(() => {
      const el = document.querySelector('.guide-band');
      const text = el?.firstElementChild?.getBoundingClientRect();
      const button = el?.querySelector('.primary-link')?.getBoundingClientRect();
      return {
        textRight: text?.right ?? 0,
        textTop: text?.top ?? 0,
        buttonLeft: button?.left ?? 0,
        buttonTop: button?.top ?? 0,
        height: el?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(band.buttonLeft, `${path} band button at ${width}`).toBeGreaterThanOrEqual(
      band.textRight - 1,
    );
    expect(Math.abs(band.buttonTop - band.textTop), `${path} band row at ${width}`).toBeLessThan(
      120,
    );
    expect(band.height, `${path} band height at ${width}`).toBeLessThan(260);
  }
});

test('/network at 768: the closing band gives its words room instead of an 80 px column', async ({
  page,
}) => {
  await open(page, '/network', 768);
  const band = await page.evaluate(() => {
    const el = document.querySelector('.guide-band');
    return {
      text: el?.firstElementChild?.getBoundingClientRect().width ?? 0,
      height: el?.getBoundingClientRect().height ?? 0,
    };
  });
  // On main the text column was 80 px wide and the band 520 px tall.
  expect(band.text).toBeGreaterThan(300);
  expect(band.height).toBeLessThan(400);
});

// W7: with nothing saved the page is at Normal text, whatever the Text Size and Less Movement code does.
test('with no saved text size the page carries no text size attribute and the text is 16 px', async ({
  page,
}) => {
  for (const path of ['/', '/how-it-works', '/plan']) {
    await open(page, path, 390);
    expect(
      await page.evaluate(() => ({
        size: getComputedStyle(document.documentElement).fontSize,
        textSize: document.documentElement.getAttribute('data-text-size'),
        lessMovement: document.documentElement.getAttribute('data-less-movement'),
      })),
      path,
    ).toEqual({ size: '16px', textSize: null, lessMovement: null });
  }
});
