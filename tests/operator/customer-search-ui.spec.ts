import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The customer search (docs/revamp/specs/navigation-v1/customer-search.md): the Search button first in the customer top
// bar and the dialog it opens, mounted as a fixture in the real customer header, rail and tabs with the real stylesheets.
// The answers of /api/customer-search are scripted with page.route, so every state the route can produce is shown; the
// route itself is tested in tests/integration/customer-search-route*.test.ts. Nothing here reads a database.
test.use({ timezoneId: 'UTC', locale: 'en-GB' });
test.setTimeout(120_000);

const r1 = '11111111-1111-4111-8111-111111111111';
const r2 = '22222222-2222-4222-8222-222222222222';
const r3 = '33333333-3333-4333-8333-333333333333';
const company = 'ab'.repeat(32);
const report = '44444444-4444-4444-8444-444444444444';
const workspace = '00000000-0000-4000-8000-0000000000a1';
const bengaliCompany = 'cd'.repeat(32);

type Answer = {
  status?: number;
  json?: unknown;
  delay?: number;
  abort?: boolean;
};
const spain = {
  hits: [
    {
      id: r1,
      label: 'Sell in Spain',
      detail: '',
      href: `/account/requests/${r1}`,
      kind: 'request',
    },
    {
      id: r2,
      label: 'Sell knitwear in Spian',
      detail: '',
      href: `/account/requests/${r2}`,
      kind: 'request',
    },
    {
      id: company,
      label: 'Madrid Textiles SL',
      detail: 'Spain',
      href: `/account/missions/${report}`,
      kind: 'company',
    },
  ],
  scopes: { requests: 'ok', companies: 'ok' },
  facts: {
    [`request:${r1}`]: { sent: '2026-11-12T10:00:00.000Z', status: 'ACTIVE' },
    [`request:${r2}`]: { sent: '2026-11-03T10:00:00.000Z', withdrawn: true, close: true },
    [`company:${company}`]: { reports: 2 },
  },
};
const none = (scopes: Record<string, string> = { requests: 'ok', companies: 'ok' }) => ({
  hits: [],
  scopes,
  facts: {},
});

// The faces of apps/web/app/layout.tsx, so the header is measured with the fonts people see.
const faces = [
  ['--font-newsreader', 'newsreader-latin-variable.woff2', '200 800'],
  ['--font-geist', 'geist-latin-variable.woff2', '100 900'],
  ['--font-geist-mono', 'geist-mono-latin-variable.woff2', '100 900'],
  ['--font-bengali', 'noto-serif-bengali-variable.woff2', '100 900'],
  ['--font-bengali-sans', 'noto-sans-bengali-variable.woff2', '100 900'],
] as const;
const fontCss = faces
  .map(
    ([variable, file, weight]) =>
      `@font-face{font-family:'${file}';src:url(/fonts/${file}) format('woff2');font-weight:${weight};font-display:block}\n:root{${variable}:'${file}'}`,
  )
  .join('\n');

