import { test, expect, type Page } from '@playwright/test';

// Wave 6 Q-02 guard: the large-text rules must not move the public pages at the normal (100%) text size, except for the
// two changes the verification record lists (the closing band text box at 1024 and up, and the /network band at 768). Each fact below was measured on main before the Q-02 styles and is asserted unchanged here.
// Measured on main (1c0f75e) without any Q-02 style, by this same probe, at every width and step of the home player.
// The branch build gave the same 36 rows, so these are the 100% layout the large-text rules must not move.
const BASELINE: Record<string, Record<string, number | boolean>> = {
  '320:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '320:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 1,
  },
  '320:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 3,
    headDrawn: true,
    buyerColumns: 2,
  },
  '320:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '320:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '320:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '390:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '390:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 1,
  },
  '390:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 3,
    headDrawn: true,
    buyerColumns: 2,
  },
  '390:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '390:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '390:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 72,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '768:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1024:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1280:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:0': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:1': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:2': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:3': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:4': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
  '1440:5': {
    stepRows: 1,
    fieldColumns: 2,
    tabRows: 1,
    planLabel: 64,
    passStub: 88,
    quoteColumns: 4,
    headDrawn: true,
    buyerColumns: 2,
  },
};
const widths = [320, 390, 768, 1024, 1280, 1440] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

test('home player: steps, fields, tabs, plan rows, passes and quotes keep their normal-size layout', async ({
  page,
}) => {
  for (const width of widths) {
    await open(page, '/', width);
    // The player shows one screen at a time; the others are not laid out, so step through all six and read what is drawn.
    for (let step = 0; step < 6; step++) {
      const facts = await page.evaluate(() => {
        const drawn = (selector: string) =>
          Array.from(document.querySelectorAll(selector)).find(
            (el) =>
              el.getBoundingClientRect().width > 2 &&
              !el.closest('[aria-hidden="true"], [hidden]') &&
              getComputedStyle(el).visibility === 'visible',
          ) ?? null;
        const columns = (el: Element | null) =>
          el
            ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).map(parseFloat)
            : [];
        const rowsOf = (selector: string, parent: Element | null) =>
          new Set(
            Array.from(parent?.querySelectorAll(selector) ?? []).map((el) =>
              Math.round(el.getBoundingClientRect().top),
            ),
          ).size;
        const steps = drawn('.ac1-steps');
        const fields = drawn('.ac1-fields');
        const plan = drawn('.ac1-plan li');
        const pass = drawn('.ac1-pass');
        const head = drawn('.ac1-compare-head');
        const quoteRow = drawn('.ac1-compare-row:not(.ac1-compare-head)');
        const buyer = drawn('.ac1-buyers li');
        return {
          stepRows: rowsOf('li', steps),
          fieldColumns: fields ? columns(fields).length : 2,
          tabRows: rowsOf('button', drawn('.ac1-record-tabs')),
          planLabel: plan ? columns(plan)[0] : 64,
          passStub: pass ? columns(pass)[1] : 88,
          quoteColumns: quoteRow ? columns(quoteRow).length : 4,
          headDrawn: head ? head.getBoundingClientRect().height > 2 : true,
          buyerColumns: buyer ? columns(buyer).length : 2,
        };
      });
      expect(facts, `home step ${step} at ${width}`).toEqual(BASELINE[`${width}:${step}`]);
      await page.locator('.ac1-player-controls button').last().click();
    }
  }
});

test('footer: promise, actions and link columns keep their normal-size layout', async ({
  page,
}) => {
  for (const width of widths) {
    await open(page, '/network', width);
    const facts = await page.evaluate(() => {
      const columns = (el: Element | null) =>
        el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
      return {
        groupLists: Array.from(document.querySelectorAll('.guide-footer-group ul')).map(columns),
        groupCount: document.querySelectorAll('.guide-footer-group').length,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(facts.sideways, `footer at ${width}`).toBeLessThanOrEqual(0);
    expect(facts.groupCount).toBeGreaterThan(0);
    // A phone footer keeps its two link columns; wider footers never go below one.
    for (const count of facts.groupLists)
      expect(count, `footer link columns at ${width}`).toBe(width <= 390 ? 2 : count);
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

test('home player: the six step marks stay in one row at every width from 320 to 1920', async ({
  page,
}) => {
  await open(page, '/', 1000);
  for (let width = 320; width <= 1920; width += 32) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await page.evaluate(
      () =>
        new Set(
          Array.from(document.querySelector('.ac1-steps')?.children ?? []).map((el) =>
            Math.round(el.getBoundingClientRect().top),
          ),
        ).size,
    );
    // At 1024 the player is about 483 px wide and the six marks need about 472, so a narrower track would wrap them.
    expect(rows, `step marks at ${width}`).toBe(1);
  }
  for (const width of [1024, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await page.evaluate(
      () =>
        new Set(
          Array.from(document.querySelector('.ac1-steps')?.children ?? []).map((el) =>
            Math.round(el.getBoundingClientRect().top),
          ),
        ).size,
    );
    expect(rows, `step marks at ${width}`).toBe(1);
  }
});
