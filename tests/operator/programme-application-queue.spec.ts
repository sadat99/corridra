import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Staff reading applications to public programme pages (ADR-080, owner decision of 12 November 2026): the read only panel in
// Settings (#programme-application-queue), bundled from the source with the real stylesheets. Every read is answered here
// with synthetic rows. The role matrix and the database rules are held without a browser in
// tests/integration/staff-programme-applications.test.ts.
const tenant = fixtureTenant;
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
let origin = '';
test.beforeAll(async () => {
  fixture = await startTodayFixture();
  origin = fixture.origin;
});
test.afterAll(async () => {
  await fixture.close();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  programmeId: id(900),
  workspaceId: id(901),
  status,
  displayLabel: `Synthetic applicant ${n}`,
  statement: `Synthetic statement ${n} about two combine harvesters.`,
  appliedAt: new Date(Date.now() - n * 3600000).toISOString(),
  decisionVersion: 0,
  programmeTitle: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  address: 'synthetic-china-delegation-abcdefghij',
  pageState: 'OPEN',
  ...extra,
});

type Answer = { status?: number; json: unknown };
async function open(page: Page, answer: (url: string, count: number) => Answer, offered = true) {
  const asked: string[] = [];
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: false } }),
  );
  await page.route('**/api/workspace/customer-erasure-queue?*', (route) =>
    route.fulfill({ json: { items: [], nextAfter: null } }),
  );
  await page.route('**/api/workspace/programme-applications?*', (route) => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    asked.push(request.url());
    const { status = 200, json } = answer(request.url(), asked.length);
    return route.fulfill({ status, json });
  });
  await page.goto(
    `${origin}/?workspace=${tenant}&applications=${offered ? 'on' : 'off'}#programme-application-queue`,
  );
  if (offered)
    await expect(
      page.getByRole('heading', { name: 'Programme Applications', level: 2 }),
    ).toBeVisible();
  return asked;
}
const panel = (page: Page) => page.locator('#programme-application-queue');

test('the panel is read only: it loads, shows the words and offers no button that changes anything', async ({
  page,
}) => {
  const asked = await open(page, () => ({
    json: {
      applications: [
        row(1, 'SUBMITTED'),
        row(2, 'DECLINED', { note: 'Synthetic note: places are full.', decisionVersion: 1 }),
        row(3, 'JOINED'),
      ],
      total: 3,
      nextAfter: null,
    },
  }));
  await expect(panel(page).getByText('Press Load Applications to read them.')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Load Applications' }).click();
  await expect(panel(page).getByText('Showing 3 of 3')).toBeVisible();
  await expect(panel(page).locator(':scope > summary')).toContainText('3 in all');
  const first = panel(page).getByRole('listitem').filter({ hasText: 'Synthetic applicant 1' });
  await expect(first).toContainText('Waiting for the organiser');
  await first.getByText('Show Their Words').click();
  await expect(first).toContainText('Synthetic statement 1 about two combine harvesters.');
  await expect(first).toContainText('Synthetic Dhaka Agro Traders Association');
  const declined = panel(page).getByRole('listitem').filter({ hasText: 'Synthetic applicant 2' });
  await declined.getByText('Show Their Words').click();
  await expect(declined).toContainText('Declined');
  await expect(declined).toContainText('Synthetic note: places are full.');
  // Only the load buttons exist. Nothing decides, edits, invites or exports.
  const names = await panel(page)
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((b) => b.textContent?.trim()));
  expect(names).toEqual(['Load Applications']);
  await expect(panel(page)).not.toContainText(/@|email/i);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain(`tenant=${tenant}`);
});

test('a next page is read when asked and added below the first', async ({ page }) => {
  await open(page, (url) =>
    url.includes('after=')
      ? { json: { applications: [row(3, 'WITHDRAWN')], total: 3, nextAfter: null } }
      : {
          json: {
            applications: [row(1, 'SUBMITTED'), row(2, 'INVITED')],
            total: 3,
            nextAfter: id(2),
          },
        },
  );
  await panel(page).getByRole('button', { name: 'Load Applications' }).click();
  await expect(panel(page).getByText('Showing 2 of 3')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Load More Applications' }).click();
  await expect(panel(page).getByText('Showing 3 of 3')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Load More Applications' })).toHaveCount(0);
  await expect(panel(page)).toContainText('Withdrawn');
});

test('nothing yet, a refusal and a failure are each said in words, never as a blank panel', async ({
  page,
}) => {
  let step = 0;
  await open(page, () => {
    step += 1;
    if (step === 1) return { json: { applications: [], total: 0, nextAfter: null } };
    if (step === 2)
      return {
        status: 403,
        json: { error: 'You cannot read programme applications from this account.' },
      };
    return { status: 503, json: { error: 'Programme applications are not available yet.' } };
  });
  const load = panel(page).getByRole('button', { name: 'Load Applications' });
  await load.click();
  await expect(panel(page).getByText('There are no applications yet.')).toBeVisible();
  await load.click();
  await expect(panel(page).getByRole('alert')).toContainText(
    'You cannot read programme applications',
  );
  await load.click();
  await expect(panel(page).getByRole('alert')).toContainText('not available yet');
});

test('where the staff read is not offered nothing is drawn and the address is unknown', async ({
  page,
}) => {
  await open(page, () => ({ json: {} }), false);
  await expect(page.locator('#programme-application-queue')).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`the loaded panel fits ${width} px, stays under the record limit and passes axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await open(page, () => ({
      json: {
        applications: [1, 2, 3, 4, 5].map((n) => row(n, n % 2 ? 'SUBMITTED' : 'WAITLISTED')),
        total: 5,
        nextAfter: null,
      },
    }));
    await panel(page).getByRole('button', { name: 'Load Applications' }).click();
    await expect(panel(page).getByText('Showing 5 of 5')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const height = await panel(page).evaluate((el) => el.getBoundingClientRect().height);
    // Record or queue pages: 4 phone screens (844 px high) or 2.5 desktop screens (900 px high).
    expect(height / (width === 390 ? 844 : 900)).toBeLessThan(width === 390 ? 4 : 2.5);
    const results = await new AxeBuilder({ page })
      .include('#programme-application-queue')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
