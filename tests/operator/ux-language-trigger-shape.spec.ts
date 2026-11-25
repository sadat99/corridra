import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Header triggers (owner, 10 November 2026): "language switch has letters and world icon together which go outside
// the square shade that appear when cursor is put on the switch." The globe was an SVG with no size of its own, which
// adds nothing to a button's natural width, so the language trigger stayed at its 44 px minimum while the globe and the
// code ran out of it on both sides. This mounts the real customer and team headers with the real stylesheets and
// checks, in the hover, open (aria-expanded) and keyboard focus states, that the trigger's own box contains the boxes
// of everything inside it, at phone, tablet and desktop widths and with the text at 200 percent. The help, inbox and
// account triggers are measured the same way, because they share the rule.
let server: Server, origin: string;
test.beforeAll(async () => {
  const at = (path: string) => JSON.stringify(resolve(path));
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${at('apps/web/components/language-provider.tsx')};
      import{AppHeader}from ${at('apps/web/components/ux/app-header.tsx')};
      import{BrandLockup}from ${at('apps/web/components/site-header.tsx')};
      const kind = new URLSearchParams(location.search).get('kind');
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false},{code:'bn',draft:false},{code:'zh',draft:false},{code:'ar',draft:false}]}>
          <div className="site-shell"><AppHeader kind={kind} live={false} notifications brandMark={<BrandLockup/>}/></div>
        </LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
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
                : 'const router={replace:()=>{},push:()=>{},refresh:()=>{}};export function useRouter(){return router}export function usePathname(){return new URLSearchParams(location.search).get("kind")==="team"?"/operator":"/account"}export function useSearchParams(){return new URLSearchParams(location.search)}',
          }));
        },
      },
    ],
  });
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic header triggers</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><main id="main"><h1>Synthetic header triggers</h1></main><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

const kinds = ['customer', 'team'] as const;
// 640 and 700 are the narrowest widths with the language trigger on the row, and the ones where the signed-in header
// keeps one row (it may wrap above 700 px); 701 is the first width where it wraps.
const widths = [320, 390, 640, 700, 701, 768, 1024, 1440] as const;
// Below 640 px the language and help menus fold into the avatar menu, so their triggers are not on the row.
const folded = (width: number) => width < 640;

async function open(page: Page, kind: (typeof kinds)[number], width: number, zoomed: boolean) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.goto(`${origin}/?kind=${kind}`);
  if (zoomed) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
}

/** The boxes inside a trigger that fall outside the trigger's own box (decoration placed on top of it is skipped). */
async function spill(trigger: Locator) {
  return trigger.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return Array.from(button.querySelectorAll(':scope > *'))
      .filter((child) => getComputedStyle(child).position !== 'absolute')
      .map((child) => ({ child, rect: child.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.left < box.left - 0.5 ||
          rect.right > box.right + 0.5 ||
          rect.top < box.top - 0.5 ||
          rect.bottom > box.bottom + 0.5,
      )
      .map(({ child, rect }) => ({
        child: `${child.tagName.toLowerCase()}.${child.getAttribute('class') ?? ''}`,
        childBox: [rect.left, rect.top, rect.right, rect.bottom].map(Math.round),
        triggerBox: [box.left, box.top, box.right, box.bottom].map(Math.round),
      }));
  });
}

async function shape(trigger: Locator) {
  return trigger.evaluate((button) => {
    const style = getComputedStyle(button);
    const box = button.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      focusVisible: button.matches(':focus-visible'),
      height: box.height,
      width: box.width,
    };
  });
}