let server: Server, origin: string;
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(path));
  const result = await build({
    stdin: {
      contents: `import{createRoot,hydrateRoot}from'react-dom/client';
import{renderToString}from'react-dom/server';
import{LanguageProvider}from ${source('apps/web/components/language-provider.tsx')};
import{AppHeader}from ${source('apps/web/components/ux/app-header.tsx')};
import{BrandLockup}from ${source('apps/web/components/site-header.tsx')};
import{LeftNavFrame,LeftNavList}from ${source('apps/web/components/ux/left-nav.tsx')};
import{customerTabs}from ${source('apps/web/lib/ux/customer-navigation.ts')};
import{CustomerRailTop,CustomerRailFoot}from ${source('apps/web/components/ux/customer-rail.tsx')};
import*as store from ${source('apps/web/components/ux/customer-bar-store.ts')};
import{CustomerBarIdentityNote}from ${source('apps/web/components/ux/customer-bar-note.tsx')};
const flags=new URLSearchParams(location.search);
const on=(name)=>flags.get(name)!=='off';
store.setCustomerCompanies(on('companies'));
store.setCustomerMove(flags.get('move')==='on');
store.setCustomerBilling(on('billing'));
store.setCustomerNotificationSettings(on('settings'));
store.setCustomerOrganisationProfiles(on('profiles'));
store.setCustomerProblemReports(on('problems'));
const words={navLabel:'Navigation',menuLabel:'Menu',closeLabel:'Close menu',collapseLabel:'Collapse menu',expandLabel:'Expand menu'};
const tabs=customerTabs({companies:on('companies'),move:flags.get('move')==='on'});
const items=tabs.map(t=>({key:t.key,label:t.label,href:t.href,icon:t.icon}));
const view=(show)=>(
  <LanguageProvider offered={[{code:'en',draft:false},{code:'bn',draft:false},{code:'zh',draft:false}]}>
    {show&&flags.get('identity')!=='none'?<CustomerBarIdentityNote subject="synthetic-subject-1" issuer="https://auth.example.invalid/neondb/auth"/>:null}
    <div className="site-shell">
      <AppHeader kind="customer" live={false} notifications brandMark={<BrandLockup/>}/>
      <LeftNavFrame navId="customer-navigation" words={words} nav={<><CustomerRailTop/><LeftNavList id="customer-navigation" label="Navigation" items={items} current="home"/><CustomerRailFoot/></>}>
        <main><h1>Synthetic page</h1><p>Synthetic content</p><button id="outside" type="button">Outside</button></main>
      </LeftNavFrame>
    </div>
  </LanguageProvider>);
const host=document.getElementById('fixture');
// hydrate=on draws the page as a server would and then hydrates it, so the dialog's mounted flag starts false.
if(flags.get('hydrate')==='on')host.innerHTML=renderToString(view(true));
if(flags.get('hold')==='on')await new Promise((done)=>{window.releaseFixture=done});
const root=flags.get('hydrate')==='on'?hydrateRoot(host,view(true)):createRoot(host);
const draw=(show)=>root.render(view(show));
if(flags.get('hydrate')!=='on')draw(true);window.drawIdentity=draw;`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css', '.woff2': 'empty' },
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const globalCss = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  const destination = (title: string) =>
    `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path.startsWith('/fonts/')) {
      response.setHeader('Content-Type', 'font/woff2');
      response.end(readFileSync(resolve('apps/web/app/fonts', basename(path))));
    } else if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(`${fontCss}\n${globalCss}\n${componentCss}`);
    } else if (/^\/account\/(requests|missions)\/[0-9a-f-]{36}$/.test(path)) {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        destination(path.includes('requests') ? 'Request destination' : 'Report destination'),
      );
    } else if (path === '/signin') {
      response.setHeader('Content-Type', 'text/html');
      response.end(destination('Sign in destination'));
    } else if (path === '/account' || path.startsWith('/account/')) {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic customer page</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address unavailable');
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

type Mounted = {
  searches: { q: string; scope: string }[];
  heard: Record<string, string>[];
  next: (answer: Answer) => void;
};
/** Mounts the customer frame at `path`, answering the search with whatever `next` last set. */
async function mount(page: Page, path = '/account', answer: Answer = { json: spain }) {
  let current = answer;
  const searches: Mounted['searches'] = [];
  const heard: Record<string, string>[] = [];
  await page.route('**/api/customer-search', async (route: Route) => {
    const request = route.request();
    searches.push(JSON.parse(request.postData() ?? '{}'));
    heard.push(request.headers());
    const given = current;
    if (given.delay) await new Promise((done) => setTimeout(done, given.delay));
    if (given.abort) return route.abort('failed').catch(() => undefined);
    return route
      .fulfill({ status: given.status ?? 200, json: given.json ?? {} })
      .catch(() => undefined);
  });
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { workspaces: [{ id: workspace, name: 'Synthetic Dhaka Knits' }] } }),
  );
  await page.route('**/api/customer-inbox*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({ json: { user: { name: 'Synthetic Alice', email: 'a@example.invalid' } } }),
  );
  await page.goto(`${origin}${path}`);
  await page.waitForSelector('header.ux-app-header');
  return { searches, heard, next: (value: Answer) => (current = value) } satisfies Mounted;
}
const trigger = (page: Page) => page.getByRole('button', { name: 'Search', exact: true });
const dialogOf = (page: Page) =>
  page.getByRole('dialog', { name: 'Search Requests, Companies and pages' });
const field = (page: Page) =>
  page.getByRole('combobox', { name: 'Search Requests, Companies and pages' });
async function openDialog(page: Page) {
  await trigger(page).click();
  await expect(dialogOf(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}
const options = (page: Page) => dialogOf(page).getByRole('option');
const selectedLabel = (page: Page) =>
  dialogOf(page).locator('[role="option"][aria-selected="true"] strong').innerText();
async function type(page: Page, words: string) {
  await field(page).fill(words);
}
/**
 * Waits for the dialog's opening fade to finish. Axe blends a text colour with the opacity of the element it sits in, so a
 * scan taken while the dialog is still fading in (about 0.8 opaque on a slow runner) sees muted text at 3.2 to 4.2 to 1
 * where the finished dialog has 5.75 to 6.63 to 1. The scan is of the dialog as it stays on screen.
 */
async function steady(page: Page) {
  await dialogOf(page).evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}
/** Waits for the debounce and the answer to settle: the summary line leaves "Searching". */
async function settled(page: Page) {
  await expect(dialogOf(page).locator('.ux-csearch-list')).not.toHaveAttribute('aria-busy', 'true');
}

test.describe('the Search button', () => {
  test('is one real button with the exact name, the dialog popup and no keycap', async ({
    page,
  }) => {
    await mount(page);
    const button = trigger(page);
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    await expect(button).toHaveAttribute('title', 'Search');
    await expect(button).toHaveAttribute('type', 'button');
    await expect(button.locator('kbd')).toHaveCount(0);
    expect(await button.evaluate((node) => node.textContent?.trim())).toBe('Search');
    // First in the tools row, before New Request, and it opens nothing by itself.
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ux-bar-tools > *')).map(
        (node) => node.getAttribute('class') ?? node.tagName,
      ),
    );
    expect(order[0]).toContain('ux-csearch-trigger');
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(0);
  });

  test('is the icon below 64em and the field with the word from 64em', async ({ page }) => {
    await mount(page);
    for (const [width, wide] of [
      [390, false],
      [1023, false],
      [1024, true],
      [1440, true],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => matchMedia('(min-width:64em)').matches)).toBe(wide);
      const box = (await trigger(page).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      if (wide) expect(box.width).toBeGreaterThanOrEqual(176);
      else {
        // Below 64em it is a fixed 44 by 44 px target with a fixed 24 px glyph, so larger text cannot grow it.
        expect(box.width).toBeCloseTo(44, 1);
        expect(box.height).toBeCloseTo(44, 1);
        const glyph = (await trigger(page).locator('svg').boundingBox())!;
        expect([glyph.width, glyph.height]).toEqual([24, 24]);
      }
      // The word is on screen only in the field; the name is the same either way.
      const word = await trigger(page)
        .locator('span')
        .evaluate((node) => node.getBoundingClientRect().width);
      if (wide) expect(word).toBeGreaterThan(20);
      else expect(word).toBeLessThanOrEqual(1);
      expect(await trigger(page).evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe(
        '0px',
      );
    }
  });
});

test.describe('positive: Requests, Companies and Pages', () => {
  test('P1: finds a Request by its title, marks the words, and Enter opens it by a full page load', async ({
    page,
  }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    // Marked words are text nodes in <mark>.
    await expect(dialogOf(page).locator('mark').first()).toHaveText(/spain/i);
    await expect(options(page).first()).toContainText('Sent 12 Nov 2026 · Status: Find');
    await expect(options(page).first()).toContainText('Request');
    // The close match is told, and a withdrawn Request is shown with its chip and its line.
    const close = options(page).filter({ hasText: 'Sell knitwear in Spian' });
    await expect(close).toContainText('Close match');
    await expect(close).toContainText('Withdrawn');
    await expect(close).toContainText('Sent 3 Nov 2026 · You withdrew this request');
    expect(mounted.searches).toEqual([{ q: 'spain', scope: 'all' }]);
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(() => ((window as unknown as { alive: boolean }).alive = true));
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/account/requests/${r1}`);
    await expect(page.getByRole('heading', { name: 'Request destination' })).toBeVisible();
    // A new document: the marker of the old one is gone.
    expect(
      await page.evaluate(() => (window as unknown as { alive?: boolean }).alive),
    ).toBeUndefined();
  });

  test('P2: finds a Company by name; its detail counts only the reports found and it opens the report page', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'madrid');
    const row = options(page).filter({ hasText: 'Madrid Textiles SL' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Spain · 2 approved reports found');
    await expect(row).toContainText('Company');
    await expect(row).toHaveAttribute('href', `/account/missions/${report}`);
    await row.click();
    await page.waitForURL(`${origin}/account/missions/${report}`);
  });

  test('every hit is a real link, so a middle click or a copied address works', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    const tags = await options(page).evaluateAll((nodes) =>
      nodes.map((node) => `${node.tagName}:${node.getAttribute('href')}`),
    );
    expect(tags[0]).toBe(`A:/account/requests/${r1}`);
    expect(tags.every((tag) => tag.startsWith('A:/'))).toBe(true);
  });

  test('a hit that is not an address of this page is never shown or opened', async ({ page }) => {
    await mount(page, '/account', {
      json: {
        hits: [
          { id: r1, label: 'Evil', detail: '', href: 'https://evil.example/x', kind: 'request' },
          {
            id: r3,
            label: 'Sell in Spain',
            detail: '',
            href: `/account/requests/${r3}`,
            kind: 'request',
          },
        ],
        scopes: { requests: 'ok', companies: 'ok' },
        facts: { [`request:${r3}`]: { sent: '2026-11-12T10:00:00.000Z' } },
      },
    });
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await expect(dialogOf(page)).not.toContainText('Evil');
  });

  test('text from a hit is never HTML', async ({ page }) => {
    await mount(page, '/account', {
      json: {
        hits: [
          {
            id: r1,
            label: '<img src=x onerror="window.pwned=1"> Sell in Spain',
            detail: '',
            href: `/account/requests/${r1}`,
            kind: 'request',
          },
        ],
        scopes: { requests: 'ok', companies: 'ok' },
        facts: { [`request:${r1}`]: { sent: '2026-11-12T10:00:00.000Z' } },
      },
    });
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toContainText('<img src=x onerror=');
    await expect(dialogOf(page).locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
    ).toBeUndefined();
  });

  test('Bengali and Chinese names keep their vowel signs, are marked and carry their language', async ({
    page,
  }) => {
    await mount(page, '/account', {
      json: {
        hits: [
          {
            id: bengaliCompany,
            label: 'ঢাকা নিটওয়্যার',
            detail: 'বাংলাদেশ',
            href: `/account/missions/${report}`,
            kind: 'company',
          },
          {
            id: 'ef'.repeat(32),
            label: '上海纺织',
            detail: 'China',
            href: `/account/missions/${report}`,
            kind: 'company',
          },
        ],
        scopes: { requests: 'ok', companies: 'ok' },
        facts: {
          [`company:${bengaliCompany}`]: { reports: 1 },
          [`company:${'ef'.repeat(32)}`]: { reports: 1 },
        },
      },
    });
    await openDialog(page);
    await type(page, 'ঢাকা');
    const row = options(page).first();
    await expect(row.locator('strong')).toHaveAttribute('lang', 'bn');
    await expect(row.locator('mark').first()).toHaveText('ঢাকা');
    await expect(options(page).nth(1).locator('strong')).toHaveAttribute('lang', 'zh');
  });
});

