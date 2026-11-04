import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Wave 6 (docs/revamp/specs/wave6-quality.md), customer surfaces. Each case is named by its Q id. The real
// components are mounted with the real stylesheets and the interface answered by the test: no database, no
// customer, no email. A case that passes on the first run is recorded as "checked, no defect" in the
// verification record; only a case that failed first has a fix behind it.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{NotificationsForm}from ${JSON.stringify(resolve('apps/web/app/account/notifications/notifications-form.tsx'))};
      import{CustomerWorkspaceInvitation}from ${JSON.stringify(resolve('apps/web/app/account/customer-workspace-invitation.tsx'))};
      import{CustomerWorkspaceLeave}from ${JSON.stringify(resolve('apps/web/app/account/customer-workspace-leave.tsx'))};
      const query=new URLSearchParams(location.search);
      const props=JSON.parse(query.get('props')||'{}');
      const screen=query.get('screen');
      window.__events=[];
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Wave 6 fixture</h1>
        {screen==='invite'
          ?<CustomerWorkspaceInvitation subject="synthetic-alice" issuer=${JSON.stringify(issuer)} onJoined={()=>window.__events.push('joined')} onDenied={(s)=>window.__events.push('denied:'+s)}/>
          :screen==='leave'
          ?<CustomerWorkspaceLeave workspace={props.workspace} subject="synthetic-alice" issuer=${JSON.stringify(issuer)} onLeft={(id)=>window.__events.push('left:'+id)} onDenied={(s)=>window.__events.push('denied:'+s)}/>
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
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return "/account"}',
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
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wave 6 fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

// What a browser or a library says when a request cannot finish. None of it may reach a person.
const machineWords =
  /failed to fetch|networkerror|load failed|unexpected token|unexpected end|json|<html/i;
const limitLine = 'The request limit was reached. Try again later.';

const choices = (over: Record<string, unknown> = {}) => ({
  kinds: ['your-move'],
  digest: false,
  quietStart: null,
  quietEnd: null,
  timeZone: 'UTC',
  language: null,
  version: 1,
  open: true,
  synthetic: false,
  ...over,
});
async function openChoices(
  page: Page,
  answer: (route: import('@playwright/test').Route) => unknown,
) {
  const sent: string[] = [];
  await page.route('**/api/pulse/preferences', async (route) => {
    sent.push(route.request().postData() ?? '');
    await answer(route);
  });
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify({ initial: choices() }))}`);
  await expect(page.getByRole('heading', { name: 'Wave 6 fixture' })).toBeVisible();
  return sent;
}
const save = (page: Page) => page.getByRole('button', { name: 'Save my choices' });
const said = (page: Page) => page.locator('form p[role="alert"], form p[role="status"]').last();

test.describe('Q-05 and Q-06 email choices', () => {
  test('Q-05 offline: a request that cannot finish says so in plain words and keeps the choices', async ({
    page,
  }) => {
    await openChoices(page, (route) => route.abort('internetdisconnected'));
    await save(page).click();
    await expect(said(page)).toContainText('not saved');
    await expect(said(page)).not.toHaveText(machineWords);
    await expect(said(page)).toHaveAttribute('role', 'alert');
    await expect(save(page)).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: /One thing needs you/ })).toBeChecked();
  });

  test('Q-05 unavailable: an error page that is not JSON never shows parser words', async ({
    page,
  }) => {
    await openChoices(page, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<html>Service unavailable</html>',
      }),
    );
    await save(page).click();
    await expect(said(page)).toContainText('not saved');
    await expect(said(page)).not.toHaveText(machineWords);
  });

  test('Q-05 429: says the limit was reached and to try later', async ({ page }) => {
    await openChoices(page, (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"x"}' }),
    );
    await save(page).click();
    await expect(said(page)).toHaveText(limitLine);
  });

  test('Q-06 a double click sends one request, the button is disabled and busy while it runs, and the result is announced', async ({
    page,
  }) => {
    const sent = await openChoices(page, async (route) => {
      await new Promise((done) => setTimeout(done, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true, version: 2 }),
      });
    });
    await save(page).dblclick();
    await expect(save(page)).toBeDisabled();
    await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(said(page)).toContainText('Email is on');
    await expect(page.locator('form')).not.toHaveAttribute('aria-busy', 'true');
    expect(sent).toHaveLength(1);
  });
});

const member = { id: '00000000-0000-4000-8000-000000000006', name: 'Synthetic Dhaka Towels' };
async function openLeave(page: Page, status: number | 'abort', body = '{}') {
  let calls = 0;
  await page.route('**/api/customer-workspace-members', async (route) => {
    calls += 1;
    if (status === 'abort') await route.abort('internetdisconnected');
    else await route.fulfill({ status, contentType: 'application/json', body });
  });
  await page.goto(
    `${origin}/?screen=leave&props=${encodeURIComponent(JSON.stringify({ workspace: member }))}`,
  );
  await page.getByRole('button', { name: /^Leave Synthetic Dhaka Towels/ }).click();
  return () => calls;
}

test.describe('Q-05 leaving a team', () => {
  test('Q-05 429: says the limit was reached and to try later, not to repeat at once', async ({
    page,
  }) => {
    await openLeave(page, 429);
    await page.getByRole('button', { name: 'Confirm leaving' }).click();
    await expect(page.getByText(limitLine)).toBeVisible();
  });
});

test.describe('Q-05 joining a team', () => {
  const code = 'A'.repeat(43);
  const open = async (page: Page, status: number | 'abort') => {
    let calls = 0;
    await page.route('**/api/customer-workspace-access', async (route) => {
      calls += 1;
      if (status === 'abort') await route.abort('internetdisconnected');
      else await route.fulfill({ status, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`${origin}/?screen=invite`);
    await page.getByText('Join a workspace', { exact: true }).click();
    await page.getByLabel(/invitation code/i).fill(code);
    await page.getByRole('button', { name: /^Join/ }).click();
    return () => calls;
  };
  test('Q-05 429: says the limit was reached and to try later', async ({ page }) => {
    await open(page, 429);
    await expect(page.getByRole('alert')).toHaveText(limitLine);
  });
  test('Q-05 offline: keeps the code and says the join was not confirmed', async ({ page }) => {
    await open(page, 'abort');
    await expect(page.getByRole('alert')).toContainText('Joining was not confirmed');
    await expect(page.getByRole('alert')).not.toHaveText(machineWords);
    await expect(page.getByLabel(/invitation code/i)).toHaveValue(code);
  });
});

for (const width of [320, 390])
  test(
    'Q-02 and Q-03 the offline and limit states reflow with no sideways scroll and pass axe at ' +
      width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let attempt = 0;
      await openChoices(page, (route) =>
        ++attempt === 1
          ? route.abort('internetdisconnected')
          : route.fulfill({ status: 429, contentType: 'application/json', body: '{}' }),
      );
      for (const words of ['not saved', limitLine]) {
        await save(page).click();
        await expect(said(page)).toContainText(words);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
    },
  );
