import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// B9b (ADR-090) on the staff introductions list: the test delivery note of a real email and the one-message send. The
// real component runs against stubbed workspace routes; what the server allows is proved in the integration tests.
const tenant = '00000000-0000-4000-8000-000000000a09';
const waitingEmail = '00000000-0000-4000-8000-000000000901';
const sinkEmail = '00000000-0000-4000-8000-000000000902';
const listEmail = '00000000-0000-4000-8000-000000000903';
const waitingSample = '00000000-0000-4000-8000-000000000904';
const revokedEmail = '00000000-0000-4000-8000-000000000905';
const optedOutEmail = '00000000-0000-4000-8000-000000000906';
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{ControlledAccess}from ${JSON.stringify(resolve('apps/web/app/operator/access.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page"><ControlledAccess tenant=${JSON.stringify(tenant)} revision={0}/></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    // access.tsx draws a country mark (CountryName), whose stylesheet names the flag files by address.
    external: ['/flags/*'],
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const css = `${readFileSync(resolve('apps/web/app/globals.css'), 'utf8')}\n${
    result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
  }`;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(css);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Introductions</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Row = Record<string, unknown>;
const message = (id: string, company: string, extra: Row): Row => ({
  id,
  link_id: `link-${id}`,
  presentation: { company },
  decision: null,
  response_id: null,
  attempts: 0,
  revoked: false,
  expires_at: '2026-12-01T09:00:00Z',
  ...extra,
});
const messages = [
  message(waitingEmail, 'Sample Mill One', { channel: 'EMAIL', delivery_status: 'PENDING' }),
  message(sinkEmail, 'Sample Mill Two', {
    channel: 'EMAIL',
    delivery_status: 'DELIVERED',
    attempts: 1,
    receipt_provider: 'email_test',
    delivery_note: 'Test, not sent',
  }),
  message(listEmail, 'Sample Mill Three', {
    channel: 'EMAIL',
    delivery_status: 'DELIVERED',
    attempts: 1,
    receipt_provider: 'email_test',
    delivery_note: 'Test, sent to a test address only',
  }),
  message(waitingSample, 'Sample Mill Four', { channel: 'SYNTHETIC', delivery_status: 'PENDING' }),
  message(revokedEmail, 'Sample Mill Five', {
    channel: 'EMAIL',
    delivery_status: 'PENDING',
    revoked: true,
  }),
  message(optedOutEmail, 'Sample Mill Six', {
    channel: 'EMAIL',
    delivery_status: 'PENDING',
    contact_opted_out: true,
  }),
];
type Sent = { action: string; body: unknown };
async function open(
  page: Page,
  role: string,
  answer?: (sent: Sent) => { status: number; json: unknown } | undefined,
) {
  const sent: Sent[] = [];
  await page.route('**/api/workspace/**', (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (route.request().method() === 'POST') {
      const entry = { action, body: route.request().postDataJSON() as unknown };
      sent.push(entry);
      return route.fulfill(answer?.(entry) ?? { status: 200, json: { started: [] } });
    }
    return route.fulfill({
      json:
        action === 'communications'
          ? {
              role,
              policies: [],
              templates: [],
              targets: [],
              contacts: [],
              messages,
              optouts: [],
              attempts: [],
              targetsTotal: null,
              targetsNext: null,
              contactsTotal: null,
              contactsNext: null,
              messagesTotal: null,
              messagesNext: null,
              optoutsTotal: null,
              optoutsNext: null,
            }
          : {
              role,
              owners: [],
              meetings: [],
              meetingsTotal: null,
              next: null,
              followupsTotal: null,
              followupsNext: null,
              participants: [],
              outcomes: [],
              followups: [],
              history: [],
            },
    });
  });
  await page.goto(origin);
  await expect(page.locator('article.introduction-card')).toHaveCount(messages.length);
  return sent;
}
const card = (page: Page, company: string) =>
  page.locator('article.introduction-card', { hasText: company });

test('one click on Send This Email posts exactly one message id, and only a waiting real email offers it', async ({
  page,
}) => {
  const sent = await open(page, 'operator');
  const send = page.getByRole('button', { name: /^Send This Email/ });
  // Only the waiting real email offers the send: not a delivered one, and never a sample message.
  await expect(send).toHaveCount(1);
  await expect(
    card(page, 'Sample Mill One').getByRole('button', {
      name: 'Send This Email to Sample Mill One',
      exact: true,
    }),
  ).toBeVisible();
  await expect(card(page, 'Sample Mill One')).toContainText('One click sends this one email only.');
  await expect(card(page, 'Sample Mill Four').getByRole('button')).toHaveCount(1);
  // A waiting real email whose link is revoked, or whose contact opted out, offers no send.
  await expect(card(page, 'Sample Mill Five')).toContainText('Link revoked.');
  for (const company of ['Sample Mill Five', 'Sample Mill Six'])
    await expect(card(page, company).getByRole('button', { name: /^Send This Email/ })).toHaveCount(
      0,
    );
  await expect(
    card(page, 'Sample Mill Four').getByRole('button', { name: 'Revoke Buyer Link' }),
  ).toBeVisible();
  await send.click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText(
    'Delivery work started. Refresh to see its result.',
  );
  expect(sent).toEqual([{ action: 'dispatch', body: { messageId: waitingEmail } }]);
});

test('the test delivery notes read on their cards and the batch action still posts an empty body', async ({
  page,
}) => {
  const sent = await open(page, 'operator');
  await expect(card(page, 'Sample Mill Two')).toContainText('Delivery note: Test, not sent.');
  await expect(card(page, 'Sample Mill Three')).toContainText(
    'Delivery note: Test, sent to a test address only.',
  );
  for (const company of ['Sample Mill One', 'Sample Mill Four'])
    await expect(card(page, company)).not.toContainText('Delivery note');
  await expect(
    page.getByText(
      'This starts sample introductions and manual handoffs only. A real email is sent one at a time with Send This Email on its own card.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dispatch Pending Introductions', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText(
    'Delivery work started. Refresh to see its result.',
  );
  expect(sent).toEqual([{ action: 'dispatch', body: {} }]);
});

test('a refused send shows the reason in plain words and sends nothing else', async ({ page }) => {
  const sent = await open(page, 'operator', () => ({
    status: 409,
    json: { error: 'This message cannot be sent now' },
  }));
  await page.getByRole('button', { name: /^Send This Email/ }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText(
    'This message cannot be sent now',
  );
  expect(sent).toEqual([{ action: 'dispatch', body: { messageId: waitingEmail } }]);
});

test('a viewer reads the delivery notes and is offered no send', async ({ page }) => {
  const sent = await open(page, 'viewer');
  await expect(card(page, 'Sample Mill Two')).toContainText('Delivery note: Test, not sent.');
  await expect(page.getByRole('button', { name: /^Send This Email/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Dispatch Pending Introductions', exact: true }),
  ).toHaveCount(0);
  expect(sent).toEqual([]);
});

for (const width of [390, 768, 1440])
  test(`at ${width} px the send and the notes fit their cards, the send is keyboard reachable and axe is clean`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 'operator');
    const send = page.getByRole('button', { name: /^Send This Email/ });
    await send.focus();
    await expect(send).toBeFocused();
    const box = (await send.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(24);
    for (const one of await page.locator('article.introduction-card').all())
      expect(await one.evaluate((c) => c.scrollWidth <= c.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('article.introduction-card')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  });
