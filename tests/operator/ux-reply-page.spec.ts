import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The supplier Reply Page (Lane 8 of the UX update), mounted with the real introduction component, the
// real stylesheets and the private interface answered by the test: one question at a time, the full quote
// form, the check, the receipt, a limited Chinese catalogue, the terms the team asked for, a retry that
// repeats the same message, and layout at four widths. No database, no supplier, no email.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const token = 'a1'.repeat(32);

const view = (over: Record<string, unknown> = {}) => ({
  role: 'SUPPLIER',
  sharedRequirements: 'Curtain track, 4 metres, white, about 1,200 pieces.',
  sharedUncertainty: 'Buyer budget is not verified.',
  allowQuotation: true,
  allowMeetingInterest: true,
  introduction: {
    company: 'Example Hospitality Group',
    country: 'Spain',
    capability: 'Hotel interior fit-out',
    fit: 'They buy track hardware in volume.',
    evidence: 'Operator reported.',
    uncertainty: 'Not independently verified.',
    conversationPurpose: 'Discuss a curtain track supply',
    availableDates: 'Weeks 3 and 4',
  },
  template: 'You were introduced by the Corridra team.',
  expiresAt: '2099-01-01T00:00:00Z',
  decision: null,
  synthetic: true,
  ...over,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{BuyerIntroduction}from ${JSON.stringify(resolve('apps/web/app/buyer/introduction.tsx'))};
      const q=new URLSearchParams(location.search);
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Private introduction</h1><BuyerIntroduction replyPage={q.get('old')!=='1'} chineseReleased={q.get('nozh')!=='1'}/></main>);`,
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reply fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

type Sent = Record<string, unknown>;
/** Answers the private interface and records every command it receives. */
async function open(
  page: Page,
  options: {
    hash?: string;
    view?: Record<string, unknown>;
    failDetail?: number;
    old?: boolean;
    zhNotReleased?: boolean;
    // Answer correction: how the private interface answers a correction, and what each later read of the page returns.
    revise?: (body: Sent, count: number) => { status: number; value: unknown };
    reads?: Record<string, unknown>[];
  } = {},
) {
  const sent: Sent[] = [];
  let revisions = 0;
  let readCount = 0;
  let failures = options.failDetail ?? 0;
  await page.route('**/api/buyer', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    sent.push(body);
    const json = (status: number, value: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (body.action === 'read') {
      const later = options.reads?.[readCount++ - 1];
      return json(200, view(later ?? options.view));
    }
    if (body.action === 'detail-revision') {
      const answer = options.revise?.(body, ++revisions) ?? {
        status: 200,
        value: { recorded: true, version: Number(body.expectedVersion) + 1 },
      };
      return json(answer.status, answer.value);
    }
    if (body.action === 'respond') return json(200, { decision: body.decision });
    if (body.action === 'detail-response') {
      if (failures > 0) {
        failures -= 1;
        return json(500, { error: 'The response could not be completed. Please try again.' });
      }
      return json(200, { recorded: true, sourceKind: 'SELF_DECLARATION' });
    }
    return json(400, { error: 'unexpected' });
  });
  const query = [options.old ? 'old=1' : '', options.zhNotReleased ? 'nozh=1' : '']
    .filter(Boolean)
    .join('&');
  await page.goto(`${origin}/${query ? `?${query}` : ''}#${options.hash ?? `t=${token}`}`);
  return sent;
}
const detail = (sent: Sent[]) => sent.filter((c) => c.action === 'detail-response');
async function toMessage(page: Page) {
  await page.getByRole('button', { name: 'Interested', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your message' })).toBeVisible();
}

test('asks one question first: the answer, with the shared requirement and the three choices', async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole('heading', { name: 'Would this company be relevant to you?' }),
  ).toBeVisible();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByText('Curtain track, 4 metres, white, about 1,200 pieces.')).toBeVisible();
  for (const name of ['Interested', 'Need more information', 'Not relevant'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop Further Introductions' })).toBeVisible();
  await expect(page.getByText('(madeup) Sample introduction. No real outreach.')).toBeVisible();
  // Nothing past the first question is on the page yet.
  await expect(page.getByLabel('Your message to the team')).toHaveCount(0);
});

test('Need more information and Not relevant are recorded and end with a thank you', async ({
  page,
}) => {
  const sent = await open(page);
  await page.getByRole('button', { name: 'Need more information', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  expect(sent.filter((c) => c.action === 'respond')).toMatchObject([
    { decision: 'NEED_INFO', optOut: false },
  ]);
  expect(detail(sent)).toHaveLength(0);
});

test('the full path: message, four quote steps, a check, one send and a receipt', async ({
  page,
}) => {
  const sent = await open(page);
  await toMessage(page);
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Your message to the team').fill('We can quote this.');
  await page.getByLabel(/I would like to discuss a meeting/).check();
  await page.getByRole('button', { name: 'Add a quote' }).click();

  await expect(page.getByRole('heading', { name: 'Your quote: what you offer' })).toBeVisible();
  await expect(page.getByText('Step 3 of 7')).toBeVisible();
  await page.getByLabel('What you are quoting').fill('Polyester curtain track, 4 m');
  await page.getByLabel('Quantity').fill('1200');
  await page.getByLabel('Minimum order').fill('200');
  await page.getByLabel(/^Unit/).fill('pieces');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Your quote: the price' })).toBeVisible();
  await page.getByLabel('Currency of your quote').selectOption('USD');
  await page.getByLabel('Price for one unit').fill('12.50');
  await page.getByLabel('Tooling').selectOption('NONE');
  await page.getByLabel('Set-up').selectOption('AMOUNT');
  await page.getByRole('textbox', { name: 'Set-up' }).fill('300');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Your quote: the terms' })).toBeVisible();
  await page.getByLabel('This quote is valid until').fill('2099-12-31');
  await page.getByLabel('Trade term').selectOption('FOB');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Your quote: what is included' })).toBeVisible();
  await page.getByLabel('Shipping').selectOption('EXCLUDED');
  await page
    .getByLabel('What is missing or uncertain in this quote')
    .fill('Freight is not yet known');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Check what you typed' })).toBeVisible();
  await expect(page.getByText('Step 7 of 7')).toBeVisible();
  const summary = page.locator('.reply-summary');
  await expect(summary).toContainText('Price for one unit');
  await expect(summary).toContainText('USD 12.50');
  await expect(summary).toContainText('Tooling');
  await expect(summary).toContainText('USD 0.00');
  await expect(summary).toContainText('2099-12-31');
  // What was not typed says so, and is never shown as zero.
  await expect(summary.locator('div', { hasText: 'Lead time' }).locator('dd')).toHaveText(
    'Not stated',
  );
  await expect(summary.locator('div', { hasText: 'Total price' }).locator('dd')).toHaveText(
    'Not stated',
  );
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Tick the box to confirm.')).toBeVisible();
  expect(detail(sent)).toHaveLength(0);
  await page.getByLabel(/This is my own declaration/).check();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  const [command] = detail(sent);
  expect(command).toMatchObject({
    action: 'detail-response',
    token,
    body: 'We can quote this.',
    meetingInterest: true,
    acknowledged: true,
    quotation: {
      currency: 'USD',
      uncertainties: 'Freight is not yet known',
      terms: {
        specification: 'Polyester curtain track, 4 m',
        quantity: '1200',
        moq: '200',
        unit: 'pieces',
        unitPriceMinor: '1250',
        toolingMinor: '0',
        setupMinor: '30000',
        validUntil: '2099-12-31T23:59:59Z',
        incoterm: 'FOB',
        shipping: 'EXCLUDED',
      },
    },
  });
  const terms = (command.quotation as { terms: Record<string, string> }).terms;
  expect(Object.keys(terms)).not.toContain('totalPriceMinor');
  expect(Object.keys(terms)).not.toContain('leadTime');
  expect(typeof command.responseId).toBe('string');
  const receipt = page.locator('.reply-receipt');
  await expect(receipt).toContainText('Corridra receipt');
  await expect(receipt).toContainText('We can quote this.');
  await expect(receipt).toContainText('Lead time: Not stated');
  await expect(page.getByRole('link', { name: 'Download as a text file' })).toHaveAttribute(
    'download',
    'corridra-receipt.txt',
  );
  await expect(page.getByRole('button', { name: 'Copy the receipt' })).toBeVisible();
  // Nothing was kept in the browser.
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('a message without a quote goes to the check and sends no quotation', async ({ page }) => {
  const sent = await open(page);
  await toMessage(page);
  await page.getByLabel('Your message to the team').fill('Please send more detail.');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await expect(page.getByRole('heading', { name: 'Check what you typed' })).toBeVisible();
  await expect(page.getByText('No quote is included.')).toBeVisible();
  await page.getByLabel(/This is my own declaration/).check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  expect(detail(sent)[0]).toMatchObject({
    body: 'Please send more detail.',
    quotation: null,
    meetingInterest: false,
  });
});

test('a supplier whose link allows no quote sees no quote step', async ({ page }) => {
  await open(page, { view: { allowQuotation: false, allowMeetingInterest: false } });
  await toMessage(page);
  await expect(page.getByRole('button', { name: 'Add a quote' })).toHaveCount(0);
  await expect(page.getByLabel(/I would like to discuss a meeting/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
});

test('holds a step until it is right, and says what is wrong in words', async ({ page }) => {
  await open(page);
  await toMessage(page);
  await page.getByRole('button', { name: 'Add a quote' }).click();
  await expect(page.getByText('Write at least 3 characters.')).toBeVisible();
  await page.getByLabel('Your message to the team').fill('Quote follows.');
  await page.getByRole('button', { name: 'Add a quote' }).click();
  await page.getByLabel('Quantity').fill('1.5');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Use a whole number above zero, or leave it blank.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your quote: what you offer' })).toBeVisible();
  await page.getByLabel('Quantity').fill('15');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Currency of your quote').selectOption('JPY');
  await page.getByLabel('Price for one unit').fill('12.5');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.getByText('This currency allows fewer decimal places. Nothing is rounded for you.'),
  ).toBeVisible();
  // Back never blocks, and what was typed is still there.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Quantity')).toHaveValue('15');
});

test('a quote cannot go on without its currency, because the database refuses one', async ({
  page,
}) => {
  const sent = await open(page);
  await toMessage(page);
  await page.getByLabel('Your message to the team').fill('We can quote this.');
  await page.getByRole('button', { name: 'Add a quote' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Choose the currency of your quote.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your quote: the price' })).toBeVisible();
  expect(detail(sent)).toHaveLength(0);
});

test('keeps the exact message after a failed send and repeats it under the same id', async ({
  page,
}) => {
  const sent = await open(page, { failDetail: 1 });
  await toMessage(page);
  await page.getByLabel('Your message to the team').fill('We can quote this.');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await page.getByLabel(/This is my own declaration/).check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'could not be completed' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry the Same Response' }).click();
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  const [first, second] = detail(sent);
  expect(second).toEqual(first);
});

test('shows the receipt at once for a link that was already answered', async ({ page }) => {
  await open(page, {
    view: {
      decision: 'INTERESTED',
      detailResponse: {
        sourceKind: 'SELF_DECLARATION',
        createdAt: '2026-10-20T08:00:00Z',
        body: {
          body: 'Earlier reply',
          meetingInterest: false,
          quotation: null,
          acknowledged: true,
        },
      },
    },
  });
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  await expect(page.locator('.reply-receipt')).toContainText('Earlier reply');
  await expect(page.locator('.reply-receipt')).toContainText('Oct 20, 2026');
});

test('an older link, the bare token, still opens the page in English', async ({ page }) => {
  await open(page, { hash: token });
  await expect(
    page.getByRole('heading', { name: 'Would this company be relevant to you?' }),
  ).toBeVisible();
});

test('a link without a usable token says so and sends nothing', async ({ page }) => {
  const sent = await open(page, { hash: 'l=zh' });
  await expect(
    page.getByText('This private link is unavailable. Open the complete link you received.'),
  ).toBeVisible();
  expect(sent).toHaveLength(0);
});

test('with the switch off the older form and its words are what the page shows', async ({
  page,
}) => {
  await open(page, { hash: token, old: true, view: { decision: 'INTERESTED' } });
  await expect(page.getByRole('heading', { name: 'Reply or request clarification' })).toBeVisible();
  await expect(page.getByText('Step 1 of')).toHaveCount(0);
});

test('a link that names Chinese opens in English until a native reviewer is recorded', async ({
  page,
}) => {
  await open(page, { hash: `t=${token}&l=zh`, zhNotReleased: true });
  await expect(
    page.getByRole('heading', { name: 'Would this company be relevant to you?' }),
  ).toBeVisible();
  await expect(page.locator('section[aria-label="Private introduction"]')).toHaveAttribute(
    'lang',
    'en',
  );
  await expect(page.getByRole('heading', { name: '这家公司与您相关吗？' })).toHaveCount(0);
});

test('the Chinese catalogue covers the page words, and the page sets its own language', async ({
  page,
}) => {
  const sent = await open(page, { hash: `t=${token}&l=zh` });
  await expect(page.getByRole('heading', { name: '这家公司与您相关吗？' })).toBeVisible();
  await expect(page.locator('section[aria-label="Private introduction"]')).toHaveAttribute(
    'lang',
    'zh-Hans',
  );
  await expect(page.locator('.reply')).toHaveAttribute('dir', 'ltr');
  // The requirement the team wrote is theirs and stays as written, marked as English.
  const shared = page.locator('.reply-shared');
  await expect(shared).toHaveAttribute('lang', 'en');
  await expect(shared).toContainText('Curtain track, 4 metres, white');
  await page.getByRole('button', { name: '有兴趣' }).click();
  await expect(page.getByRole('heading', { name: '您的留言' })).toBeVisible();
  await page.getByLabel('给团队的留言').fill('我们可以报价。');
  await page.getByRole('button', { name: '添加报价' }).click();
  await expect(page.getByRole('heading', { name: '您的报价：产品内容' })).toBeVisible();
  await page.getByLabel('报价产品').fill('聚酯窗帘轨道');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('请选择报价币种。')).toBeVisible();
  await page.getByLabel('报价币种').selectOption('CNY');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('此报价中缺少或不确定的内容').fill('运费尚未确定');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '请检查您填写的内容' })).toBeVisible();
  await page.getByLabel(/这是我对此请求的个人声明/).check();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('heading', { name: '您的回答已记录' })).toBeVisible();
  // What was typed is never translated and never altered.
  expect(detail(sent)[0]).toMatchObject({
    body: '我们可以报价。',
    quotation: { terms: { specification: '聚酯窗帘轨道' } },
  });
  await expect(page.locator('.reply-receipt')).toContainText('Corridra 回执');
});

test('marks the terms the team asked for and lists them on the message step', async ({ page }) => {
  await open(page, { hash: `t=${token}&ask=leadTime,validUntil` });
  await toMessage(page);
  await expect(page.getByRole('note')).toContainText(
    'The team asked for these: Lead time, This quote is valid until',
  );
  await page.getByLabel('Your message to the team').fill('We can quote this.');
  await page.getByRole('button', { name: 'Add a quote' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Currency of your quote').selectOption('USD');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Your quote: the terms' })).toBeVisible();
  await expect(page.locator('.reply-field[data-asked="true"]')).toHaveCount(2);
  await expect(page.locator('.reply-asked')).toHaveCount(2);
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide on every step: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { hash: `t=${token}&ask=leadTime` });
    const check = async (label: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        label,
      ).toBe(true);
      for (const control of await page
        .locator(
          '.reply button, .reply select, .reply input:not([type=checkbox]), .reply textarea, .reply summary, .reply a',
        )
        .all()) {
        const box = await control.boundingBox();
        if (!box) continue;
        expect(box.height, `${label}: target height`).toBeGreaterThanOrEqual(43.5);
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${label} ${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    };
    await check('answer');
    await toMessage(page);
    await page.getByLabel('Your message to the team').fill('We can quote this.');
    await check('message');
    await page.getByRole('button', { name: 'Add a quote' }).click();
    await check('what');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Currency of your quote').selectOption('USD');
    await page.getByLabel('Tooling').selectOption('AMOUNT');
    await check('price');
    await page.getByRole('button', { name: 'Next' }).click();
    await check('terms');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('What is missing or uncertain in this quote').fill('Freight unknown');
    await check('included');
    await page.getByRole('button', { name: 'Next' }).click();
    await check('check');
    await page.getByLabel(/This is my own declaration/).check();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
    await check('receipt');
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: `docs/design-system/evidence/lane8-reply-page/receipt-${width}.png`,
        fullPage: true,
      });
  });
}