test.describe('positive: Pages', () => {
  test('P3: with nothing typed the tabs and New Request are listed under their heading, nothing is sent', async ({
    page,
  }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await expect(
      dialogOf(page).getByText('Pages you can open', { exact: true }).first(),
    ).toBeVisible();
    await expect(options(page)).toHaveCount(6);
    const labels = await options(page).locator('strong').allInnerTexts();
    expect(labels).toEqual(['Home', 'Requests', 'Companies', 'Meetings', 'Reports', 'New Request']);
    await expect(dialogOf(page)).toContainText(
      'Type at least 2 letters to search your Requests and Companies.',
    );
    expect(mounted.searches).toEqual([]);
  });

  test('P3: Companies is absent when its module is off, and a Coming soon item is never a hit', async ({
    page,
  }) => {
    await mount(page, '/account?companies=off&billing=off&settings=off&profiles=off&problems=off');
    await openDialog(page);
    expect(await options(page).locator('strong').allInnerTexts()).toEqual([
      'Home',
      'Requests',
      'Meetings',
      'Reports',
      'New Request',
    ]);
    await field(page).click();
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const all = await options(page).locator('strong').allInnerTexts();
    expect(all).not.toContain('Companies');
    for (const soon of [
      'Plan and Billing',
      'Notification Settings',
      'Company Profile',
      'Report a Problem',
    ])
      expect(all, soon).not.toContain(soon);
    await type(page, 'billing');
    await expect(dialogOf(page)).toContainText('No match for “billing”');
  });

  test('P3: the links of the account and help menus are found and open the shell address', async ({
    page,
  }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await type(page, 'billing');
    const row = options(page).filter({ hasText: 'Plan and Billing' });
    await expect(row).toHaveAttribute('href', '/account/billing');
    await expect(row).toContainText('Account menu');
    await expect(row).toContainText('Page');
    await type(page, 'privacy');
    await expect(options(page).first()).toHaveAttribute('href', '/privacy');
    await type(page, 'report a problem');
    await expect(options(page).first()).toHaveAttribute(
      'href',
      '/account/problem-reports/new?from=%2Faccount',
    );
    // Pages never reach the server.
    expect(mounted.searches).toEqual([]);
  });

  test('Pages still filter with one letter, and the server is not asked', async ({ page }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await type(page, 'h');
    await page.waitForTimeout(700);
    await expect(options(page).first()).toBeVisible();
    expect(mounted.searches).toEqual([]);
  });

  test('Requests and Companies scopes list only their own page when nothing is typed', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    expect(await options(page).locator('strong').allInnerTexts()).toEqual(['Requests']);
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    expect(await options(page).locator('strong').allInnerTexts()).toEqual(['Companies']);
  });
});

