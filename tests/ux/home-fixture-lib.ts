import { expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// The component fixture of the home pages, factored out so the v4.3 fixture shares it (tests/ux/home-v42-fixture.ts
// keeps its own copy, unchanged). A fixture bundles real components with their own stylesheets (esbuild, no Next.js
// router: the path the footer sees is the query's `path`) and mounts them on the live home page of the running build,
// which supplies the global, home-landing and home-routes styles, the fonts and the /flags files exactly as the live
// home loads them. A component fixture, not a deployed page; pages that depend on the layout are measured on a real
// build.
export type Bundle = { script: string; styles: string };

/** The absolute path of a source file in the web app, as the fixture's imports name it. */
export const webFile = (path: string) => JSON.stringify(resolve('apps/web', path));

/** Bundles one entry module's source (TSX); the caller caches the promise. */
export function bundleFixture(contents: string): Promise<Bundle> {
  return build({
    stdin: { contents, loader: 'tsx', resolveDir: resolve('apps/web') },
    plugins: [
      {
        name: 'pathname',
        setup(b) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: 'navigation',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              "export const usePathname = () => new URLSearchParams(location.search).get('path') ?? '/';" +
              'export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });' +
              'export const useSearchParams = () => new URLSearchParams(location.search);',
            loader: 'js',
          }));
        },
      },
    ],
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    // Flag images and the hero photo are served by the site, not bundled.
    external: ['/flags/*', '/corridra-industrial-hero.webp'],
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css', '.woff2': 'empty', '.webp': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  }).then((result) => ({
    script: result.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
    styles: result.outputFiles.find((f) => f.path.endsWith('.css'))!.text,
  }));
}

export type MountOptions = {
  width: number;
  height?: number;
  /** The path the footer believes it is on (`/plan` gives the compact footer). */
  path?: string;
  signedIn?: boolean;
  /** CORRIDRA_UX_ACCESS_DOORS as the server would pass it. */
  doors?: boolean;
  /** Browser text size in per cent of the default (200 for the WCAG 1.4.4 check). */
  textSize?: number;
};

/** Replaces the live home's body with the bundle's app and waits until it has drawn. */
export async function mountBundle(
  page: Page,
  bundle: Bundle,
  options: MountOptions,
  app: { id: string; ready: string; footer: string },
) {
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: options.signedIn ? { user: { id: 'synthetic-user' }, session: { id: 's' } } : {},
    }),
  );
  await page.route('**/api/operator-auth/get-session', (route) => route.fulfill({ json: {} }));
  await page.setViewportSize({
    width: options.width,
    height: options.height ?? (options.width < 700 ? 844 : 900),
  });
  const query = new URLSearchParams({
    path: options.path ?? '/',
    doors: options.doors ? '1' : '0',
  });
  await page.goto(`/?${query}`);
  await expect(page.locator('main#main .tr-hero')).toBeVisible();
  await page.evaluate(
    ({ css, size, id }) => {
      document.body.innerHTML = `<div class="site-shell"><div id="${id}"></div></div>`;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      if (size) document.documentElement.style.fontSize = `${size}%`;
    },
    { css: bundle.styles, size: options.textSize ?? 0, id: app.id },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: bundle.script, type: 'module' });
  await expect(page.locator(app.ready)).toBeVisible();
  await expect(page.locator(app.footer)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img[data-flag]')].every(
      (img) => (img as HTMLImageElement).complete,
    ),
  );
}