// Answer correction (CRUD gap G7, module 3): offered only where the page says a correction is possible.
const earlier = (over: Record<string, unknown> = {}) => ({
  decision: 'INTERESTED',
  detailResponse: {
    sourceKind: 'SELF_DECLARATION',
    createdAt: '2026-10-20T08:00:00Z',
    version: 0,
    canRevise: true,
    body: {
      body: 'Earlier reply',
      meetingInterest: false,
      quotation: {
        currency: 'USD',
        terms: {
          specification: 'Polyester curtain track',
          unitPriceMinor: '1250',
          toolingMinor: '0',
        },
        uncertainties: 'Lead time not yet known',
      },
      acknowledged: true,
    },
    ...over,
  },
});
const signed = async (page: Page) => {
  await page.getByLabel(/This is my own declaration/).check();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
};

test('a correction is offered only when the page says it is possible', async ({ page }) => {
  await open(page, {
    view: {
      decision: 'INTERESTED',
      detailResponse: { ...earlier().detailResponse, version: undefined, canRevise: undefined },
    },
  });
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change My Answer' })).toHaveCount(0);
});

test('Change My Answer starts from the recorded answer and sends one correction at the version it saw', async ({
  page,
}) => {
  const sent = await open(page, { view: earlier() });
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await expect(page.getByLabel('Your message to the team')).toHaveValue('Earlier reply');
  await page.getByLabel('Your message to the team').fill('Corrected reply with the same offer.');
  await page.getByRole('button', { name: 'Add a quote' }).click();
  // The recorded quote is there to edit, in the form the supplier typed it.
  await expect(page.getByLabel('What you are quoting')).toHaveValue('Polyester curtain track');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Currency of your quote')).toHaveValue('USD');
  await expect(page.getByLabel('Price for one unit')).toHaveValue('12.50');
  await expect(page.getByLabel('Tooling')).toHaveValue('NONE');
  await page.getByLabel('Price for one unit').fill('13.00');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page
    .getByLabel('What is missing or uncertain in this quote')
    .fill('Lead time still unknown');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Check what you typed' })).toBeVisible();
  await signed(page);
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  await expect(page.locator('.reply-receipt')).toContainText(
    'Corrected reply with the same offer.',
  );
  const [correction] = sent.filter((c) => c.action === 'detail-revision');
  expect(correction).toMatchObject({
    expectedVersion: 0,
    body: 'Corrected reply with the same offer.',
    acknowledged: true,
  });
  expect(correction!.responseId).toMatch(/^[0-9a-f-]{36}$/);
  expect((correction!.quotation as { terms: Record<string, string> }).terms).toMatchObject({
    specification: 'Polyester curtain track',
    unitPriceMinor: '1300',
    toolingMinor: '0',
  });
  expect(sent.filter((c) => c.action === 'detail-response')).toHaveLength(0);
});

