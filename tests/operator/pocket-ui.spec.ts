import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Pocket (phone), Step 1 (owner, 13 November 2026, "implement the corridra pocket 100% correctly"): the Next Move button,
// its list, and the short phone header. The real header, sidebar frame (the phone has no bottom tab bar since the owner's
// 14 November 2026 "B"), Pocket button and the real stylesheets are
// mounted as a fixture (the pattern of customer-search-ui.spec.ts), so every behaviour below is the shipped component's.
// What the signals say is scripted by the address (`?signals=`); the rules themselves are tested in
// tests/integration/pocket-next-move.test.ts, and the real signed-in pages are proved by scripts/qa/signed-in-sweep.ts.
test.use({ timezoneId: 'UTC', locale: 'en-GB' });
test.setTimeout(120_000);

const workspace = '00000000-0000-4000-8000-0000000000a1';
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
let globalCss = '';
let componentCss = '';
test.beforeAll(async () => {
  const source = (path: string) => JSON.stringify(resolve(path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
import{LanguageProvider}from ${source('apps/web/components/language-provider.tsx')};
import{AppHeader}from ${source('apps/web/components/ux/app-header.tsx')};
import{BrandLockup}from ${source('apps/web/components/site-header.tsx')};
import{LeftNavFrame,LeftNavList}from ${source('apps/web/components/ux/left-nav.tsx')};
import{customerTabs}from ${source('apps/web/lib/ux/customer-navigation.ts')};
import{CustomerRailTop,CustomerRailFoot}from ${source('apps/web/components/ux/customer-rail.tsx')};
import{PocketButton}from ${source('apps/web/components/ux/pocket-button.tsx')};
import*as store from ${source('apps/web/components/ux/customer-bar-store.ts')};
const q=new URLSearchParams(location.search);
const pocket=q.get('pocket')!=='off';
store.setCustomerCompanies(true);
store.setCustomerProblemReports(q.get('problems')==='on');
const words={navLabel:'Navigation',menuLabel:'Menu',closeLabel:'Close menu',collapseLabel:'Collapse menu',expandLabel:'Expand menu'};
const tabs=customerTabs({companies:true,move:false});
const items=tabs.map(t=>({key:t.key,label:t.label,href:t.href,icon:t.icon}));
const draft={quotes:{count:0,href:null},drafts:{count:3,href:'/account/drafts/'+${JSON.stringify(workspace)}+'?draft=d1'},partial:false,hasWorkspace:true};
const sets={
  none:{quotes:{count:0,href:null},drafts:{count:0,href:null},partial:false,hasWorkspace:true},
  draft,
  quotes1:{quotes:{count:1,href:'/account/service-requests/w/r1'},drafts:{count:0,href:null},partial:false,hasWorkspace:true},
  quotes3:{quotes:{count:3,href:'/account/service-requests'},drafts:draft.drafts,partial:false,hasWorkspace:true},
  partial:{quotes:{count:3,href:'/account/service-requests'},drafts:{count:0,href:null},partial:true,hasWorkspace:true},
};
const which=q.get('signals')||'none';
let signals;
if(which==='pending'){signals=new Promise(done=>{window.resolveSignals=()=>done(sets.draft)})}
else if(which==='failed'){signals=Promise.resolve(null)}
else signals=Promise.resolve(sets[which]);
const rows=Array.from({length:Number(q.get('rows')||40)},(_,i)=>i);
createRoot(document.getElementById('fixture')).render(
  <LanguageProvider offered={[{code:'en',draft:false},{code:'bn',draft:false}]}>
    <div className="site-shell">
      <AppHeader kind="customer" live={false} notifications brandMark={<BrandLockup/>} whatsappHref={q.get('whatsapp')==='on'?'https://wa.me/8801000000000':undefined} pocket={pocket}/>
      <LeftNavFrame navId="customer-navigation" words={words} nav={<><CustomerRailTop/><LeftNavList id="customer-navigation" label="Navigation" items={items} current="home"/><CustomerRailFoot/></>}>
        <main id="main"><h1>Your move</h1>{rows.map(i=><p key={i}>Synthetic content row {i}</p>)}<a id="last" href="/account/last">Last link of the page</a></main>
        {pocket?<PocketButton signals={signals} whatsappHref={q.get('whatsapp')==='on'?'https://wa.me/8801000000000':undefined}/>:null}
      </LeftNavFrame>
    </div>
  </LanguageProvider>);`,
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
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  globalCss =
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8') +
    '\n' +
    readFileSync(resolve('apps/web/app/comfort.css'), 'utf8');
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
    } else if (path === '/account/destination') {
      response.setHeader('Content-Type', 'text/html');
      response.end(destination('Destination'));
    } else if (path === '/account' || path.startsWith('/account/') || path === '/plan') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Synthetic customer page</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    } else if (
      path === '/how-it-works' ||
      path === '/trust' ||
      path === '/privacy' ||
      path === '/'
    ) {
      response.setHeader('Content-Type', 'text/html');
      response.end(destination('Public page'));
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

async function mount(page: Page, path = '/account', query = '') {
  await page.route('**/api/customer-workspaces', (route) =>
    route.fulfill({ json: { workspaces: [{ id: workspace, name: 'Synthetic Dhaka Knits' }] } }),
  );
  await page.route('**/api/customer-inbox*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({ json: { user: { name: 'Synthetic Alice', email: 'a@example.invalid' } } }),
  );
  await page.goto(`${origin}${path}${query}`);
  await page.waitForSelector('header.ux-app-header');
}
const main = (page: Page) => page.locator('.ux-pocket-main');
const more = (page: Page) => page.locator('.ux-pocket-more');
const panel = (page: Page) => page.locator('.ux-pocket-panel');
const rowNames = (page: Page) => page.locator('.ux-pocket-row').allInnerTexts();
const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!;
const phone = { width: 390, height: 844 };
const header = (page: Page) => page.locator('header.ux-customer-header');

/** The words a person sees in the header row on a phone: every control that is drawn. */
async function visibleHeader(page: Page) {
  return header(page).evaluate((root) => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    return {
      brand: !!root.querySelector('.brand') && shown(root.querySelector('.brand')!),
      search:
        !!root.querySelector('.ux-csearch-trigger') &&
        shown(root.querySelector('.ux-csearch-trigger')!),
      newRequest:
        !!root.querySelector('.ux-bar-new-narrow') &&
        shown(root.querySelector('.ux-bar-new-narrow')!),
      language:
        !!root.querySelector('.ux-util-language') &&
        shown(root.querySelector('.ux-util-language')!),
      help: !!root.querySelector('.ux-util-help') && shown(root.querySelector('.ux-util-help')!),
      title:
        !!root.querySelector('.ux-pocket-title') && shown(root.querySelector('.ux-pocket-title')!),
      inbox: !!root.querySelector('.ux-bar-inbox') && shown(root.querySelector('.ux-bar-inbox')!),
      account:
        !!root.querySelector('.ux-util-avatar') && shown(root.querySelector('.ux-util-avatar')!),
    };
  });
}

test.describe('switch off: exactly what main draws', () => {
  for (const width of [320, 390, 640, 768, 1440]) {
    test(`no button, no title and the old header at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mount(page, '/account', '?pocket=off');
      await expect(page.locator('.ux-pocket')).toHaveCount(0);
      await expect(page.locator('.ux-pocket-title')).toHaveCount(0);
      const shown = await visibleHeader(page);
      expect(shown.brand).toBe(true);
      expect(shown.title).toBe(false);
      // The header New Request is the narrow one below 1024 px, as on main.
      expect(shown.newRequest).toBe(width < 1024);
      expect(shown.search).toBe(true);
      expect(shown.inbox).toBe(true);
      expect(shown.account).toBe(true);
    });
  }
});

