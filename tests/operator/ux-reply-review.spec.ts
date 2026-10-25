import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The team's review of supplier replies (Lane 8 of the UX update), mounted with the real component, the
// real stylesheets and the review interface answered by the test: the reply beside the requirement term by
// term with the engine's gaps, publish, ask and reject, the prepared quotation, a closed database, a role
// that cannot act, and layout at four widths. No database, no supplier.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111';
const replyId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';

const complete = {
  specification: 'Curtain track, 4 m',
  quantity: '10',
  unit: 'pieces',
  unitPriceMinor: '1250',
  totalPriceMinor: '12500',
  leadTime: '6 weeks',
  validUntil: '2099-12-31T23:59:59Z',
  incoterm: 'FOB',
  shipping: 'INCLUDED',
  paymentTerms: '30 percent deposit',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
};
const replies = {
  gappy: [
    {
      id: replyId,
      link_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: '2026-10-24T08:00:00Z',
      body: {
        body: 'We can quote this. Terms follow.',
        meetingInterest: true,
        quotation: {
          currency: 'USD',
          terms: {
            specification: 'Curtain track, 4 m',
            quantity: '10',
            unit: 'pieces',
            unitPriceMinor: '1250',
            totalPriceMinor: '12500',
          },
          uncertainties: 'Lead time and validity not yet known',
        },
      },
    },
  ],
  complete: [
    {
      id: secondId,
      link_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      created_at: '2026-10-24T09:00:00Z',
      body: {
        body: '原始答复：我们可以报价。',
        meetingInterest: false,
        quotation: { currency: 'USD', terms: complete, uncertainties: '运费尚未确定' },
      },
    },
  ],
  none: [
    {
      id: replyId,
      link_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: { body: 'Please send more detail.', meetingInterest: false, quotation: null },
    },
  ],
} as const;
const disclosures = [
  {
    link_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    role: 'SUPPLIER',
    shared_requirements: 'Curtain track, 4 metres, white, about 1,200 pieces.',
  },
  {
    link_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    role: 'SUPPLIER',
    shared_requirements: 'Curtain track, 4 metres, white.',
  },
];

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{ReplyReview}from ${JSON.stringify(resolve('apps/web/app/operator/reply-review.tsx'))};
      import{OperatorFlags}from ${JSON.stringify(resolve('apps/web/app/operator/operator-flags.tsx'))};
      const q=new URLSearchParams(location.search);
      const props=JSON.parse(q.get('props'));
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Delivery</h1><h2>Declarations</h2>
        <OperatorFlags replyReview={q.get('flag')!=='0'}><ReplyReview {...props}/></OperatorFlags></main>);`,
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
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Stored = Record<string, unknown>;
async function open(
  page: Page,
  options: {
    replies?: keyof typeof replies;
    role?: string;
    open?: boolean;
    flag?: boolean;
    unavailable?: boolean;
    failWith?: { status: number; error: string };
  } = {},
) {
  const reviews: Stored[] = [];
  const sent: Stored[] = [];
  await page.route('**/api/reply/review**', async (route) => {
    const request = route.request();
    const json = (status: number, value: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (options.unavailable) return json(503, { error: 'Reply review is unavailable' });
    if (request.method() === 'GET') return json(200, { open: options.open !== false, reviews });
    const body = JSON.parse(request.postData() ?? '{}');
    sent.push(body);
    if (options.failWith) return json(options.failWith.status, { error: options.failWith.error });
    reviews.push({
      id: crypto.randomUUID(),
      responseId: body.responseId,
      decision: body.decision,
      reasonCode: body.reasonCode ?? null,
      askTerms: body.askTerms ?? null,
      note: body.note ?? null,
      createdAt: '2026-10-25T01:00:00Z',
    });
    return json(200, { id: 'x', replayed: false });
  });
  const props = {
    tenant,
    role: options.role ?? 'owner',
    responses: replies[options.replies ?? 'gappy'],
    disclosures,
  };
  await page.goto(
    `${origin}/?props=${encodeURIComponent(JSON.stringify(props))}${options.flag === false ? '&flag=0' : ''}`,
  );
  return sent;
}

test('sets the reply beside the requirement, term by term, with the gaps the engine reports', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Review supplier replies' })).toBeVisible();
  await expect(page.getByText('Curtain track, 4 metres, white, about 1,200 pieces.')).toBeVisible();
  await expect(page.getByText('We can quote this. Terms follow.')).toBeVisible();
  await expect(page.getByText('Not comparable yet')).toBeVisible();
  const terms = page.locator('.reply-review-terms');
  await expect(terms.locator('div', { hasText: 'Unit price' }).locator('dd').first()).toContainText(
    'USD 12.50',
  );
  // Missing terms say so and are flagged; nothing is shown as zero.
  for (const term of [
    'Lead time',
    'Valid until',
    'Trade term',
    'Shipping',
    'Payment terms',
    'Tooling',
    'Set-up',
    'Packaging',
  ]) {
    const row = terms.locator('div', { hasText: new RegExp(`^${term}`) });
    await expect(row.locator('dd').first()).toHaveText('Not stated');
    await expect(row).toContainText('Engine: missing');
  }
  await expect(terms.locator('div[data-gap="true"]')).toHaveCount(8);
  await expect(
    page.getByText('Meeting or visit interest expressed. No appointment is inferred.'),
  ).toBeVisible();
  await expect(page.getByText('Awaiting review.')).toBeVisible();
});

test('a complete reply is comparable on supplied terms, and a Chinese reply is marked as such', async ({
  page,
}) => {
  await open(page, { replies: 'complete' });
  await expect(page.getByText('Comparable on supplied terms')).toBeVisible();
  await expect(page.locator('.reply-review-terms div[data-gap="true"]')).toHaveCount(0);
  await expect(page.getByText('原始答复：我们可以报价。')).toHaveAttribute('lang', 'zh');
  await expect(page.getByText(/Supplier uncertainties/)).toHaveAttribute('lang', 'zh');
});

test('a reply with no quotation says so', async ({ page }) => {
  await open(page, { replies: 'none' });
  await expect(page.getByText('No quotation in this reply.')).toBeVisible();
});

test('ask: the missing terms are chosen for the team, one decision is recorded, and the link suffix is shown', async ({
  page,
}) => {
  const sent = await open(page);
  await page.getByRole('button', { name: 'Ask for missing terms' }).click();
  for (const term of [
    'Lead time',
    'Valid until',
    'Trade term',
    'Shipping',
    'Payment terms',
    'Tooling',
    'Set-up',
    'Packaging',
  ])
    await expect(page.getByRole('checkbox', { name: term })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Quantity' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Tooling' }).uncheck();
  await page.getByRole('checkbox', { name: 'Set-up' }).uncheck();
  await page.getByRole('checkbox', { name: 'Packaging' }).uncheck();
  await page.getByRole('checkbox', { name: 'Shipping' }).uncheck();
  await page.getByRole('checkbox', { name: 'Payment terms' }).uncheck();
  await page.getByLabel(/Language of the supplier/).selectOption('zh');
  await expect(
    page.getByText(/Chinese opens only after a native reviewer is recorded/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record the request' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Decision recorded.' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    decision: 'ASK',
    responseId: replyId,
    askTerms: ['leadTime', 'validUntil', 'incoterm'],
  });
  expect(typeof sent[0].commandId).toBe('string');
  await expect(
    page.getByText('Asked for Lead time, Valid until, Trade term. Waiting for a new reply.'),
  ).toBeVisible();
  await expect(page.locator('.reply-review-link code')).toHaveText(
    '&l=zh&ask=leadTime,validUntil,incoterm',
  );
  // An ask keeps the reply open for a later decision.
  await expect(page.getByRole('button', { name: 'Publish: prepare as a quotation' })).toBeVisible();
});

test('publish records one decision and prepares the quotation for the existing form', async ({
  page,
}) => {
  const sent = await open(page, { replies: 'complete' });
  await page.getByRole('button', { name: 'Publish: prepare as a quotation' }).click();
  await expect(
    page.getByText('Published: prepared as a mission quotation, not yet confirmed.'),
  ).toBeVisible();
  expect(sent).toMatchObject([{ decision: 'PUBLISH', responseId: secondId }]);
  const block = page.locator('.reply-review-prepared pre');
  await expect(block).toContainText('currency: USD');
  await expect(block).toContainText('unitPrice: 12.50');
  await expect(block).toContainText('tooling: 0.00');
  await expect(block).toContainText('validUntil: 2099-12-31T23:59:59Z');
  await expect(block).toContainText('source: supplier reply, self-declared');
  await expect(page.getByRole('button', { name: 'Copy the prepared quotation' })).toBeVisible();
  // Final: no more decisions.
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
});

test('reject needs a reason, records it, and tells the team the customer never sees the reply', async ({
  page,
}) => {
  const sent = await open(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('The customer never sees a rejected reply.')).toBeVisible();
  await page.getByLabel('Reason').selectOption('PRICE_NOT_CREDIBLE');
  await page.getByLabel('Note for the team (optional)').fill('Price is far below cost');
  await page.getByRole('button', { name: 'Record the rejection' }).click();
  await expect(page.getByText('Rejected: Price not credible.')).toBeVisible();
  expect(sent[0]).toMatchObject({
    decision: 'REJECT',
    reasonCode: 'PRICE_NOT_CREDIBLE',
    note: 'Price is far below cost',
  });
  await expect(page.getByText('Review history (1)')).toBeVisible();
  await expect(page.locator('.reply-review-prepared')).toHaveCount(0);
});

test('shows the database message when the team member must verify again', async ({ page }) => {
  await open(page, {
    failWith: { status: 403, error: 'Verify your authenticator again to continue' },
  });
  await page.getByRole('button', { name: 'Publish: prepare as a quotation' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Verify your authenticator again to continue' }),
  ).toBeVisible();
  await expect(page.getByText('Awaiting review.')).toBeVisible();
});

test('a role that cannot review, and a database that is not open, can read but not act', async ({
  page,
}) => {
  await open(page, { role: 'operator' });
  await expect(page.getByText('We can quote this. Terms follow.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish: prepare as a quotation' })).toHaveCount(
    0,
  );
  const other = await page.context().newPage();
  await open(other, { open: false });
  await expect(other.getByText('Reply review is not open yet.')).toBeVisible();
  await expect(other.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  await expect(other.getByText('We can quote this. Terms follow.')).toBeVisible();
});

test('says so when the module is not installed, and shows nothing at all with the switch off', async ({
  page,
}) => {
  await open(page, { unavailable: true });
  await expect(
    page.getByText('Reply review is not installed or not available here.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish: prepare as a quotation' })).toHaveCount(
    0,
  );
  const off = await page.context().newPage();
  await open(off, { flag: false });
  await expect(off.getByRole('heading', { name: 'Review supplier replies' })).toHaveCount(0);
  await expect(off.getByText('We can quote this. Terms follow.')).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide in every state: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const check = async (label: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        label,
      ).toBe(true);
      for (const control of await page
        .locator(
          '.reply-review button, .reply-review select, .reply-review textarea, .reply-review summary',
        )
        .all()) {
        const box = await control.boundingBox();
        if (box) expect(box.height, `${label}: target`).toBeGreaterThanOrEqual(43.5);
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    };
    await check('awaiting');
    await page.getByRole('button', { name: 'Ask for missing terms' }).click();
    await check('ask form');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await check('reject form');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Publish: prepare as a quotation' }).click();
    await expect(
      page.getByText('Published: prepared as a mission quotation, not yet confirmed.'),
    ).toBeVisible();
    await check('published');
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: `docs/design-system/evidence/lane8-reply-page/review-${width}.png`,
        fullPage: true,
      });
  });
}
