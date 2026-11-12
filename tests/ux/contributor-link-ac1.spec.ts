import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lane 8: the contributor left bar and the link-based /buyer reply page in the AC/1 look. Both are mounted from
// the real components and real stylesheets on a small local page (no sign-in, no database, no email). The checks
// read computed styles, so they fail on a page that still has the navy bar or the square, thin-ringed fields.

let server: Server;
let origin: string;
let navHtml = '';
let replyBundle = '';
let replyCss = '';
const appCss = (file: string) =>
  existsSync(resolve('apps/web', file)) ? readFileSync(resolve('apps/web', file), 'utf8') : '';
const token = 'a1'.repeat(32);

const view = {
  role: 'SUPPLIER',
  sharedRequirements: 'Curtain track, 4 metres, white, about 1,200 pieces.',
  sharedUncertainty: 'Buyer budget is not verified.',
  allowQuotation: true,
  allowMeetingInterest: true,
  introduction: {
    company: 'Example Hospitality Group',
    country: 'Spain',
    capability: 'Hotel interior fit-out',
    fit: 'They buy track hardware in volume.',
    evidence: 'Operator reported.',
    uncertainty: 'Not independently verified.',
    conversationPurpose: 'Discuss a curtain track supply',
    availableDates: 'Weeks 3 and 4',
  },
  template: 'You were introduced by the Corridra team.',
  expiresAt: '2099-01-01T00:00:00Z',
  decision: null,
  synthetic: true,
};