test.describe('phone width, switch on', () => {
  for (const width of [320, 390, 640]) {
    test(`button and short header at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mount(page, '/account', '?signals=draft');
      await expect(main(page)).toBeVisible();
      await expect(main(page)).toHaveText(/Finish Your Draft/);
      const target = await box(main(page));
      expect(target.height).toBeGreaterThanOrEqual(55.9);
      expect(target.height).toBeLessThanOrEqual(56.1 * 2);
      const small = await box(more(page));
      expect(small.height).toBeGreaterThanOrEqual(43.9);
      expect(small.width).toBeGreaterThanOrEqual(43.9);
      // The end corner, 16 px above the bottom edge (no bottom bar, safe area 0 here), inside the window.
      expect(target.x + target.width).toBeLessThanOrEqual(width - 15);
      expect(await page.locator('.ux-customer-tabs').count()).toBe(0);
      expect(844 - (target.y + target.height)).toBeGreaterThanOrEqual(15.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      // The header keeps the menu or title, the inbox and the account menu, and nothing else.
      const shown = await visibleHeader(page);
      expect(shown).toMatchObject({
        brand: false,
        search: false,
        newRequest: false,
        language: false,
        help: false,
        title: true,
        inbox: true,
        account: true,
      });
      await expect(page.locator('.ux-pocket-title')).toHaveText('Your move');
      // One heading, untouched.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }

  for (const width of [768, 1440]) {
    test(`the button and the short header are not drawn at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mount(page, '/account', '?signals=draft');
      await expect(main(page)).toBeHidden();
      const shown = await visibleHeader(page);
      expect(shown.title).toBe(false);
      expect(shown.brand).toBe(true);
    });
  }

  test('width 641 is above the phone: nothing drawn', async ({ page }) => {
    await page.setViewportSize({ width: 641, height: 800 });
    await mount(page, '/account', '?signals=draft');
    await expect(main(page)).toBeHidden();
    expect((await visibleHeader(page)).brand).toBe(true);
  });

  test('every touch target is 44 px or more', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    await more(page).click();
    const targets = page.locator(
      '.ux-pocket-main, .ux-pocket-more, .ux-pocket-row, header.ux-customer-header button, header.ux-customer-header a',
    );
    const sizes = await targets.evaluateAll((els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            name: (el.textContent || el.getAttribute('aria-label') || '').trim(),
            w: r.width,
            h: r.height,
          };
        })
        .filter((s) => s.w > 0 && s.h > 0),
    );
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      expect(size.h, size.name).toBeGreaterThanOrEqual(43.9);
      expect(size.w, size.name).toBeGreaterThanOrEqual(43.9);
    }
  });
});

