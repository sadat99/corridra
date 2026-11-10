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
        <LanguageProvider offered={[{code:'en',draft:false},{code:'bn',draft:false},{code:'zh',draft:false}]}>
          <div className="site-shell"><AppHeader kind={kind} live={false} notifications brandMark={<BrandLockup/>}/></div>
        </LanguageProvider>);`,
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
const widths = [320, 390, 768, 1024, 1440] as const;
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
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(0);
        const triggers = page.locator('header .ux-menu-button:visible');
        const names = await triggers.evaluateAll((all) =>
          all.map((button) => button.getAttribute('aria-label')),
        );
        // The account menu is on the row at every width. Language and Help join it from 640 px; the customer header
        // adds the inbox.
        expect(names).toContain('Account menu');
        const language = page.locator('header .ux-util-language > .ux-menu-button');
        if (folded(width)) {
          await expect(language).toBeHidden();
          expect(names).not.toContain('Language');
          expect(names).not.toContain('Help and accessibility');
        } else {
          expect(names).toContain('Language');
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

for (const kind of kinds)
  test(`the ${kind} header has no accessibility violations with the language menu open`, async ({
    page,
  }) => {
    await open(page, kind, 1440, false);
    await page.getByRole('button', { name: 'Language', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Language' })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
