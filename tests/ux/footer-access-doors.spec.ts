import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Access doors, Unit B (CORRIDRA_UX_ACCESS_DOORS, owner 14 Nov 2026): the footer of a signed-out visitor shows
// "Find your way in." and three links to the access pages, where the Sign In button and "Already working with us?"
// were, and every family group starts closed on a phone. The real SiteFooterView and the real stylesheets on a small
// bundled page; the switch is the `accessDoors` prop the server wrapper passes (the wrapper itself is covered by the
// source check at the end). The path the footer believes it is on, and whether anyone is signed in, come from the
// query and from the answered session route. Component fixture, not a deployed page.
const fixturePath = '/__footer-access-doors-fixture';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { SiteFooterView } from ${JSON.stringify(resolve('apps/web/components/site-footer-view.tsx'))};
        import { useSignedIn } from ${JSON.stringify(resolve('apps/web/components/use-signed-in.ts'))};
        const q = new URLSearchParams(location.search);
        function Footer() {
          useSignedIn(true);
          return <SiteFooterView realUse={true} accessDoors={q.get('doors') === '1'} />;
        }
        createRoot(document.getElementById('app')).render(<Footer />);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    plugins: [
      {
        // The fixture has no router: the path the footer sees is the query's `path`.
        name: 'pathname',
        setup(b) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: 'navigation',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              "export const usePathname = () => new URLSearchParams(location.search).get('path') ?? location.pathname;" +
              'export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });' +
              'export const useSearchParams = () => new URLSearchParams(location.search);',
            loader: 'js',
          }));
        },
      },
    ],
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = [
    'app/globals.css',
    'components/site-header.css',
    'components/language-switcher.css',
    'components/site-footer.css',
  ]
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Footer access doors fixture</title><style>${css}</style></head><body><div class="site-shell"><main style="min-height:200px"></main><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const doors = [
  ['Customer Access', '/access/customer'],
  ['Team and Network Access', '/access/team'],
  ['Private Link Access', '/access/link'],
] as const;

async function open(
  page: Page,
  options: { doors?: boolean; path?: string; signedIn?: boolean; width?: number } = {},
) {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: options.signedIn ? { user: { id: 'synthetic-user' }, session: { id: 's' } } : {},
    }),
  );
  await page.route('**/api/operator-auth/get-session', (route) => route.fulfill({ json: {} }));
  const width = options.width ?? 1440;
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  const query = new URLSearchParams({
    doors: options.doors === false ? '0' : '1',
    path: options.path ?? '/about',
  });
  await page.goto(`${fixturePath}?${query}`);
  await page.evaluate(() => document.fonts.ready);
  const footer = page.locator('footer.guide-footer');
  await expect(footer).toBeVisible();
  if (options.signedIn)
    await expect(
      footer.getByRole('link', { name: 'Open Your Workspace', exact: true }),
    ).toBeVisible();
  return footer;
}

test('signed out, the footer offers three access doors with the registry words and addresses', async ({
  page,
}) => {
  const footer = await open(page);
  const section = footer.locator('section.guide-footer-access');
  await expect(section).toHaveCount(1);
  await expect(section).toHaveAttribute('lang', 'en');
  await expect(
    section.getByRole('heading', { level: 2, name: 'Find your way in.', exact: true }),
  ).toBeVisible();
  const links = section.getByRole('link');
  await expect(links).toHaveCount(3);
  for (const [index, [title, href]] of doors.entries()) {
    await expect(links.nth(index)).toHaveText(title);
    await expect(links.nth(index)).toHaveAttribute('href', href);
  }
  // Start a Request stays; the Sign In button and the "Already working with us?" line are gone.
  const actions = footer.locator('.guide-footer-actions');
  await expect(actions.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(footer.getByRole('link', { name: 'Sign In', exact: true })).toHaveCount(0);
  await expect(footer.getByText('Already working with us?')).toHaveCount(0);
  await expect(footer.locator('a[href="/signin"]')).toHaveCount(0);
});

test('the heading is the quiet mono title and nothing in the row is uppercased', async ({
  page,
}) => {
  const footer = await open(page);
  const style = await footer.locator('.guide-footer-access-title').evaluate((node) => {
    const css = getComputedStyle(node);
    return { size: css.fontSize, transform: css.textTransform, weight: css.fontWeight };
  });
  expect(style.size).toBe('12px');
  expect(style.transform).toBe('none');
  expect(style.weight).toBe('600');
  // The mono face comes from the layout's font variable, which the fixture does not load; the rule must name it.
  const rule = readFileSync(resolve('apps/web/components/site-footer.css'), 'utf8').match(
    /\.guide-footer-access-title \{[^}]*\}/,
  )![0];
  expect(rule).toContain('font-family: var(--font-mono)');
  const transforms = await footer
    .locator('.guide-footer-access a')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).textTransform));
  expect(transforms).toEqual(['none', 'none', 'none']);
});

