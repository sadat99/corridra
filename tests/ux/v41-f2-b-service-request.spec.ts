import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v4.1, unit F2 (builder B): the customer's help request page. The real component and the real stylesheets
// on a small bundled page (no server, no sign-in); the request and its quote are invented. It proves:
//   04  no cost is cut or pushed off screen on a phone: nothing in the quote is wider than its region and every
//       amount is on screen with its exact words;
//   05  one primary button per decision region while a step is open, and the step's field takes the focus;
//   11  the page is one surface (no card inside the page card), the h1 names the service and there is no back link;
//   14  one link per destination when the request cannot be shown;
//   18  the sample-mode rule is a hint under the field, not part of its label.
const fixturePath = '/__v41-f2-b-service-request';
const workspaceId = '00000000-0000-4000-8000-0000000000a1';
const requestId = '00000000-0000-4000-8000-0000000000b2';
let html = '';

const detail = {
  workspaceId,
  canAct: true,
  request: {
    id: requestId,
    workspaceId,
    contextKind: 'programme',
    contextRef: '00000000-0000-4000-8000-0000000000c3',
    contextLabel: 'Synthetic Dhaka buyer delegation',
    serviceKey: 'interpreter-day',
    serviceTitle: 'Interpreter day',
    status: 'quoted',
    needVersion: 1,
    region: 'Dhaka',
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    serviceVersion: 1,
  },
  service: {
    title: 'Interpreter day',
    summary: 'An interpreter works with you for one day of meetings in one city.',
    included: ['One interpreter for up to eight hours'],
    excluded: ['Written translation'],
    regions: ['Dhaka', 'Guangzhou'],
    quoteBasis: 'per_day',
  },
  need: {
    version: 1,
    text: 'Synthetic need: an interpreter for two supplier meetings',
    preferredFrom: '2026-12-01',
    preferredTo: '2026-12-03',
    region: 'Dhaka',
    updatedAt: '2026-10-19T09:00:00.000Z',
  },
  quote: {
    id: '00000000-0000-4000-8000-0000000000d4',
    version: 1,
    currency: 'USD',
    scope: 'Synthetic scope: one interpreter for one day of two meetings in Dhaka',
    components: [
      {
        position: 1,
        kind: 'service_fee',
        label: 'Synthetic interpreter day fee',
        treatment: 'included',
        amountMinor: '45000',
      },
      {
        position: 2,
        kind: 'local_cost',
        label: 'Synthetic local transport estimate',
        treatment: 'estimate',
        amountMinor: '6000',
      },
      {
        position: 3,
        kind: 'pass_through',
        label: 'Synthetic meeting room at cost',
        treatment: 'included',
        amountMinor: '12000',
      },
      {
        position: 4,
        kind: 'tax',
        label: 'Synthetic local sales tax',
        treatment: 'not_included',
        amountMinor: null,
      },
    ],
    fixedTotalMinor: '57000',
    estimatedTotalMinor: '6000',
    exclusions: ['Synthetic exclusion: written translation'],
    assumptions: ['Synthetic assumption: both meetings are in the same building'],
    deliveryTerms: 'Synthetic delivery terms: on the agreed day, eight hours',
    paymentTerms: 'Synthetic payment terms are settled later; nothing is charged now',
    validUntil: '2026-12-31T23:59:59.000000Z',
    preparedAt: '2026-10-19T10:00:00.000000Z',
    expired: false,
    digest: 'a'.repeat(64),
    synthetic: true,
    billing: 'billing_not_enabled',
    paymentTaken: false,
  },
  orderIntent: null,
  timeline: [
    {
      seq: 1,
      at: '2026-10-19T09:00:00.000Z',
      kind: 'requested',
      status: 'requested',
      by: 'You',
      note: null,
      quoteVersion: null,
    },
  ],
  actions: ['accept', 'decline', 'question'],
  synthetic: true,
};

