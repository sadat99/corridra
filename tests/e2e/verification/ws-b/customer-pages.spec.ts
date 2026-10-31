import { test, expect, evidence, expectNoForbiddenCopy } from '../fixtures';
import type { Page } from '@playwright/test';

// The customer shell (WS-E) shows a data-environment note. In this synthetic environment it reads
// "Test mode"; with real use on it reads "Your work stays private to the people given access". It is
// not WS-B page content (integration note in docs/qa/2026-10-31/status/WS-B.md), so it is set aside
// before checking the words on WS-B pages. Everything else on the page is checked.
async function expectNoForbiddenPageCopy(page: Page) {
  await page.evaluate(() => document.querySelectorAll('.ux-testmode').forEach((n) => n.remove()));
  await expectNoForbiddenCopy(page);
}

// WS-B verification (program section 8 and 6.B). The verification server has no customer identity
// service, so these cases prove what a signed-out visitor and the gated customer routes show, plus the
// server answers behind them. Signed-in customer screens are proved by the fixture specs in
// tests/operator (KI-16) and the pure rules by tests/integration/ws-b-customer-words.test.ts.
const id = '00000000-0000-4000-8000-000000000001';

// /account/rooms, /account/move and /account/notifications answer not found while their switch or
// module is off, by design; those are still checked for words and for never failing with a server error.
const customerRoutes = [
  '/account/requests/' + id,
  '/account/service-requests/new',
  '/account/service-requests',
  '/account/delegations',
  '/account/notifications',
  '/account/rooms/' + id,
  '/account/move',
  '/account/request/' + id,
  '/account/drafts/' + id,
  '/account/profile/' + id,
  '/account/billing',
];

test('B-1: customer routes answer without forbidden live copy', async ({ page }, info) => {
  for (const path of customerRoutes) {
    const response = await page.goto(path);
    // A signed-out visitor is sent to sign-in, shown a plain unavailable notice, or told the page does
    // not exist while its switch is off. Never a server error.
    expect([200, 404], path).toContain(response?.status());
    await expect(page.locator('h1').first(), path).toBeVisible();
    await expectNoForbiddenPageCopy(page);
  }
  await page.goto('/account/requests/' + id);
  await expect(page.getByRole('status')).toHaveText('Saved request details are unavailable.');
  await evidence(page, `B-1-request-gate-${info.project.name}`);
});

test('B-1: closed request API answers 503 with no-store and discloses nothing', async ({
  request,
}) => {
  for (const path of ['/api/customer-requests', '/api/customer-requests/' + id]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(503);
    expect(response.headers()['cache-control'], path).toBe('no-store');
    const body = await response.text();
    expect(body, path).not.toMatch(/title|objective|market/i);
  }
});

test('B-3: contributor setup states the password rule and the signed-out page never loops back', async ({
  page,
}, info) => {
  const setup = await page.goto('/contributor/setup');
  expect(setup?.status()).toBe(200);
  await expect(page.getByText('Password rule:')).toBeVisible();
  await expect(page.getByText(/at least 14 characters and at most 128/)).toBeVisible();
  await expectNoForbiddenPageCopy(page);
  await evidence(page, `B-3-contributor-setup-${info.project.name}`);
  const door = await page.goto('/contributor');
  expect(door?.status()).toBe(200);
  // Signed out, the page offers the invitation steps; it never claims the person is set up.
  await expect(page.getByText('You’re set up. No tasks assigned yet.')).toHaveCount(0);
  await expectNoForbiddenPageCopy(page);
});

// B-4 (Arabic right to left) is proved in tests/integration/ws-b-customer-words.test.ts: the drafts in
// bn, zh, es, ar, fr and de are not offered in the browser until a native reviewer is recorded (D16),
// so a browser cannot choose Arabic on this server yet.
