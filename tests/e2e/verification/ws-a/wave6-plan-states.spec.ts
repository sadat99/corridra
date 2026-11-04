import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';

// Wave 6 Q-05 and Q-06 on /plan: the send of the guided request in every state the network can put it in.
// The send is answered by the test, so nothing is stored. Honest words, never a raw error, never blank;
// a way to try again; one request for a double click; busy while in flight; the result announced.
// Made-up details only.

const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true });
const submitName = 'Submit mission request';

async function toSubmit(page: Page) {
  await page.goto('/plan?job=buyers&companyCountry=BD&marketCode=CN');
  await next(page).click();
  await next(page).click();
  await page
    .getByLabel(/^Your offer or requirement/)
    .first()
    .fill('QA test (madeup): fabric for a knitting unit');
  await next(page).click();
  await next(page).click();
  await page.getByLabel('Name', { exact: true }).fill('QA buyer (madeup)');
  await page.getByLabel('Company', { exact: true }).fill('QA test company (madeup)');
  await page.getByLabel('Work email', { exact: true }).fill('qa-buyer@example.invalid');
  await page.getByLabel('I have read', { exact: false }).check();
}

const technical = /unexpected|json|failed to fetch|networkerror|undefined|null|\[object|syntax/i;
const status = (page: Page) => page.locator('p.guide-status');

async function answerOnce(page: Page, respond: (route: Route) => Promise<void>) {
  let sent = 0;
  await page.route('**/api/intake', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent += 1;
    if (sent === 1) return respond(route);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ receipt: 'b'.repeat(64) }),
    });
  });
  return () => sent;
}

const cases: { name: string; respond: (route: Route) => Promise<void>; says: RegExp }[] = [
  {
    name: '503 from the proxy with a page instead of JSON',
    respond: (route) =>
      route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<h1>Service Unavailable</h1>',
      }),
    says: /try again/i,
  },
  {
    name: '503 with a JSON error that has no words',
    respond: (route) => route.fulfill({ status: 503, json: {} }),
    says: /try again/i,
  },
  {
    name: '429 with no body',
    respond: (route) => route.fulfill({ status: 429, json: {} }),
    says: /later|wait/i,
  },
  {
    name: '409 with no body',
    respond: (route) => route.fulfill({ status: 409, json: {} }),
    says: /try again|already|changed/i,
  },
  {
    name: 'offline: the request is rejected',
    respond: (route) => route.abort('internetdisconnected'),
    says: /connection|offline|try again/i,
  },
];

for (const entry of cases) {
  test(`Q-05 /plan send, ${entry.name}: plain words, announced, and the same button tries again`, async ({
    page,
  }) => {
    const sent = await answerOnce(page, entry.respond);
    await toSubmit(page);
    const button = page.getByRole('button', { name: submitName, exact: true });
    await button.click();
    await expect(status(page)).toBeVisible();
    const words = (await status(page).innerText()).trim();
    expect(words.length, 'something is said').toBeGreaterThan(10);
    expect(words, 'no raw error').not.toMatch(technical);
    expect(words).toMatch(entry.says);
    await expect(button).toBeEnabled();
    expect(sent()).toBe(1);
    // Try again with the same button: it sends once more and now succeeds.
    await button.click();
    await expect(page.getByLabel('Private receipt code')).toHaveValue('b'.repeat(64));
    expect(sent()).toBe(2);
  });
}

test('Q-06 /plan send: busy while in flight, one request for a double click, result announced', async ({
  page,
}) => {
  let sent = 0;
  await page.route('**/api/intake', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent += 1;
    await new Promise((done) => setTimeout(done, 1200));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ receipt: 'c'.repeat(64) }),
    });
  });
  await toSubmit(page);
  const button = page.getByRole('button', { name: submitName, exact: true });
  await button.dblclick();
  const form = page.locator('form.intake-form');
  const busy = async () =>
    (await button.isDisabled()) || (await form.getAttribute('aria-busy')) === 'true';
  expect(await busy(), 'busy while the request is in flight').toBe(true);
  await expect(page.getByLabel('Private receipt code')).toHaveValue('c'.repeat(64));
  expect(sent).toBe(1);
  await expect(status(page)).toContainText(/recorded/i);
});
