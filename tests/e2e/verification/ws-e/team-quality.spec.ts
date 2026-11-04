import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInOwner, qaSeed } from '../fixtures';
import type { Page } from '@playwright/test';
import { operatorSlugs } from '../../../../apps/web/lib/operator-urls';

// Wave 6 (docs/revamp/specs/wave6-quality.md), track S4: Q-01 keyboard, Q-02 reflow, Q-03 contrast and
// semantics, Q-05 states and Q-06 busy actions on the team workspace and the owner page. One owner
// sign-in for the whole file (the shared sign-in rate limit): the widths are switched inside the
// tests, so it runs once, at 1280. The contributor board is covered in tests/operator/
// real-network-work.spec.ts, which already holds an invited contributor.
test.describe.configure({ mode: 'serial' });
const once = (name: string) => name === 'w1280';
test.beforeEach(({}, info) => {
  test.skip(!once(info.project.name), 'Runs once, at 1280; it switches widths itself.');
});

let page: Page;
let tenant = '';
test.beforeAll(async ({ browser }, info) => {
  if (!once(info.project.name)) return;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3300' });
  page = await context.newPage();
  await signInOwner(page);
  tenant = qaSeed().tenantId;
});
test.afterAll(async () => {
  await page?.context().close();
});

const sections = Object.entries(operatorSlugs).map(([id, slug]) => ({ id, slug }));
const addresses = [
  { name: 'today', path: () => `/operator?workspace=${tenant}` },
  ...sections.map((s) => ({ name: s.slug, path: () => `/operator/${s.slug}?workspace=${tenant}` })),
  { name: 'owner', path: () => `/operator/owner?workspace=${tenant}` },
];
async function open(path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
  // The workspace reads its data after load: wait until no loading line is left.
  await expect(page.getByText(/Loading (workspace|today)/i)).toHaveCount(0, { timeout: 20000 });
}

test('Q-03 axe is clean at 390 and 1440 on Today, every section and the owner page', async () => {
  test.setTimeout(600000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const address of addresses) {
      await open(address.path());
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect
        .soft(
          result.violations.map((v) => `${v.id}: ${v.nodes.length}`),
          `${address.name} at ${width}`,
        )
        .toEqual([]);
    }
  }
});

test('Q-02 no sideways scroll at 320 and at 640 (1280 at 200 percent zoom)', async () => {
  test.setTimeout(600000);
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 800 });
    for (const address of addresses) {
      await open(address.path());
      const overflow = await page.evaluate(() => {
        const wide = document.documentElement.scrollWidth - innerWidth;
        const clipped = [
          ...document.querySelectorAll<HTMLElement>('a, button, input, select, textarea'),
        ]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) =>
            (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40),
          );
        return { wide, clipped };
      });
      expect
        .soft(overflow.wide, `${address.name} at ${width}: sideways scroll`)
        .toBeLessThanOrEqual(1);
      expect
        .soft(overflow.clipped, `${address.name} at ${width}: controls beyond the edge`)
        .toEqual([]);
    }
  }
});

test('Q-01 Tab reaches every control with a visible focus ring, never traps, and a view change lands on its section', async () => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const address of addresses.filter((a) =>
    ['today', 'missions', 'audit', 'owner'].includes(a.name),
  )) {
    await open(address.path());
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    let previous = '';
    for (let step = 0; step < 150; step++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { key: 'BODY', ring: true };
        const style = getComputedStyle(el);
        const ring =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none';
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30);
        const index = [...document.querySelectorAll('*')].indexOf(el);
        return { key: `${index}:${el.tagName}:${el.id}:${label}`, ring };
      });
      if (info.key === 'BODY') break;
      expect.soft(info.ring, `${address.name}: no visible focus on ${info.key}`).toBe(true);
      expect.soft(info.key, `${address.name}: focus trapped on ${info.key}`).not.toBe(previous);
      previous = info.key;
      seen.push(info.key);
    }
    expect.soft(seen.length, `${address.name}: Tab found no controls`).toBeGreaterThan(3);
  }
  // A view change inside the workspace (a # link) moves focus to the section that opened.
  await open(`/operator?workspace=${tenant}`);
  await page.evaluate(() => {
    window.location.hash = 'workspace-missions';
  });
  await expect(page.locator('#workspace-missions')).toBeVisible();
  const landed = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { id: el?.id ?? '', inside: !!el?.closest('#workspace-missions') };
  });
  expect.soft(landed.inside, `focus after the view change: ${JSON.stringify(landed)}`).toBe(true);
});