test.describe('keyboard', () => {
  test('P4: scopes cycle with Tab and Shift+Tab, focus stays in the field, the chips say which is pressed', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    const pressed = () =>
      dialogOf(page)
        .getByRole('group', { name: 'Search in' })
        .locator('button[aria-pressed="true"]')
        .innerText();
    expect(await pressed()).toBe('All');
    for (const name of ['Requests', 'Companies', 'Pages', 'All']) {
      await page.keyboard.press('Tab');
      expect(await pressed()).toBe(name);
      await expect(field(page)).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    expect(await pressed()).toBe('Pages');
    await expect(dialogOf(page).locator('[role="status"]')).toHaveText('Search in Pages', {
      timeout: 3000,
    });
  });

  test('P4: Up and Down stop at the ends, Enter opens the selected row', async ({ page }) => {
    await mount(page);
    await openDialog(page);
    const labels = ['Home', 'Requests', 'Companies', 'Meetings', 'Reports', 'New Request'];
    expect(await selectedLabel(page)).toBe('Home');
    await page.keyboard.press('ArrowUp');
    expect(await selectedLabel(page)).toBe('Home');
    for (const label of labels.slice(1)) {
      await page.keyboard.press('ArrowDown');
      expect(await selectedLabel(page)).toBe(label);
    }
    await page.keyboard.press('ArrowDown');
    expect(await selectedLabel(page)).toBe('New Request');
    await field(page).press('ArrowUp');
    await field(page).press('ArrowUp');
    await field(page).press('ArrowUp');
    await field(page).press('ArrowUp');
    expect(await selectedLabel(page)).toBe('Requests');
    await expect(field(page)).toHaveAttribute(
      'aria-activedescendant',
      (await dialogOf(page).locator('[aria-selected="true"]').getAttribute('id'))!,
    );
  });

  test('P4: Escape closes and clears, and focus returns to the button even when a click did not focus it', async ({
    page,
  }) => {
    await mount(page);
    // A click that gives no focus (Safari does this to buttons).
    await trigger(page).evaluate((node) => (node as HTMLButtonElement).click());
    await expect(dialogOf(page)).toBeVisible();
    await type(page, 'spain');
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await trigger(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(dialogOf(page).getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('P4: Ctrl K and Command K open it from anywhere, and an open dialog is not stacked', async ({
    page,
  }) => {
    await mount(page);
    await page.locator('#outside').focus();
    await page.keyboard.press('Control+K');
    await expect(dialogOf(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Control+K');
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#outside')).toBeFocused();
    await page.keyboard.press('Meta+K');
    await expect(dialogOf(page)).toBeVisible();
  });

  test('Ctrl K is ignored while another modal dialog is open', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => {
      const other = document.createElement('dialog');
      other.setAttribute('aria-label', 'Another dialog');
      other.innerHTML = '<button type="button">Inside</button>';
      document.body.append(other);
      other.showModal();
    });
    await page.keyboard.press('Control+K');
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(0);
  });

  test('Ctrl K pressed before the dialog exists is kept and opens it as soon as it does, with focus in the field', async ({
    page,
  }) => {
    // The fixture holds back its first render, as a slow first load holds back hydration: the script has run, nothing
    // is drawn. Before the fix the key reached no listener and the dialog never opened.
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: { user: null } }));
    await page.goto(`${origin}/account?hold=on`);
    await page.waitForFunction('typeof window.releaseFixture === "function"');
    await expect(page.locator('header.ux-app-header')).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await page.evaluate('window.releaseFixture()');
    await expect(dialogOf(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toBeHidden();
    // One key opens it once: the held request is used up.
    await page.waitForTimeout(300);
    await expect(dialogOf(page)).toBeHidden();
  });

  test('Ctrl K pressed after the server HTML but before hydration is kept, and opens the dialog once it is hydrated', async ({
    page,
  }) => {
    // The page is drawn as a server draws it and hydration is held back: the header is on screen and nothing answers.
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: { user: null } }));
    await page.goto(`${origin}/account?hold=on&hydrate=on`);
    await page.waitForFunction('typeof window.releaseFixture === "function"');
    await expect(page.locator('header.ux-app-header')).toHaveCount(1);
    await expect(dialogOf(page)).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await page.evaluate('window.releaseFixture()');
    await expect(dialogOf(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toBeHidden();
  });

  test('a Ctrl K before the dialog exists does not open over another modal dialog', async ({
    page,
  }) => {
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: { user: null } }));
    await page.goto(`${origin}/account?hold=on`);
    await page.waitForFunction('typeof window.releaseFixture === "function"');
    await page.evaluate(() => {
      const other = document.createElement('dialog');
      other.setAttribute('aria-label', 'Another dialog');
      other.innerHTML = '<button type="button">Inside</button>';
      document.body.append(other);
      other.showModal();
    });
    await page.keyboard.press('Control+K');
    await page.evaluate('window.releaseFixture()');
    await page.waitForSelector('header.ux-app-header');
    await page.waitForTimeout(300);
    await expect(page.locator('dialog.ux-csearch[open]')).toHaveCount(0);
  });

  test('KI-52: Escape then Ctrl K at once reopens it, and the late close event does not close it again', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+K');
    await expect(dialogOf(page)).toBeVisible();
    await page.waitForTimeout(300);
    await expect(dialogOf(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    // And the same through the button.
    await page.keyboard.press('Escape');
    await trigger(page).click();
    await page.waitForTimeout(300);
    await expect(dialogOf(page)).toBeVisible();
  });

  test('a composition Enter does not open a row', async ({ page }) => {
    await mount(page);
    await openDialog(page);
    await page.evaluate(() => {
      const input = document.querySelector('dialog.ux-csearch input')!;
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(dialogOf(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/account');
  });

  test('the backdrop and the Close button close it', async ({ page }) => {
    await mount(page);
    await openDialog(page);
    await dialogOf(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await openDialog(page);
    await page.mouse.click(5, 5);
    await expect(dialogOf(page)).toBeHidden();
  });
});

test.describe('P5: what is not sent', () => {
  test('nothing, one letter and symbols send nothing', async ({ page }) => {
    const mounted = await mount(page);
    await openDialog(page);
    for (const words of ['', 'a', ' ', '!!', 'a ']) {
      await type(page, words);
      await page.waitForTimeout(500);
    }
    expect(mounted.searches).toEqual([]);
    await expect(dialogOf(page)).toContainText('Type at least 2 letters');
  });

  test('typing fast sends one search after the pause, and the Pages scope sends none', async ({
    page,
  }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await field(page).pressSequentially('spain', { delay: 40 });
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    expect(mounted.searches).toEqual([{ q: 'spain', scope: 'all' }]);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await type(page, 'spain again');
    await page.waitForTimeout(700);
    expect(mounted.searches).toHaveLength(1);
  });

  test('one scope is asked for by name', async ({ page }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    expect(mounted.searches).toEqual([{ q: 'spain', scope: 'requests' }]);
    // Under Requests only its hits (and its own page) are listed, never the Companies hit.
    await expect(dialogOf(page)).not.toContainText('Madrid Textiles SL');
  });
});

test.describe('privacy', () => {
  test('the words travel in one POST body only: not in the address, a header, the Referer or a store', async ({
    page,
  }) => {
    await mount(page);
    const seen: { url: string; method: string; type: string; referer?: string; body: string }[] =
      [];
    page.on('request', (request) => {
      if (request.url().includes('/api/'))
        seen.push({
          url: request.url(),
          method: request.method(),
          type: request.headers()['content-type'] ?? '',
          referer: request.headers()['referer'],
          body: request.postData() ?? '',
        });
    });
    await openDialog(page);
    await type(page, 'secretphrase');
    await expect(options(page).first()).toBeVisible();
    await page.waitForTimeout(300);
    const searches = seen.filter((item) => item.url.endsWith('/api/customer-search'));
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      method: 'POST',
      url: `${origin}/api/customer-search`,
      type: 'application/json',
      body: JSON.stringify({ q: 'secretphrase', scope: 'all' }),
    });
    expect(searches[0]!.referer).toBeUndefined();
    for (const item of seen.filter((entry) => !entry.url.endsWith('/api/customer-search')))
      expect(item.url + item.body).not.toContain('secretphrase');
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie,
        address: location.href,
        databases: 'databases' in indexedDB ? undefined : null,
      })),
    ).toMatchObject({ local: 0, session: 0, cookie: '', address: `${origin}/account` });
    // Closing leaves nothing of it in the page either.
    await page.keyboard.press('Escape');
    expect(await page.content()).not.toContain('secretphrase');
  });

  test('the fetch is same-origin, uncached and sends no referrer', async ({ page }) => {
    await mount(page);
    await page.addInitScript(() => {
      const original = window.fetch;
      (window as unknown as { calls: unknown[] }).calls = [];
      window.fetch = (input, init) => {
        if (String(input).includes('customer-search'))
          (window as unknown as { calls: unknown[] }).calls.push({
            credentials: init?.credentials,
            cache: init?.cache,
            referrerPolicy: init?.referrerPolicy,
            method: init?.method,
          });
        return original(input, init);
      };
    });
    await page.reload();
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls)).toEqual([
      {
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        method: 'POST',
      },
    ]);
  });
});

test.describe('the rejection-only identity headers', () => {
  const subject = 'synthetic-subject-1';
  const issuer = 'https://auth.example.invalid/neondb/auth';
  const names = ['x-corridra-customer-subject', 'x-corridra-customer-issuer'] as const;

  test('the headers carry exactly the identity the shell supplied, and never the words, the address or the body', async ({
    page,
  }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await type(page, 'secretphrase');
    await expect(options(page).first()).toBeVisible();
    expect(mounted.heard).toHaveLength(1);
    expect(mounted.heard[0]![names[0]]).toBe(subject);
    expect(mounted.heard[0]![names[1]]).toBe(issuer);
    // The words are in no header, and the identity is in neither the address nor the body.
    expect(JSON.stringify(mounted.heard[0])).not.toContain('secretphrase');
    expect(mounted.searches[0]).toEqual({ q: 'secretphrase', scope: 'all' });
    expect(page.url()).not.toContain(subject);
  });

  test('with no identity (signed out, or the provider could not answer) no identity header is sent', async ({
    page,
  }) => {
    const mounted = await mount(page, '/account?identity=none');
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    expect(mounted.heard).toHaveLength(1);
    for (const name of names) expect(mounted.heard[0]![name]).toBeUndefined();
  });

  test('a change of session clears it: the next search sends none', async ({ page }) => {
    const mounted = await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    expect(mounted.heard[0]![names[0]]).toBe(subject);
    await page.evaluate(() => window.dispatchEvent(new Event('corridra-session-changed')));
    await trigger(page).click();
    await type(page, 'madrid');
    await expect(options(page).first()).toBeVisible();
    expect(mounted.heard).toHaveLength(2);
    for (const name of names) expect(mounted.heard[1]![name]).toBeUndefined();
  });

  test('when the page that supplied it goes away the holder is cleared', async ({ page }) => {
    const mounted = await mount(page);
    await page.evaluate(() =>
      (window as unknown as { drawIdentity: (show: boolean) => void }).drawIdentity(false),
    );
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).first()).toBeVisible();
    for (const name of names) expect(mounted.heard[0]![name]).toBeUndefined();
  });

  test('a conflict (the account changed in another tab) reads as denied, never No match', async ({
    page,
  }) => {
    await mount(page, '/account', { status: 409, json: { error: 'Conflict' } });
    await openDialog(page);
    await type(page, 'spain');
    await expect(dialogOf(page)).toContainText('Your access could not be confirmed.');
    await expect(options(page).filter({ hasText: 'Sign In' })).toBeVisible();
    await expect(dialogOf(page).getByText(/No match/)).toHaveCount(0);
  });

  test('a malformed identity header (400) reads as a failed search with Retry, never No match', async ({
    page,
  }) => {
    await mount(page, '/account', { status: 400, json: { error: 'Bad request' } });
    await openDialog(page);
    await type(page, 'spain');
    await expect(dialogOf(page).getByText('The search did not finish. Try again.')).toBeVisible();
    await expect(options(page).first()).toContainText('Retry');
    await expect(dialogOf(page).getByText(/No match/)).toHaveCount(0);
  });
});

