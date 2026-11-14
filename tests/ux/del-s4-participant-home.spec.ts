import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR-084 slice S4 (CORRIDRA_DELEGATION_FIRST_RUN): the participant home. The real ParticipantAccount and the real
// stylesheets on a small bundled page in the customer frame; the participant, terms and reminder routes that already
// exist are answered by the test, which also counts every request so it can show that no read was added. Sample
// records only. Component protocol fixture, not database acceptance.
const fixturePath = '/__del-s4-participant-home-fixture';
const programmeId = '00000000-0000-4000-8000-000000000002';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { ParticipantAccount } from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-account.tsx'))};
        const q = new URLSearchParams(location.search);
        const slots = pageFrameSlots({
          back: { label: 'Back to my account', href: '/account' },
          helper: 'Fictional sample registration only.',
        });
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Delegation registrations" customer above={slots.above} lead={slots.lead}>
            <div className="account-compact">
              <ParticipantAccount subject="synthetic-alice" issuer=${JSON.stringify(issuer)} framed
                termsEnabled={q.get('terms') === '1'} homeEnabled={q.get('home') === '1'} />
            </div>
          </WorkspaceShell>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/page-frame.css',
    'components/ux/overflow-menu.css',
    'app/account/page-budget.css',
    'app/account/delegations/participant-account.css',
  ]
    .flatMap((file) => {
      try {
        return [readFileSync(resolve('apps/web', file), 'utf8')];
      } catch {
        return [];
      }
    })
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Participant home fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const expires = () => new Date(Date.now() + 3600000).toISOString();
const rid = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const registration = (n: number) => ({
  id: rid(n),
  programmeId,
  name: `Sample Guangzhou delegation round ${n}`,
  reportingPurpose: 'Sample shared programme purpose, no private commercial details',
  displayLabel: 'Synthetic participant label',
  consentedAt: '2026-10-18T00:00:00Z',
  status: 'REGISTERED',
  synthetic: true,
});
const terms = {
  version: 2,
  included: 'Sample inclusions',
  excluded: null,
  cancellationTerms: 'Sample cancelling',
  changeTerms: 'Sample changes',
  feesApply: true,
  feeNote: null,
};
const place = (id: string, over: Record<string, unknown> = {}) => ({
  registrationId: id,
  programmeId,
  programmeName: 'Sample Guangzhou delegation round',
  expiresAt: expires(),
  terms,
  acceptedVersion: 2,
  termsCurrent: true,
  criteria: null,
  enrolment: { status: 'PLACED', position: null, reasons: [] },
  placesAvailable: true,
  waitlist: false,
  fees: [{ currency: 'USD', exponent: 2, dueMinor: '120000' }],
  tasks: [],
  profileChoices: [],
  sendsMessages: false,
  ...over,
});
const feeStatus = (id: string) => ({
  registrationId: id,
  programmeId,
  expiresAt: expires(),
  provenance: 'ORGANISER_RECORDED',
  verified: false,
  collectsPayments: false,
  amounts: [
    {
      currency: 'USD',
      exponent: 2,
      dueMinor: '120000',
      recordedMinor: '20000',
      outstandingMinor: '100000',
    },
    {
      currency: 'BDT',
      exponent: 0,
      dueMinor: '5000',
      recordedMinor: '0',
      outstandingMinor: '5000',
    },
  ],
});

type Options = {
  rows?: number;
  terms?: boolean;
  home?: boolean;
  placeStatus?: number;
  feeStatusCode?: number;
};
async function open(page: Page, width: number, options: Options = {}) {
  const requests: string[] = [];
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/customer-programme-participants*', (route) => {
    requests.push('participants');
    return route.fulfill({
      json: {
        registrations: Array.from({ length: options.rows ?? 1 }, (_, n) => registration(n + 1)),
        nextAfter: null,
        synthetic: true,
      },
    });
  });
  await page.route('**/api/customer-programme-terms*', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view') ?? '';
    requests.push('terms:' + view);
    const id = url.searchParams.get('registrationId') ?? '';
    if (view === 'reminders')
      return route.fulfill({
        json: {
          asOf: '2026-11-14',
          windowDays: 3,
          expiresAt: expires(),
          sendsMessages: false,
          assignedToYou: [],
          forParticipant: [],
          termsToAccept: [],
        },
      });
    if (view === 'place')
      return options.placeStatus
        ? route.fulfill({ status: options.placeStatus, json: {} })
        : route.fulfill({ json: place(id) });
    if (view === 'fees')
      return options.feeStatusCode
        ? route.fulfill({ status: options.feeStatusCode, json: {} })
        : route.fulfill({ json: feeStatus(id) });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/customer-programme-payment-declarations*', (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.route('**/api/customer-programme-fee-disputes*', (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.goto(
    `${fixturePath}?terms=${options.terms === false ? '0' : '1'}&home=${options.home === false ? '0' : '1'}`,
  );
  await expect(page.getByRole('heading', { name: 'Your sample registrations' })).toBeVisible();
  return requests;
}
const closeDetails = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = false)));
const mainHeight = (page: Page) =>
  page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().height);

