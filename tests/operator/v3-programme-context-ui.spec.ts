import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';import {ProgrammeContextEditor} from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-context-editor.tsx'))};const root=createRoot(document.getElementById('fixture'));const query=new URLSearchParams(location.search);const initial={subject:'synthetic-bob',issuer:${JSON.stringify(issuer)},programmeId:'00000000-0000-4000-8000-000000000005',...(query.get('mode')==='participant'?{registrationId:'00000000-0000-4000-8000-000000000004'}:{workspaceId:'00000000-0000-4000-8000-000000000006'}),onClose:()=>{}};const router={push:path=>location.assign(path),replace:path=>location.replace(path),back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},hmrRefresh:()=>{},prefetch:async()=>{}};const render=p=>{const all={...initial,...p};root.render(<AppRouterContext.Provider value={router}><ProgrammeContextEditor key={all.issuer+all.subject+all.programmeId+(all.registrationId??all.workspaceId)} {...all}/></AppRouterContext.Provider>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Next replaces browser compile-time environment constants in its real build.
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  expect(
    Object.keys(result.metafile!.inputs).some((path) => path.includes('packages/auth/src')),
  ).toBe(false);
  const javascript = result.outputFiles[0].text;
  // Use the real compiled global CSS/font class, not unprocessed Tailwind source.
  const documentResponse = await fetch('http://127.0.0.1:3200/');
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.text();
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  for (const path of cssPaths) expect(path).toMatch(/^\/_next\/static\/chunks\/[\w.-]+\.css$/);
  const css = Buffer.concat(
    await Promise.all(
      cssPaths.map((path) =>
        readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length))),
      ),
    ),
  );
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(javascript);
    } else if (path === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(path)) {
      void readFile(resolve('apps/web/.next/static', path.slice('/_next/static/'.length)))
        .then((font) => {
          response.setHeader('Content-Type', 'font/woff2');
          response.end(font);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    } else if (path === '/' || path === '/account/delegations') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div><section id="customer-missions"><h2>Existing shared mission section</h2></section></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
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

const programmeId = '00000000-0000-4000-8000-000000000005',
  workspaceId = '00000000-0000-4000-8000-000000000006',
  registrationId = '00000000-0000-4000-8000-000000000004';
const context = {
  version: 1,
  organiser: 'Synthetic organiser',
  marketCode: 'EU',
  purpose: 'Synthetic factory programme',
  startsAt: '2026-12-01T09:00:00+06:00',
  endsAt: '2026-12-03T17:00:00+06:00',
  timezone: 'Asia/Dhaka',
  updatedAt: '2026-10-18T00:00:00Z',
};
function snapshot(participant = false) {
  return {
    programmeId,
    synthetic: true,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    context,
    ...(participant
      ? { registrationId }
      : { workspaceId, currentVersion: 1, shared: true, reason: 'Synthetic original planning' }),
  };
}
test('owner saves exact scope, date offsets, version and explicit participant sharing', async ({
  page,
}) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/customer-programme-context**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: snapshot() });
    command = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ...snapshot(),
        commandId: command!.commandId,
        currentVersion: 2,
        context: { ...context, version: 2 },
      },
    });
  });
  await page.goto(origin);
  await page.getByLabel('Reason for change', { exact: true }).fill('Synthetic revised reason');
  await page.getByLabel('I confirm these are fictional planning details only.').check();
  await page.getByRole('button', { name: 'Save programme details', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Programme details saved.');
  expect(command).toMatchObject({
    workspaceId,
    programmeId,
    expectedVersion: 1,
    startsAt: context.startsAt,
    shared: true,
    reason: 'Synthetic revised reason',
  });
  expect(command).not.toHaveProperty('ownerId');
});
test('short change reason stays editable without sending a rejected save', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-context**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: snapshot() });
    const body = route.request().postDataJSON();
    commands.push(body);
    return route.fulfill({
      json: {
        ...snapshot(),
        commandId: body.commandId,
        currentVersion: 2,
        context: { ...context, version: 2 },
      },
    });
  });
  await page.goto(origin);
  const reason = page.getByLabel('Reason for change', { exact: true });
  await reason.fill('');
  await reason.pressSequentially('ab');
  await page.getByLabel('I confirm these are fictional planning details only.').check();
  await page.getByRole('button', { name: 'Save programme details', exact: true }).click();
  expect(await reason.evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  expect(commands).toHaveLength(0);
  await expect(reason).toHaveValue('ab');
  await reason.pressSequentially('c');
  await page.getByRole('button', { name: 'Save programme details', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Programme details saved.');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    reason: 'abc',
    workspaceId,
    programmeId,
    expectedVersion: 1,
  });
});
test('wrong acknowledgement retains exact command for safe retry', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-programme-context**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: snapshot() });
    const body = route.request().postDataJSON();
    commands.push(body);
    return route.fulfill({
      json: {
        ...snapshot(),
        currentVersion: 2,
        context: { ...context, version: 2 },
        commandId: commands.length === 1 ? 'wrong' : body.commandId,
      },
    });
  });
  await page.goto(origin);
  await page.getByLabel('I confirm these are fictional planning details only.').check();
  await page.getByRole('button', { name: 'Save programme details', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Retry same save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Programme details saved.');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('participant reads shared details without organiser editing controls', async ({ page }) => {
  await page.route('**/api/customer-programme-context**', (route) =>
    route.fulfill({ json: snapshot(true) }),
  );
  await page.goto(origin + '/?mode=participant');
  await expect(page.getByText(context.organiser, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save programme details' })).toHaveCount(0);
});
for (const status of [403, 409, 503])
  test('save ' + status + ' clears stale details and offers recovery', async ({ page }) => {
    await page.route('**/api/customer-programme-context**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: snapshot() })
        : route.fulfill({ status, json: { error: 'Unavailable' } }),
    );
    await page.goto(origin);
    await page.getByLabel('I confirm these are fictional planning details only.').check();
    await page.getByRole('button', { name: 'Save programme details', exact: true }).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText(context.organiser, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload programme details' })).toBeVisible();
  });
test('snapshot expiry clears details and draft without extending permission', async ({ page }) => {
  await page.route('**/api/customer-programme-context**', (route) =>
    route.fulfill({ json: { ...snapshot(), expiresAt: new Date(Date.now() + 600).toISOString() } }),
  );
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('must be checked again');
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('dirty close asks before discarding local draft', async ({ page }) => {
  await page.route('**/api/customer-programme-context**', (route) =>
    route.fulfill({ json: snapshot() }),
  );
  await page.goto(origin);
  await page.getByLabel('Reason for change', { exact: true }).fill('Synthetic unsaved change');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Close programme details' }).click();
  await expect(page.getByLabel('Reason for change', { exact: true })).toHaveValue(
    'Synthetic unsaved change',
  );
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/customer-programme-context**', (route) =>
      route.fulfill({ json: snapshot() }),
    );
    await page.goto(origin);
    await expect(page.getByLabel('Reason for change', { exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (width === 320) {
      await mkdir('.cache/v3-programme-context/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-programme-context/after/organiser-320.png',
        fullPage: true,
      });
    }
  });
