import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The two screens of Pulse (Lane 7 of the UX update), mounted with the real stylesheets and the interface
// answered by the test: the email choices page (which messages, one email a day, quiet hours, time zone,
// language) and the page an email's mute link opens. No database, no customer, no email.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const requestId = '6f1d3a52-8c1e-4b3a-9d7e-2f4a5b6c7d8e';
const token = 'A'.repeat(43);

const initial = (over: Record<string, unknown> = {}) => ({
  kinds: ['your-move', 'update', 'countdown', 'complete'],
  digest: false,
  quietStart: null,
  quietEnd: null,
  timeZone: 'UTC',
  language: null,
  version: 0,
  open: true,
  synthetic: false,
  ...over,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{NotificationsForm}from ${JSON.stringify(resolve('apps/web/app/account/notifications/notifications-form.tsx'))};
      import{MuteForm}from ${JSON.stringify(resolve('apps/web/app/pulse/mute/[requestId]/mute-form.tsx'))};
      const query=new URLSearchParams(location.search);
      const props=JSON.parse(query.get('props')||'{}');
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Email choices</h1>{query.get('screen')==='mute'
          ?<MuteForm requestId=${JSON.stringify(requestId)}/>
          :<NotificationsForm initial={props.initial} unavailable={!!props.unavailable}/>}</main>);`,
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
    plugins: [
      {
        name: 'next-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function openChoices(
  page: Page,
  props: Record<string, unknown> = { initial: initial() },
  answer?: { status: number; body: unknown },
) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/pulse/preferences', async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({
      status: answer?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer?.body ?? { saved: true, version: 1 }),
    });
  });
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(props))}`);
  await expect(page.getByRole('heading', { name: 'Email choices' })).toBeVisible();
  return sent;
}

