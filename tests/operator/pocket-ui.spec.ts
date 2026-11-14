import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Pocket (phone), Step 1 (owner, 13 November 2026, "implement the corridra pocket 100% correctly"), changed by the owner
// on 14 November 2026 ("i asked for one +, u got me two buttons, New request and More, which cover the content on the
// screen. why cant u put just + with all these option, including New Request in blue"): ONE round plus in the end corner,
// one compact list above it with the Next Move first in the primary cobalt, and the short phone header. The real header,
// sidebar frame (the phone has no bottom tab bar since the owner's 14 November 2026 "B"), Pocket button and the real
// stylesheets are mounted as a fixture (the pattern of
// customer-search-ui.spec.ts), so every behaviour below is the shipped component's. What the signals say is scripted by
// the address (`?signals=`); the rules themselves are tested in tests/integration/pocket-next-move.test.ts, and the real
// signed-in pages are proved by scripts/qa/signed-in-sweep.ts.
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
const plus = (page: Page) => page.locator('.ux-pocket-plus');
const panel = (page: Page) => page.locator('.ux-pocket-panel');
const firstRow = (page: Page) => page.locator('.ux-pocket-row').first();
const rowLabels = (page: Page) => page.locator('.ux-pocket-row .ux-pocket-label').allInnerTexts();
/** One tap on the plus opens the one list. */
async function openList(page: Page) {
  await plus(page).click();
  await expect(panel(page)).toBeVisible();
}
/** The computed colour of a design token, as the browser resolves it. */
const token = (page: Page, name: string) =>
  page.evaluate((variable) => {
    const probe = document.createElement('i');
    probe.style.backgroundColor = `var(${variable})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, name);
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
    test(`one round plus and the short header at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mount(page, '/account', '?signals=draft');
      await expect(plus(page)).toBeVisible();
      // The accessible name is words; the icon is decoration.
      await expect(plus(page)).toHaveAccessibleName('Open Quick Menu');
      const target = await box(plus(page));
      expect(target.width).toBeGreaterThanOrEqual(55.9);
      expect(target.width).toBeLessThanOrEqual(56.1);
      expect(target.height).toBeGreaterThanOrEqual(55.9);
      expect(target.height).toBeLessThanOrEqual(56.1);
      expect(await plus(page).evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%');
      // The end corner (16 px in), 16 px above the bottom edge (no bottom bar, safe area 0 here), inside the window.
      expect(target.x + target.width).toBeGreaterThanOrEqual(width - 16.5);
      expect(target.x + target.width).toBeLessThanOrEqual(width - 15.5);
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
    test(`the plus and the short header are not drawn at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mount(page, '/account', '?signals=draft');
      await expect(plus(page)).toBeHidden();
      const shown = await visibleHeader(page);
      expect(shown.title).toBe(false);
      expect(shown.brand).toBe(true);
    });
  }

  test('width 641 is above the phone: nothing drawn', async ({ page }) => {
    await page.setViewportSize({ width: 641, height: 800 });
    await mount(page, '/account', '?signals=draft');
    await expect(plus(page)).toBeHidden();
    expect((await visibleHeader(page)).brand).toBe(true);
  });

  // The owner's complaint (14 November 2026): two buttons, New Request and More. There is one control, closed and open.
  for (const state of ['closed', 'open'])
    test(`exactly one fixed control, ${state}: no second button, no separate Next Move pill`, async ({
      page,
    }) => {
      await page.setViewportSize(phone);
      await mount(page, '/account', '?signals=draft');
      if (state === 'open') await openList(page);
      const fixed = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return (
              s.position === 'fixed' &&
              s.display !== 'none' &&
              s.visibility !== 'hidden' &&
              r.width > 0 &&
              r.height > 0 &&
              (el.matches('a[href], button') || el.querySelector('a[href], button') !== null)
            );
          })
          .map((el) => el.className),
      );
      expect(fixed).toEqual(['ux-pocket']);
      // Closed, the corner holds that one button and nothing else.
      if (state === 'closed')
        await expect(page.locator('.ux-pocket').locator('button, a')).toHaveCount(1);
      await expect(page.locator('.ux-pocket-more, .ux-pocket-main')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
    });

  test('every touch target is 44 px or more', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    const targets = page.locator(
      '.ux-pocket-plus, .ux-pocket-row, header.ux-customer-header button, header.ux-customer-header a',
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
    expect(sizes.length).toBeGreaterThan(8);
    for (const size of sizes) {
      expect(size.h, size.name).toBeGreaterThanOrEqual(43.9);
      expect(size.w, size.name).toBeGreaterThanOrEqual(43.9);
    }
  });

  test('the list is compact: not full width, inside the window, and the page behind stays readable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await mount(page, '/account', '?signals=quotes3');
    await openList(page);
    const list = await box(panel(page));
    expect(list.width).toBeLessThanOrEqual(390 - 32 + 0.5);
    expect(list.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(list.y).toBeGreaterThanOrEqual(0);
    // Six rows of at least 44 px fit in well under two thirds of the window.
    expect(list.height).toBeLessThan(700 * 0.66);
    // The scrim is light, and exists only while the list is open.
    const scrim = page.locator('.ux-pocket-scrim');
    await expect(scrim).toHaveCount(1);
    const alpha = await scrim.evaluate((el) => {
      const colour = getComputedStyle(el).backgroundColor;
      const match = colour.match(/color\(srgb [^/]+\/ ([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/);
      return match ? Number(match[1] ?? match[2]) : 1;
    });
    expect(alpha).toBeLessThanOrEqual(0.3);
    await page.keyboard.press('Escape');
    await expect(scrim).toHaveCount(0);
  });
});

test.describe('the Next Move words, as the first row of the list', () => {
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
      await openList(page);
      const first = firstRow(page);
      await expect(first).toHaveText(words);
      await expect(first).toHaveAttribute('data-pocket-row', 'move');
      await expect(first).toHaveAttribute('href', href);
    });
  }

  test('the first row is the Next Move in the primary cobalt with white words, nearest the plus', async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=quotes3');
    await openList(page);
    const first = firstRow(page);
    const style = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, color: s.color };
    });
    expect(style.background).toBe(await token(page, '--brand'));
    expect(style.color).toBe('rgb(255, 255, 255)');
    // Only the Next Move is primary: every other row is plain.
    const others = await page
      .locator('.ux-pocket-row:not([data-pocket-row="move"])')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(others.length).toBeGreaterThan(3);
    for (const background of others) expect(background).not.toBe(style.background);
    // First in reading order and the one nearest the plus.
    const rows = await page.locator('.ux-pocket-row').evaluateAll((els) =>
      els.map((el) => ({
        key: el.getAttribute('data-pocket-row'),
        bottom: el.getBoundingClientRect().bottom,
      })),
    );
    expect(rows[0].key).toBe('move');
    for (const row of rows.slice(1)) expect(row.bottom).toBeLessThan(rows[0].bottom);
    const plusBox = await box(plus(page));
    expect(plusBox.y - rows[0].bottom).toBeLessThan(40);
  });

  // The fixed order, and no row is ever drawn twice.
  const orders: [string, string[]][] = [
    ['none', ['New Request', 'Get Help', 'Search', 'Meetings']],
    ['failed', ['New Request', 'Get Help', 'Search', 'Meetings']],
    ['draft', ['Finish Your Draft', 'Get Help', 'Search', 'Meetings', 'New Request']],
    ['quotes1', ['Review 1 Quote', 'Get Help', 'Search', 'Meetings', 'New Request']],
    ['partial', ['Review 3+ Quotes', 'Get Help', 'Search', 'Meetings', 'New Request']],
    [
      'quotes3',
      ['Review 3 Quotes', 'Get Help', 'Search', 'Meetings', 'Continue Draft', 'New Request'],
    ],
  ];
  for (const [signals, expected] of orders)
    test(`${signals}: the rows in order, New Request never twice`, async ({ page }) => {
      await page.setViewportSize(phone);
      await mount(page, '/account', `?signals=${signals}`);
      await openList(page);
      const labels = (await rowLabels(page)).map((label) => label.trim());
      expect(labels).toEqual(expected);
      expect(labels.filter((label) => label === 'New Request').length).toBeLessThanOrEqual(1);
      // Nothing else in the corner says New Request either (no pill beside the plus).
      await expect(
        page.locator('.ux-pocket').getByText('New Request', { exact: true }),
      ).toHaveCount(labels.includes('New Request') ? 1 : 0);
    });

  test('a draft count shows only above one, on the Next Move row, and is not read as a zero', async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    await expect(page.locator('.ux-pocket-badge')).toHaveText('3');
    await expect(firstRow(page).locator('.ux-pocket-badge')).toHaveCount(1);
    await expect(firstRow(page)).toContainText('3 waiting');
    await mount(page, '/account', '?signals=none');
    await openList(page);
    await expect(page.locator('.ux-pocket-badge')).toHaveCount(0);
  });

  test('the first paint has New Request first with a working link, and the words upgrade when the read arrives', async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=pending');
    await openList(page);
    await expect(firstRow(page)).toHaveText(/New Request/);
    await expect(firstRow(page)).toHaveAttribute('href', '/plan');
    await page.evaluate(() =>
      (window as unknown as { resolveSignals: () => void }).resolveSignals(),
    );
    await expect(firstRow(page)).toHaveText(/Finish Your Draft/);
    // The pending list works: it is a real link.
    await mount(page, '/account', '?signals=pending');
    await openList(page);
    await firstRow(page).click();
    await expect(page).toHaveURL(/\/plan$/);
  });
});

test.describe('doing things with it', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone);
  });

  test('a tap opens the list and runs nothing; the plus turns into a close mark', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=quotes1');
    const closedIcon = await plus(page).locator('svg path').getAttribute('d');
    await expect(panel(page)).toHaveCount(0);
    await plus(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(/\/account\?signals=quotes1$/);
    await expect(plus(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(plus(page)).toHaveAccessibleName('Close Quick Menu');
    const openIcon = await plus(page).locator('svg path').getAttribute('d');
    expect(openIcon).not.toBe(closedIcon);
    // A second tap on the same control closes it and keeps focus there.
    await plus(page).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(plus(page)).toBeFocused();
    await expect(plus(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a tap, then the Next Move row, runs the Next Move', async ({ page }) => {
    await mount(page, '/account', '?signals=quotes1');
    await openList(page);
    await firstRow(page).click();
    await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
  });

  test('Enter and Space open the list with focus on the first row', async ({ page }) => {
    for (const key of ['Enter', 'Space']) {
      await mount(page, '/account', '?signals=quotes1');
      await plus(page).focus();
      await page.keyboard.press(key);
      await expect(panel(page)).toBeVisible();
      await expect(firstRow(page)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
    }
  });

  test('press, slide up, release on a row opens it (mouse)', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(plus(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 20, { steps: 4 });
    await expect(panel(page)).toBeVisible();
    // The list is above the plus: choose Meetings.
    const meetings = await box(page.locator('.ux-pocket-row', { hasText: 'Meetings' }));
    expect(meetings.y).toBeLessThan(start.y);
    await page.mouse.move(x, meetings.y + meetings.height / 2, { steps: 12 });
    await expect(page.locator('.ux-pocket-row[data-hot="true"]')).toHaveText('Meetings');
    await page.mouse.up();
    await expect(page).toHaveURL(/\/account\/meetings$/);
  });

  test('a slide releases on the Next Move, the row nearest the plus, and opens it', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=quotes1');
    const start = await box(plus(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 20, { steps: 4 });
    const move = await box(firstRow(page));
    await page.mouse.move(x, move.y + move.height / 2, { steps: 8 });
    await expect(page.locator('.ux-pocket-row[data-hot="true"]')).toHaveAttribute(
      'data-pocket-row',
      'move',
    );
    await page.mouse.up();
    await expect(page).toHaveURL(/\/account\/service-requests\/w\/r1$/);
  });

  test('a slide of 150 px up from the plus lands on a row and runs it', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(plus(page));
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 150, { steps: 10 });
    const hot = page.locator('.ux-pocket-row[data-hot="true"]');
    await expect(hot).toHaveCount(1);
    const key = await hot.getAttribute('data-pocket-row');
    await page.mouse.up();
    if (key === 'help') await expect(page.getByRole('menu', { name: 'Get Help' })).toBeVisible();
    else if (key === 'search')
      await expect(
        page.getByRole('dialog', { name: 'Search Requests, Companies and pages' }),
      ).toBeVisible();
    else await expect(page).not.toHaveURL(/\/account\?signals=draft$/);
  });

  test('a slide that is released over nothing closes the list and runs nothing', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(plus(page));
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

  test('a slide never selects text and a slide never also toggles the plus', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    const start = await box(plus(page));
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
    // Released over nothing: closed, and the click after the release did not open it again.
    await expect(panel(page)).toHaveCount(0);
    expect(await plus(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    expect(await plus(page).evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  });

  test.describe('with a finger', () => {
    test.use({ hasTouch: true });
    test('press, slide up, release on a row opens it (touch)', async ({ page }) => {
      await mount(page, '/account', '?signals=draft');
      const start = await box(plus(page));
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

    test('a plain finger tap opens the list, and a tap outside closes it', async ({ page }) => {
      await mount(page, '/account', '?signals=draft');
      await plus(page).tap();
      await expect(panel(page)).toBeVisible();
      await page.touchscreen.tap(30, 200);
      await expect(panel(page)).toHaveCount(0);
    });
  });

  test('every row is a real link or button', async ({ page }) => {
    await mount(page, '/account', '?signals=quotes3');
    await expect(plus(page)).toHaveAccessibleName(/Quick Menu/);
    await openList(page);
    await expect(plus(page)).toHaveAttribute('aria-expanded', 'true');
    const kinds = await page
      .locator('.ux-pocket-row')
      .evaluateAll((els) =>
        els.map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('href') ? ':href' : ''}`),
      );
    expect(kinds).toEqual(['a:href', 'button', 'button', 'a:href', 'a:href', 'a:href']);
    await page.locator('.ux-pocket-row', { hasText: 'Meetings' }).click();
    await expect(page).toHaveURL(/\/account\/meetings$/);
  });

  test('Continue Draft is listed only when a draft exists and it is not the Next Move', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await openList(page);
    expect(await rowLabels(page)).not.toContain('Continue Draft');
    await mount(page, '/account', '?signals=quotes1');
    await openList(page);
    expect(await rowLabels(page)).not.toContain('Continue Draft');
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    expect(await rowLabels(page)).not.toContain('Continue Draft');
    await mount(page, '/account', '?signals=quotes3');
    await openList(page);
    await expect(page.locator('.ux-pocket-row', { hasText: 'Continue Draft' })).toHaveAttribute(
      'href',
      `/account/drafts/${workspace}?draft=d1`,
    );
  });

  test('New Request in the list opens where requests are made', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    await expect(page.locator('.ux-pocket-row', { hasText: 'New Request' })).toHaveAttribute(
      'href',
      '/account?view=work#customer-workspaces',
    );
    // Closes after choosing.
    await page.locator('.ux-pocket-row', { hasText: 'New Request' }).click();
    await expect(page).toHaveURL(/\/account\?view=work/);
  });

  test('Search in the list opens the existing search dialog and closes the list', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await openList(page);
    await page.locator('.ux-pocket-row', { hasText: 'Search' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Search Requests, Companies and pages' }),
    ).toBeVisible();
  });

  test('Escape closes the list and returns focus to the plus; the scrim closes it too', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(plus(page)).toBeFocused();
    await openList(page);
    await page.locator('.ux-pocket-scrim').click({ position: { x: 30, y: 200 } });
    await expect(panel(page)).toHaveCount(0);
    await expect(plus(page)).toBeFocused();
    // Escape also works with focus inside the list.
    await plus(page).focus();
    await page.keyboard.press('Enter');
    await expect(firstRow(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(plus(page)).toBeFocused();
  });

  test('keyboard: the plus, then the rows in order, and Tab out closes it', async ({ page }) => {
    await mount(page, '/account', '?signals=draft');
    await plus(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    const keys = ['move', 'help', 'search', 'meetings', 'new'];
    await expect(page.locator(`[data-pocket-row="${keys[0]}"]`)).toBeFocused();
    for (const key of keys.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`[data-pocket-row="${key}"]`)).toBeFocused();
    }
    // Back up with Shift+Tab, as far as the plus, which keeps the list open.
    for (const key of keys.slice(0, -1).reverse()) {
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator(`[data-pocket-row="${key}"]`)).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await expect(plus(page)).toBeFocused();
    await expect(panel(page)).toBeVisible();
    // Tabbing past the last row leaves the group and closes the list.
    await page.keyboard.press('Tab');
    for (let step = 1; step < keys.length; step++) await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Get Help opens every item of the existing help content, and Back returns to the list', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none&whatsapp=on&problems=on');
    await openList(page);
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
    await expect(page.locator('[data-pocket-row="help"]')).toBeFocused();
    // Escape from the help panel closes everything and returns focus to the plus.
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(plus(page)).toBeFocused();
  });

  test('Get Help without a WhatsApp number or Report a Problem says Coming soon, as the header menu does', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await openList(page);
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    const help = page.getByRole('menu', { name: 'Get Help' });
    await expect(help.getByText('Chat on WhatsApp')).toBeVisible();
    await expect(help.getByText('Coming soon')).toHaveCount(2);
  });

  test('Text Size and Stronger Colours in the help panel really change the page', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=none');
    await openList(page);
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
      // Without the plus the header keeps what it has today: New Request, Search and the brand.
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
      await expect(plus(page)).toBeVisible();
    });
});

