import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build, type Plugin } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The organiser page for a signed-in visitor with no owner or admin workspace (the Programmes chooser). The real
// WorkspaceChooser and the real stylesheets are drawn on a small bundled page inside the customer frame, with its
// workspace read answered by the test (no sign-in), at the three widths of the owner's checklist. It pins the step:
// why a workspace is needed, one primary Create a Workspace link to the existing create place, the registrations
// link kept, nothing that creates anything by itself, no horizontal scroll, and axe clean.
const fixturePath = '/__organise-empty-fixture';
const viewHeight: Record<number, number> = { 390: 844, 768: 1024, 1440: 900 };
const shots = process.env.ORGANISE_SHOTS_DIR;
let html = '';

// The chooser's three imports from the server are answered here: the link is a plain anchor, redirect is never
// reached by these cases and the workspace read returns the rows the page is opened with.
const shims: Plugin = {
  name: 'chooser-shims',
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link', namespace: 'shim' }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({
      path: 'next-navigation',
      namespace: 'shim',
    }));
    b.onResolve({ filter: /lib\/foundations$/ }, () => ({
      path: 'foundations',
      namespace: 'shim',
    }));
    b.onResolve({ filter: /^@corridra\/domain$/ }, () => ({ path: 'domain', namespace: 'shim' }));
    b.onLoad({ filter: /^next-link$/, namespace: 'shim' }, () => ({
      contents: `import { createElement } from 'react';
        export default function Link({ href, children, prefetch, ...rest }) { return createElement('a', { href, ...rest }, children); }`,
      loader: 'js',
      resolveDir: resolve('apps/web'),
    }));
    b.onLoad({ filter: /^next-navigation$/, namespace: 'shim' }, () => ({
      contents: `export const redirect = (to) => { throw new Error('redirect:' + to); };`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^foundations$/, namespace: 'shim' }, () => ({
      contents: `export const foundations = () => ({
        ready: Promise.resolve(),
        customerWorkspaces: { list: async () => JSON.parse(new URLSearchParams(location.search).get('rows') || '[]') },
      });`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^domain$/, namespace: 'shim' }, () => ({
      contents: `export class DomainError extends Error { constructor(message, status) { super(message); this.status = status; } }`,
      loader: 'js',
    }));
  },
};

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { WorkspaceChooser } from ${JSON.stringify(resolve('apps/web/components/workspace-chooser.tsx'))};
        import { programmesChooserBack } from ${JSON.stringify(resolve('apps/web/app/account/frame-copy.ts'))};
        const slots = pageFrameSlots({ back: programmesChooserBack });
        WorkspaceChooser({ kind: 'programmes', enabled: true }).then((chooser) => {
          createRoot(document.getElementById('app')).render(
            <WorkspaceShell title="Programmes" customer above={slots.above} lead={slots.lead}>{chooser}</WorkspaceShell>);
        });`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    plugins: [shims],
    bundle: true,
    outdir: 'out',
    loader: { '.css': 'css' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundled = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = [
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8'),
    readFileSync(resolve('apps/web/components/ux/shells.css'), 'utf8'),
    bundled,
  ].join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Organiser fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const member = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Sample trading company',
    role: 'member',
    synthetic: true,
  },
];

async function open(page: Page, width: number, rows: unknown[]) {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: viewHeight[width]! });
  await page.goto(`${fixturePath}?rows=${encodeURIComponent(JSON.stringify(rows))}`);
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('no workspace: why one is needed, one primary Create a Workspace link, registrations kept', async ({
      page,
    }) => {
      await open(page, width, []);
      await expect(
        page.getByText('Organising a programme needs a workspace. Create one to continue.'),
      ).toBeVisible();
      const create = page.getByRole('link', { name: 'Create a Workspace', exact: true });
      await expect(create).toHaveCount(1);
      await expect(create).toHaveAttribute('href', '/account?view=work#customer-workspaces');
      await expect(create).toHaveClass(/primary-link/);
      await expect(
        page.getByRole('link', { name: 'Your programme registrations', exact: true }),
      ).toHaveAttribute('href', '/account/delegations');
      // It only links: nothing on the page can create a workspace by itself.
      await expect(page.locator('main form, main button')).toHaveCount(0);
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: join(shots, `empty-${width}.png`), fullPage: true });
      }
    });

    test('member only: says who can organise and still offers Create a Workspace', async ({
      page,
    }) => {
      await open(page, width, member);
      await expect(
        page.getByText('Only workspace owners and admins can organise programmes.', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Create a Workspace', exact: true }),
      ).toHaveAttribute('href', '/account?view=work#customer-workspaces');
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: join(shots, `member-${width}.png`), fullPage: true });
      }
    });

    test('no horizontal scroll, the action is a 44 px target up to 768, and axe is clean', async ({
      page,
    }) => {
      await open(page, width, []);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (width <= 768) {
        const box = await page
          .getByRole('link', { name: 'Create a Workspace', exact: true })
          .boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test('the action takes keyboard focus with a visible ring', async ({ page }) => {
      await open(page, width, []);
      const create = page.getByRole('link', { name: 'Create a Workspace', exact: true });
      await create.focus();
      await expect(create).toBeFocused();
      const outline = await create.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
    });
  });
}