test('a correction can drop the quote and Keep My Current Answer leaves everything as it was', async ({
  page,
}) => {
  const sent = await open(page, { view: earlier() });
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await page.getByRole('button', { name: 'Keep My Current Answer' }).click();
  await expect(page.locator('.reply-receipt')).toContainText('Earlier reply');
  expect(sent.filter((c) => c.action === 'detail-revision')).toHaveLength(0);
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  const [correction] = sent.filter((c) => c.action === 'detail-revision');
  expect(correction).toMatchObject({ quotation: null, expectedVersion: 0 });
});

test('a correction changed in another window keeps the typed text and lets the person choose', async ({
  page,
}) => {
  const newer = earlier({
    version: 3,
    body: {
      body: 'Changed in another window',
      meetingInterest: false,
      quotation: null,
      acknowledged: true,
    },
  });
  const sent = await open(page, {
    view: earlier(),
    reads: [newer],
    revise: (_body, count) =>
      count === 1
        ? {
            status: 409,
            value: {
              error:
                'This answer was changed since you opened it. The latest version is shown; try again.',
            },
          }
        : { status: 200, value: { recorded: true, version: 4 } },
  });
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await page.getByLabel('Your message to the team').fill('My own corrected reply');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  const alert = page.getByRole('alert').filter({ hasText: 'was changed since you opened it' });
  await expect(alert).toContainText('Changed in another window');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByText('My own corrected reply')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep Mine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  const corrections = sent.filter((c) => c.action === 'detail-revision');
  expect(corrections).toHaveLength(2);
  expect(corrections[1]).toMatchObject({ expectedVersion: 3, body: 'My own corrected reply' });
  expect(corrections[1]!.responseId).not.toBe(corrections[0]!.responseId);
});