test.describe('denial and failure states: never "No match"', () => {
  async function ask(page: Page, answer: Answer, words = 'spain') {
    const mounted = await mount(page, '/account?from=here', answer);
    await openDialog(page);
    await type(page, words);
    return mounted;
  }
  const noMatch = (page: Page) => dialogOf(page).getByText(/No match/);

  test('D1: signed out says so, offers Sign In without the words, and still lists pages', async ({
    page,
  }) => {
    await ask(page, { status: 401, json: { error: 'Sign in required' } }, 'home');
    await expect(dialogOf(page).getByText('You are signed out', { exact: true })).toBeVisible();
    await expect(dialogOf(page)).toContainText('Sign in again to keep searching.');
    const signIn = options(page).filter({ hasText: 'Sign In' });
    await expect(signIn).toHaveAttribute('href', '/signin?next=%2Faccount%3Ffrom%3Dhere');
    expect(await signIn.getAttribute('href')).not.toContain('home');
    await expect(noMatch(page)).toHaveCount(0);
    expect(await options(page).count()).toBeGreaterThan(1);
    await expect(dialogOf(page).locator('[role="status"]')).toHaveText(
      'You are signed out. Sign in again to keep searching.',
      { timeout: 3000 },
    );
    await signIn.click();
    await page.waitForURL(/\/signin\?next=/);
  });

  test('D5: a closed account has its own block', async ({ page }) => {
    await ask(page, { status: 403, json: { error: 'Closed', code: 'account_closed' } });
    await expect(dialogOf(page).getByText('Your account is closed', { exact: true })).toBeVisible();
    await expect(dialogOf(page)).toContainText(
      'Search is turned off while your account is closed.',
    );
    await expect(noMatch(page)).toHaveCount(0);
    await expect(options(page).filter({ hasText: 'Sign In' })).toHaveCount(0);
  });

  test('a refusal that is not a closed account, and a conflict, ask for a sign in', async ({
    page,
  }) => {
    for (const status of [403, 409]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await ask(page, { status, json: { error: 'No' } });
      await expect(dialogOf(page)).toContainText('Your access could not be confirmed.');
      await expect(options(page).filter({ hasText: 'Sign In' })).toBeVisible();
      await expect(noMatch(page)).toHaveCount(0);
    }
  });

  test('the whole route being unavailable still lists pages', async ({ page }) => {
    await ask(
      page,
      { status: 503, json: { error: 'Search is not available', correlationId: 'x' } },
      'home',
    );
    await expect(dialogOf(page)).toContainText(
      'Search is not available right now. You can still open pages.',
    );
    await expect(noMatch(page)).toHaveCount(0);
    expect(await options(page).count()).toBeGreaterThan(0);
  });

  test('one scope unavailable or archived says so while the other answers', async ({ page }) => {
    await ask(page, {
      json: {
        ...spain,
        hits: [spain.hits[2]],
        scopes: { requests: 'unavailable', companies: 'ok' },
      },
    });
    await expect(options(page).filter({ hasText: 'Madrid Textiles SL' })).toBeVisible();
    await expect(dialogOf(page)).toContainText('Searching Requests is not available right now.');
    await expect(noMatch(page)).toHaveCount(0);
    await field(page).fill('');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await ask(page, {
      json: { hits: [], scopes: { requests: 'archived', companies: 'ok' }, facts: {} },
    });
    await expect(dialogOf(page)).toContainText(
      'Requests cannot be searched while one of your workspaces is archived.',
    );
    await expect(dialogOf(page)).toContainText('No match for “spain” in Companies');
  });

  test('R5: a partial scope says Partial results and Narrow your search, never No match for the words', async ({
    page,
  }) => {
    await ask(page, {
      json: { hits: [], scopes: { requests: 'partial', companies: 'ok' }, facts: {} },
    });
    await expect(dialogOf(page).getByText('Partial results.')).toBeVisible();
    await expect(dialogOf(page)).toContainText(
      'Not every Request was searched. More may exist. Narrow your search or try again.',
    );
    await expect(dialogOf(page)).toContainText('Search was partial');
    await expect(dialogOf(page).getByText(/No match for/)).toHaveCount(0);
  });

  test('a complete search with nothing found says No match, once, with the words', async ({
    page,
  }) => {
    await ask(page, { json: none() }, 'zzzz');
    await expect(dialogOf(page)).toContainText('No match for “zzzz”');
    await expect(dialogOf(page)).toContainText('Try a different spelling or fewer letters.');
    await expect(dialogOf(page)).toContainText('Only Requests you sent are searched.');
    await expect(dialogOf(page).locator('[role="status"]')).toHaveText('No match for zzzz.', {
      timeout: 3000,
    });
  });

  test('R1: a failed search shows Retry first, and Retry sends the same words again', async ({
    page,
  }) => {
    const mounted = await ask(page, { status: 500, json: { error: 'x', correlationId: 'c' } });
    await expect(dialogOf(page).getByText('The search did not finish. Try again.')).toBeVisible();
    await expect(noMatch(page)).toHaveCount(0);
    await expect(options(page).first()).toContainText('Retry');
    await expect(options(page).first()).toContainText('Search again with the same words');
    expect(mounted.searches).toHaveLength(1);
    mounted.next({ json: spain });
    await page.keyboard.press('Enter');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    expect(mounted.searches).toEqual([
      { q: 'spain', scope: 'all' },
      { q: 'spain', scope: 'all' },
    ]);
    await expect(field(page)).toBeFocused();
  });

  test('a limited search (429) is calm, offers Retry first, keeps pages, and Retry after the window works', async ({
    page,
  }) => {
    const mounted = await ask(page, {
      status: 429,
      json: { error: 'Too many searches, try again in a moment', correlationId: 'c' },
    });
    await expect(
      dialogOf(page).getByText('Too many searches just now. Wait a little, then try again.'),
    ).toBeVisible();
    await expect(noMatch(page)).toHaveCount(0);
    await expect(dialogOf(page).getByText('The search did not finish.')).toHaveCount(0);
    await expect(options(page).first()).toContainText('Retry');
    expect(mounted.searches).toHaveLength(1);
    mounted.next({ json: spain });
    await page.keyboard.press('Enter');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    expect(mounted.searches).toEqual([
      { q: 'spain', scope: 'all' },
      { q: 'spain', scope: 'all' },
    ]);
    await expect(noMatch(page)).toHaveCount(0);
  });

  test('a Companies scope held back by the request budget is a calm notice and the Requests still answer', async ({
    page,
  }) => {
    await ask(page, {
      json: {
        hits: spain.hits.filter((hit) => hit.kind === 'request'),
        scopes: { requests: 'ok', companies: 'limited' },
        facts: spain.facts,
      },
    });
    await expect(
      dialogOf(page).getByText(
        'Searching Companies is paused because of too many requests. Try again later.',
      ),
    ).toBeVisible();
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await expect(noMatch(page)).toHaveCount(0);
  });

  test('a hit from sample data carries a Sample chip, and a real one does not', async ({
    page,
  }) => {
    await ask(page, {
      json: {
        ...spain,
        hits: spain.hits.map((hit, n) => (n === 0 ? { ...hit, sample: true } : hit)),
      },
    });
    const first = options(page).filter({ hasText: 'Sell in Spain' });
    await expect(first).toContainText('Sample');
    await expect(options(page).filter({ hasText: 'Madrid Textiles SL' })).not.toContainText(
      'Sample',
    );
  });

  test('R1: an answer that is not an answer is a failed search', async ({ page }) => {
    await ask(page, { json: { hits: 'no' } });
    await expect(options(page).first()).toContainText('Retry');
  });

  test('R1: a slow answer for older words is dropped when newer words answer first', async ({
    page,
  }) => {
    const mounted = await mount(page, '/account', {
      delay: 1500,
      json: { ...spain, hits: [{ ...spain.hits[0], label: 'Old answer' }] },
    });
    await openDialog(page);
    await type(page, 'spa');
    await expect.poll(() => mounted.searches.length).toBe(1);
    mounted.next({ json: spain });
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(dialogOf(page)).not.toContainText('Old answer');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
  });

  test('R2: offline says so and offers Retry', async ({ page, context }) => {
    await mount(page, '/account', { abort: true });
    await openDialog(page);
    await context.setOffline(true);
    await type(page, 'spain');
    await expect(
      dialogOf(page).getByText('You are offline. Check your connection, then try again.'),
    ).toBeVisible();
    await expect(options(page).first()).toContainText('Retry');
    await context.setOffline(false);
  });
});

