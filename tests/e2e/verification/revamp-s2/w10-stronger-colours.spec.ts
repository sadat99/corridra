import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInCustomer, signInOwner } from '../fixtures';
import type { Page } from '@playwright/test';
import { measureColours, weakRings } from '../../../browser/ring-contrast';

// W10 Stronger Colours on the signed-in pages, on a production build with the test-only sign-ins. The effect is in force
// when the person chose it (the saved choice puts data-contrast="more" on <html>) or the device asks
// (prefers-contrast: more). Both ways are measured with axe, enhanced contrast (7 to 1) included, on the customer pages,
// the helper's Me page and Team Today, at a phone and a desktop width, with the menus closed and open. The control
// itself (the Help menu row and the Me switch) is checked for its states, keyboard, size, storage and the device rule.
// The widths are set in each case, so the work runs once, in the first project.
const sizes = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const customerPages = [
  '/account',
  '/account?view=work',
  '/account?view=results',
  '/account?view=more',
  '/account/meetings',
] as const;
const standardTags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'sizes are set in each case');
});

const header = (page: Page) => page.locator('header.ux-app-header');
const html = (page: Page) => page.locator('html');
/** The phone folds Help into the Account menu; wider screens have their own Help button. */
const menuName = (width: number) => (width < 640 ? 'Account menu' : 'Help and accessibility');