for (const kind of kinds)
  for (const width of widths)
    for (const zoomed of [false, true])
      test(`the ${kind} header triggers contain their icon and code in hover, open and focus at ${width} px${zoomed ? ' with 200% text' : ''}`, async ({
        page,
      }) => {
        await open(page, kind, width, zoomed);
        // The header row fits the window: giving the trigger the width its content needs must not add sideways scroll.
        // At 640 px with 200% text the customer header scrolled 34 px sideways before the trigger was resized and 72 px
        // after; the tools now wrap inside the header instead, so every width and text size has none.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          'sideways scroll in px',
        ).toBeLessThanOrEqual(0);
        const triggers = page.locator('header .ux-menu-button:visible');
        const names = await triggers.evaluateAll((all) =>
          all.map((button) => button.getAttribute('aria-label')),
        );
        // The account menu is on the row at every width. Language and Help join it from 640 px; the customer header
        // adds the inbox.
        expect(names).toContain('Account menu');
        // The customer header's language is the top bar's sheet button (UI/UX.v4, owner option 1a): an icon and its code,
        // beside Listen, from 360 px; under 360 px both are in the drawer. The team header keeps its menu.
        const language =
          kind === 'customer'
            ? page.locator('header .ux-bar-topbar button[aria-haspopup="dialog"]')
            : page.locator('header .ux-util-language > .ux-menu-button');
        // The team language menu's button is named after the code it shows ("EN, Language", final walk W-2).
        const languageMenuNames = names.filter((name) => /(^|, )Language$/.test(name ?? ''));
        if (kind === 'customer') {
          expect(languageMenuNames).toEqual([]);
          if (folded(width)) expect(names).not.toContain('Help and accessibility');
          else expect(names).toContain('Help and accessibility');
          // Under 360 px Listen and the language code are in the drawer, so the bar draws neither.
          if (width < 360) {
            await expect(page.locator('header .ux-bar-topbar')).toBeHidden();
          } else {
            // Listen is in the bar wherever this browser can read the page aloud (it can here), beside the language code.
            const listen = page.locator('header .ux-bar-topbar button[aria-pressed]');
            await expect(listen).toBeVisible();
            await expect(listen).toHaveAccessibleName('Listen to This Page');
            await expect(listen).toContainText('Listen');
            for (const tool of await page.locator('header .ux-bar-topbar button').all()) {
              const label = await tool.getAttribute('aria-label');
              expect(await spill(tool), `${label} at rest`).toEqual([]);
              await page.mouse.move(0, 0);
              await tool.hover();
              const hovered = await shape(tool);
              expect(hovered.background, `${label} hover shade`).not.toBe('rgba(0, 0, 0, 0)');
              expect(hovered.height, `${label} height`).toBeGreaterThanOrEqual(44);
              expect(hovered.width, `${label} width`).toBeGreaterThanOrEqual(44);
              expect(await spill(tool), `${label} on hover`).toEqual([]);
              await tool.blur();
              await page.keyboard.press('Tab');
              await tool.focus();
              const focused = await shape(tool);
              expect(focused.focusVisible, `${label} focus-visible`).toBe(true);
              expect(focused.outlineWidth).toBeGreaterThanOrEqual(3);
              expect(await spill(tool), `${label} on focus`).toEqual([]);
            }
            // The language sheet opens from the code and closes on Escape with focus back on it.
            await language.click();
            await expect(language).toHaveAttribute('aria-expanded', 'true');
            await expect(page.getByRole('dialog', { name: 'Language' })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(language).toBeFocused();
          }
        } else if (folded(width)) {
          await expect(language).toBeHidden();
          expect(languageMenuNames).toEqual([]);
          expect(names).not.toContain('Help and accessibility');
        } else {
          expect(names).toContain('EN, Language');
          expect(names).toContain('Help and accessibility');
        }

        for (const name of names) {
          const button = page.getByRole('button', { name: name!, exact: true }).first();

          // Resting: the shape is the box itself.
          expect(await spill(button), `${name} at rest`).toEqual([]);

          // Hover: the shaded square is the button's background, and it holds everything.
          await page.mouse.move(0, 0);
          await button.hover();
          const hovered = await shape(button);
          expect(hovered.background, `${name} hover shade`).not.toBe('rgba(0, 0, 0, 0)');
          expect(hovered.height).toBeGreaterThanOrEqual(44);
          expect(await spill(button), `${name} on hover`).toEqual([]);

          // Open (aria-expanded): the same shade, the same box.
          await button.click();
          await expect(button).toHaveAttribute('aria-expanded', 'true');
          await page.mouse.move(0, 0);
          const opened = await shape(button);
          expect(opened.background, `${name} open shade`).not.toBe('rgba(0, 0, 0, 0)');
          expect(await spill(button), `${name} when open`).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(button).toHaveAttribute('aria-expanded', 'false');

          // Keyboard focus: the ring is drawn around the same box, so it surrounds the whole control.
          await button.blur();
          await page.keyboard.press('Tab');
          await button.focus();
          const focused = await shape(button);
          expect(focused.focusVisible, `${name} focus-visible`).toBe(true);
          expect(focused.outlineStyle, `${name} ring`).not.toBe('none');
          expect(focused.outlineWidth).toBeGreaterThanOrEqual(3);
          expect(await spill(button), `${name} on focus`).toEqual([]);
        }

        // The language trigger grows with its content: wider than a lone icon, never fixed to the 44 px minimum.
        if (!folded(width)) {
          const [globe, code] = await Promise.all([
            language.locator('svg').boundingBox(),
            language.locator('span').boundingBox(),
          ]);
          const trigger = await language.boundingBox();
          expect(globe).not.toBeNull();
          expect(code).not.toBeNull();
          expect(trigger!.width).toBeGreaterThan(globe!.width + code!.width);
        }
      });