for (const [title, href] of doors) {
  test(`${href} marks only its own door as the current page`, async ({ page }) => {
    const footer = await open(page, { path: href });
    const current = footer.locator('.guide-footer-access a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(title);
  });
}

test('on an ordinary page no door is marked current', async ({ page }) => {
  const footer = await open(page, { path: '/about' });
  await expect(footer.locator('.guide-footer-access a[aria-current]')).toHaveCount(0);
});

for (const width of [390, 768, 1440]) {
  test(`every door is at least 44 px tall and nothing scrolls sideways at ${width}px`, async ({
    page,
  }) => {
    const footer = await open(page, { width });
    const boxes = await footer
      .locator('.guide-footer-access a')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(43.5);
    // A phone stacks the three links; wider screens put them in one row where they fit.
    if (width === 390) expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(3);
    else expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

// The locked footer heights (UI/UX.v3 "Footer phone fit (L14)", tests/browser/footer-option-b.spec.ts).
test('with the switch on the footer keeps the locked heights: 844 at 390, 890 at 768, 575 at 1440', async ({
  page,
}) => {
  const caps = { 390: 844, 768: 890, 1440: 575 } as const;
  for (const [width, cap] of Object.entries(caps)) {
    const footer = await open(page, { width: Number(width) });
    // The caps are measured with the doors on the page, so a footer without them cannot pass.
    await expect(footer.locator('.guide-footer-access a')).toHaveCount(3);
    const height = (await footer.boundingBox())!.height;
    expect(height, `footer height at ${width}`).toBeLessThanOrEqual(cap);
  }
});

test('with the switch on every family group starts closed on a phone, and nothing is dropped', async ({
  page,
}) => {
  const footer = await open(page, { width: 390 });
  const groups = footer.locator('nav.guide-footer-groups details.guide-footer-details');
  await expect(groups).toHaveCount(4);
  for (let index = 0; index < 4; index += 1)
    await expect(groups.nth(index), `group ${index}`).not.toHaveAttribute('open', /.*/);
  // The same sixteen links are in the page while closed.
  await expect(footer.locator('nav.guide-footer-groups a')).toHaveCount(16);
  // A group opens with a tap.
  await groups.first().locator('summary').click();
  await expect(groups.first()).toHaveAttribute('open', '');
});

test('with the switch off the footer is the one it was: Sign In, the workspace line, Buy Abroad open', async ({
  page,
}) => {
  const footer = await open(page, { doors: false, width: 390 });
  await expect(footer.locator('section.guide-footer-access')).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Sign In', exact: true })).toHaveAttribute(
    'href',
    '/signin',
  );
  await expect(
    footer.getByRole('link', { name: 'Open Your Workspace', exact: true }),
  ).toHaveAttribute('href', '/workspace');
  await expect(footer.locator('details.guide-footer-details').first()).toHaveAttribute('open', '');
});

test('signed in, the doors give way to the workspace button and Sign In never appears', async ({
  page,
}) => {
  const footer = await open(page, { signedIn: true });
  await expect(footer.locator('section.guide-footer-access')).toHaveCount(0);
  await expect(
    footer.getByRole('link', { name: 'Open Your Workspace', exact: true }),
  ).toHaveAttribute('href', '/account');
  await expect(footer.getByRole('link', { name: 'Start a Request', exact: true })).toHaveAttribute(
    'href',
    '/plan',
  );
  await expect(footer.getByRole('link', { name: 'Sign In', exact: true })).toHaveCount(0);
});

test('the request page keeps its compact footer, and the staff preview shows no account actions', async ({
  page,
}) => {
  const plan = await open(page, { path: '/plan', width: 390 });
  await expect(plan.locator('section.guide-footer-access')).toHaveCount(0);
  await expect(plan).toHaveClass(/guide-footer-compact/);
  await expect(plan.getByRole('link', { name: 'Sign In', exact: true })).toHaveAttribute(
    'href',
    '/signin',
  );
  const staff = await open(page, { path: '/operator/view-as/customer', width: 390 });
  await expect(staff.locator('section.guide-footer-access')).toHaveCount(0);
  await expect(staff.locator('.guide-footer-actions')).toHaveCount(0);
});

test('the server wrapper reads the switch and hands it down', () => {
  const read = (file: string) => readFileSync(resolve('apps/web/components', file), 'utf8');
  expect(read('site-footer.tsx')).toContain("accessDoors={uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS')}");
  expect(read('site-footer-place.tsx')).toContain('accessDoors={accessDoors}');
});
