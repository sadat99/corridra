import AxeBuilder from '@axe-core/playwright';
import type { Page, Response } from '@playwright/test';
import { test, expect } from '../fixtures';

// Revamp Wave 4, docs/revamp/specs/decision-card-ui.md, the public page on a real production build:
// D-01 no session request and no cookie, D-02 the token never in a URL or in storage, D-03 one message
// for every answer that is not an open card, D-04 noindex, no-referrer and no-store, D-10 widths and axe.
const token = 'Zk3_-9' + 'a'.repeat(37);
const unavailable = 'This link is not available.';

async function load(page: Page, hash: string) {
  const requests: string[] = [];
  const responses: Response[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => responses.push(response));
  const main = await page.goto('/decision-card' + hash);
  await expect(page.getByRole('heading', { name: unavailable })).toBeVisible();
  return { requests, responses, main: main! };
}

test('D-01 no session request and no Set-Cookie', async ({ page }) => {
  const { requests, responses, main } = await load(page, '#' + token);
  expect(requests.filter((url) => /get-session|\/api\/(operator-)?auth/.test(url))).toEqual([]);
  expect(await main.headerValue('set-cookie')).toBeNull();
  for (const response of responses)
    expect(await response.headerValue('set-cookie'), response.url()).toBeNull();
  // The page is bare: no header, no footer, no help dock.
  await expect(page.locator('header, footer, .site-header, .corner-dock')).toHaveCount(0);
  expect(await page.context().cookies()).toEqual([]);
});

test('D-02 the token is in no request URL, not in the address after load and not in storage', async ({
  page,
}) => {
  const { requests } = await load(page, '#' + token);
  for (const url of requests) expect(url, url).not.toContain(token);
  expect(page.url()).not.toContain(token);
  expect(new URL(page.url()).hash).toBe('');
  const stored = await page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
  }));
  expect(stored.local + stored.session).not.toContain(token);
  expect(stored.local + stored.session).toBe('{}{}');
});

test('D-02 the token travels in a POST body only', async ({ page }) => {
  const posted: { method: string; url: string; body: string | null }[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/decision-card'))
      posted.push({ method: request.method(), url: request.url(), body: request.postData() });
  });
  await page.goto('/decision-card#' + token);
  await expect(page.getByRole('heading', { name: unavailable })).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]!.method).toBe('POST');
  expect(new URL(posted[0]!.url).search).toBe('');
  expect(JSON.parse(posted[0]!.body!)).toEqual({ token });
});

test('D-03 an unknown link, a random link and no link show identical text', async ({ page }) => {
  const seen: string[] = [];
  for (const hash of ['#' + token, '#' + 'b'.repeat(43), '#short', '']) {
    await page.goto('/decision-card' + hash);
    await expect(page.getByRole('heading', { name: unavailable })).toBeVisible();
    seen.push(await page.locator('main').innerText());
  }
  expect(new Set(seen).size).toBe(1);
  expect(seen[0]).toBe(unavailable);
});

test('D-04 the page and the answer are no-store, noindex and no-referrer', async ({ page }) => {
  const { responses, main } = await load(page, '#' + token);
  expect(main.headers()['cache-control']).toMatch(/no-store/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  const api = responses.find((response) => response.url().includes('/api/decision-card'))!;
  expect(api.headers()['cache-control']).toMatch(/no-store/);
  expect(api.headers()['x-robots-tag']).toMatch(/noindex/);
});

const open = {
  state: 'OPEN',
  card: {
    company: 'Lantern Cutting Works with a long registered name Limited',
    decision: 'SELECT',
    rationale: 'Best fit for the declared product and the delivery date. '.repeat(4),
    nextAction: 'Send the purchase order and confirm the factory visit',
    dueAt: '2026-12-01',
    provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
  },
  expiresAt: '2026-11-10T10:00:00.000Z',
  synthetic: true,
};

for (const width of [320, 390, 768, 1440]) {
  test(`D-10 at ${width} px: no sideways scroll, axe clean, six fields and no controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const state of ['unknown', 'open'] as const) {
      await page.route('**/api/decision-card', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state === 'open' ? open : { state: 'unknown' }),
        }),
      );
      // A new document each time: a hash-only change on the same page would not reload it.
      await page.goto('about:blank');
      await page.goto('/decision-card#' + token);
      await expect(
        page.getByRole('heading', { name: state === 'open' ? 'Shared decision' : unavailable }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        state,
      ).toBeLessThanOrEqual(0);
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(
        axe.violations.map((v) => v.id),
        state,
      ).toEqual([]);
      if (state === 'open') {
        await expect(page.locator('main dl > div')).toHaveCount(6);
        await expect(page.locator('main button, main a, main input, main form')).toHaveCount(0);
        await expect(page.locator('main')).toContainText('Selected');
        await expect(page.locator('main')).toContainText('1 Dec 2026');
        await expect(page.locator('main')).toContainText('Self-declared');
      }
      await page.unroute('**/api/decision-card');
    }
  });
}