// The language choice is reachable at every width and text size: from the trigger on the row where there is one, and
// from the account menu below 640 px, where the trigger is folded into it. Nothing is lost at either size.
for (const kind of kinds)
  for (const width of widths)
    for (const zoomed of [false, true])
      test(`the ${kind} header offers every language at ${width} px${zoomed ? ' with 200% text' : ''}`, async ({
        page,
      }) => {
        await open(page, kind, width, zoomed);
        if (kind === 'customer' && !folded(width)) {
          // The customer header's language is the sheet: every language in its own script with its code, one tap each.
          const code = page.locator('header .ux-bar-topbar button[aria-haspopup="dialog"]');
          await expect(code).toContainText('EN');
          await code.click();
          const sheet = page.getByRole('dialog', { name: 'Language' });
          for (const [short, name] of [
            ['EN', 'English'],
            ['BN', 'বাংলা'],
            ['ZH', '中文'],
          ])
            await expect(
              sheet.getByRole('button', { name: new RegExp(`${short}\\s*${name}`) }),
            ).toBeVisible();
          await expect(sheet.getByRole('button', { name: /EN\s*English/ })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          return;
        }
        const language = page.getByRole('button', { name: 'EN, Language', exact: true });
        const opener = folded(width)
          ? page.getByRole('button', { name: 'Account menu', exact: true })
          : language;
        if (!folded(width)) await expect(language).toBeVisible();
        await opener.click();
        // The customer account menu keeps Language as one row (A2): open it first, then every language is one tap away.
        if (folded(width) && kind === 'customer')
          await page.getByRole('menuitem', { name: /^Language/ }).click();
        for (const name of ['English', 'বাংলা', '中文'])
          await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
        await expect(
          page.getByRole('menuitemradio', { name: 'English', exact: true }),
        ).toHaveAttribute('aria-checked', 'true');
      });

/** Where the customer header's tools are: New Request, then the language, inbox, help and account triggers. */
async function tools(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      const rect = el?.getBoundingClientRect();
      return rect
        ? { left: rect.left, right: rect.right, centre: (rect.top + rect.bottom) / 2 }
        : null;
    };
    const named = (name: string) =>
      box(document.querySelector(`header button[aria-label="${name}"]`));
    return {
      request: box(document.querySelector('header .ux-bar-primary')),
      language: box(document.querySelector('header .ux-bar-topbar button[aria-haspopup="dialog"]')),
      inbox: named('Inbox'),
      help: named('Help and accessibility'),
      account: named('Account menu'),
    };
  });
}

