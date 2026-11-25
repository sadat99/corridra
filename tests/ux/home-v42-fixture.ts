import { expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Home page v4.2 with the switch on (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by default"), as a
// component fixture so CI keeps one production build with CORRIDRA_UX_HOME_V42 unset. The real HomeV42 and the real
// SiteFooterView with `trim` (what the server passes while the switch is exactly "true") are bundled with their own
// stylesheets and mounted on the home page of that build, which supplies the global, home-landing and home-routes
// styles, the fonts and the /flags files exactly as the live home loads them. Header left out: v4.2 keeps it
// unchanged. Component fixture, not a deployed page; the page itself is measured on a local ON build as well.
let bundled: Promise<{ script: string; styles: string }> | null = null;

function bundle() {
  bundled ??= build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { HomeV42 } from ${JSON.stringify(resolve('apps/web/components/home-v42.tsx'))};
        import { SiteFooterView } from ${JSON.stringify(resolve('apps/web/components/site-footer-view.tsx'))};
        import { useSignedIn } from ${JSON.stringify(resolve('apps/web/components/use-signed-in.ts'))};
        const q = new URLSearchParams(location.search);
        function Page() {
          useSignedIn(true);
          return (
            <>
              <main id="main" lang="en" dir="ltr" tabIndex={-1} className="ux-public ux-guide-home ac1-home tr-home">
                <HomeV42 whatsapp={null} />
              </main>
              <SiteFooterView realUse={true} accessDoors={q.get('doors') === '1'} trim />
            </>
          );
        }
        createRoot(document.getElementById('v42-app')).render(<Page />);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    plugins: [
      {
        // The fixture has no Next.js router: the path the footer sees is the query's `path`.
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
    // Flag images are served by the site, not bundled.
    external: ['/flags/*'],
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css', '.woff2': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  }).then((result) => ({
    script: result.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
    styles: result.outputFiles.find((f) => f.path.endsWith('.css'))!.text,
  }));
  return bundled;
}

export type HomeV42Options = {
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

/** Mounts the v4.2 home and the trimmed footer on the live home page of the running (switch off) build. */
export async function mountHomeV42(page: Page, options: HomeV42Options) {
  const { script, styles } = await bundle();
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
    ({ css, size }) => {
      document.body.innerHTML = '<div class="site-shell"><div id="v42-app"></div></div>';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      if (size) document.documentElement.style.fontSize = `${size}%`;
    },
    { css: styles, size: options.textSize ?? 0 },
  );
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await expect(page.locator('main#main .hv42 .hv42-hero')).toBeVisible();
  await expect(page.locator('footer.guide-footer-trim')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img[data-flag]')].every(
      (img) => (img as HTMLImageElement).complete,
    ),
  );
  if (options.signedIn)
    await expect(
      page.locator('footer').getByRole('link', { name: 'Open Your Workspace', exact: true }),
    ).toBeVisible();
}
