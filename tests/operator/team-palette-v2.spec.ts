import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// The staff command palette, Phase 1 (docs/revamp/specs/navigation-v1/command-palette-search.md): the wide Search
// field in the top bar, ranked and marked results with the stage of a mission and the source flag of a company, the
// empty state with this person's recents, and an honest state for denied, partial, failed and signed-out searches.
// Bundled with the real stylesheets (the Today fixture); the search route and the session are answered by page.route.
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
test.beforeAll(async () => {
  fixture = await startTodayFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const missionId = (n: number) => `0b5a0001-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = (n: number) => `0c5a0001-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dialogName = 'Search missions, companies and actions';

type Answer = {
  missions?: { id: string; label: string; detail: string }[];
  companies?: { id: string; label: string; detail: string }[];
  denied?: string[];
  partial?: string[];
  facts?: Record<string, unknown>;
};
const answer = (over: Answer = {}) => ({
  missions: [],
  companies: [],
  denied: [],
  partial: [],
  ...over,
});

async function open(
  page: Page,
  options: { width?: number; role?: string; user?: { id: string } | null | 'down' } = {},
) {
  const { width = 1280, role = 'owner', user = 'down' } = options;
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role,
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  // 'down' leaves the session read unanswered (a 404 in this fixture): who is signed in is unknown.
  if (user !== 'down')
    await page.route('**/api/operator-auth/get-session', (route) =>
      route.fulfill({ json: user ? { user, session: { id: 's' } } : null }),
    );
  await page.goto(`${fixture.origin}/operator?owner=on&urls=on&role=${role}`);
  await expect(page.locator('header.ux-app-header')).toBeVisible();
}

/** Answers the search route and counts what was asked. */
async function serve(
  page: Page,
  reply: (url: URL, count: number) => Answer | number | Promise<Answer | number>,
) {
  const asked: URL[] = [];
  await page.route('**/api/workspace/search?*', async (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const result = await reply(url, asked.length);
    if (typeof result === 'number') return route.fulfill({ status: result, json: { error: 'x' } });
    return route.fulfill({ json: result as Answer });
  });
  return asked;
}

const palette = (page: Page) => page.getByRole('dialog', { name: dialogName });
const field = (page: Page) => palette(page).getByRole('combobox');

async function type(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await field(page).fill(text);
}

test.describe('P8 the Search control in the top bar', () => {
  test('from 1024 px it is a wide field of 176 to 560 px and 44 px high; below it is an icon button', async ({
    page,
  }) => {
    await open(page);
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    for (const [width, min, max] of [
      [1024, 176, 560],
      [1100, 176, 560],
      [1280, 176, 560],
      [1440, 176, 560],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const box = (await trigger.boundingBox())!;
      expect(box.height, `height at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `width at ${width}`).toBeGreaterThanOrEqual(min);
      expect(box.width, `width at ${width}`).toBeLessThanOrEqual(max);
      await expect(trigger).toContainText('Search');
      await expect(trigger).toContainText('Ctrl K');
      // One row: the header keeps its height, and nothing runs past the window.
      const header = (await page.locator('header.ux-app-header').boundingBox())!;
      expect(header.height, `header at ${width}`).toBeLessThanOrEqual(72);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const box = (await trigger.boundingBox())!;
      expect(box.height, `height at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `width at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `width at ${width}`).toBeLessThanOrEqual(52);
      await expect(trigger).toHaveAccessibleName(/Search/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });
  test('R2-6 the account and help buttons stay inside the header and the window, rail open and collapsed', async ({
    page,
  }) => {
    await open(page);
    const header = page.locator('header.ux-app-header');
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const collapsed of [false, true]) {
        const frame = page.locator('.ux-leftnav-frame');
        if ((await frame.getAttribute('data-collapsed')) !== String(collapsed))
          await page.locator('.ux-leftnav-collapse').click();
        await expect(frame).toHaveAttribute('data-collapsed', String(collapsed));
        const bar = (await header.boundingBox())!;
        for (const name of ['Account menu', 'Help and accessibility']) {
          const box = (await header.getByRole('button', { name }).boundingBox())!;
          const where = `${name} at ${width}, rail ${collapsed ? 'collapsed' : 'open'}`;
          expect(box.x, where).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, where).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
          expect(box.x + box.width, where).toBeLessThanOrEqual(width);
          // Tools that wrap or overflow drop out of the fixed-height header.
          expect(box.y, where).toBeGreaterThanOrEqual(bar.y - 0.5);
          expect(box.y + box.height, where).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
        }
      }
    }
  });
  test('R3 at 200% text the Search field never runs past its container or the window', async ({
    page,
  }) => {
    // Corridra's own text-size setting, like this style, sets the root font size as an author style. An em media query
    // reads the browser default instead, so the wide field applies here and its floor of 11rem is 352 px: at 1024 px
    // that was wider than the tools box (249 px), and the page scrolled sideways by 63 px.
    await open(page);
    // The rail is collapsed so the header has the room the field is measured against: with the rail open, the header
    // itself is already wider than the window at 200% text and 1024 or 1100 px on main as well (a separate matter).
    await page.locator('.ux-leftnav-collapse').click();
    await expect(page.locator('.ux-leftnav-frame')).toHaveAttribute('data-collapsed', 'true');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    for (const width of [1024, 1100, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const m = await trigger.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const room = node.parentElement!.getBoundingClientRect();
        return {
          right: box.right,
          roomRight: room.right,
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(m.scroll, `sideways scroll in px at ${width}`).toBeLessThanOrEqual(0);
      expect(m.right, `trigger right edge against its container at ${width}`).toBeLessThanOrEqual(
        m.roomRight + 0.5,
      );
      expect(m.right, `trigger right edge against the window at ${width}`).toBeLessThanOrEqual(
        width,
      );
    }
  });
  test('R3 at normal text the Search field at 1024 px is still at least 176 px wide', async ({
    page,
  }) => {
    await open(page);
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    await page.setViewportSize({ width: 1024, height: 900 });
    expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(176);
  });
  test('it is one button: no input and no second combobox in the header', async ({ page }) => {
    await open(page);
    const header = page.locator('header.ux-app-header');
    await expect(header.locator('input, [role="combobox"]')).toHaveCount(0);
    const trigger = header.getByRole('button', { name: /Search/ });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  });
  test('the wordmark is not hidden between 900 and 1023 px, and the field begins at 1024', async ({
    page,
  }) => {
    await open(page);
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    await page.setViewportSize({ width: 1000, height: 900 });
    expect((await trigger.boundingBox())!.width).toBeLessThan(200);
    await page.setViewportSize({ width: 1024, height: 900 });
    expect((await trigger.boundingBox())!.width).toBeGreaterThan(200);
  });
});

test.describe('P3 and P4 and P5 rows', () => {
  const rich = answer({
    missions: [
      { id: missionId(1), label: 'Madrid Textiles', detail: 'Sell in a new market · Spain' },
      { id: missionId(2), label: 'Mad Dogs Ltd', detail: 'Buy leather · Italy' },
      { id: missionId(3), label: 'Nomad Freight', detail: 'Trip · France' },
      { id: missionId(4), label: 'Madeira Wines', detail: 'Sell wine · Portugal' },
      { id: missionId(5), label: 'Madagascar Vanilla', detail: 'Buy vanilla · Madagascar' },
    ],
    companies: [
      { id: companyId(1), label: 'Madrid Source Co', detail: 'ES' },
      { id: companyId(2), label: 'Madrid Old Co', detail: 'ES' },
      { id: companyId(3), label: 'Madrid Plain Co', detail: 'ES' },
    ],
    facts: {
      ['mission:' + missionId(1)]: { status: 'TARGETING' },
      ['mission:' + missionId(2)]: { status: 'DRAFT' },
      ['mission:' + missionId(3)]: { status: 'MEETINGS' },
      ['mission:' + missionId(4)]: { status: 'ON_HOLD' },
      ['mission:' + missionId(5)]: { status: 'CANCELLED' },
      ['company:' + companyId(1)]: { source: 'SOURCE_REPORTED' },
      ['company:' + companyId(2)]: { source: 'EXPIRED' },
    },
  });
  test('stage badges, source chips, marked words and the full name of an option', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => rich);
    await type(page, 'mad');
    const box = palette(page);
    const row = (name: RegExp) => box.getByRole('option', { name });
    await expect(row(/Madrid Textiles/)).toContainText('Step 2, Find');
    await expect(row(/Madrid Textiles/)).toContainText('Finding companies');
    await expect(row(/Mad Dogs Ltd/)).toContainText('Step 1, Define');
    await expect(row(/Nomad Freight/)).toContainText('Step 4, Visit');
    await expect(row(/Madeira Wines/)).toContainText('Paused');
    await expect(row(/Madeira Wines/)).not.toContainText(/Step \d/);
    await expect(row(/Madagascar Vanilla/)).toContainText('Cancelled');
    await expect(row(/Madrid Source Co/)).toContainText('Source on record');
    await expect(row(/Madrid Old Co/)).toContainText('Source expired');
    await expect(row(/Madrid Plain Co/)).not.toContainText('Source');
    await expect(box).not.toContainText(/Evidence available|Verified/);
    // The typed words are marked as text inside the label; the whole label is still the name.
    await expect(row(/Madrid Textiles/).locator('strong mark')).toHaveText('Mad');
    await expect(row(/Nomad Freight/).locator('strong mark')).toHaveText('mad');
    await expect(row(/Madrid Textiles/).getByText('Madrid Textiles')).toBeVisible();
  });
  test('markup in a name is shown as text and never runs', async ({ page }) => {
    await open(page);
    const hostile = '<img src=x onerror="window.__pwned=1"> Mad Co';
    await serve(page, () =>
      answer({ missions: [{ id: missionId(9), label: hostile, detail: '<b>Spain</b>' }] }),
    );
    await type(page, 'mad');
    const option = palette(page).getByRole('option', { name: /Mad Co/ });
    await expect(option).toBeVisible();
    await expect(option).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(palette(page).locator('img, b')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });
  test('an answer of the old shape (four keys, plain hits) renders as before', async ({ page }) => {
    await open(page);
    await serve(page, () =>
      answer({
        missions: [
          { id: missionId(1), label: 'Invented Towels Ltd', detail: 'Source suppliers · China' },
        ],
      }),
    );
    await type(page, 'Invented');
    const option = palette(page).getByRole('option', { name: /Invented Towels Ltd/ });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute(
      'href',
      `/operator/missions/${missionId(1)}?workspace=${fixtureTenant}`,
    );
    await expect(
      palette(page).locator('.ux-palette-badge, .ux-palette-chip, .ux-palette-close-match'),
    ).toHaveCount(0);
  });
  test('an unknown status has its plain words and no step number', async ({ page }) => {
    await open(page);
    await serve(page, () =>
      answer({
        missions: [{ id: missionId(1), label: 'Odd Status Co', detail: '' }],
        facts: { ['mission:' + missionId(1)]: { status: 'WAITING_ON_CUSTOMER' } },
      }),
    );
    await type(page, 'odd');
    const option = palette(page).getByRole('option', { name: /Odd Status Co/ });
    await expect(option).toContainText('Waiting on customer');
    await expect(option).not.toContainText(/Step \d/);
  });
});

test.describe('states that are not "no match"', () => {
  const hit = [{ id: missionId(1), label: 'Madrid Textiles', detail: 'Sell · Spain' }];
  const never = /Nothing found|No match/;
  test('D1 a denied scope is named, the other scope still shows, and it is not "no match"', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => answer({ missions: hit, denied: ['companies'] }));
    await type(page, 'mad');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    await expect(palette(page)).toContainText('Your role cannot search companies.');
    await expect(palette(page)).toContainText('Ask an owner or admin if you need access.');
    await expect(palette(page)).not.toContainText(never);
  });
  test('a role denied in both scopes is told so, not that nothing matched', async ({ page }) => {
    await open(page);
    await serve(page, () => answer({ denied: ['missions', 'companies'] }));
    await type(page, 'mad');
    await expect(palette(page)).toContainText('Your role cannot search missions or companies.');
    await expect(palette(page)).not.toContainText(never);
  });
  test('D4 a role revoked in the middle of a session is denied on the next search', async ({
    page,
  }) => {
    await open(page);
    let revoked = false;
    await serve(page, () =>
      revoked ? answer({ denied: ['missions', 'companies'] }) : answer({ missions: hit }),
    );
    await type(page, 'mad');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    revoked = true;
    await field(page).fill('madr');
    await expect(palette(page)).toContainText('Your role cannot search missions or companies.');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toHaveCount(0);
  });
  test('partial results say so and never give a number', async ({ page }) => {
    await open(page);
    await serve(page, () => answer({ missions: hit, partial: ['missions'] }));
    await type(page, 'mad');
    await expect(palette(page)).toContainText('Partial results.');
    await expect(palette(page)).toContainText(
      'Not every mission was searched. More may exist. Narrow your search or try again.',
    );
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
  });
  test('a complete search with nothing found says no match, with the query as text', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => answer());
    await type(page, '<b>zzz</b>');
    await expect(palette(page)).toContainText('No match for “<b>zzz</b>”');
    await expect(palette(page)).toContainText('Try a different spelling or fewer letters.');
    await expect(palette(page).locator('b')).toHaveCount(0);
  });
  test('a search that found nothing in the part it could search does not claim there is no match', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => answer({ partial: ['companies'] }));
    await type(page, 'zzz');
    await expect(palette(page)).toContainText('No match in the part searched');
    await expect(palette(page)).not.toContainText('Partial results.');
  });
  test('R1 a failed search offers Retry first, keeps the words, and Retry sends the same search again', async ({
    page,
  }) => {
    await open(page);
    const asked = await serve(page, (_url, count) =>
      count === 1 ? 500 : answer({ missions: hit }),
    );
    await type(page, 'mad');
    await expect(palette(page)).toContainText('The search did not finish. Try again.');
    await expect(palette(page)).not.toContainText(never);
    const retry = palette(page).getByRole('option', { name: /Retry/ });
    await expect(retry).toHaveAttribute('aria-selected', 'true');
    await expect(field(page)).toHaveValue('mad');
    await page.keyboard.press('Enter');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    expect(asked.map((url) => url.searchParams.get('q'))).toEqual(['mad', 'mad']);
    await expect(palette(page)).not.toContainText('The search did not finish.');
  });
  test('D3 a signed-out search says so and offers Sign In, not "no match"', async ({ page }) => {
    await open(page);
    await serve(page, () => 401);
    await type(page, 'mad');
    await expect(palette(page)).toContainText('You are signed out');
    await expect(palette(page)).toContainText('Sign in again to keep searching.');
    await expect(palette(page)).not.toContainText(never);
    const signIn = palette(page).getByRole('option', { name: /Sign In/ });
    await expect(signIn).toHaveAttribute('href', /^\/operator\/signin/);
  });
  test('R1 typing again drops the answer to the older search', async ({ page }) => {
    await open(page);
    let releaseOld: () => void = () => undefined;
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve));
    let oldDone: () => void = () => undefined;
    const oldAnswered = new Promise<void>((resolve) => (oldDone = resolve));
    const asked: string[] = [];
    await page.route('**/api/workspace/search?*', async (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? '';
      asked.push(q);
      if (q === 'madr') {
        await oldGate;
        // The page has abandoned this request; answering it is the stale answer arriving late.
        await route
          .fulfill({
            json: answer({ missions: [{ id: missionId(1), label: 'Old Answer Co', detail: '' }] }),
          })
          .catch(() => undefined);
        oldDone();
        return;
      }
      await route.fulfill({
        json: answer({ missions: [{ id: missionId(2), label: 'New Answer Co', detail: '' }] }),
      });
    });
    await type(page, 'madr');
    await expect.poll(() => asked).toContain('madr');
    await field(page).fill('madri');
    await expect(palette(page).getByRole('option', { name: /New Answer Co/ })).toBeVisible();
    releaseOld();
    await oldAnswered;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(palette(page).getByRole('option', { name: /Old Answer Co/ })).toHaveCount(0);
    await expect(palette(page).getByRole('option', { name: /New Answer Co/ })).toBeVisible();
  });
});

test.describe('P7 the empty state and recents', () => {
  const recentsKey = (subject: string) =>
    'corridra:palette-recents:v1:' + encodeURIComponent(JSON.stringify([subject, fixtureTenant]));
  const seed = async (page: Page, subject: string) =>
    page.evaluate(
      ([key, mission]) =>
        localStorage.setItem(
          key!,
          JSON.stringify({ v: 1, items: [{ k: 'm', id: mission!, l: 'Madrid Textiles' }] }),
        ),
      [recentsKey(subject), missionId(1)],
    );
  test('opening the palette asks the search route for nothing and offers the places the role may open', async ({
    page,
  }) => {
    await open(page);
    const asked = await serve(page, () => answer());
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await expect(palette(page)).toContainText(
      'Type at least 2 letters to search missions and companies.',
    );
    await expect(palette(page).getByRole('group', { name: 'Places you can open' })).toBeVisible();
    await expect(palette(page).getByRole('option').first()).toBeVisible();
    await field(page).fill('m');
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
  });
  test("this person's recents come first, then the places; Clear Recents removes them", async ({
    page,
  }) => {
    await open(page, { user: { id: 'person-a' } });
    await seed(page, 'person-a');
    const asked = await serve(page, () => answer());
    await page.keyboard.press('Control+k');
    const recents = palette(page).getByRole('group', { name: 'Recent on this device' });
    await expect(recents.getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    await expect(recents.getByRole('option', { name: /Madrid Textiles/ })).toContainText('Mission');
    await expect(recents.getByRole('option', { name: /Clear Recents/ })).toBeVisible();
    await expect(palette(page).getByRole('group', { name: 'Places you can open' })).toBeVisible();
    const order = await palette(page).getByRole('option').allInnerTexts();
    expect(order[0]).toContain('Madrid Textiles');
    await recents.getByRole('option', { name: /Clear Recents/ }).click();
    await expect(recents).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), recentsKey('person-a')),
    ).toBeNull();
    expect(asked).toHaveLength(0);
  });
  test("D5 another person on the same device does not see the first person's recents, and they are removed", async ({
    page,
  }) => {
    await open(page, { user: { id: 'person-b' } });
    await seed(page, 'person-a');
    await page.keyboard.press('Control+k');
    await expect(palette(page).getByRole('group', { name: 'Places you can open' })).toBeVisible();
    await expect(palette(page).getByRole('group', { name: 'Recent on this device' })).toHaveCount(
      0,
    );
    await expect(palette(page)).not.toContainText('Madrid Textiles');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), recentsKey('person-a')))
      .toBeNull();
  });
  test('D5 a session that has ended removes the recents and says so', async ({ page }) => {
    await open(page, { user: null });
    await seed(page, 'person-a');
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toContainText('You are signed out');
    await expect(palette(page).getByRole('option', { name: /Sign In/ })).toBeVisible();
    await expect(palette(page)).not.toContainText('Madrid Textiles');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), recentsKey('person-a')))
      .toBeNull();
  });
  test('no recents are shown when who is signed in cannot be read, and nothing is claimed', async ({
    page,
  }) => {
    await open(page);
    await seed(page, 'person-a');
    await page.keyboard.press('Control+k');
    await expect(palette(page).getByRole('group', { name: 'Places you can open' })).toBeVisible();
    await expect(palette(page)).not.toContainText('Madrid Textiles');
    await expect(palette(page)).not.toContainText('signed out');
  });
  test('Companies with nothing opened yet says so', async ({ page }) => {
    await open(page, { user: { id: 'person-a' } });
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('button', { name: 'Companies', exact: true }).click();
    await expect(palette(page)).toContainText('Type at least 2 letters to search companies.');
    await expect(palette(page)).toContainText('No recent companies yet.');
  });
  test('opening a hit remembers its name and nothing else', async ({ page }) => {
    await open(page, { user: { id: 'person-a' } });
    await serve(page, () =>
      answer({
        missions: [{ id: missionId(1), label: 'Madrid Textiles', detail: 'Secret detail' }],
      }),
    );
    await page.route('**/operator/missions/**', (route) =>
      route.fulfill({ status: 200, body: '<html></html>', contentType: 'text/html' }),
    );
    await type(page, 'mad');
    await palette(page)
      .getByRole('option', { name: /Madrid Textiles/ })
      .click();
    await page.waitForURL(/operator\/missions\//);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).toContain('Madrid Textiles');
    expect(stored).not.toContain('Secret detail');
    expect(stored).not.toMatch(/"q"|query/);
  });
});

test.describe('P9 keyboard and announcements', () => {
  const found = answer({
    missions: [
      { id: missionId(1), label: 'Madrid Textiles', detail: 'Sell · Spain' },
      { id: missionId(2), label: 'Mad Dogs', detail: 'Buy · Italy' },
    ],
  });
  test('the active option is always a real option, after every result change', async ({ page }) => {
    await open(page);
    await serve(page, () => found);
    await page.keyboard.press('Control+k');
    const check = async () => {
      const id = await field(page).getAttribute('aria-activedescendant');
      expect(id).toBeTruthy();
      const option = palette(page).locator(`[id="${id}"]`);
      await expect(option).toHaveAttribute('role', 'option');
      await expect(option).toHaveAttribute('aria-selected', 'true');
    };
    await check();
    await field(page).fill('mad');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    await check();
    await page.keyboard.press('ArrowDown');
    await check();
    await palette(page).getByRole('button', { name: 'Missions', exact: true }).click();
    // While the new search runs there is no option, and the field points at none; then it points at the first.
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    await check();
    await palette(page).getByRole('button', { name: 'All', exact: true }).click();
    await field(page).fill('');
    await check();
    // With no option to point at (nothing opened yet in Companies) the field points at nothing.
    await palette(page).getByRole('button', { name: 'Companies', exact: true }).click();
    await expect(palette(page).getByRole('option')).toHaveCount(0);
    await expect(field(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
    await expect(field(page)).toHaveAttribute('aria-autocomplete', 'list');
  });
  test('typing quickly makes exactly one announcement, the settled count, and never says Searching', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => found);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const status = palette(page).locator('[role="status"]');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await status.evaluate((node) => {
      (window as unknown as { __changes: string[] }).__changes = [];
      new MutationObserver(() =>
        (window as unknown as { __changes: string[] }).__changes.push(node.textContent ?? ''),
      ).observe(node, { childList: true, characterData: true, subtree: true });
    });
    await field(page).pressSequentially('madrid', { delay: 60 });
    await expect(status).toHaveText('2 results');
    const changes = await page.evaluate(
      () => (window as unknown as { __changes: string[] }).__changes,
    );
    // Without the settle delay "Searching" would be spoken first, and the sequence would be two long.
    expect(changes.filter(Boolean)).toEqual(['2 results']);
  });
  test('the status node shows the settled message only after the settle delay', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () =>
      answer({
        missions: [{ id: missionId(1), label: 'Madrid Textiles', detail: 'Sell · Spain' }],
      }),
    );
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const status = palette(page).locator('[role="status"]');
    await expect(status).toHaveText('');
    await page.evaluate(() => {
      const times: { shown?: number; spoken?: number } = {};
      (window as unknown as { __times: typeof times }).__times = times;
      const dialog = document.querySelector('dialog.ux-palette')!;
      new MutationObserver(() => {
        const now = performance.now();
        if (times.shown === undefined && dialog.querySelector('[role="option"]')) times.shown = now;
        if (
          times.spoken === undefined &&
          dialog.querySelector('[role="status"]')?.textContent === '1 result'
        )
          times.spoken = now;
      }).observe(dialog, { childList: true, characterData: true, subtree: true });
    });
    await field(page).fill('madrid');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    // The visible summary already says it; the screen reader line follows once the message has stayed the same.
    await expect(status).toHaveText('1 result', { timeout: 3000 });
    const times = await page.evaluate(
      () => (window as unknown as { __times: { shown: number; spoken: number } }).__times,
    );
    expect(times.spoken - times.shown).toBeGreaterThanOrEqual(450);
  });
  test('Tab cycles the scopes and stays in the field; Escape closes, resets and returns focus', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => found);
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    await trigger.click();
    await expect(palette(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await field(page).fill('mad');
    for (const name of ['Missions', 'Companies', 'Actions', 'All']) {
      await page.keyboard.press('Tab');
      await expect(palette(page).getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(field(page)).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(field(page)).toHaveValue('');
    await expect(palette(page).getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  test('the hint appears once, the scopes are exactly four, and People is not offered', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page).getByText('Searches only what your role may open')).toHaveCount(1);
    await expect(
      palette(page).getByRole('group', { name: 'Search in' }).getByRole('button'),
    ).toHaveText(['All', 'Missions', 'Companies', 'Actions']);
    await expect(palette(page)).not.toContainText('People');
  });
  test('the listbox is the scroll viewport and holds only groups of options', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    const list = palette(page).getByRole('listbox');
    expect(await list.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');
    await expect(list).toHaveAttribute('aria-label', 'Recent items and places you can open');
    await field(page).fill('audit');
    await expect(list).toHaveAttribute('aria-label', 'Results');
  });
});

test.describe('M4 accessibility', () => {
  for (const width of [390, 1440])
    test(`axe finds no wcag2a or wcag2aa violation in the open dialog at ${width} px`, async ({
      page,
    }) => {
      await open(page, { width });
      await serve(page, () =>
        answer({
          missions: [
            { id: missionId(1), label: 'Madrid Textiles', detail: 'Sell · Spain' },
            { id: missionId(4), label: 'Madeira Wines', detail: 'Sell wine · Portugal' },
          ],
          companies: [
            { id: companyId(1), label: 'Madrid Source Co', detail: 'ES' },
            { id: companyId(2), label: 'Madrid Old Co', detail: 'ES' },
          ],
          denied: [],
          partial: ['missions'],
          facts: {
            ['mission:' + missionId(1)]: { status: 'TARGETING', close: true },
            ['mission:' + missionId(4)]: { status: 'ON_HOLD' },
            ['company:' + companyId(1)]: { source: 'SOURCE_REPORTED' },
            ['company:' + companyId(2)]: { source: 'EXPIRED' },
          },
        }),
      );
      await type(page, 'mad');
      await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
      const scan = async () =>
        (
          await new AxeBuilder({ page })
            .include('dialog.ux-palette')
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze()
        ).violations.map((v) => v.id);
      expect(await scan()).toEqual([]);
      // The error and the signed-out states too.
      await page.unroute('**/api/workspace/search?*');
      await serve(page, () => 500);
      await field(page).fill('madri');
      await expect(palette(page)).toContainText('The search did not finish. Try again.');
      expect(await scan()).toEqual([]);
    });
  test('the Close button replaces Esc on a phone, and no text is smaller than 12 px', async ({
    page,
  }) => {
    await open(page, { width: 390 });
    await page.keyboard.press('Control+k');
    const close = palette(page).getByRole('button', { name: 'Close' });
    await expect(close).toBeVisible();
    // 44 px in CSS; layout rounds to 1/64 px.
    expect((await close.boundingBox())!.height).toBeGreaterThan(43.9);
    const small = await palette(page).evaluate((root) =>
      Array.from(root.querySelectorAll('*'))
        .filter(
          (node) =>
            node.childNodes.length &&
            Array.from(node.childNodes).some((c) => c.nodeType === 3 && c.textContent?.trim()),
        )
        .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12)
        .map((node) => node.className),
    );
    expect(small).toEqual([]);
    await close.click();
    await expect(palette(page)).toBeHidden();
  });
  test('scope buttons, the field and the rows keep 44 px targets', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    for (const name of ['All', 'Missions', 'Companies', 'Actions'])
      expect(
        (await palette(page).getByRole('button', { name, exact: true }).boundingBox())!.height +
          0.1,
      ).toBeGreaterThanOrEqual(44);
    expect((await field(page).boundingBox())!.height).toBeGreaterThan(43.9);
    expect(
      (await palette(page).getByRole('option').first().boundingBox())!.height,
    ).toBeGreaterThanOrEqual(56);
  });
});

test.describe('FAIL 2 the palette reopens after every kind of close', () => {
  // The dialog is closed natively (Escape) before React hears of it. A reopen in the same turn used to be lost:
  // the open state was still true, so Ctrl K changed nothing and the close handler then closed it for good.
  const modes = [
    ['close()', 'close'],
    ['requestClose()', 'requestClose'],
    ['close() and a task later', 'closeThenTask'],
  ] as const;
  for (const [label, mode] of modes)
    test(`Ctrl K straight after ${label} opens an empty, focused palette`, async ({ page }) => {
      await open(page, { user: { id: 'person-a' } });
      await serve(page, () => answer());
      await page.keyboard.press('Control+k');
      await expect(palette(page)).toBeVisible();
      await field(page).fill('mad');
      const state = await page.evaluate(async (how) => {
        const dialog = document.querySelector('dialog.ux-palette') as HTMLDialogElement;
        const press = () =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'k',
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        if (how === 'close') dialog.close();
        else if (how === 'requestClose') dialog.requestClose();
        else {
          dialog.close();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        press();
        await new Promise((resolve) => setTimeout(resolve, 400));
        const input = dialog.querySelector('input') as HTMLInputElement;
        return {
          open: dialog.open,
          value: input.value,
          focused: document.activeElement === input,
        };
      }, mode);
      expect(state).toEqual({ open: true, value: '', focused: true });
      await expect(palette(page)).toBeVisible();
      await expect(field(page)).toHaveValue('');
      await expect(field(page)).toBeFocused();
      // And it closes again, with focus back where it was opened.
      await page.keyboard.press('Escape');
      await expect(palette(page)).toBeHidden();
    });
  test('Escape then Ctrl K with no wait between them opens it every time', async ({ page }) => {
    await open(page, { user: { id: 'person-a' } });
    await serve(page, () => answer());
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    for (let round = 0; round < 12; round++) {
      await field(page).fill('mad');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await expect(palette(page), `round ${round}`).toBeVisible();
      await expect(field(page), `round ${round}`).toHaveValue('');
      await expect(field(page), `round ${round}`).toBeFocused();
    }
  });
  test('Ctrl K while it is open keeps the words and does not change where focus returns', async ({
    page,
  }) => {
    await open(page, { user: { id: 'person-a' } });
    await serve(page, () => answer());
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    await trigger.click();
    await field(page).fill('mad');
    await page.keyboard.press('Control+k');
    await expect(field(page)).toHaveValue('mad');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('R2-1 and R2-13 the keyboard', () => {
  const found = answer({
    missions: [
      { id: missionId(1), label: 'Madrid Textiles', detail: 'Sell · Spain' },
      { id: missionId(2), label: 'Mad Dogs', detail: 'Buy · Italy' },
    ],
  });
  test('Down pressed while the search runs still leaves a selected row when the answer arrives, and Enter opens it', async ({
    page,
  }) => {
    await open(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const asked = await serve(page, async () => {
      await gate;
      return found;
    });
    await page.route('**/operator/missions/**', (route) =>
      route.fulfill({ status: 200, body: '<html></html>', contentType: 'text/html' }),
    );
    await type(page, 'madrid');
    await expect(palette(page)).toContainText('Searching missions and companies');
    await expect(palette(page).getByRole('option')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => asked.length).toBe(1);
    release();
    const first = palette(page).getByRole('option', { name: /Madrid Textiles/ });
    await expect(first).toBeVisible();
    const id = await field(page).getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    const active = palette(page).locator(`[id="${id}"]`);
    await expect(active).toHaveAttribute('role', 'option');
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await page.waitForURL(/operator\/missions\//);
  });
  test('Enter that commits an input method composition does not open a result', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => found);
    await page.route('**/operator/missions/**', (route) =>
      route.fulfill({ status: 200, body: '<html></html>', contentType: 'text/html' }),
    );
    await type(page, 'madrid');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    const before = page.url();
    const prevented = await field(page).evaluate((input) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    await page.waitForTimeout(400);
    expect(prevented).toBe(false);
    expect(page.url()).toBe(before);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForURL(/operator\/missions\//);
  });
  test('Safari ends the composition before the committing Enter: keyCode 229 does not open a result', async ({
    page,
  }) => {
    await open(page);
    await serve(page, () => found);
    await page.route('**/operator/missions/**', (route) =>
      route.fulfill({ status: 200, body: '<html></html>', contentType: 'text/html' }),
    );
    await type(page, 'madrid');
    await expect(palette(page).getByRole('option', { name: /Madrid Textiles/ })).toBeVisible();
    const before = page.url();
    const prevented = await field(page).evaluate((input) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        isComposing: false,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    await page.waitForTimeout(400);
    expect(prevented).toBe(false);
    expect(page.url()).toBe(before);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForURL(/operator\/missions\//);
  });
});

test.describe('N5 and S3 recents', () => {
  const recentsKey = (subject: string) =>
    'corridra:palette-recents:v1:' + encodeURIComponent(JSON.stringify([subject, fixtureTenant]));
  test('"No recent missions yet." is not said while who is signed in is still being read', async ({
    page,
  }) => {
    await open(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/operator-auth/get-session', async (route) => {
      await gate;
      await route.fulfill({ json: { user: { id: 'person-a' }, session: { id: 's' } } });
    });
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('button', { name: 'Missions', exact: true }).click();
    await expect(palette(page)).toContainText('Type at least 2 letters to search missions.');
    await expect(palette(page)).not.toContainText('No recent missions yet.');
    release();
    await expect(palette(page)).toContainText('No recent missions yet.');
  });
  for (const [label, signOut] of [
    ['the workspace toolbar Sign Out', 'toolbar'],
    ['the account menu Sign Out', 'menu'],
  ] as const)
    test(`S3 ${label} removes the recents from this device`, async ({ page }) => {
      await open(page, { user: { id: 'person-a' } });
      await page.evaluate(
        ([key, mission]) =>
          localStorage.setItem(
            key!,
            JSON.stringify({ v: 1, items: [{ k: 'm', id: mission!, l: 'Madrid Textiles' }] }),
          ),
        [recentsKey('person-a'), missionId(1)],
      );
      await page.route('**/api/operator-auth/sign-out', (route) => route.fulfill({ json: {} }));
      await page.route('**/operator/signin*', (route) =>
        route.fulfill({ status: 200, body: '<html></html>', contentType: 'text/html' }),
      );
      expect(
        await page.evaluate((key) => localStorage.getItem(key), recentsKey('person-a')),
      ).not.toBeNull();
      if (signOut === 'toolbar')
        await page.locator('.operator-toolbar').getByRole('button', { name: 'Sign Out' }).click();
      else {
        await page
          .locator('header.ux-app-header')
          .getByRole('button', { name: /Account/ })
          .click();
        await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
      }
      await page.waitForURL(/signin/);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), recentsKey('person-a')),
      ).toBeNull();
    });
});

test.describe('B1 and B2 the palette fits a phone', () => {
  const states = [
    ['a failed search', () => 500, 'The search did not finish. Try again.'],
    [
      'a denied scope with no match',
      () => answer({ denied: ['companies'] }),
      'Your role cannot search companies.',
    ],
  ] as const;
  for (const width of [320, 390])
    for (const [label, reply, words] of states)
      test(`at ${width} px the panel is ${width - 16} px wide, 8 px from the side, and the footer line is whole in ${label}`, async ({
        page,
      }) => {
        await open(page, { width });
        await serve(page, reply);
        await type(page, 'madrid');
        await expect(palette(page)).toContainText(words);
        const box = await page.evaluate(() => {
          const dialog = document.querySelector('dialog.ux-palette') as HTMLElement;
          const line = document.querySelector('.ux-palette-hint > span:last-child') as HTMLElement;
          const d = dialog.getBoundingClientRect();
          const l = line.getBoundingClientRect();
          return {
            width: d.width,
            left: d.left,
            right: window.innerWidth - d.right,
            lineInside:
              l.height > 0 &&
              l.left >= d.left - 0.5 &&
              l.right <= d.right + 0.5 &&
              l.bottom <= d.bottom + 0.5,
            lineClipped: line.scrollWidth > line.clientWidth,
          };
        });
        expect(box.width).toBe(width - 16);
        expect(box.left).toBe(8);
        expect(box.right).toBe(8);
        expect(box.lineInside).toBe(true);
        expect(box.lineClipped).toBe(false);
      });
  test('on a short phone the list region gives way so the footer line is still whole', async ({
    page,
  }) => {
    await open(page, { width: 390 });
    await page.setViewportSize({ width: 390, height: 440 });
    await serve(page, () => 500);
    await type(page, 'madrid');
    await expect(palette(page)).toContainText('The search did not finish. Try again.');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('dialog.ux-palette')!.getBoundingClientRect();
      const l = document
        .querySelector('.ux-palette-hint > span:last-child')!
        .getBoundingClientRect();
      return l.height > 0 && l.bottom <= d.bottom + 0.5;
    });
    expect(inside).toBe(true);
  });
  test('the panel uses the height of a tall phone, up to 36rem', async ({ page }) => {
    await open(page, { width: 390 });
    await serve(page, () => answer());
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const max = await palette(page).evaluate((node) => getComputedStyle(node).maxHeight);
    expect(max).toBe('576px');
  });
});

test.describe('DS the palette on a phone, in detail', () => {
  const recentsKey =
    'corridra:palette-recents:v1:' +
    encodeURIComponent(JSON.stringify(['person-a', fixtureTenant]));
  test('DS-7 at 200% text the field keeps 8rem and the footer line stays', async ({ page }) => {
    await open(page, { width: 390 });
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await serve(page, () => answer());
    await type(page, 'madrid');
    await expect(palette(page)).toContainText('No match for');
    const m = await page.evaluate(() => {
      const input = document.querySelector('.ux-palette-input input') as HTMLElement;
      const d = document.querySelector('dialog.ux-palette')!.getBoundingClientRect();
      const l = document
        .querySelector('.ux-palette-hint > span:last-child')!
        .getBoundingClientRect();
      return {
        input: input.getBoundingClientRect().width,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        lineInside: l.height > 0 && l.bottom <= d.bottom + 0.5 && l.right <= d.right + 0.5,
      };
    });
    expect(m.input).toBeGreaterThanOrEqual(m.rem * 8 - 0.5);
    expect(m.lineInside).toBe(true);
    await expect(field(page)).toHaveValue('madrid');
  });
  test('DS-1 the pressed Search button shows the selected colour with a mouse over it', async ({
    page,
  }) => {
    await open(page, { width: 1280 });
    const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
    const selected = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.border = '1px solid var(--selected)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return colour;
    });
    await trigger.hover();
    await page.mouse.down();
    await expect
      .poll(() => trigger.evaluate((node) => getComputedStyle(node).borderTopColor))
      .toBe(selected);
    await page.mouse.up();
  });
  test('DS-3 the summary line has room above it on a phone', async ({ page }) => {
    await open(page, { width: 390 });
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const top = await palette(page)
      .locator('.ux-palette-summary')
      .evaluate((node) => parseFloat(getComputedStyle(node).paddingTop));
    expect(top).toBeGreaterThanOrEqual(8);
  });
  test('DS-4 a row with no detail has no blank gap, and an empty trail adds no height', async ({
    page,
  }) => {
    await open(page, { width: 390, user: { id: 'person-a' } });
    await page.evaluate(
      ([key, mission]) =>
        localStorage.setItem(
          key!,
          JSON.stringify({ v: 1, items: [{ k: 'm', id: mission!, l: 'Madrid Textiles' }] }),
        ),
      [recentsKey, missionId(1)],
    );
    await page.keyboard.press('Control+k');
    const recent = palette(page).getByRole('option', { name: /Madrid Textiles/ });
    await expect(recent).toBeVisible();
    const gap = await recent.evaluate((row) => {
      const text = row.querySelector('.ux-palette-text')!.getBoundingClientRect();
      const trail = row.querySelector('.ux-palette-kind')!.getBoundingClientRect();
      return trail.top - text.bottom;
    });
    expect(gap).toBeLessThanOrEqual(6);
    const clear = palette(page).getByRole('option', { name: /Clear Recents/ });
    const extra = await clear.evaluate((row) => {
      const r = row.getBoundingClientRect();
      const t = row.querySelector('.ux-palette-text')!.getBoundingClientRect();
      const style = getComputedStyle(row);
      return r.height - t.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    });
    expect(extra).toBeLessThanOrEqual(1);
  });
  test('DS-6 the Retry detail wraps instead of being cut at 320 px', async ({ page }) => {
    await open(page, { width: 320 });
    await serve(page, () => 500);
    await type(page, 'madrid');
    const retry = palette(page).getByRole('option', { name: /Retry/ });
    await expect(retry).toBeVisible();
    const cut = await retry
      .locator('.ux-palette-detail')
      .evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(cut).toBe(false);
    await expect(retry).toContainText('Search again with the same words');
  });
});