const summarise = (violations: { id: string; nodes: { html: string }[] }[]) =>
  violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 160)}`);
async function axeClean(page: Page) {
  const standard = await new AxeBuilder({ page }).withTags(standardTags).analyze();
  const enhanced = await new AxeBuilder({ page }).withRules(['color-contrast-enhanced']).analyze();
  return { standard: summarise(standard.violations), enhanced: summarise(enhanced.violations) };
}
const chooseStronger = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('corridra.contrast', 'more'));

/** The page now, closed and then with the Help (or Account) menu open, each checked with axe. */
async function expectCleanWithMenu(page: Page, where: string, width: number, withMenu: boolean) {
  expect(await axeClean(page), `${where} at ${width}, menus closed`).toEqual({
    standard: [],
    enhanced: [],
  });
  if (!withMenu) return;
  await header(page)
    .getByRole('button', { name: menuName(width) })
    .click();
  await expect(page.getByRole('menu', { name: menuName(width) })).toBeVisible();
  expect(await axeClean(page), `${where} at ${width}, menu open`).toEqual({
    standard: [],
    enhanced: [],
  });
  await page.keyboard.press('Escape');
}

type Way = 'the saved choice' | 'the device setting';
const ways: Way[] = ['the saved choice', 'the device setting'];
async function prepare(page: Page, way: Way) {
  if (way === 'the saved choice') await chooseStronger(page);
  else await page.emulateMedia({ contrast: 'more' });
}
async function expectWay(page: Page, way: Way) {
  if (way === 'the saved choice') await expect(html(page)).toHaveAttribute('data-contrast', 'more');
  else await expect(html(page)).not.toHaveAttribute('data-contrast', /.*/);
}

for (const way of ways) {
  test(`with ${way} every customer page has no axe violations, enhanced contrast included, at 390 and 1440, menus closed and open`, async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await signInCustomer(context);
    await prepare(page, way);
    for (const path of customerPages)
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto(path);
        await expect(page.locator('main h1, main h2').first()).toBeVisible();
        await expectWay(page, way);
        await expectCleanWithMenu(page, path, size.width, true);
      }
  });
}

test('the enhanced contrast rule runs on these pages: without Stronger Colours the customer home does not meet it', async ({
  page,
  context,
}) => {
  await signInCustomer(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const { enhanced } = await axeClean(page);
  expect(enhanced.length).toBeGreaterThan(0);
});

test('the stronger colours shift nothing: every customer page and the Me page keep their height, with underlined links on', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await signInCustomer(context);
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  for (const path of customerPages)
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const plain = await height();
      await html(page).evaluate((el) => el.setAttribute('data-contrast', 'more'));
      expect(await height(), `${path} at ${size.width}`).toBe(plain);
      await html(page).evaluate((el) => el.removeAttribute('data-contrast'));
    }
});

test.describe('the Help menu row', () => {
  const open = async (page: Page, width = 1440) => {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
    await page.goto('/account');
    await header(page)
      .getByRole('button', { name: menuName(width) })
      .click();
    return page.getByRole('menu', { name: menuName(width) });
  };
  const row = (menu: ReturnType<Page['getByRole']>) =>
    menu.getByRole('menuitemcheckbox', { name: 'Stronger Colours' });
  const contrast = (page: Page) =>
    page.evaluate(() => ({
      attribute: document.documentElement.getAttribute('data-contrast'),
      saved: localStorage.getItem('corridra.contrast'),
    }));

  test.beforeEach(async ({ context }) => {
    await signInCustomer(context);
  });

  test('it is a switch between Listen and Less Movement that says On or Off in words, stays open, and survives a reload', async ({
    page,
  }) => {
    const menu = await open(page);
    const toggle = row(menu);
    // Text Size, then Stronger Colours, then Less Movement last (it carries the one live note).
    const order = await menu.evaluate((panel) =>
      Array.from(
        panel.querySelectorAll('[role="menuitemcheckbox"], [role="group"][aria-label="Text Size"]'),
      )
        .map((el) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim())
        .map((name) =>
          ['Text Size', 'Stronger Colours', 'Less Movement'].find((n) => name.startsWith(n)),
        )
        .filter(Boolean),
    );
    expect(order).toEqual(['Text Size', 'Stronger Colours', 'Less Movement']);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toContainText('Off');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toContainText('On');
    await expect(menu).toBeVisible();
    expect(await contrast(page)).toEqual({ attribute: 'more', saved: 'more' });
    await page.reload();
    expect(await contrast(page)).toEqual({ attribute: 'more', saved: 'more' });
    await header(page).getByRole('button', { name: 'Help and accessibility' }).click();
    await expect(row(menu)).toHaveAttribute('aria-checked', 'true');
    await row(menu).click();
    await expect(row(menu)).toHaveAttribute('aria-checked', 'false');
    expect(await contrast(page)).toEqual({ attribute: null, saved: null });
  });

  test('it works by keyboard, is at least 44 px, and Escape returns focus to the Help button', async ({
    page,
  }) => {
    const menu = await open(page);
    const toggle = row(menu);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const box = (await toggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(
      header(page).getByRole('button', { name: 'Help and accessibility' }),
    ).toBeFocused();
  });

  test('on a phone the Account menu holds it and it works there', async ({ page }) => {
    const menu = await open(page, 390);
    await row(menu).click();
    await expect(row(menu)).toHaveAttribute('aria-checked', 'true');
    expect((await contrast(page)).attribute).toBe('more');
  });

  test('choosing it sends nothing to a server and sets no cookie', async ({ page, context }) => {
    const menu = await open(page);
    const cookiesBefore = JSON.stringify(await context.cookies());
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' || new URL(request.url()).pathname.startsWith('/api'))
        sent.push(`${request.method()} ${request.url()}`);
    });
    await row(menu).click();
    await row(menu).click();
    expect(sent).toEqual([]);
    expect(JSON.stringify(await context.cookies())).toBe(cookiesBefore);
  });

  test('a browser that will not save says so, the choice still holds for the page, and a save that works clears the note', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'corridra.contrast') throw new Error('blocked');
        setItem.call(this, key, value);
      };
    });
    const menu = await open(page);
    const note = menu.locator('[aria-live="polite"]');
    await expect(note).toBeEmpty();
    await row(menu).click();
    await expect(row(menu)).toHaveAttribute('aria-checked', 'true');
    expect((await contrast(page)).attribute).toBe('more');
    await expect(note).toHaveText(
      'This browser cannot save your choice. It lasts until the page loads again.',
    );
    // Turning it off removes the saved value, which this browser allows, so the unsaved choice is gone.
    await row(menu).click();
    await expect(note).toBeEmpty();
  });

  test('when the device asks for more contrast the row reads On with its reason, a tap does nothing, and nothing is saved', async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: 'more' });
    const menu = await open(page);
    const toggle = row(menu);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toContainText('On');
    await expect(toggle).toContainText('Your device asks for this');
    await expect(toggle).toHaveAccessibleDescription('Your device asks for this');
    // Still reachable by keyboard and still 44 px tall, but it does nothing.
    await toggle.focus();
    await expect(toggle).toBeFocused();
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    // Playwright waits for an enabled control, and this one is announced as unavailable, so the tap is forced.
    await toggle.click({ force: true });
    await page.keyboard.press('Enter');
    expect(await contrast(page)).toEqual({ attribute: null, saved: null });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The device stops asking: the row goes back to what the person chose, which is nothing.
    await page.emulateMedia({ contrast: 'no-preference' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).not.toContainText('Your device asks for this');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('a saved choice stays when the device asks too, and a saved Off never lowers what the device asks for', async ({
    page,
  }) => {
    const menu = await open(page);
    await row(menu).click();
    await page.emulateMedia({ contrast: 'more' });
    await expect(row(menu)).toHaveAttribute('aria-disabled', 'true');
    await expect(row(menu)).toHaveAttribute('aria-checked', 'true');
    await row(menu).click({ force: true });
    expect(await contrast(page)).toEqual({ attribute: 'more', saved: 'more' });
    await page.emulateMedia({ contrast: 'no-preference' });
    // The choice was never touched, so it applies again.
    await expect(row(menu)).toHaveAttribute('aria-checked', 'true');
    expect(await contrast(page)).toEqual({ attribute: 'more', saved: 'more' });
    // With the device asking and nothing chosen, the colours are the stronger ones (the media block, no attribute).
    await row(menu).click();
    await page.emulateMedia({ contrast: 'more' });
    expect((await contrast(page)).attribute).toBeNull();
    const textTwo = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim(),
      );
    const asked = await textTwo();
    await page.emulateMedia({ contrast: 'no-preference' });
    expect(await textTwo()).not.toBe(asked);
  });

  test('when the device reduces motion the Less Movement row reads On with its reason, a tap does nothing, and nothing is saved', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const menu = await open(page);
    const toggle = menu.getByRole('menuitemcheckbox', { name: 'Less Movement' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toContainText('Your device asks for this');
    await toggle.click({ force: true });
    expect(
      await page.evaluate(() => ({
        attribute: document.documentElement.getAttribute('data-less-movement'),
        saved: localStorage.getItem('corridra.less-movement'),
      })),
    ).toEqual({ attribute: null, saved: null });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

// One team sign-in for everything the team and helper pages need. The sign-in is limited to five requests in a row
// less than a minute apart (better-auth rate limit, shared by every spec), and the specs after this one sign in
// too, so this spec signs in once and then waits out the minute before it ends.
test('the helper Me page and Team Today with Stronger Colours: axe, height, the switch and the device rule', async ({
  page,
}, info) => {
  test.setTimeout(480_000);
  const seed = await signInOwner(page, '/operator');
  await test.step('the Me page and Team Today have no axe violations, enhanced contrast included, at 390 and 1440, with the saved choice and with the device setting', async () => {
    for (const way of ways) {
      await page.evaluate((saved) => {
        if (saved) localStorage.setItem('corridra.contrast', 'more');
        else localStorage.removeItem('corridra.contrast');
      }, way === 'the saved choice');
      await page.emulateMedia({
        contrast: way === 'the device setting' ? 'more' : 'no-preference',
      });
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto(`/contributor/me?workspace=${seed.tenantId}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Me.' })).toBeVisible();
        await expectWay(page, way);
        await expectCleanWithMenu(page, `Me, ${way}`, size.width, false);
        await page.goto('/operator');
        await expect(page.locator('main h1, main h2').first()).toBeVisible();
        await expectWay(page, way);
        await expectCleanWithMenu(page, `Team Today, ${way}`, size.width, true);
      }
    }
  });
  // Back to a plain page: nothing chosen and the device asks for nothing.
  await page.evaluate(() => localStorage.removeItem('corridra.contrast'));
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  const meUrl = `/contributor/me?workspace=${seed.tenantId}`;
  const openMe = async () => {
    await page.goto(meUrl);
    const card = page.locator('section', {
      has: page.getByRole('heading', { name: 'Make it easier to read' }),
    });
    await expect(card).toBeVisible();
    return card;
  };
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);

  await test.step('the page keeps its height and stays within the phone budget at 390 by 844', async () => {
    await openMe();
    await page.evaluate(() => document.fonts.ready);
    const plain = await height();
    await html(page).evaluate((el) => el.setAttribute('data-contrast', 'more'));
    expect(await height()).toBe(plain);
    // Layout budget (docs/revamp/specs/layout-budget.md): 1.5 screens is the target, 2.0 the hard limit, at 390 wide.
    info.annotations.push({
      type: 'me-page-screens',
      description: `${plain}px = ${(plain / 844).toFixed(2)} screens`,
    });
    expect(plain / 844).toBeLessThanOrEqual(2);
  });

  await test.step('Stronger Colours is a switch that turns the colours on and off and survives a reload', async () => {
    const card = await openMe();
    const toggle = card.getByRole('switch', { name: 'Stronger Colours', exact: true });
    await page.evaluate(() => localStorage.removeItem('corridra.contrast'));
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(html(page)).toHaveAttribute('data-contrast', 'more');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-contrast', 'more');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(html(page)).not.toHaveAttribute('data-contrast', /.*/);
    expect(await page.evaluate(() => localStorage.getItem('corridra.contrast'))).toBeNull();
  });

  await test.step('when the device asks, both switches read On, say why, and change nothing', async () => {
    await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
    const card = await openMe();
    const stronger = card.getByRole('switch', { name: 'Stronger Colours', exact: true });
    const movement = card.getByRole('switch', { name: 'Less Movement', exact: true });
    for (const toggle of [stronger, movement]) {
      await expect(toggle).toBeChecked();
      await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(stronger).toHaveAccessibleDescription(
      'Your device already asks for stronger colours, so this stays On.',
    );
    await expect(movement).toHaveAccessibleDescription(
      'Your device already reduces motion, so this stays On.',
    );
    await stronger.click({ force: true });
    await movement.click({ force: true });
    await expect(stronger).toBeChecked();
    await expect(movement).toBeChecked();
    expect(
      await page.evaluate(() => ({
        contrast: localStorage.getItem('corridra.contrast'),
        movement: localStorage.getItem('corridra.less-movement'),
      })),
    ).toEqual({ contrast: null, movement: null });
    await page.emulateMedia({ contrast: 'no-preference', reducedMotion: 'no-preference' });
    await expect(stronger).not.toBeChecked();
    await expect(movement).not.toBeChecked();
    await expect(stronger).toHaveAccessibleDescription(
      'Darker text, clearer lines and underlined links.',
    );
  });
  // Leave the sign-in rate limit as this spec found it, for the specs that sign in after it.
  await page.waitForTimeout(61_000);
});