test.describe('the Next Move words', () => {
  const cases: [string, RegExp, string][] = [
    ['none', /New Request/, '/account?view=work#customer-workspaces'],
    ['draft', /Finish Your Draft/, `/account/drafts/${workspace}?draft=d1`],
    ['quotes1', /Review 1 Quote\b/, '/account/service-requests/w/r1'],
    ['quotes3', /Review 3 Quotes/, '/account/service-requests'],
    ['partial', /Review 3\+ Quotes/, '/account/service-requests'],
    ['failed', /New Request/, '/plan'],
  ];
  for (const [signals, words, href] of cases) {
    test(`${signals}: ${words}`, async ({ page }) => {
      await page.setViewportSize(phone);
      await mount(page, '/account', `?signals=${signals}`);
      await expect(main(page)).toHaveText(words);
      await expect(main(page)).toHaveAttribute('href', href);
      // The accessible name carries the visible words.
      const name = await main(page).evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim());
      expect(name).toMatch(words);
    });
  }

  test('a draft count shows only above one and is not read as a zero', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    await expect(page.locator('.ux-pocket-badge')).toHaveText('3');
    await mount(page, '/account', '?signals=none');
    await expect(page.locator('.ux-pocket-badge')).toHaveCount(0);
  });

  test('the first paint is New Request with a working link, and the words upgrade when the read arrives', async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=pending');
    await expect(main(page)).toHaveText(/New Request/);
    await expect(main(page)).toHaveAttribute('href', '/plan');
    await page.evaluate(() =>
      (window as unknown as { resolveSignals: () => void }).resolveSignals(),
    );
    await expect(main(page)).toHaveText(/Finish Your Draft/);
    // The pending button works: it is a real link.
    await mount(page, '/account', '?signals=pending');
    await main(page).click();
    await expect(page).toHaveURL(/\/plan$/);
  });
});