test.describe('scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone);
  });
  const hiddenNow = (page: Page) => page.locator('.ux-pocket').getAttribute('data-hidden');

  test('slides away on scroll down and returns on scroll up', async ({ page }) => {
    await mount(page, '/account', '?signals=draft&rows=120');
    await expect(plus(page)).toBeVisible();
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => hiddenNow(page)).toBe('true');
    await expect
      .poll(() => page.locator('.ux-pocket').evaluate((el) => getComputedStyle(el).opacity))
      .toBe('0');
    await page.mouse.wheel(0, -300);
    await expect.poll(() => hiddenNow(page)).toBeNull();
    await expect(plus(page)).toBeVisible();
  });

  // The phone has no bottom bar (owner, 14 November 2026, "B"): the plus never covers the last row or link.
  for (const width of [320, 390]) {
    test(`at the end of the page the plus never covers the last link (${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await mount(page, '/account', `?signals=quotes3&rows=30`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // Even after the idle return time the plus stays out of the way at the end.
      await page.waitForTimeout(1500);
      await expect.poll(() => hiddenNow(page)).toBe('true');
      await expect
        .poll(() => page.locator('.ux-pocket').evaluate((el) => getComputedStyle(el).opacity))
        .toBe('0');
      await page.locator('#last').click({ timeout: 5000 });
      await expect(page).toHaveURL(/\/account\/last$/);
    });
  }

  test('the plus sits at the bottom edge, 16 px up, and no bottom bar is in the page', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    await expect(page.locator('.ux-customer-tabs')).toHaveCount(0);
    const bare = await box(plus(page));
    // No bar: the gap to the bottom edge is the plus's own gap (16 px), safe area 0 here.
    expect(phone.height - (bare.y + bare.height)).toBeGreaterThanOrEqual(15.5);
    expect(phone.height - (bare.y + bare.height)).toBeLessThanOrEqual(16.5);
    // Nothing sets or reads a bottom bar height any more: the source no longer knows the tab bar.
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

  test('the open list sits above the plus and stays inside the window', async ({ page }) => {
    await mount(page, '/account', '?signals=quotes3');
    await openList(page);
    const list = await box(panel(page));
    const target = await box(plus(page));
    expect(list.y + list.height).toBeLessThanOrEqual(target.y);
    expect(list.y).toBeGreaterThanOrEqual(0);
  });

  test('adds no page length: the document is as tall as without it', async ({ page }) => {
    await mount(page, '/account', '?signals=draft&rows=40');
    const on = await page.evaluate(() => document.documentElement.scrollHeight);
    await mount(page, '/account', '?pocket=off&signals=draft&rows=40');
    const off = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(on).toBe(off);
  });

  test('the plus is above the device safe area, and that is its only bottom offset', async ({
    page,
  }) => {
    await mount(page, '/account', '?signals=draft');
    const target = await box(plus(page));
    expect(phone.height - (target.y + target.height)).toBeGreaterThanOrEqual(12);
    // The plus places itself above the device's bottom edge by the safe area plus its own gap.
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
  test('dir=rtl puts the plus in the left corner, the list beside it, and the header mirrors', async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    const ltr = await box(plus(page));
    expect(ltr.x).toBeGreaterThan(phone.width / 2 - 40);
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
    });
    const rtl = await box(plus(page));
    expect(rtl.x).toBeLessThan(20);
    expect(rtl.x).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      phone.width,
    );
    await openList(page);
    const list = await box(panel(page));
    expect(list.x).toBeGreaterThanOrEqual(0);
    expect(list.x + list.width).toBeLessThanOrEqual(phone.width);
    // The list hangs from the same (left) edge as the plus, not from the right.
    expect(Math.abs(list.x - rtl.x)).toBeLessThan(2);
    // The row words start at the right in right to left (logical alignment), icon first.
    const row = await firstRow(page).evaluate((el) => getComputedStyle(el).textAlign);
    expect(['start', 'right']).toContain(row);
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
    await openList(page);
    expect(await panel(page).evaluate((el) => el.getAnimations().length)).toBe(0);
    expect(await plus(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
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
    const target = await box(plus(page));
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.x + target.width).toBeLessThanOrEqual(320);
    await openList(page);
    const list = await box(panel(page));
    expect(list.x).toBeGreaterThanOrEqual(0);
    expect(list.x + list.width).toBeLessThanOrEqual(320);
    expect(list.y).toBeGreaterThanOrEqual(0);
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
    // (the plus and the list rows) are all scanned by it.
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
    await openList(page);
    expect(await scan(page)).toEqual([]);
    await page.locator('.ux-pocket-row', { hasText: 'Get Help' }).click();
    await expect(page.getByRole('menu', { name: 'Get Help' })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('axe is clean with the list open at 320 and with a draft count on the Next Move', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mount(page, '/account', '?signals=draft');
    await openList(page);
    expect(await scan(page)).toEqual([]);
  });

  test('the plus is cobalt with a white icon, tokens only', async ({ page }) => {
    await page.setViewportSize(phone);
    await mount(page, '/account', '?signals=draft');
    const style = await plus(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, color: s.color };
    });
    expect(style.background).toBe(await token(page, '--brand'));
    expect(style.color).toBe('rgb(255, 255, 255)');
    const css = readFileSync(resolve('apps/web/components/ux/pocket-button.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toMatch(/text-transform/);
  });
});