test.beforeAll(async () => {
  const stub = {
    name: 'next-link-stub',
    setup(b: import('esbuild').PluginBuild) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents:
          'export default function Link({ href, children, prefetch, ...rest }) { return <a href={href} {...rest}>{children}</a>; }',
        loader: 'tsx',
        resolveDir: resolve('apps/web'),
      }));
    },
  };
  const common = {
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'esm' as const,
    platform: 'browser' as const,
    jsx: 'automatic' as const,
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  };
  const nav = await build({
    ...common,
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { LeftNavFrame, LeftNavList } from ${JSON.stringify(resolve('apps/web/components/ux/left-nav.tsx'))};
        const words = { navLabel: 'Contributor sections', menuLabel: 'Sections', closeLabel: 'Close sections', collapseLabel: 'Collapse sections', expandLabel: 'Expand sections' };
        const items = [
          { key: 'tasks', label: 'Your tasks', href: '/tasks', icon: 'home' },
          { key: 'how', label: 'How assigned work works', href: '/how', icon: 'chevron' },
        ];
        createRoot(document.getElementById('app')).render(
          <LeftNavFrame navId="contributor-navigation" words={words} dir="ltr"
            nav={<LeftNavList id="contributor-navigation" label="Contributor sections" items={items} current="tasks" />}>
            <main id="main" tabIndex={-1}><h1>Your tasks</h1><p>Page text.</p></main>
          </LeftNavFrame>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    loader: { '.css': 'empty' },
    plugins: [stub],
  });
  // Every sheet the contributor bar can meet, the navy Team sheet included, then the contributor's own.
  const sheets = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/left-nav.css',
    'components/ux/team-nav.css',
    'components/ux/contributor-frame.css',
  ]
    .map(appCss)
    .join('\n');
  navHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contributor bar fixture</title><style>${sheets}</style></head><body><header class="site-header ux-app-header"></header><div id="app"></div><script type="module">${nav.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;

  const reply = await build({
    ...common,
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
        import{BuyerIntroduction}from ${JSON.stringify(resolve('apps/web/app/buyer/introduction.tsx'))};
        createRoot(document.getElementById('fixture')).render(
          <main className="operator-page ux-workspace"><h1>Private introduction</h1><BuyerIntroduction replyPage={true} chineseReleased={true}/></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    loader: { '.css': 'css' },
  });
  replyBundle = reply.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  replyCss = reply.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/nav') {
      res.setHeader('content-type', 'text/html');
      res.end(navHtml);
    } else if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(replyBundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${appCss('app/globals.css')}\n${replyCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reply fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const widths = [320, 390, 768, 1440];
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

test('the contributor bar is a white rail with a cobalt current item on the selected surface', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/nav`);
  const style = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        bg: c.backgroundColor,
        color: c.color,
        weight: c.fontWeight,
        edge: c.borderInlineStartColor,
        edgeWidth: c.borderInlineStartWidth,
      };
    });
  // The navy panel (rgb(20, 36, 56)) is gone: the bar's own surface is clear over the white rail.
  expect((await style('#contributor-navigation')).bg).toBe('rgba(0, 0, 0, 0)');
  const current = await style('#contributor-navigation a[aria-current="page"]');
  expect(current).toMatchObject({
    bg: 'rgb(231, 238, 255)',
    color: 'rgb(30, 66, 149)',
    weight: '600',
    edge: 'rgb(40, 86, 197)',
    edgeWidth: '3px',
  });
  const other = await style('#contributor-navigation li:nth-child(2) a');
  expect(other).toMatchObject({ bg: 'rgba(0, 0, 0, 0)', color: 'rgb(75, 90, 108)', weight: '500' });
  expect(contrast(current.color, current.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(other.color, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(4.5);
});

test('keyboard focus on a bar item is a 3 px cobalt ring, and the selected item stays visible in forced colours', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/nav`);
  await page.locator('#contributor-navigation li:nth-child(2) a').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const ring = await page.locator('#contributor-navigation li:nth-child(2) a').evaluate((el) => ({
    width: getComputedStyle(el).outlineWidth,
    colour: getComputedStyle(el).outlineColor,
  }));
  expect(ring).toEqual({ width: '3px', colour: 'rgb(40, 86, 197)' });
  await page.emulateMedia({ forcedColors: 'active' });
  const forced = await page
    .locator('#contributor-navigation a[aria-current="page"]')
    .evaluate((el) => ({
      edge: getComputedStyle(el).borderInlineStartColor,
      width: getComputedStyle(el).borderInlineStartWidth,
    }));
  expect(forced.width).toBe('3px');
  expect(forced.edge).not.toBe('rgba(0, 0, 0, 0)');
  await page.locator('#contributor-navigation li:nth-child(2) a').focus();
  const focused = await page
    .locator('#contributor-navigation li:nth-child(2) a')
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(focused).not.toBe('none');
});

for (const width of widths) {
  test(`the contributor bar page has no side scroll and no axe violations at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${origin}/nav`);
    expect(await noSideScroll(page)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
}

async function openReply(page: Page) {
  await page.route('**/api/buyer', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const answer =
      body.action === 'read'
        ? view
        : body.action === 'respond'
          ? { decision: body.decision }
          : { error: 'unexpected' };
    return route.fulfill({
      status: body.action === 'read' || body.action === 'respond' ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });
  await page.goto(`${origin}/#t=${token}`);
  await expect(page.getByRole('button', { name: 'Interested', exact: true })).toBeVisible();
}

// Every control of the reply form, from main before this change: the form keeps each field, name and label.
const quoteControls = [
  'input|What you are quoting',
  'input|Quantity',
  'input|Minimum order',
  'input|Unit',
];

test('the reply form keeps its fields and takes the AC/1 field, notice and card look', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReply(page);
  const sample = await page.locator('.reply-sample').evaluate((el) => {
    const c = getComputedStyle(el);
    return { radius: c.borderTopLeftRadius, bg: c.backgroundColor };
  });
  expect(sample.radius).toBe('999px');
  expect(sample.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.reply').evaluate((el) => getComputedStyle(el).maxWidth)).toBe(
    '768px',
  );
  await page.getByRole('button', { name: 'Interested', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your message' })).toBeVisible();
  await page.getByLabel('Your message to the team').fill('We can quote this.');
  await page.getByRole('button', { name: 'Add a quote' }).click();
  const found: string[] = [];
  for (const spec of quoteControls) {
    const [tag, label] = spec.split('|') as [string, string];
    const field = page.getByLabel(label, { exact: false }).first();
    await expect(field).toBeVisible();
    found.push(`${tag}|${label}|${await field.evaluate((el) => el.tagName.toLowerCase())}`);
  }
  expect(found).toEqual(quoteControls.map((s) => `${s}|input`));
  const input = page.getByLabel('What you are quoting');
  const resting = await input.evaluate((el) => {
    const c = getComputedStyle(el);
    return { radius: c.borderTopLeftRadius, border: c.borderTopColor, minHeight: c.minHeight };
  });
  expect(resting.radius).toBe('8px');
  expect(resting.border).toBe('rgb(164, 177, 194)');
  await input.focus();
  const ring = await input.evaluate((el) => {
    const c = getComputedStyle(el);
    return { width: c.outlineWidth, colour: c.outlineColor };
  });
  expect(ring).toEqual({ width: '3px', colour: 'rgb(40, 86, 197)' });
});

for (const width of widths) {
  test(`the reply page has no side scroll and no axe violations at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openReply(page);
    expect(await noSideScroll(page)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
}