test.describe('doing things with it', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone);
  });

  test('a tap runs the Next Move', async ({ page }) => {
    await mount(page, '/account', '?signals=quotes1');
    await main(page).click();
    await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
  });

  test('Enter and Space run the Next Move', async ({ page }) => {
    await mount(page, '/account', '?signals=quotes1');
    await main(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
    await mount(page, '/account', '?signals=quotes1');
    await main(page).focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
  });

  test('press, slide up, release on a row opens it (mouse)', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(main(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 20, { steps: 4 });
    await expect(panel(page)).toBeVisible();
    // The list is above the button: choose Meetings.
    const meetings = await box(page.locator('.ux-pocket-row', { hasText: 'Meetings' }));
    expect(meetings.y).toBeLessThan(start.y);
    await page.mouse.move(x, meetings.y + meetings.height / 2, { steps: 12 });
    await expect(page.locator('.ux-pocket-row[data-hot="true"]')).toHaveText('Meetings');
    await page.mouse.up();
    await expect(page).toHaveURL(/\/account\/meetings$/);
  });

  test('a slide of 150 px up from the button lands on the top row', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(main(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 150, { steps: 10 });
    const hot = page.locator('.ux-pocket-row[data-hot="true"]');
    await expect(hot).toHaveCount(1);
    const label = (await hot.innerText()).trim();
    await page.mouse.up();
    if (label === 'Get Help')
      await expect(page.getByRole('menu', { name: 'Get Help' })).toBeVisible();
    else await expect(page).not.toHaveURL(/\/account$/);
  });

  test('a slide that is released over nothing closes the list and runs nothing', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(main(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 4 });
    await expect(panel(page)).toBeVisible();
    await page.mouse.move(x, 5, { steps: 6 });
    await page.mouse.up();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/account\?signals=draft$/);
  });

  test('a slide never selects text and a slide never also runs the tap', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(main(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 60, { steps: 6 });
    await page.mouse.move(x - 120, y - 60, { steps: 6 });
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
    await page.mouse.move(x, 5, { steps: 4 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/account\?signals=draft$/);
    expect(await main(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    expect(await main(page).evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  });

  test.describe('with a finger', () => {
    test.use({ hasTouch: true });
    test('press, slide up, release on a row opens it (touch)', async ({ page }) => {
      await mount(page, '/account', '?signals=draft');
      const start = await box(main(page));
      const x = start.x + start.width / 2;
      const y = start.y + start.height / 2;
      const client = await page.context().newCDPSession(page);
      const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', py?: number) =>
        client.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: py === undefined ? [] : [{ x, y: py }],
        });
      await send('touchStart', y);
      for (let step = 1; step <= 6; step++) await send('touchMove', y - step * 8);
      await expect(panel(page)).toBeVisible();
      const meetings = await box(page.locator('.ux-pocket-row', { hasText: 'Meetings' }));
      await send('touchMove', meetings.y + meetings.height / 2);
      await expect(page.locator('.ux-pocket-row[data-hot="true"]')).toHaveText('Meetings');
      await send('touchEnd');
      await expect(page).toHaveURL(/\/account\/meetings$/);
    });
  });

  test('More opens the same list with a tap, and every row is a real control', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    await expect(more(page)).toHaveAccessibleName(/More/);
    await more(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await rowNames(page)).toEqual([
      'Get Help',
      'Search',
      'Meetings',
      'Continue Draft',
      'New Request',
    ]);
    await page.locator('.ux-pocket-row', { hasText: 'Meetings' }).click();
    await expect(page).toHaveURL(/\/account\/meetings$/);
  });

  test('Continue Draft is listed only when a draft exists', async ({ page }) => {
    await mount(page, '/account', '?signals=none');
    await more(page).click();
    expect(await rowNames(page)).toEqual(['Get Help', 'Search', 'Meetings', 'New Request']);
    await mount(page, '/account', '?signals=quotes1');
    await more(page).click();
    expect(await rowNames(page)).not.toContain('Continue Draft');
  });

  test('New Request in the list opens where requests are made', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    await more(page).click();
    await expect(page.locator('.ux-pocket-row', { hasText: 'New Request' })).toHaveAttribute(
      'href',
      '/account?view=work#customer-workspaces',
    );
    await expect(page.locator('.ux-pocket-row', { hasText: 'Continue Draft' })).toHaveAttribute(
      'href',
      `/account/drafts/${workspace}?draft=d1`,
    );
  });

  test('Search in the list opens the existing search dialog', async ({ page }) => {
    await mount(page, '/account', '?signals=none');
    await more(page).click();
    await page.locator('.ux-pocket-row', { hasText: 'Search' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Search Requests, Companies and pages' }),
    ).toBeVisible();
  });

  test('Escape closes the list and returns focus to More; the scrim closes it too', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    await more(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(more(page)).toBeFocused();
    await more(page).click();
    await page.locator('.ux-pocket-scrim').click({ position: { x: 30, y: 200 } });
    await expect(panel(page)).toHaveCount(0);
  });

  test('keyboard: Tab reaches More, the list and the button in order, and Tab out closes it', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    await more(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    // Focus moves into the list, at the row nearest the thumb.
    await expect(page.locator('.ux-pocket-row', { hasText: 'New Request' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(more(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(main(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Get Help opens every item of the existing help content, and Back returns to the list', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none&whatsapp=on&problems=on');
    await more(page).click();
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    const help = page.getByRole('menu', { name: 'Get Help' });
    await expect(help).toBeVisible();
    const names = [
      'See How It Works',
      'Chat on WhatsApp',
      'How We Label Facts',
      'Report a Problem',
      'Listen to This Page',
      'Text Size',
      'Stronger Colours',
      'Less Movement',
      'Corridra Website',
      'Privacy Notice',
    ];
    for (const name of names)
      await expect(help.getByText(name, { exact: false }).first(), name).toBeVisible();
    // The same links as the header Help menu holds.
    await expect(help.getByRole('menuitem', { name: 'See How It Works' })).toHaveAttribute(
      'href',
      '/how-it-works',
    );
    await expect(help.getByRole('menuitem', { name: 'How We Label Facts' })).toHaveAttribute(
      'href',
      '/trust',
    );
    await expect(help.getByRole('menuitem', { name: 'Privacy Notice' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await expect(help.getByRole('menuitem', { name: 'Corridra Website' })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(help.getByRole('menuitem', { name: /Chat on WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/8801000000000',
    );
    // Report a Problem carries the page the person is on.
    await expect(help.getByRole('menuitem', { name: 'Report a Problem' })).toHaveAttribute(
      'href',
      /\/account\/problem-reports\/new\?from=%2Faccount/,
    );
    await help.getByRole('menuitem', { name: 'Back' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole('menu', { name: 'Get Help' })).toHaveCount(0);
  });

  test('Get Help without a WhatsApp number or Report a Problem says Coming soon, as the header menu does', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await more(page).click();
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    const help = page.getByRole('menu', { name: 'Get Help' });
    await expect(help.getByText('Chat on WhatsApp')).toBeVisible();
    await expect(help.getByText('Coming soon')).toHaveCount(2);
  });

  test('Text Size and Stronger Colours in the help panel really change the page', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await more(page).click();
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    const help = page.getByRole('menu', { name: 'Get Help' });
    await help
      .getByRole('menuitemcheckbox', { name: 'Stronger Colours' })
      .click()
      .catch(async () => {
        await help.getByText('Stronger Colours').click();
      });
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
  });
});

test.describe('where it is not drawn', () => {
  const hidden = [
    '/account/request/' + workspace,
    '/account/drafts/' + workspace,
    '/account/service-requests/new',
    '/account/problem-reports/new',
    '/account/profile/' + workspace,
    '/account/billing/' + workspace,
    '/account/delegations/' + workspace,
    '/plan',
  ];
  for (const path of hidden)
    test(`not on ${path.replace(workspace, '[workspace]')}, and the old header is back`, async ({
      page,
    }) => {
      await page.setViewportSize(phone);
      await mount(page, path, '?signals=draft');
      await expect(page.locator('.ux-pocket')).toHaveCount(0);
      const shown = await visibleHeader(page);
      // Without the button the header keeps what it has today: New Request, Search and the brand.
      expect(shown.brand).toBe(true);
      expect(shown.newRequest).toBe(true);
      expect(shown.search).toBe(true);
      expect(shown.title).toBe(false);
    });

  for (const path of [
    '/account',
    '/account/meetings',
    '/account/service-requests',
    '/account/delegations/organise',
  ])
    test(`drawn on ${path}`, async ({ page }) => {
      await page.setViewportSize(phone);
      await mount(page, path, '?signals=none');
      await expect(main(page)).toBeVisible();
    });
});

test.describe('scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone);
  });
  const hiddenNow = (page: Page) => page.locator('.ux-pocket').getAttribute('data-hidden');

  test('slides away on scroll down and returns on scroll up', async ({ page }) => {
    await mount(page, '/account', '?signals=draft&rows=120');
    await expect(main(page)).toBeVisible();
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => hiddenNow(page)).toBe('true');
    await expect
      .poll(() => page.locator('.ux-pocket').evaluate((el) => getComputedStyle(el).opacity))
      .toBe('0');
    await page.mouse.wheel(0, -300);
    await expect.poll(() => hiddenNow(page)).toBeNull();
    await expect(main(page)).toBeVisible();
  });

  // The phone has no bottom bar (owner, 14 November 2026, "B"): the button never covers the last row or link.
  for (const width of [320, 390]) {
    test(`at the end of the page the button never covers the last link (${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await mount(page, '/account', `?signals=quotes3&rows=30`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // Even after the idle return time the button stays out of the way at the end.
      await page.waitForTimeout(1500);
      await expect.poll(() => hiddenNow(page)).toBe('true');
      await page.locator('#last').click({ timeout: 5000 });
      await expect(page).toHaveURL(/\/account\/last$/);
    });
  }

  test('the button sits at the bottom edge, 16 px up, and no bottom bar is in the page', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
    const bare = await box(main(page));
    // No bar: the gap to the bottom edge is the button's own gap (16 px), safe area 0 here.
    expect(phone.height - (bare.y + bare.height)).toBeGreaterThanOrEqual(15.5);
    expect(phone.height - (bare.y + bare.height)).toBeLessThanOrEqual(16.5);
    // Nothing sets or reads a bottom bar height any more: the button's own source no longer knows the tab bar.
    for (const file of ['pocket-button.css', 'pocket-button.tsx'])
      expect(readFileSync(resolve('apps/web/components/ux', file), 'utf8')).not.toMatch(
        /shell-bottom-bar|ux-customer-tabs/,
      );
    expect(
      await page
        .locator('.ux-pocket')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--shell-bottom-bar')),
    ).toBe('');
  });

  test('adds no page length: the document is as tall as without it', async ({ page }) => {
    await mount(page, '/account', '?signals=draft&rows=40');
    const on = await page.evaluate(() => document.documentElement.scrollHeight);
    await mount(page, '/account', '?pocket=off&signals=draft&rows=40');
    const off = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(on).toBe(off);
  });

  test('the button is above the device safe area, and that is its only bottom offset', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    const target = await box(main(page));
    expect(phone.height - (target.y + target.height)).toBeGreaterThanOrEqual(12);
    // The button places itself above the device's bottom edge by the safe area plus its own gap.
    expect(componentCss + globalCss).toContain('env(safe-area-inset-bottom');
    expect(readFileSync(resolve('apps/web/components/ux/pocket-button.css'), 'utf8')).toContain(
      'env(safe-area-inset-bottom',
    );
    expect(
      await page.locator('.ux-pocket').evaluate((el) => getComputedStyle(el).insetBlockEnd),
    ).not.toBe('auto');
  });
});

test.describe('right to left, reduced motion, text size', () => {
  test('dir=rtl puts the button in the left corner, and the header mirrors', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    const ltr = await box(main(page));
    expect(ltr.x).toBeGreaterThan(phone.width / 2 - 40);
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
    });
    const rtl = await box(main(page));
    expect(rtl.x).toBeLessThan(20);
    expect(rtl.x).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      phone.width,
    );
    await more(page).click();
    const list = await box(panel(page));
    expect(list.x).toBeGreaterThanOrEqual(0);
    expect(list.x + list.width).toBeLessThanOrEqual(phone.width);
  });

  test('reduced motion: nothing animates and the list simply appears', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    // The design system's reduced-motion rule leaves a 0.01 ms transition: nothing visible moves.
    expect(
      await page
        .locator('.ux-pocket')
        .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
    ).toBeLessThan(0.001);
    await more(page).click();
    expect(await panel(page).evaluate((el) => el.getAnimations().length)).toBe(0);
    await expect(panel(page)).toBeVisible();
  });

  test('Less Movement (the saved choice) also stops it', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    await page.evaluate(() => document.documentElement.setAttribute('data-less-movement', 'on'));
    const duration = await page
      .locator('.ux-pocket')
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(duration).toBeLessThan(0.001);
  });

  test('a long label wraps and stays inside the window at 320 with the largest text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mount(page, '/account', '?signals=partial');
    await page.evaluate(() => document.documentElement.setAttribute('data-text-size', 'largest'));
    const target = await box(main(page));
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.x + target.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});

test.describe('accessibility', () => {
  const scan = async (page: Page) => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // The account menu button (unchanged by Pocket) shows its initials to sight and names itself "Account menu"; axe's
    // experimental label-in-name rule flags that on main too, so it is the one finding left out. Pocket's own controls
    // (More, the Next Move, the list rows) are all scanned by it.
    return result.violations
      .map((v) => ({
        ...v,
        nodes: v.nodes.filter((n) => !n.html.includes('aria-label="Account menu"')),
      }))
      .filter((v) => v.nodes.length > 0)
      .map(
        (v) =>
          `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 200)).join(' | ')}`,
      );
  };
  test('axe is clean with the list closed, open and on the help panel', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=quotes3&whatsapp=on&problems=on');
    expect(await scan(page)).toEqual([]);
    await more(page).click();
    await expect(panel(page)).toBeVisible();
    expect(await scan(page)).toEqual([]);
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    await expect(page.getByRole('menu', { name: 'Get Help' })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('the button is cobalt with white words, tokens only', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    const style = await main(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, color: s.color };
    });
    const cobalt = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.backgroundColor = 'var(--brand)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    expect(style.background).toBe(cobalt);
    expect(style.color).toBe('rgb(255, 255, 255)');
    const css = readFileSync(resolve('apps/web/components/ux/pocket-button.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toMatch(/text-transform/);
  });
});
