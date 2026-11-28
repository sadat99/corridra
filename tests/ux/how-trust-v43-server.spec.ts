import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// /how-it-works, /trust and the home with CORRIDRA_UX_HOW_TRUST_V43 exactly "true" (and the home page v4.3 on), as the
// server sends them (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build it"). The switch is read
// when the page is built, and the shared UX server is built with it unset, so this spec builds the switch-on app beside
// it (`.next/how-trust-v43`, through CORRIDRA_NEXT_DIST_DIR) and serves that build on its own port. It checks what the
// layout and Next.js decide: the server HTML of the three pages and their stylesheet, the v4.3 header and footer on the
// deep pages, reading with no script, the links from the home into the two pages and back, and no sideways scroll on
// the real pages. The width and content matrix is in how-trust-v43.spec.ts on the shared build.

const web = resolve('apps/web');
const distDir = '.next/how-trust-v43';
const port = 3193;
const origin = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('pnpm', ['exec', 'next', ...args], { cwd: web, env, stdio: 'inherit' });
  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) throw new Error(`next ${args.join(' ')} exited ${code}`);
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  // HOW_TRUST_V43_REUSE=1: a switch-on server for this build is already listening on the port (a local shortcut).
  if (process.env.HOW_TRUST_V43_REUSE === '1') return;
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    CORRIDRA_UX_HOME_V43: 'true',
    // This spec is about the page of before home v4.4, which is live by default since 28 Nov 2026; exactly "false" gives it.
    CORRIDRA_UX_HOME_V44: 'false',
    CORRIDRA_UX_HOW_TRUST_V43: 'true',
    CORRIDRA_NEXT_DIST_DIR: distDir,
    CORRIDRA_LANGUAGES_REVIEWED: 'ar,bn',
    CORRIDRA_LANGUAGES_PAGES: 'ar,bn',
    CORRIDRA_SUPPORT_WHATSAPP_NUMBER: '+8801700000000',
  };
  // `next build` adds its output's type folder to the app's tsconfig.json; that file is tracked, so it is put back.
  const tsconfig = resolve(web, 'tsconfig.json');
  const kept = readFileSync(tsconfig, 'utf8');
  try {
    await run(['build'], env);
  } finally {
    writeFileSync(tsconfig, kept);
  }
  server = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', `${port}`],
    { cwd: web, env, stdio: 'ignore' },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(origin + '/')).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the switch-on server did not start');
    await new Promise((done) => setTimeout(done, 500));
  }
});
test.afterAll(() => {
  server?.kill();
});

const at = (path: string) => origin + path;
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const main = (html: string) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

for (const [path, title] of [
  ['/how-it-works', 'How it works | Corridra'],
  ['/trust', 'Trust and evidence | Corridra'],
] as const) {
  test(`${path}: the server HTML holds the deep page, the v4.3 header and footer, and links its stylesheet`, async ({
    request,
  }) => {
    const response = await request.get(at(path));
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain(`<title>${title}</title>`);
    const body = main(html);
    expect(body).toContain('htv43');
    expect(body).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
    expect(count(body, '<h1')).toBe(1);
    expect(count(body, 'href="/plan"')).toBe(1);
    expect(body).not.toContain('Show More');
    expect(body).not.toContain('guide-more');
    expect(body).not.toContain('role="tablist"');
    expect(html.slice(html.indexOf('<header'), html.indexOf('</header>'))).toContain(
      'data-v43="true"',
    );
    expect(html.slice(html.indexOf('<footer'), html.indexOf('</footer>'))).toContain(
      'guide-footer-pack',
    );
    const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
    const css = await Promise.all(
      sheets.map(async (sheet) => (await request.get(new URL(sheet, origin).href)).text()),
    );
    expect(
      css.some((text) => text.includes('.htv43')),
      'a linked stylesheet holds .htv43',
    ).toBe(true);
  });

  test(`${path}: with no script the page reads, every in-page link has its target and one request can start`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at(path));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const href of await page
      .locator('.htv43-toc a')
      .evaluateAll((all) => all.map((a) => a.getAttribute('href')!)))
      await expect(page.locator(href), href).toHaveCount(1);
    expect(await noSideways(page)).toBe(0);
    await page.locator('#start-request a').click();
    await expect(page).toHaveURL(/\/plan/);
    await context.close();
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const)
    test(`${path} at ${width}px: no sideways scroll, axe clean, and the header's Start a Request is the only other one`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(at(path));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await noSideways(page)).toBe(0);
      await expect(page.locator('main a:text("Start a Request")')).toHaveCount(1);
      const found = (await new AxeBuilder({ page }).include('main').analyze()).violations;
      expect(found.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
}

test('the home keeps two summaries; each one goes to its page, and every anchor of the header and footer still has a target', async ({
  request,
  page,
}) => {
  const html = await (await request.get(at('/'))).text();
  const body = main(html);
  for (const id of ['process', 'trust', 'questions', 'inbound', 'start', 'brief'])
    expect(count(body, `id="${id}"`), id).toBe(1);
  for (const id of ['who', 'people', 'limits']) expect(count(body, `id="${id}"`), id).toBe(0);
  expect(body).not.toContain('hv43-stages');
  expect(body).not.toContain('hv43-ledger');
  expect(body).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/'));
  await page.locator('section#process a[href="/how-it-works"]').click();
  await expect(page).toHaveURL(at('/how-it-works'));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One commercial objective.');
  await page.goto(at('/'));
  await page.locator('section#trust a[href="/trust"]').click();
  await expect(page).toHaveURL(at('/trust'));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know what is claimed.');
  // The links of the header and the footer that point into the home still land on a section that is there.
  await page.goto(at('/'));
  for (const id of ['service-source', 'service-sell', 'service-delegation', 'inbound', 'questions'])
    await expect(page.locator(`#${id}`), id).toHaveCount(1);
});

test('the header and footer destinations of the deep pages are the ones the home has, each once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(at('/trust'));
  const footer = page.locator('footer.guide-footer-pack');
  for (const href of ['/how-it-works', '/trust', '/corridors', '/#questions'])
    await expect(footer.locator(`a[href="${href}"]`), href).toHaveCount(1);
});