// Q-05: every read failure says what happened in words. A 503 and an offline request offer a retry,
// a 429 says to try again later, a 403 says access is not allowed. The words each screen shows are
// written into the failure message so a miss names what the person would have read.
const failures = [
  {
    name: '503',
    apply: (r: import('@playwright/test').Route) =>
      r.fulfill({ status: 503, json: { error: 'Service unavailable' } }),
    retry: true,
    words: /could not|unavailable|try again/i,
  },
  {
    name: '403',
    apply: (r: import('@playwright/test').Route) =>
      r.fulfill({ status: 403, json: { error: 'Forbidden' } }),
    retry: false,
    words: /not allowed|no access|don.t have access|access required|permission|denied|role/i,
  },
  {
    name: '429',
    apply: (r: import('@playwright/test').Route) =>
      r.fulfill({
        status: 429,
        headers: { 'Retry-After': '30' },
        json: { error: 'Too many requests' },
      }),
    retry: false,
    words: /try again (later|in)|too many|wait/i,
  },
  {
    name: 'offline',
    apply: (r: import('@playwright/test').Route) => r.abort('failed'),
    retry: true,
    words: /could not|offline|connection|try again/i,
  },
] as const;
const targets = [
  {
    name: 'Today (the missions read)',
    path: () => `/operator?workspace=${tenant}`,
    pattern: '**/api/workspace/missions**',
  },
  {
    name: 'the workspace read',
    path: () => `/operator?workspace=${tenant}`,
    pattern: '**/api/workspace/workspace**',
  },
  {
    name: 'the Missions section',
    path: () => `/operator/missions?workspace=${tenant}`,
    pattern: '**/api/workspace/missions**',
  },
];
for (const target of targets) {
  test(`Q-05 ${target.name}: 503, 403, 429 and offline each get honest words and the right next step`, async () => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const failure of failures) {
      await page.route(target.pattern, failure.apply);
      await page.goto(target.path(), { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(2500);
      const shown = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'main [role=status], main [role=alert], main .ux-state, main [aria-live]',
          ),
        ]
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' | '),
      );
      const retry = await page.getByRole('button', { name: /retry|try again|refresh/i }).count();
      const label = `${target.name} / ${failure.name}: shown="${shown.slice(0, 220)}" retryButtons=${retry}`;
      expect.soft(shown, label).toMatch(failure.words);
      if (failure.retry) expect.soft(retry, label).toBeGreaterThan(0);
      expect.soft(shown, label + ' (blank area)').not.toBe('');
      if (failure.name === '503' && target.name.startsWith('Today')) {
        // The retry works once the read works again, and the list replaces the failure line.
        await page.unroute(target.pattern);
        await page.getByRole('button', { name: /retry/i }).first().click();
        await expect(page.locator('.ux-overview')).toBeVisible({ timeout: 20000 });
        continue;
      }
      await page.unroute(target.pattern);
    }
  });
}

// Q-05 sweep: with every data read of a section failing (503), no section is a blank area, and
// none shows an empty or zero state as if it were a result.
test('Q-05 every section says its data could not be loaded when every read fails', async () => {
  test.setTimeout(400000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const skip = new Set(['workspace-authenticator', 'workspace-controls']);
  for (const { id, slug } of sections.filter((s) => !skip.has(s.id))) {
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      if (
        /\/api\/workspace\/(workspace|config)\b/.test(url) ||
        !/\/api\/(workspace|team-control)\//.test(url)
      )
        return route.continue();
      return route.fulfill({ status: 503, json: { error: 'Service unavailable' } });
    });
    await page.goto(`/operator/${slug}?workspace=${tenant}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect
      .soft(text, `${slug} (${id}): no failure words with every read failing`)
      .toMatch(/could not|unavailable|failed|try again|retry|check your connection/i);
    expect
      .soft(text, `${slug} (${id}): an empty or zero state shown as a result`)
      .not.toMatch(/No mission requests yet|Nothing is waiting|None recorded/i);
    await page.unroute('**/api/**');
  }
});

// Q-06: a request-sending action is disabled or busy while it is in flight, a double click sends
// one request, and the result is announced. Read-only refresh and load actions are used so the
// seeded data never changes; the request is slowed so the in-flight window can be seen.
const busyActions = [
  { slug: 'missions', name: 'Refresh missions' },
  { slug: 'research', name: 'Refresh research' },
  { slug: 'research', name: 'Load company link requests' },
  { slug: 'assistance', name: 'Refresh AI review' },
  { slug: 'network', name: 'Refresh invitations' },
  { slug: 'network', name: 'Refresh execution work' },
  { slug: 'health', name: 'Refresh operations' },
  { slug: 'settings', name: 'Refresh reviewed configuration' },
  { slug: 'audit', name: 'Load access and recent changes' },
  { slug: 'controls', name: 'Load workspace members' },
];
test('Q-06 busy actions: one request on a double click, disabled or busy in flight', async () => {
  test.setTimeout(400000);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const action of busyActions) {
    await open(`/operator/${action.slug}?workspace=${tenant}`);
    // Operations panels load their own data after the workspace: let that settle first.
    await page.waitForTimeout(1500);
    const button = page.getByRole('button', { name: action.name, exact: true });
    await expect(button, action.name).toBeVisible();
    let sent = 0;
    await page.route('**/api/**', async (route) => {
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue().catch(() => undefined);
    });
    await button.dblclick();
    const inFlight = await button.evaluate(
      (el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-busy') === 'true',
    );
    await page.waitForTimeout(1600);
    await page.unroute('**/api/**');
    expect
      .soft(sent, `${action.slug} / ${action.name}: requests after a double click`)
      .toBeLessThanOrEqual(1);
    expect
      .soft(inFlight, `${action.slug} / ${action.name}: disabled or aria-busy while in flight`)
      .toBe(true);
  }
});
