import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Component protocol fixtures with a mocked API (U10c), not provider or database acceptance. The restricted database authority is
// proved by tests/integration/real-payment-declaration.test.ts. A declaration is not proof of bank receipt.
const issuer =
  'https://ep-payment-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000026';
const programmeId = '00000000-0000-4000-8000-000000000027';
const registrationId = '00000000-0000-4000-8000-0000000000f1';
const declarationA = '00000000-0000-4000-8000-0000000000b1';
const declarationB = '00000000-0000-4000-8000-0000000000b2';
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {ParticipantPaymentDeclaration} from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-payment-declaration.tsx'))};
import {ProgrammePaymentReview} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-payment-review.tsx'))};
const q=new URLSearchParams(location.search);
const base={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)}};
window.__decided=0;
const root=createRoot(document.getElementById('fixture'));
root.render(q.get('c')==='organiser'
 ?<ProgrammePaymentReview {...base} workspaceId=${JSON.stringify(workspaceId)} programmeId=${JSON.stringify(programmeId)} labels={{${JSON.stringify(registrationId)}:'Synthetic Buyer Alpha'}} onDecided={()=>{window.__decided+=1}}/>
 :<ParticipantPaymentDeclaration {...base} registrationId=${JSON.stringify(registrationId)} feeCurrencies={['BDT','USD']}/>);`,
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
    metafile: true,
  });
  // The browser bundle must carry no server authority code.
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  const css = Buffer.concat(
    await Promise.all(
      cssPaths.map((path) =>
        readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))),
      ),
    ),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample payment declaration fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Sample payment declaration fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
const declaration = (over: Record<string, unknown> = {}) => ({
  id: declarationA,
  registrationId,
  currency: 'BDT',
  exponent: 2,
  amountMinor: '4000000',
  paidOn: '2026-11-09',
  payerReference: 'Synthetic bank transfer 8841',
  note: null,
  declaredAt: '2026-11-10T08:00:00Z',
  status: 'AWAITING_REVIEW',
  reason: null,
  decidedAt: null,
  acknowledgedAmountMinor: null,
  acknowledgedOn: null,
  verified: false,
  ...over,
});
const own = (declarations: unknown[]) => ({
  registrationId,
  programmeId,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  provenance: 'PARTICIPANT_DECLARED',
  verified: false,
  collectsPayments: false,
  declarations,
});
const pending = (declarations: unknown[]) => ({
  workspaceId,
  programmeId,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  provenance: 'PARTICIPANT_DECLARED',
  verified: false,
  declarations,
});
const queued = (over: Record<string, unknown> = {}) =>
  declaration({
    outstandingMinor: '12000000',
    ...over,
  });
type Seen = { posts: Record<string, unknown>[]; headers: Record<string, string>[] };
async function mock(
  page: Page,
  read: () => unknown,
  options: { status?: number; seen?: Seen; failPost?: number } = {},
) {
  await page.route('**/api/customer-programme-payment-declarations**', (route) => {
    const request = route.request();
    options.seen?.headers.push(request.headers());
    if (options.status) return route.fulfill({ status: options.status, json: { error: 'x' } });
    if (request.method() === 'GET') return route.fulfill({ json: read() });
    options.seen?.posts.push(request.postDataJSON());
    if (options.failPost) return route.fulfill({ status: options.failPost, json: { error: 'x' } });
    return route.fulfill({ json: { replayed: false } });
  });
}
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);

test.describe('participant: I Have Paid', () => {
  test('an unchecked declaration never says paid, received or confirmed', async ({ page }) => {
    await mock(page, () => own([declaration()]));
    await page.goto(origin);
    const block = page.getByRole('heading', { name: 'Tell the Organiser You Paid' });
    await expect(block).toBeVisible();
    await expect(
      page.getByText('Declared by you, not yet confirmed by the organiser'),
    ).toBeVisible();
    await expect(page.getByText('It is not proof of payment', { exact: false })).toBeVisible();
    const text = await page.locator('#fixture').innerText();
    expect(text).not.toContain('Confirmed by the organiser');
    expect(text).not.toMatch(/\breceived\b/i);
    expect(text).not.toMatch(/\bNot accepted\b/);
    expect(text).toContain('BDT 40000.00');
    expect(text).not.toContain('—');
  });
  test('confirmed and not accepted states say exactly that, with the reason', async ({ page }) => {
    await mock(page, () =>
      own([
        declaration({
          id: declarationA,
          status: 'ACKNOWLEDGED',
          decidedAt: '2026-11-11T08:00:00Z',
          acknowledgedAmountMinor: '4000000',
          acknowledgedOn: '2026-11-09',
        }),
        declaration({
          id: declarationB,
          amountMinor: '500',
          status: 'REJECTED',
          reason: 'Synthetic nothing reached the account',
          decidedAt: '2026-11-11T09:00:00Z',
        }),
      ]),
    );
    await page.goto(origin);
    await expect(page.getByText('Confirmed by the organiser', { exact: true })).toBeVisible();
    await expect(
      page.getByText('The organiser recorded BDT 40000.00 on 2026-11-09.'),
    ).toBeVisible();
    await expect(page.getByText('different from what you declared')).toHaveCount(0);
    await expect(
      page.getByText('Not accepted by the organiser: Synthetic nothing reached the account'),
    ).toBeVisible();
    await expect(page.getByText('not yet confirmed')).toHaveCount(0);
    await axe(page);
  });
  test('a partial acknowledgement shows what the organiser recorded next to what was declared', async ({
    page,
  }) => {
    await mock(page, () =>
      own([
        declaration({
          status: 'ACKNOWLEDGED',
          decidedAt: '2026-11-11T08:00:00Z',
          acknowledgedAmountMinor: '2400000',
          acknowledgedOn: '2026-11-10',
        }),
      ]),
    );
    await page.goto(origin);
    const text = await page.locator('#fixture').innerText();
    expect(text).toContain('You say you paid BDT 40000.00 on 2026-11-09');
    expect(text).toContain('Confirmed by the organiser');
    expect(text).toContain('The organiser recorded BDT 24000.00 on 2026-11-10.');
    expect(text).toContain('This is different from what you declared.');
    await axe(page);
  });
  test('the form sends exact minor units, a command id and the account headers', async ({
    page,
  }) => {
    const seen: Seen = { posts: [], headers: [] };
    await mock(page, () => own([]), { seen });
    await page.goto(origin);
    await page.getByText('I Have Paid', { exact: true }).click();
    await page.getByLabel('Currency').selectOption('USD');
    await page.getByLabel('Amount you paid').fill('125.5');
    await page.getByLabel('Date paid').fill('2026-11-09');
    await page.getByLabel(/^Your reference/).fill('Synthetic transfer 77');
    await page.getByLabel(/^Note for the organiser/).fill('Synthetic paid at the office');
    await page.getByLabel(/I paid this amount to the organiser myself/).check();
    await axe(page);
    await page.getByRole('button', { name: 'Send to the Organiser' }).click();
    await expect(page.getByText('Sent to the organiser.', { exact: false })).toBeVisible();
    expect(seen.posts).toHaveLength(1);
    expect(seen.posts[0]).toMatchObject({
      action: 'declare',
      registrationId,
      currency: 'USD',
      amountMinor: '12550',
      paidOn: '2026-11-09',
      payerReference: 'Synthetic transfer 77',
      note: 'Synthetic paid at the office',
    });
    expect(String(seen.posts[0].commandId)).toMatch(/^[0-9a-f-]{36}$/);
    const post = seen.headers.find((h) => h['content-type']?.includes('json'))!;
    expect(post['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(post['x-corridra-customer-issuer']).toBe(issuer);
  });
  test('bad amounts, a future day and a missing confirmation are stopped before anything is sent', async ({
    page,
  }) => {
    const seen: Seen = { posts: [], headers: [] };
    await mock(page, () => own([]), { seen });
    await page.goto(origin);
    await page.getByText('I Have Paid', { exact: true }).click();
    const send = page.getByRole('button', { name: 'Send to the Organiser' });
    await page.getByLabel('Amount you paid').fill('12.345');
    await page.getByLabel(/I paid this amount/).check();
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Enter the amount you paid');
    await page.getByLabel('Amount you paid').fill('10');
    // A day after today is out of range for the date field itself, so the browser blocks the send.
    await page.getByLabel('Date paid').fill('2999-01-01');
    expect(
      await page
        .getByLabel('Date paid')
        .evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow),
    ).toBe(true);
    await send.click();
    await page.getByLabel('Date paid').fill(today());
    await page.getByLabel(/I paid this amount/).uncheck();
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Confirm that you paid');
    await page.getByLabel(/I paid this amount/).check();
    await page.getByLabel(/^Your reference/).fill('Synthetic ');
    await page.getByLabel(/^Note for the organiser/).fill('no marker here');
    await send.click();
    await expect(page.getByRole('alert')).toContainText('Synthetic');
    expect(seen.posts).toHaveLength(0);
  });
  test('a refused send keeps what was typed and says it was not saved', async ({ page }) => {
    const seen: Seen = { posts: [], headers: [] };
    await mock(page, () => own([]), { seen, failPost: 409 });
    await page.goto(origin);
    await page.getByText('I Have Paid', { exact: true }).click();
    await page.getByLabel('Amount you paid').fill('10');
    await page.getByLabel(/I paid this amount/).check();
    await page.getByRole('button', { name: 'Send to the Organiser' }).click();
    await expect(page.getByRole('alert')).toContainText('changed since you opened it');
    await expect(page.getByLabel('Amount you paid')).toHaveValue('10');
  });
  test('where declarations are switched off nothing is shown', async ({ page }) => {
    await mock(page, () => own([]), { status: 503 });
    await page.goto(origin);
    await expect(page.locator('#fixture')).toBeEmpty();
  });
});

test.describe('organiser: Awaiting Your Check', () => {
  const organiser = (page: Page) => page.goto(origin + '/?c=organiser');
  test('lists what participants say they paid without calling it received', async ({ page }) => {
    await mock(page, () => pending([queued()]));
    await organiser(page);
    await expect(page.getByText('Awaiting Your Check (1)')).toBeVisible();
    const text = await page.locator('#fixture').innerText();
    expect(text).toContain('Synthetic Buyer Alpha says they paid BDT 40000.00 on 2026-11-09');
    expect(text).toContain('not proof of payment');
    expect(text).toContain('changes no amount in your records until you acknowledge it');
    expect(text).toContain('Outstanding in your records for this participant: BDT 120000.00');
    expect(text).not.toContain('—');
    await axe(page);
  });
  test('acknowledging sends the amount received and the date, then refreshes the totals', async ({
    page,
  }) => {
    const seen: Seen = { posts: [], headers: [] };
    let list = [queued()];
    await mock(page, () => pending(list), { seen });
    await organiser(page);
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(page.getByLabel(/^Amount you received/)).toHaveValue('40000.00');
    await expect(page.getByLabel('Date received')).toHaveValue('2026-11-09');
    await page.getByLabel(/^Amount you received/).fill('39000');
    await page.getByRole('button', { name: 'Acknowledge Payment' }).click();
    await expect(page.getByRole('alert')).toContainText('Confirm that you have checked');
    await page.getByLabel(/I checked this against my own records/).check();
    await axe(page);
    list = [];
    await page.getByRole('button', { name: 'Acknowledge Payment' }).click();
    await expect(page.getByText('One payment entry was added', { exact: false })).toBeVisible();
    expect(seen.posts).toHaveLength(1);
    expect(seen.posts[0]).toMatchObject({
      action: 'decide',
      workspaceId,
      programmeId,
      declarationId: declarationA,
      decision: 'ACKNOWLEDGED',
      reason: null,
      receivedAmountMinor: '3900000',
      receivedOn: '2026-11-09',
    });
    expect(await page.evaluate(() => (window as unknown as { __decided: number }).__decided)).toBe(
      1,
    );
  });
  test('not accepting needs a reason, sends it and does not refresh the totals', async ({
    page,
  }) => {
    const seen: Seen = { posts: [], headers: [] };
    let list = [queued()];
    await mock(page, () => pending(list), { seen });
    await organiser(page);
    await page.getByRole('button', { name: 'Not Accepted', exact: true }).click();
    await page.getByRole('button', { name: 'Send Reason' }).click();
    await expect(page.getByRole('alert')).toContainText('at least ten characters');
    await page.getByLabel(/^Reason the participant will read/).fill('Synthetic no such transfer');
    list = [];
    await page.getByRole('button', { name: 'Send Reason' }).click();
    await expect(
      page.getByText('Nothing was added to your records', { exact: false }),
    ).toBeVisible();
    expect(seen.posts[0]).toMatchObject({
      action: 'decide',
      declarationId: declarationA,
      decision: 'REJECTED',
      reason: 'Synthetic no such transfer',
      receivedAmountMinor: null,
      receivedOn: null,
    });
    expect(await page.evaluate(() => (window as unknown as { __decided: number }).__decided)).toBe(
      0,
    );
  });
  test('an empty list or a switched-off feature shows nothing', async ({ page }) => {
    await mock(page, () => pending([]));
    await organiser(page);
    await expect(page.locator('#fixture')).toBeEmpty();
    await page.unroute('**/api/customer-programme-payment-declarations**');
    await mock(page, () => pending([]), { status: 503 });
    await organiser(page);
    await expect(page.locator('#fixture')).toBeEmpty();
  });
  test('at 390 px wide the list needs no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mock(page, () => pending([queued(), queued({ id: declarationB })]));
    await organiser(page);
    await expect(page.getByText('Awaiting Your Check (2)')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