test('an answer already corrected in another window is what the receipt shows and the next correction starts from', async ({
  page,
}) => {
  const newer = earlier({
    version: 2,
    body: {
      body: 'Corrected in another window',
      meetingInterest: false,
      quotation: null,
      acknowledged: true,
    },
  });
  // This window sends the first answer; by the time the page reads it back, another window has corrected it twice.
  const sent = await open(page, { reads: [newer] });
  await toMessage(page);
  await page.getByLabel('Your message to the team').fill('Please send more detail.');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
  await expect(page.locator('.reply-receipt')).toContainText('Corrected in another window');
  await expect(page.locator('.reply-receipt')).not.toContainText('Please send more detail.');
  // The editor starts from the text that belongs to version 2, so older terms cannot be sent as if they were current.
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await expect(page.getByLabel('Your message to the team')).toHaveValue(
    'Corrected in another window',
  );
  await page.getByLabel('Your message to the team').fill('Corrected again here');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  const corrections = sent.filter((c) => c.action === 'detail-revision');
  expect(corrections).toHaveLength(1);
  expect(corrections[0]).toMatchObject({ expectedVersion: 2, body: 'Corrected again here' });
});

test('Use Theirs shows the newer answer and sends nothing more', async ({ page }) => {
  const newer = earlier({
    version: 3,
    body: {
      body: 'Changed in another window',
      meetingInterest: false,
      quotation: null,
      acknowledged: true,
    },
  });
  const sent = await open(page, {
    view: earlier(),
    reads: [newer],
    revise: () => ({
      status: 409,
      value: {
        error:
          'This answer was changed since you opened it. The latest version is shown; try again.',
      },
    }),
  });
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await page.getByLabel('Your message to the team').fill('My own corrected reply');
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  await page.getByRole('button', { name: 'Use Theirs', exact: true }).click();
  await expect(page.locator('.reply-receipt')).toContainText('Changed in another window');
  expect(sent.filter((c) => c.action === 'detail-revision')).toHaveLength(1);
});

test('once the team has decided on an answer the page says so and offers no more corrections', async ({
  page,
}) => {
  await open(page, {
    view: earlier(),
    revise: () => ({
      status: 409,
      value: {
        error:
          'The team has already made a decision on this answer, so it can no longer be changed here.',
      },
    }),
  });
  await page.getByRole('button', { name: 'Change My Answer' }).click();
  await page.getByRole('button', { name: 'Send my message without a quote' }).click();
  await signed(page);
  await expect(page.getByRole('alert').filter({ hasText: 'made a decision' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Keep My Current Answer' }).click();
  await expect(page.getByRole('button', { name: 'Change My Answer' })).toHaveCount(0);
});