test.describe('recovery and cleanup', () => {
  test('R3: close and reopen starts clean', async ({ page }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await trigger(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(dialogOf(page)).not.toContainText('Sell in Spain');
    await expect(dialogOf(page)).toContainText('Type at least 2 letters');
  });

  test('R4: a change of session closes the dialog and clears the words and the answer', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('corridra-session-changed')));
    await expect(dialogOf(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    expect(await page.content()).not.toContain('Sell in Spain');
    await trigger(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(dialogOf(page)).not.toContainText('Sell in Spain');
  });

  test('R4: an answer that arrives after the session changed is not shown', async ({ page }) => {
    const mounted = await mount(page, '/account', { delay: 800, json: spain });
    await openDialog(page);
    await type(page, 'spain');
    await expect.poll(() => mounted.searches.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('corridra-session-changed')));
    await page.waitForTimeout(1200);
    expect(await page.content()).not.toContain('Sell in Spain');
    await trigger(page).click();
    await expect(dialogOf(page)).not.toContainText('Sell in Spain');
  });

  test('R4: leaving the page and coming back from the cache forgets the words', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(dialogOf(page)).toBeHidden();
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await trigger(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(dialogOf(page)).not.toContainText('Sell in Spain');
  });

  test('R4: a tab that is hidden forgets the words and the answer but keeps the dialog', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Sell in Spain' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(field(page)).toHaveValue('');
    await expect(dialogOf(page)).not.toContainText('Sell in Spain');
  });

  test('the dialog is gone from the page for a signed out visitor too: the button answers with the sign in message', async ({
    page,
  }) => {
    await mount(page, '/account', { status: 401, json: { error: 'Sign in required' } });
    await openDialog(page);
    await type(page, 'spain');
    await expect(dialogOf(page).getByText('You are signed out', { exact: true })).toBeVisible();
  });
});

test.describe('accessibility', () => {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
  test('axe is clean on the header with the button and on the open dialog in every state', async ({
    page,
  }) => {
    const mounted = await mount(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const header = await new AxeBuilder({ page })
        .include('header.ux-app-header')
        .withTags(tags)
        .analyze();
      expect(
        header.violations.map((item) => item.id),
        `header ${width}`,
      ).toEqual([]);
    }
    await openDialog(page);
    const states: [string, Answer, string][] = [
      ['empty', { json: spain }, ''],
      ['hits', { json: spain }, 'spain'],
      ['nomatch', { json: none() }, 'zzzz'],
      ['partial', { json: none({ requests: 'partial', companies: 'ok' }) }, 'zzzz'],
      ['signedout', { status: 401, json: {} }, 'spain'],
      ['failed', { status: 500, json: {} }, 'spain'],
    ];
    for (const [name, answer, words] of states) {
      mounted.next(answer);
      await type(page, words);
      if (words) await page.waitForTimeout(600);
      await settled(page);
      await steady(page);
      const result = await new AxeBuilder({ page })
        .include('dialog.ux-csearch')
        .withTags(tags)
        .analyze();
      expect(
        result.violations.map(
          (item) => `${item.id}: ${item.nodes.map((node) => node.html.slice(0, 80)).join(' | ')}`,
        ),
        name,
      ).toEqual([]);
    }
  });

  test('the dialog is named, the field is a combobox, rows are options and chips say pressed', async ({
    page,
  }) => {
    await mount(page);
    await openDialog(page);
    await expect(dialogOf(page)).toHaveAttribute('lang', 'en');
    await expect(field(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(field(page)).toHaveAttribute('maxlength', '80');
    await expect(field(page)).toHaveAttribute('autocomplete', 'off');
    await expect(field(page)).toHaveAttribute('placeholder', 'Search Requests and Companies');
    await expect(dialogOf(page).getByRole('listbox', { name: 'Pages you can open' })).toBeVisible();
    await type(page, 'spain');
    await expect(dialogOf(page).getByRole('listbox', { name: 'Results' })).toBeVisible();
    await expect(dialogOf(page).getByRole('group', { name: 'Search in' })).toBeVisible();
    for (const name of ['All', 'Requests', 'Companies', 'Pages'])
      await expect(dialogOf(page).getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        /true|false/,
      );
    // Selection is a tint, a bar and the Enter keycap, never colour alone.
    const row = options(page).first();
    const [bar, enter] = await Promise.all([
      row.evaluate((node) => getComputedStyle(node).boxShadow),
      row.locator('.ux-csearch-enter').evaluate((node) => getComputedStyle(node).visibility),
    ]);
    expect(bar).not.toBe('none');
    expect(enter).toBe('visible');
  });
});

/** The numbers of the header at one width and text size: for the table and for the assertions. */
async function headerNumbers(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header.ux-app-header')!.getBoundingClientRect();
    const box = (selector: string) => {
      const node = Array.from(document.querySelectorAll(selector)).find(
        (item) => item.getBoundingClientRect().width > 0,
      );
      const rect = node?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null;
    };
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      header: {
        left: header.left,
        right: header.right,
        top: header.top,
        bottom: header.bottom,
        height: header.height,
      },
      search: box('header .ux-csearch-trigger'),
      newRequest: box('header .ux-bar-new-narrow'),
      avatar: box('header .ux-util-avatar > button, header [aria-label="Account menu"]'),
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
}

test.describe('header geometry (M4)', () => {
  for (const text of [100, 200]) {
    for (const width of [320, 390, 768, 1024, 1440]) {
      test(`${width} wide at ${text}% text: no sideways scroll, a 44 px button inside the header, nothing pushed off`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await mount(page);
        if (text !== 100)
          await page.addStyleTag({ content: `html{font-size:${text}% !important}` });
        await page.waitForTimeout(250);
        const numbers = await headerNumbers(page);
        console.log(
          `GEOMETRY ${width} @${text}%: header ${Math.round(numbers.header.height)}px, search ${Math.round(numbers.search!.width)}x${Math.round(numbers.search!.height)} at ${Math.round(numbers.search!.left)},${Math.round(numbers.search!.top)}, doc ${numbers.scrollWidth}`,
        );
        expect(numbers.scrollWidth).toBeLessThanOrEqual(numbers.viewport);
        expect(numbers.search!.width).toBeGreaterThanOrEqual(44);
        expect(numbers.search!.height).toBeGreaterThanOrEqual(44);
        // Everywhere but the field (1024 px and wider at normal text) it is a fixed 44 by 44 px target with a 24 px
        // glyph at every text size: the root font size must not grow it.
        if (width < 1024 || text !== 100) {
          expect(numbers.search!.width).toBeCloseTo(44, 1);
          expect(numbers.search!.height).toBeCloseTo(44, 1);
          const glyph = (await trigger(page).locator('svg').boundingBox())!;
          expect([glyph.width, glyph.height]).toEqual([24, 24]);
        }
        expect(numbers.search!.left).toBeGreaterThanOrEqual(numbers.header.left - 0.5);
        expect(numbers.search!.right).toBeLessThanOrEqual(numbers.header.right + 0.5);
        // At 200% text from 1024 px the fixed 4 rem header already clips a wrapped second row on main (recorded, not
        // fixed here); everywhere else the button is wholly inside the header's height.
        if (text === 100 || width < 1024) {
          expect(numbers.search!.top).toBeGreaterThanOrEqual(numbers.header.top - 0.5);
          expect(numbers.search!.bottom).toBeLessThanOrEqual(numbers.header.bottom + 0.5);
        }
        // New Request (a phone control) and the account menu stay on the screen sideways.
        if (numbers.newRequest) {
          expect(numbers.newRequest.right).toBeLessThanOrEqual(numbers.viewport + 0.5);
          expect(numbers.newRequest.left).toBeGreaterThanOrEqual(-0.5);
        }
        expect(numbers.avatar).not.toBeNull();
        expect(numbers.avatar!.right).toBeLessThanOrEqual(numbers.viewport + 0.5);
        expect(numbers.avatar!.left).toBeGreaterThanOrEqual(-0.5);
        // The Search button comes first in the row of tools.
        const tools = await page.locator('.ux-bar-tools').boundingBox();
        expect(numbers.search!.left).toBeGreaterThanOrEqual(tools!.x - 0.5);
        await page.screenshot({
          path: `/tmp/claude-0/-home-user-corridra/6710c54a-c894-5aa1-98d6-09331b7693f0/scratchpad/squad3/shots/header-${width}-${text}.png`,
          clip: { x: 0, y: 0, width, height: Math.min(360, numbers.header.height + 60) },
        });
      });
    }
  }

  test('768 px with 200% text: Search and the five tools share one line (the header stays 225 px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await mount(page);
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    await page.waitForTimeout(250);
    const centres = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ux-bar-tools > *'))
        .filter((node) => node.getBoundingClientRect().width > 0)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return (rect.top + rect.bottom) / 2;
        }),
    );
    expect(centres).toHaveLength(6);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(44);
    expect((await headerNumbers(page)).header.height).toBeLessThanOrEqual(225);
  });

  test('1024 and wider: the field starts at the page column and the other tools stay at the right edge', async ({
    page,
  }) => {
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await mount(page);
      await page.waitForTimeout(200);
      const [search, heading, avatar] = await Promise.all([
        trigger(page).boundingBox(),
        page.locator('main h1').boundingBox(),
        page.getByRole('button', { name: 'Account menu', exact: true }).boundingBox(),
      ]);
      expect(Math.abs(search!.x - heading!.x), `${width}`).toBeLessThanOrEqual(1);
      expect(avatar!.x + avatar!.width).toBeGreaterThan(width - 40);
      expect(search!.width).toBeGreaterThanOrEqual(176);
      expect(search!.width).toBeLessThanOrEqual(560);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('the phone has no bottom tab bar, the drawer lists the five destinations, and the left bar is as it was', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page);
    await expect(page.getByRole('navigation', { name: 'Customer tabs' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const drawer = page.getByRole('navigation', { name: 'Navigation' });
    await expect(drawer.getByRole('link')).toHaveCount(5);
    for (const box of await drawer
      .getByRole('link')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(44);
    await expect(drawer.locator('[aria-current]')).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(
      page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name: 'Home' }),
    ).toBeVisible();
  });
});