// At 768 px with 200% text the header now has Listen and the language code too (UI/UX.v4 top bar), seven controls in a
// 688 px box, so it cannot hold one line. It wraps instead of running off the screen: every control stays inside the
// window, none sits on another, and the tools take at most two lines.
test('the customer tools stay inside the window at 768 px with 200% text, on at most two lines', async ({
  page,
}) => {
  await open(page, 'customer', 768, true);
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('header .ux-bar-tools > *, header .ux-bar-topbar > * > *'))
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
  );
  for (const rect of boxes) {
    expect(rect.left).toBeGreaterThanOrEqual(-0.5);
    expect(rect.right).toBeLessThanOrEqual(768.5);
  }
  // At most two lines: distinct row centres (controls within 20 px of each other share a row).
  const rows: number[] = [];
  for (const centre of boxes.map((rect) => (rect.top + rect.bottom) / 2).sort((a, b) => a - b))
    if (!rows.some((row) => Math.abs(row - centre) < 20)) rows.push(centre);
  expect(rows, 'rows of tools').toHaveLength(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

// From 640 px the language trigger sits beside New Request. The phone rule (up to 700 px) had set the gap between the
// tools to zero, so the grown shade of the language trigger touched the blue button.
for (const width of [640, 700])
  for (const zoomed of [false, true])
    test(`New Request and the language trigger keep a gap at ${width} px${zoomed ? ' with 200% text' : ''}`, async ({
      page,
    }) => {
      await open(page, 'customer', width, zoomed);
      const { request, language } = await tools(page);
      // Beside New Request with a gap, or, where Listen and the language code no longer fit the line (200% text), on
      // the next line: never touching it.
      if (!zoomed) {
        // At the normal text size they share the line, with a gap.
        expect(Math.abs(request!.centre - language!.centre), 'on the same line').toBeLessThan(4);
        expect(language!.left - request!.right, 'gap in px').toBeGreaterThanOrEqual(4);
      } else if (Math.abs(request!.centre - language!.centre) < 4) {
        expect(language!.left - request!.right, 'gap in px').toBeGreaterThanOrEqual(4);
      } else {
        expect(language!.centre - request!.centre, 'on the next line').toBeGreaterThan(30);
      }
    });

for (const kind of kinds)
  test(`the ${kind} header has no accessibility violations with the language menu open`, async ({
    page,
  }) => {
    await open(page, kind, 1440, false);
    if (kind === 'customer') {
      await page.locator('header .ux-bar-topbar button[aria-haspopup="dialog"]').click();
      await expect(page.getByRole('dialog', { name: 'Language' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'EN, Language', exact: true }).click();
      await expect(page.getByRole('menu', { name: 'Language' })).toBeVisible();
    }
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

// Final walk W-2 (25 Nov 2026): the team header's language button shows "EN", so its name starts with it ("EN,
// Language") and a voice user can say what they see (WCAG 2.5.3). The menu keeps the name "Language". Fails on the code
// before: the name was "Language" and axe (wcag21a) reported label-content-name-mismatch on it at 768 to 1920 px.
for (const width of [768, 1024, 1440, 1920])
  test(`the team header language button's name starts with the code it shows at ${width} px`, async ({
    page,
  }) => {
    await open(page, 'team', width, false);
    const language = page.locator('header .ux-util-language > .ux-menu-button');
    await expect(language).toBeVisible();
    expect((await language.innerText()).trim()).toBe('EN');
    await expect(language).toHaveAccessibleName('EN, Language');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('header')
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await language.click();
    await expect(page.getByRole('menu', { name: 'Language', exact: true })).toBeVisible();
  });

// UI/UX.v3 consistency pass, unit A2: the customer account menu keeps Sign Out pinned and Language as one row.
test.describe('the customer account menu', () => {
  test('Language is one row showing the current language; its languages open from that row and stay reachable', async ({
    page,
  }) => {
    await open(page, 'customer', 390, false);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    const row = page.getByRole('menuitem', { name: /^Language/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('English');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menuitemradio', { name: '中文', exact: true })).toHaveCount(0);
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['English', 'বাংলা', '中文'])
      await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: 'English', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  for (const height of [900, 480])
    test(`Sign Out is the last row and stays inside the visible menu at ${height} px high, before and after scrolling`, async ({
      page,
    }) => {
      await open(page, 'customer', 390, false);
      await page.setViewportSize({ width: 390, height });
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Account menu' });
      const signOut = menu.getByRole('menuitem', { name: 'Sign Out', exact: true });
      await expect(signOut).toBeVisible();
      const last = await menu.getByRole('menuitem').last().textContent();
      expect(last).toBe('Sign Out');
      const inside = async () =>
        menu.evaluate((panel) => {
          const out = panel.querySelector('.ux-menu-pinned')!.getBoundingClientRect();
          const box = panel.getBoundingClientRect();
          return { top: out.top >= box.top - 0.5, bottom: out.bottom <= box.bottom + 0.5 };
        });
      expect(await inside()).toEqual({ top: true, bottom: true });
      await menu.evaluate((panel) => panel.scrollTo(0, panel.scrollHeight));
      expect(await inside()).toEqual({ top: true, bottom: true });
      if (height === 480)
        expect(await menu.evaluate((panel) => panel.scrollHeight > panel.clientHeight)).toBe(true);
    });
});

// Arabic (right to left): the customer header keeps Listen and the language code on the screen at 320 and 390 px, with
// 44 px targets and no sideways scroll; at 390 they are in the bar, at 320 they are in the drawer (the bar draws neither).
for (const width of [320, 390])
  test(`the customer header in Arabic at ${width} px: right to left, inside the window, 44 px targets`, async ({
    page,
  }) => {
    // A browser with an Arabic voice, so Listen is offered (it is hidden where there is no voice for the page language).
    await page.addInitScript(() => {
      window.localStorage.setItem('corridra.language', 'ar');
      Object.defineProperty(window.speechSynthesis, 'getVoices', {
        configurable: true,
        value: () => [{ lang: 'ar-SA' }, { lang: 'en-US' }],
      });
    });
    await open(page, 'customer', width, false);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const bar = page.locator('header .ux-bar-topbar');
    if (width < 360) {
      await expect(bar).toBeHidden();
      return;
    }
    const tools = await bar.locator('button').all();
    expect(tools.length).toBeGreaterThanOrEqual(2);
    for (const tool of tools) {
      const box = (await tool.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    }
    await expect(bar.locator('button[aria-haspopup="dialog"]')).toContainText('AR');
  });

// One Listen for the whole app: a reading started from the account menu shows as speaking on the header button, and
// the header button stops it; a reading started from the header shows as speaking in the account menu. The speech
// synthesizer is stubbed so a reading stays running (headless Chromium has no voice that would keep it going).
// The account menu carries Listen on phones (from 640 px it sits in the Help menu), the width the review named.
for (const width of [390])
  test(`Listen state is shared between the header button and the account menu at ${width} px`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.speechSynthesis, 'getVoices', {
        configurable: true,
        value: () => [{ lang: 'en-US' }],
      });
      window.speechSynthesis.speak = () => undefined;
      window.speechSynthesis.cancel = () => undefined;
    });
    await open(page, 'customer', width, false);
    const header = page.locator('header .ux-bar-topbar').getByRole('button', {
      name: /^(Listen to This Page|Stop Reading)$/,
    });
    const account = page.getByRole('button', { name: 'Account menu', exact: true });
    const menuListen = page.getByRole('menuitemcheckbox', {
      name: /^(Listen to This Page|Stop Reading)$/,
    });
    await expect(header).toHaveAttribute('aria-pressed', 'false');

    // Started from the account menu: the header button flips to its stop state.
    await account.click();
    await expect(menuListen).toHaveAttribute('aria-checked', 'false');
    await menuListen.click();
    await expect(header).toHaveAttribute('aria-pressed', 'true');
    await expect(header).toHaveAccessibleName('Stop Reading');

    // The header button stops it, and the account menu agrees.
    await header.click();
    await expect(header).toHaveAttribute('aria-pressed', 'false');
    await expect(header).toHaveAccessibleName('Listen to This Page');
    await account.click();
    await expect(menuListen).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    // Started from the header: the account menu shows the stop state, and its row stops the reading.
    await header.click();
    await expect(header).toHaveAttribute('aria-pressed', 'true');
    await account.click();
    await expect(menuListen).toHaveAttribute('aria-checked', 'true');
    await expect(menuListen).toHaveText('Stop Reading');
    await menuListen.click();
    await expect(header).toHaveAttribute('aria-pressed', 'false');
  });