const underlineOf = (page: Page, selector: string) =>
  page.evaluate(
    (target) =>
      Array.from(document.querySelectorAll<HTMLElement>(target)).map(
        (el) => getComputedStyle(el).textDecorationLine,
      ),
    selector,
  );

for (const way of ways) {
  test(`with ${way} the focus ring on the navy Team sidebar reaches 3 to 1, and the selected stripe is white, at 1440 and 800`, async ({
    page,
  }) => {
    test.setTimeout(200_000);
    await signInOwner(page, '/operator');
    await prepare(page, way);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 800, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/operator');
      await expect(page.locator('main h1, main h2').first()).toBeVisible();
      await expectWay(page, way);
      const { rings } = await measureColours(page, 'nav.ux-team-sidebar');
      expect(rings.length, `the sidebar has focusable items at ${size.width}`).toBeGreaterThan(5);
      expect(weakRings(rings), `at ${size.width}`).toEqual([]);
      const stripe = await page.evaluate(() => {
        const current = document.querySelector('nav.ux-team-sidebar [aria-current]');
        return current ? getComputedStyle(current).boxShadow : 'none found';
      });
      // At 800 the stripe is drawn, and it is white (cobalt on navy is 1.91 to 1); at 1440 the selected tile has none.
      if (size.width === 800) expect(stripe).toBe('rgb(255, 255, 255) 3px 0px 0px 0px inset');
      else expect(stripe).toBe('none');
    }
    // Leave the sign-in rate limit as this test found it, for the specs that sign in after it.
    await page.waitForTimeout(61_000);
  });
}