for (const width of [390, 1440]) {
  test.describe(`${width} px`, () => {
    test('says where I am, what is open and what is next from the reads already made, in each original currency', async ({
      page,
    }) => {
      await open(page, width);
      const row = page.locator('.ux-reg-list > li').first();
      await expect(row.locator('.ux-home-line').first()).toContainText(
        'Place confirmed. Outstanding as recorded by the organiser: 1000.00 USD, 5000 BDT.',
      );
      // The next step is the closed details' summary; the original summary words stay inside it.
      const fold = row.locator('details.account-fold').first();
      await expect(fold.locator('> summary')).toHaveText('Next: Review the recorded fee');
      await expect(fold).not.toHaveAttribute('open', '');
      await fold.locator('> summary').click();
      await expect(row.getByText('Programme details, objectives and results')).toBeVisible();
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      expect(text).not.toMatch(/—|6000|total|urgent|overdue|verified/i);
    });

    test('adds no read: one request per endpoint and registration, the same as with it off', async ({
      page,
    }) => {
      const on = await open(page, width, { rows: 2 });
      await expect(page.getByText('Outstanding as recorded').first()).toBeVisible();
      const count = (list: string[]) =>
        list.reduce<Record<string, number>>((all, k) => ({ ...all, [k]: (all[k] ?? 0) + 1 }), {});
      const withHome = count(on);
      expect(withHome).toEqual({
        participants: 1,
        'terms:reminders': 1,
        'terms:place': 2,
        'terms:fees': 2,
      });
      const page2 = await page.context().newPage();
      const off = await open(page2, width, { rows: 2, home: false });
      await page2.waitForLoadState('networkidle');
      expect(count(off)).toEqual(withHome);
    });

    test('a failed or unloaded read shows no claim', async ({ page }) => {
      // The place cannot be read: nothing about the place, money or next step appears.
      await open(page, width, { placeStatus: 500 });
      await page.getByText('Your place could not be loaded').waitFor({ state: 'attached' });
      await expect(page.locator('.ux-home-line')).toHaveCount(0);
      await expect(page.getByText('Place confirmed')).toHaveCount(0);
    });

    test('the recorded fee read failing keeps the place line and claims no money', async ({
      page,
    }) => {
      await open(page, width, { feeStatusCode: 500 });
      await expect(page.locator('.ux-home-line')).toHaveCount(1);
      await expect(page.locator('.ux-home-line').first()).toHaveText('Place confirmed.');
      await expect(page.getByText('Outstanding as recorded')).toHaveCount(0);
    });

    test('with the switch off the row is exactly as before', async ({ page }) => {
      await open(page, width, { home: false });
      await expect(page.locator('.ux-home-line')).toHaveCount(0);
      await expect(page.getByText('Place confirmed')).toHaveCount(0);
      await expect(page.locator('.ux-reg-list > li').first()).toContainText(
        'Synthetic participant label · Registered, self-declared',
      );
    });

    test('axe clean with the block shown', async ({ page }) => {
      await open(page, width);
      await expect(page.locator('.ux-home-line').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  });
}

// The owner's rule: no page longer than before at any width. The heights are the content (main) measured on
// origin/main with the A3d fixture and the details closed (the table in audit-a3d-registrations.spec.ts); one pixel of
// room for rounding. With the switch on and the A3d fixture (no place or fee read, so the block has nothing to say) the
// page must be no longer than before: the purpose line moves into the closed details, so it is shorter.
const before: Record<number, [number, number]> = {
  390: [582.2, 814.0],
  768: [550.5, 745.4],
  1440: [561.5, 756.4],
};
for (const width of [390, 768, 1440])
  for (const rows of [1, 2])
    test(`${width} px, ${rows} registration${rows === 1 ? '' : 's'}: with the switch on the page is no longer than before`, async ({
      page,
    }) => {
      await open(page, width, { rows, terms: false });
      await closeDetails(page);
      expect(await mainHeight(page)).toBeLessThanOrEqual(before[width]![rows - 1]! + 1);
    });

// With every line to say (a place, outstanding fees in two currencies and a next step) the page is still no longer than
// before: the purpose line moves into the closed details, the next step is the details' summary, and place plus
// outstanding are one short paragraph under the label. Same table, same one pixel of room.
for (const width of [390, 768, 1440])
  for (const rows of [1, 2])
    test(`${width} px, ${rows} registration${rows === 1 ? '' : 's'}: a full home block is no longer than before`, async ({
      page,
    }) => {
      await open(page, width, { rows });
      await expect(page.locator('.ux-home-line').first()).toBeVisible();
      await expect(
        page.locator('summary', { hasText: 'Next: Review the recorded fee' }).first(),
      ).toBeVisible();
      await closeDetails(page);
      const height = await mainHeight(page);
      expect(height).toBeLessThanOrEqual(before[width]![rows - 1]! + 1);
    });
