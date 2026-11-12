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
      'Not every mission was searched. More may exist. Narrow your search.',
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
    await serve(page, async (url) => {
      if (url.searchParams.get('q') === 'madr') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return answer({ missions: [{ id: missionId(1), label: 'Old Answer Co', detail: '' }] });
      }
      return answer({ missions: [{ id: missionId(2), label: 'New Answer Co', detail: '' }] });
    });
    await type(page, 'madr');
    await page.waitForTimeout(300);
    await field(page).fill('madri');
    await expect(palette(page).getByRole('option', { name: /New Answer Co/ })).toBeVisible();
    await page.waitForTimeout(900);
    await expect(palette(page).getByRole('option', { name: /Old Answer Co/ })).toHaveCount(0);
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
  test('typing quickly makes at most one announcement per pause, and the count is spoken', async ({
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
    expect(changes.length).toBeLessThanOrEqual(2);
    expect(changes.at(-1)).toBe('2 results');
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