test.beforeAll(async () => {
  const view = resolve('apps/web/app/account/service-requests/service-request-detail.tsx');
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { ServiceRequestDetailView, ServiceRequestHeading } from ${JSON.stringify(view)};
        createRoot(document.getElementById('app')).render(
          <main id="main" className="operator-page ux-workspace ux-customer">
            <header className="ux-page-heading"><h1><ServiceRequestHeading /></h1></header>
            <ServiceRequestDetailView subject="synthetic-alice" issuer="https://fixture.invalid/auth"
              workspaceId=${JSON.stringify(workspaceId)} requestId=${JSON.stringify(requestId)} />
          </main>,
        );`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Help request fixture</title><style>${css}\n${componentCss}</style></head><body><div id="app"></div><script type="module">${script.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, status = 200) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/customer-service-requests**', (route) =>
    status === 200
      ? route.fulfill({
          json: { ...detail, expiresAt: new Date(Date.now() + 600000).toISOString() },
        })
      : route.fulfill({ status, json: { error: 'denied' } }),
  );
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(fixturePath);
}

const amounts = ['USD 450.00', 'USD 60.00', 'USD 120.00', 'Not included', 'USD 570.00'];

for (const width of [320, 390])
  test(`04, ${width} px: no cost is wider than its region and every amount is on screen`, async ({
    page,
  }) => {
    await open(page, width);
    const costs = page.getByRole('region', { name: 'Quote costs, one row for every cost' });
    await expect(costs).toBeVisible();
    // The page does not scroll sideways, the costs do not scroll inside their region, and nothing inside sticks out.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const wide = await costs.evaluate((region) => {
      const box = region.getBoundingClientRect();
      const out = Array.from(region.querySelectorAll<HTMLElement>('*')).filter((node) => {
        const own = node.getBoundingClientRect();
        return own.width > 0 && (own.left < box.left - 0.5 || own.right > box.right + 0.5);
      });
      return {
        scrolls: region.scrollWidth > region.clientWidth,
        out: out.map((node) => node.tagName + ':' + node.textContent?.slice(0, 30)),
      };
    });
    expect(wide).toEqual({ scrolls: false, out: [] });
    // Each cost names its item, its kind, how it is counted and its exact amount, all inside the viewport.
    const rows = costs.locator('tbody tr');
    await expect(rows).toHaveCount(4);
    const texts = await rows.evaluateAll((list) =>
      list.map((row) => (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    );
    amounts.slice(0, 4).forEach((amount, index) => expect(texts[index]).toContain(amount));
    expect(texts[0]).toContain('Synthetic interpreter day fee');
    for (const amount of amounts) {
      const cell = costs.locator('td.sr-amount', { hasText: amount }).first();
      await cell.scrollIntoViewIfNeeded();
      const box = (await cell.boundingBox())!;
      expect(box.x, amount).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, amount).toBeLessThanOrEqual(width + 0.5);
    }
  });

test('04, 1440 px: the costs stay a table with the same amounts', async ({ page }) => {
  await open(page, 1440);
  const table = page.getByRole('table', { name: /Every cost in this quote, in USD/ });
  await expect(table.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
  await expect(table.getByRole('row', { name: /Synthetic interpreter day fee/ })).toContainText(
    'USD 450.00',
  );
  await expect(
    table.getByRole('row', { name: /Fixed price for the included items/ }),
  ).toContainText('USD 570.00');
});

for (const width of [390, 1440])
  test(`05, ${width} px: with the decline step open there is one primary button and the reason field has the focus`, async ({
    page,
  }) => {
    await open(page, width);
    const region = page.getByRole('region', { name: 'What you can do' });
    const primaries = region.locator('button.button:not(.button-secondary)');
    // Before any step is open the one primary is Accept.
    await expect(primaries).toHaveText(['Accept This Quote']);
    await region.getByRole('button', { name: 'Decline This Quote' }).click();
    await expect(primaries).toHaveText(['Confirm and Decline']);
    await expect(region.getByRole('button', { name: 'Accept This Quote' })).toHaveClass(
      /button-secondary/,
    );
    await expect(region.getByLabel('Why? (optional)')).toBeFocused();
    // The other steps follow the same rule, and closing a step gives Accept its place back.
    await region.getByRole('button', { name: 'Ask a Question' }).click();
    await expect(primaries).toHaveText(['Send Question']);
    await expect(region.getByLabel('Your question')).toBeFocused();
    await region.getByRole('button', { name: 'Accept This Quote' }).click();
    await expect(primaries).toHaveText(['Confirm and Accept']);
    await expect(region.getByLabel(/I have read every cost/)).toBeFocused();
    await region.getByRole('button', { name: 'Accept This Quote' }).click();
    await expect(primaries).toHaveText(['Accept This Quote']);
  });

test('11: one surface, the h1 names the service, and there is no back link', async ({ page }) => {
  await open(page, 390);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Interpreter day');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Interpreter day' })).toHaveCount(1);
  await expect(page.locator('main .detail-card')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'All help requests' })).toHaveCount(0);
  // Headings step down one level at a time under the h1.
  const levels = await page
    .locator('main :is(h1, h2, h3, h4)')
    .evaluateAll((list) => list.map((node) => Number(node.tagName.slice(1))));
  levels.forEach((level, index) =>
    expect(level - (levels[index - 1] ?? 0), `heading ${index}`).toBeLessThanOrEqual(1),
  );
});

test('14: a request that cannot be shown keeps the plain title and offers each destination once', async ({
  page,
}) => {
  await open(page, 390, 403);
  await expect(page.getByText('Access required')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help request');
  const links = await page
    .locator('main a[href]')
    .evaluateAll((list) => list.map((node) => node.getAttribute('href')));
  expect(links).toEqual(['/account']);
});

test('19: no address is linked twice inside main', async ({ page }) => {
  await open(page, 390);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((list) => list.map((node) => node.getAttribute('href')));
  expect(hrefs.filter((href, index) => hrefs.indexOf(href) !== index)).toEqual([]);
});

test('18: the sample-mode rule is a hint tied to the field, not part of its label', async ({
  page,
}) => {
  await open(page, 390);
  await expect(
    page.getByText(/\(start with Synthetic\)|optional, start with Synthetic/),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Decline This Quote' }).click();
  const reason = page.getByLabel('Why? (optional)', { exact: true });
  await expect(reason).toHaveAccessibleDescription(
    'Sample mode: start your text with the word Synthetic.',
  );
  // The rule itself is unchanged: the field still starts with the word.
  await expect(reason).toHaveValue('Synthetic ');
});

test('07, 320 px at 200% text: the page does not scroll sideways', async ({ page }) => {
  await open(page, 320);
  await expect(page.getByRole('region', { name: 'What you can do' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByRole('button', { name: 'Decline This Quote' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