test.describe('email choices', () => {
  test('shows every message kind, the daily email, quiet hours, the time zone and the language', async ({
    page,
  }) => {
    await openChoices(page);
    for (const label of [
      'One thing needs you',
      'Your request moved forward',
      'A date is coming up',
      'Your mission is complete',
    ])
      await expect(page.getByRole('checkbox', { name: new RegExp(label) })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /One email a day/ })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Quiet hours/ })).not.toBeChecked();
    await expect(page.getByLabel('Quiet from')).toHaveCount(0);
    await expect(page.getByLabel('Your time zone')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Language/ })).toHaveValue('en');
    await expect(
      page.getByText('Email is sent in English until a reviewed version exists'),
    ).toBeVisible();
    await expect(
      page.getByText('Every email has a link to mute messages about one request.'),
    ).toBeVisible();
  });

  test('sends exactly what was chosen and says so plainly', async ({ page }) => {
    const sent = await openChoices(page, {
      initial: initial({ timeZone: 'Asia/Dhaka', version: 1 }),
    });
    await page.getByRole('checkbox', { name: /A date is coming up/ }).uncheck();
    await page.getByRole('checkbox', { name: /One email a day/ }).check();
    await page.getByRole('checkbox', { name: /Quiet hours/ }).check();
    await page.getByLabel('Quiet from').fill('21:30');
    await page.getByLabel('Quiet until').fill('06:45');
    await page.getByRole('combobox', { name: /^Language/ }).selectOption('bn');
    await page.getByRole('button', { name: 'Save my choices' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    expect(sent).toEqual([
      {
        kinds: ['your-move', 'update', 'complete'],
        digest: true,
        quietStart: '21:30',
        quietEnd: '06:45',
        timeZone: 'Asia/Dhaka',
        language: 'bn',
      },
    ]);
  });

  test('leaves quiet hours out of the request when they are off', async ({ page }) => {
    const sent = await openChoices(page, {
      initial: initial({ quietStart: '22:00', quietEnd: '07:00', version: 2 }),
    });
    await expect(page.getByLabel('Quiet from')).toHaveValue('22:00');
    await page.getByRole('checkbox', { name: /Quiet hours/ }).uncheck();
    await page.getByRole('button', { name: 'Save my choices' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    expect(sent[0]).toMatchObject({ quietStart: null, quietEnd: null });
  });

  test('shows a refusal in words and a closed database as nothing saved', async ({ page }) => {
    await openChoices(
      page,
      { initial: initial() },
      { status: 400, body: { error: 'Pick a time zone from the list' } },
    );
    await page.getByRole('button', { name: 'Save my choices' }).click();
    await expect(page.getByRole('alert')).toHaveText('Pick a time zone from the list');
    const other = await page.context().newPage();
    await openChoices(
      other,
      { initial: initial() },
      { status: 200, body: { saved: false, reason: 'closed' } },
    );
    await other.getByRole('button', { name: 'Save my choices' }).click();
    await expect(other.getByRole('alert')).toHaveText(
      'Email is not switched on yet, so nothing was saved.',
    );
  });

  test('while email is not switched on, the choices can be read but not changed', async ({
    page,
  }) => {
    await openChoices(page, { initial: initial({ open: false }) });
    await expect(page.getByRole('note')).toContainText('not switched on yet');
    await expect(page.getByRole('button', { name: 'Save my choices' })).toBeDisabled();
    for (const box of await page.getByRole('checkbox').all()) await expect(box).toBeDisabled();
  });

  test('says so plainly when the page cannot be read', async ({ page }) => {
    await openChoices(page, { initial: initial(), unavailable: true });
    await expect(page.getByRole('status')).toHaveText(
      'Email choices are not available just now. Please try again later.',
    );
  });

  for (const width of [320, 390, 768, 1440]) {
    test(`at ${width}px nothing scrolls sideways, every target is 44px and there is no accessibility violation`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openChoices(page, {
        initial: initial({ quietStart: '22:00', quietEnd: '07:00', digest: true, version: 1 }),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      for (const control of await page
        .locator('button, select, input[type="time"], .notifications-check')
        .all()) {
        const box = await control.boundingBox();
        expect(box!.height, 'target height').toBeGreaterThanOrEqual(43.5);
        expect(box!.width, 'target width').toBeGreaterThanOrEqual(43.5);
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
      if (width === 320 || width === 1440)
        await page.screenshot({
          path: `docs/design-system/evidence/lane7b-pulse/email-choices-${width}.png`,
          fullPage: true,
        });
    });
  }
});

test.describe('the mute page', () => {
  const openMute = async (page: Page, hash: string, status = 200) => {
    const sent: Record<string, unknown>[] = [];
    await page.route('**/api/pulse/mute', async (route) => {
      sent.push(JSON.parse(route.request().postData() ?? '{}'));
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200 ? { muted: true } : { error: 'This link is not valid or has expired.' },
        ),
      });
    });
    await page.goto(`${origin}/?screen=mute${hash}`);
    return sent;
  };

  test('opening the link does nothing; the button mutes once and the token leaves the address', async ({
    page,
  }) => {
    const sent = await openMute(page, `#t=${token}`);
    await expect(
      page.getByRole('button', { name: 'Mute messages about this request' }),
    ).toBeVisible();
    expect(sent).toEqual([]);
    expect(page.url()).not.toContain(token);
    await page.getByRole('button', { name: 'Mute messages about this request' }).click();
    await expect(page.getByRole('status')).toContainText(
      'We will not send more messages about this request',
    );
    expect(sent).toEqual([{ requestId, token }]);
  });

  test('a link without its token says so, and a refused token says it is not valid', async ({
    page,
  }) => {
    await openMute(page, '');
    await expect(page.getByRole('status')).toContainText('This link is incomplete');
    const other = await page.context().newPage();
    await openMute(other, `#t=${token}`, 400);
    await other.getByRole('button', { name: 'Mute messages about this request' }).click();
    await expect(other.getByRole('alert')).toHaveText('This link is not valid or has expired.');
  });
});