test.describe('the dialog panel', () => {
  async function openAt(page: Page, width: number, height: number, text: number, words = 'spain') {
    await page.setViewportSize({ width, height });
    await mount(page);
    if (text !== 100) await page.addStyleTag({ content: `html{font-size:${text}% !important}` });
    await openDialog(page);
    if (words) {
      await type(page, words);
      await expect(options(page).first()).toBeVisible();
    }
    await page.waitForTimeout(350);
  }
  const measure = (page: Page) =>
    page.evaluate(() => {
      const panel = document.querySelector('dialog.ux-csearch')!;
      const rect = panel.getBoundingClientRect();
      const hint = document.querySelector('.ux-csearch-hint')!;
      const hintRect = hint.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        top: rect.top,
        bottom: rect.bottom,
        viewport: document.documentElement.clientWidth,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        hintBottom: hintRect.bottom,
        hintWhole: hint.scrollHeight <= hint.clientHeight + 1,
        scrolls: panel.scrollHeight > panel.clientHeight + 1,
        scrollTop: panel.scrollTop,
        sideways: document.documentElement.scrollWidth,
      };
    });

  for (const [width, height, text] of [
    [320, 640, 100],
    [390, 844, 100],
    [320, 640, 200],
    [390, 844, 200],
  ] as const) {
    test(`under 640: ${width}x${height} at ${text}%: the panel is the viewport less 1 rem and the footer line is whole`, async ({
      page,
    }) => {
      await openAt(page, width, height, text);
      const m = await measure(page);
      console.log(`PANEL ${width}x${height} @${text}%: ${JSON.stringify(m)}`);
      expect(m.width).toBeCloseTo(m.viewport - m.rem, 0);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right).toBeLessThanOrEqual(m.viewport + 0.5);
      expect(m.sideways).toBeLessThanOrEqual(m.viewport);
      expect(m.hintWhole).toBe(true);
      if (!m.scrolls) expect(m.hintBottom).toBeLessThanOrEqual(m.bottom + 0.5);
      await page.screenshot({
        path: `/tmp/claude-0/-home-user-corridra/6710c54a-c894-5aa1-98d6-09331b7693f0/scratchpad/squad3/shots/dialog-${width}x${height}-${text}.png`,
      });
    });
  }

  test('the panel scrolls when the fixed parts leave less than 8 rem, so a row can be reached (320x640, 200%)', async ({
    page,
  }) => {
    await openAt(page, 320, 640, 200);
    const before = await measure(page);
    expect(before.scrolls).toBe(true);
    const first = options(page).first();
    await first.scrollIntoViewIfNeeded();
    const [panel, row] = await Promise.all([dialogOf(page).boundingBox(), first.boundingBox()]);
    expect(row!.y).toBeGreaterThanOrEqual(panel!.y - 1);
    expect(row!.y + Math.min(row!.height, 40)).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    // The footer is reachable too.
    await dialogOf(page).locator('.ux-csearch-hint').scrollIntoViewIfNeeded();
    const hint = await dialogOf(page).locator('.ux-csearch-hint').boundingBox();
    expect(hint!.y + hint!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    await page.screenshot({
      path: '/tmp/claude-0/-home-user-corridra/6710c54a-c894-5aa1-98d6-09331b7693f0/scratchpad/squad3/shots/dialog-320x640-200-scrolled.png',
    });
  });

  test('desktop: 720 px wide, the list scrolls inside and the footer stays', async ({ page }) => {
    await openAt(page, 1440, 900, 100);
    const m = await measure(page);
    expect(m.width).toBeCloseTo(720, 0);
    expect(m.scrolls).toBe(false);
    expect(m.hintBottom).toBeLessThanOrEqual(m.bottom + 0.5);
    await page.screenshot({
      path: '/tmp/claude-0/-home-user-corridra/6710c54a-c894-5aa1-98d6-09331b7693f0/scratchpad/squad3/shots/dialog-1440-100.png',
    });
  });

  test('every control in the dialog is at least 44 px and no text is under 12 px', async ({
    page,
  }) => {
    await openAt(page, 390, 844, 100);
    const small = await page.evaluate(() => {
      const panel = document.querySelector('dialog.ux-csearch')!;
      const targets = Array.from(panel.querySelectorAll('button, input, [role="option"]'))
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.height > 0 && (rect.height < 44 || rect.width < 44)).length;
      const text = Array.from(panel.querySelectorAll('*')).filter(
        (node) =>
          Array.from(node.childNodes).some(
            (child) => child.nodeType === 3 && child.textContent?.trim(),
          ) && parseFloat(getComputedStyle(node).fontSize) < 12,
      ).length;
      return { targets, text };
    });
    expect(small).toEqual({ targets: 0, text: 0 });
  });
});