test('Team Today tiles and rows made of links are not underlined; a link in a sentence and a standalone text link are', async ({
  page,
}) => {
  test.setTimeout(200_000);
  await signInOwner(page, '/operator');
  await chooseStronger(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/operator');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-contrast', 'more');
  // The count tiles are drawn once Today's list has loaded.
  await expect(page.locator('main .ux-today-tiles li > a').first()).toBeVisible({
    timeout: 30_000,
  });
  const tiles = await underlineOf(page, 'main .ux-today-tiles li > a');
  expect(tiles.length, 'Team Today has count tiles').toBeGreaterThan(0);
  expect(new Set(tiles)).toEqual(new Set(['none']));
  // The workspace toolbar's icon button is a control with its own look, not a standalone text link.
  const standalone = await underlineOf(page, 'main a.text-link:not(.operator-toolbar a)');
  expect(standalone.length, 'Team Today has a standalone text link').toBeGreaterThan(0);
  expect(new Set(standalone)).toEqual(new Set(['underline']));
  await page.waitForTimeout(61_000);
});

test('the account request rows are not underlined, and the link in a sentence is', async ({
  page,
  context,
}) => {
  await signInCustomer(context);
  await chooseStronger(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  const rows = await underlineOf(page, 'main li > a, main a.ux-row-link');
  expect(rows.length, 'the account page has row links').toBeGreaterThan(0);
  expect(new Set(rows)).toEqual(new Set(['none']));
  await page.goto('/account?view=more');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  const list = await underlineOf(page, 'main .ux-link-list li > a');
  expect(list.length).toBeGreaterThan(0);
  expect(new Set(list)).toEqual(new Set(['none']));
  const sentence = await underlineOf(page, 'main p a.text-link');
  expect(sentence.length, 'the more page has a link in a sentence').toBeGreaterThan(0);
  expect(new Set(sentence)).toEqual(new Set(['underline']));
});