// KI-54: the wide field starts at 64em, which reads the browser's own default font size, so emulating a larger root
// font size in the page cannot test it, and a browser profile with a larger default font is not honoured by every
// Chromium build. So this proves what holds in any build: the rule that makes the field is written in em (read back
// from the loaded stylesheet), and the query is true exactly when the window is at least 64 default-size ems wide,
// whatever the default size is. It cannot show the layout under a 32 px default font; the source test pins the rule.
test.describe('the wide field switch is an em query (KI-54)', () => {
  test('the stylesheet rule that makes the field sits inside a (min-width: 64em) media rule, nothing else', async ({
    page,
  }) => {
    await mount(page);
    const rules = await page.evaluate(() => {
      const found: { condition: string; selector: string; text: string }[] = [];
      const visit = (list: CSSRuleList, conditions: string[]) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes('ux-csearch-trigger'))
              found.push({
                condition: conditions.join(' && '),
                selector: rule.selectorText,
                text: rule.style.cssText,
              });
          } else if ('cssRules' in rule)
            visit(
              (rule as CSSGroupingRule).cssRules,
              'conditionText' in rule
                ? [...conditions, String((rule as CSSMediaRule).conditionText)]
                : conditions,
            );
        }
      };
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules, []);
      return found;
    });
    // The field is the rule that caps the width at 35rem and lets the button grow.
    const field = rules.filter((rule) => rule.text.includes('max-width: 35rem'));
    expect(field).toHaveLength(1);
    expect(field[0]!.condition).toBe('(min-width: 64em)');
    expect(field[0]!.text).toContain('flex: 1 1 0');
    // No rule outside that query grows the button or caps its width: below 64em it is the fixed icon.
    const button = '.ux-customer-header .ux-csearch-trigger';
    for (const rule of rules.filter((item) => item !== field[0] && item.selector === button)) {
      expect(rule.text, `${rule.selector} in ${rule.condition}`).not.toContain('max-width: 35rem');
      expect(rule.text, `${rule.selector} in ${rule.condition}`).not.toMatch(/flex:\s*1 1 0/);
    }
    // And no condition on the trigger switches on a pixel or rem minimum width, except the one that only narrows the icon
    // state and is itself closed by the em query (max-width: 63.99em).
    for (const rule of rules)
      if (/min-width:\s*[\d.]+(?:px|rem)/.test(rule.condition))
        expect(rule.condition, rule.selector).toContain('(max-width: 63.99em)');
  });

  test('the query matches exactly when the window is 64 default-size ems wide, at 1023, 1024 and 1440 px', async ({
    page,
  }) => {
    await mount(page);
    for (const width of [1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const read = await page.evaluate(() => {
        // `medium` is the browser's default font size, whatever the page sets on html.
        const probe = document.createElement('div');
        probe.style.fontSize = 'medium';
        document.body.append(probe);
        const em = parseFloat(getComputedStyle(probe).fontSize);
        probe.remove();
        return {
          em,
          wide: matchMedia('(min-width:64em)').matches,
          width: document.documentElement.clientWidth,
        };
      });
      expect(read.wide, `${width} px with a default size of ${read.em} px`).toBe(
        read.width >= 64 * read.em,
      );
      // The button is the field exactly when the query is true, and the fixed icon otherwise.
      const box = (await trigger(page).boundingBox())!;
      if (read.wide) expect(box.width).toBeGreaterThanOrEqual(176);
      else {
        expect(box.width).toBeCloseTo(44, 1);
        expect(box.height).toBeCloseTo(44, 1);
      }
    }
  });

  test('a larger root font size in the page does not move the query', async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 });
    await mount(page);
    const before = await page.evaluate(() => matchMedia('(min-width:64em)').matches);
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    expect(await page.evaluate(() => matchMedia('(min-width:64em)').matches)).toBe(before);
  });
});

test.describe('the approved Companies scope expires, as on the Companies page', () => {
  const companies = (expiresAt: string | null) => ({
    ...spain,
    expiresAt,
  });
  async function ask(page: Page, expiresAt: string | null) {
    await page.clock.install();
    const mounted = await mount(page, '/account', { json: companies(expiresAt) });
    await openDialog(page);
    await type(page, 'spain');
    await expect(options(page).filter({ hasText: 'Madrid Textiles SL' })).toBeVisible();
    return mounted;
  }
  const requestRow = (page: Page) => options(page).filter({ hasText: 'Sell in Spain' });
  const companyRow = (page: Page) => options(page).filter({ hasText: 'Madrid Textiles SL' });
  const cleared = 'Company results were cleared. Search again to load them.';

  test('with no expiry the companies stay for a minute and then go, with a calm notice; Requests and pages stay', async ({
    page,
  }) => {
    await ask(page, null);
    await page.clock.fastForward(58_000);
    await expect(companyRow(page)).toBeVisible();
    await expect(dialogOf(page).getByText(cleared)).toHaveCount(0);
    await page.clock.fastForward(3_000);
    await expect(companyRow(page)).toHaveCount(0);
    await expect(requestRow(page)).toBeVisible();
    await expect(dialogOf(page).getByText(cleared)).toBeVisible();
    await expect(dialogOf(page).getByText(/No match/)).toHaveCount(0);
    await expect(options(page).first()).toContainText('Retry');
  });

  test('an expiry sooner than a minute clears them at that moment', async ({ page }) => {
    await ask(page, new Date(Date.now() + 10_000).toISOString());
    await page.clock.fastForward(5_000);
    await expect(companyRow(page)).toBeVisible();
    await page.clock.fastForward(6_000);
    await expect(companyRow(page)).toHaveCount(0);
    await expect(requestRow(page)).toBeVisible();
    await expect(dialogOf(page).getByText(cleared)).toBeVisible();
  });

  test('an expiry later than a minute does not keep them longer than a minute', async ({
    page,
  }) => {
    await ask(page, new Date(Date.now() + 3_600_000).toISOString());
    await page.clock.fastForward(59_000);
    await expect(companyRow(page)).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect(companyRow(page)).toHaveCount(0);
  });

  test('searching again loads them again, and the minute starts over', async ({ page }) => {
    const mounted = await ask(page, null);
    await page.clock.fastForward(61_000);
    await expect(companyRow(page)).toHaveCount(0);
    mounted.next({ json: companies(null) });
    await page.keyboard.press('Enter');
    await expect(companyRow(page)).toBeVisible();
    await expect(dialogOf(page).getByText(cleared)).toHaveCount(0);
    await page.clock.fastForward(30_000);
    await expect(companyRow(page)).toBeVisible();
    expect(mounted.searches).toHaveLength(2);
  });

  test('a search with only Requests has nothing to clear', async ({ page }) => {
    await page.clock.install();
    await mount(page, '/account', {
      json: { ...spain, hits: spain.hits.filter((hit) => hit.kind === 'request'), expiresAt: null },
    });
    await openDialog(page);
    await type(page, 'spain');
    await expect(requestRow(page)).toBeVisible();
    await page.clock.fastForward(120_000);
    await expect(requestRow(page)).toBeVisible();
    await expect(dialogOf(page).getByText(cleared)).toHaveCount(0);
  });
});
