import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// sharp is a dependency of apps/web only; the tests load that copy.
import type SharpType from '../../apps/web/node_modules/sharp';

// ADR-088 (CI-U1P). The profile picture on My Profile, as a UI protocol fixture: every state (loading, empty, wrong type,
// too large, framing, uploading with progress, slow, failed with a reason, offline with a retry that keeps its command
// id, success, remove with a confirm step), the switch-off state, and axe with no sideways scroll at 320, 390, 768 and
// 1440 px. The route, the database and the store have their own tests; here the API is answered by the test.
const sharp = createRequire(resolve('apps/web/package.json'))('sharp') as typeof SharpType;
const issuer =
  'https://ep-picture-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
type Json = Record<string, unknown>;
let server: Server, origin: string, png: Buffer, webp: Buffer;

test.beforeAll(async () => {
  png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
  webp = await sharp(png).resize(512, 512).webp().toBuffer();
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
import {PersonalProfile} from ${JSON.stringify(resolve('apps/web/app/account/personal-profile.tsx'))};
const q=new URLSearchParams(location.search);
createRoot(document.getElementById('fixture')).render(
 <section className="ux-account-profile ux-account-card" aria-label="Your verified profile">
  <h2>Profile and Identity</h2>
  <PersonalProfile subject="synthetic-alice" issuer=${JSON.stringify(issuer)} name="Synthetic Alice Rahman"
   email="alice@example.invalid" nameEditable={false} detailsEnabled pictureEnabled={q.get('picture')!=='off'}/>
 </section>);`,
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
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
  });
  // The browser bundle carries no server code: no authority, no image processing, no storage.
  const inputs = Object.keys(result.metafile!.inputs);
  for (const server of ['packages/auth/src', 'packages/evidence', 'profile-picture-image', 'sharp'])
    expect(inputs.some((p) => p.includes(server))).toBe(false);
  const javascript = result.outputFiles[0]!.text;
  const css = Buffer.concat(
    await Promise.all(
      [
        'apps/web/app/globals.css',
        'apps/web/components/ux/dialog.css',
        'apps/web/components/ux/utility-menus.css',
        'apps/web/app/account/profile-picture.css',
      ].map((path) => readFile(path)),
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
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic profile picture fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="ux-customer"><h1>Synthetic profile picture fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
      );
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

const details = {
  currentVersion: 0,
  provenance: 'SELF_REPORTED',
  verified: false,
  profile: null,
};
type Api = {
  version: number;
  picture: boolean;
  posts: { headers: Record<string, string>; bytes: number }[];
  deletes: Json[];
  post?: (route: Route) => Promise<void> | void;
};
async function open(page: Page, api: Api, query = '') {
  await page.route('**/api/customer-personal-profile**', (route) =>
    route.fulfill({ json: details }),
  );
  await page.route('**/api/account/picture**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('scope') === 'view')
      return route.fulfill({
        json: {
          currentVersion: api.version,
          picture: api.picture
            ? { version: api.version, updatedAt: '2026-11-17T08:00:00.000Z' }
            : null,
        },
      });
    if (request.method() === 'GET') return route.fulfill({ body: webp, contentType: 'image/webp' });
    if (request.method() === 'POST') {
      api.posts.push({ headers: request.headers(), bytes: request.postDataBuffer()?.length ?? 0 });
      if (api.post) return api.post(route);
      api.version += 1;
      api.picture = true;
      return route.fulfill({
        json: {
          currentVersion: api.version,
          picture: { version: api.version, updatedAt: '2026-11-17T09:00:00.000Z' },
          commandId: request.headers()['x-command-id'],
          replayed: false,
        },
      });
    }
    if (request.method() === 'DELETE') {
      api.deletes.push(request.postDataJSON() as Json);
      api.version += 1;
      api.picture = false;
      return route.fulfill({
        json: { currentVersion: api.version, picture: null, replayed: false },
      });
    }
    return route.fallback();
  });
  await page.goto(origin + '/' + query);
  return page.getByRole('region', { name: 'Your verified profile' });
}
const fresh = (): Api => ({ version: 0, picture: false, posts: [], deletes: [] });
const chooser = (page: Page) => page.locator('input[type=file]:not([capture])');
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('empty: initials stand in, only the person sees it, and the rules are written', async ({
  page,
}) => {
  const card = await open(page, fresh());
  await expect(card.getByRole('heading', { name: 'Profile Picture' })).toBeVisible();
  await expect(card.getByText('No picture yet. Your initials are shown instead.')).toBeVisible();
  await expect(card.getByText('Only you can see your picture.')).toBeVisible();
  await expect(card.getByText(/JPEG, PNG or WebP, up to 8 MB/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Choose a Picture' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove Picture' })).toHaveCount(0);
});

test('wrong type and too large are refused on the device, before anything is sent', async ({
  page,
}) => {
  const api = fresh();
  const card = await open(page, api);
  await chooser(page).setInputFiles({
    name: 'moving.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  });
  await expect(card.getByText('Use a JPEG, PNG or WebP picture.')).toBeVisible();
  await chooser(page).setInputFiles({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await expect(
    card.getByText('This picture is larger than 8 MB. Choose a smaller one.'),
  ).toBeVisible();
  await chooser(page).setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not a picture'),
  });
  await expect(card.getByText(/could not be read/)).toBeVisible();
  expect(api.posts).toEqual([]);
});

test('frame, upload with progress and a slow notice, then success everywhere on the card', async ({
  page,
}) => {
  const api = fresh();
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done));
  api.post = async (route) => {
    await held;
    api.post = undefined;
    api.version = 1;
    api.picture = true;
    await route.fulfill({
      json: {
        currentVersion: 1,
        picture: { version: 1, updatedAt: '2026-11-17T09:00:00.000Z' },
        replayed: false,
      },
    });
  };
  const card = await open(page, api);
  await chooser(page).setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  const dialog = page.getByRole('dialog', { name: 'Frame Your Picture' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('This circle is how your picture will look.')).toBeVisible();
  const stage = dialog.getByRole('group', { name: /Picture position/ });
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await expect(dialog.getByRole('slider', { name: 'Zoom' })).not.toHaveValue('1');
  await dialog.getByRole('button', { name: 'Save Picture' }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Upload progress' })).toBeVisible();
  await expect(
    dialog.getByText('This is taking longer than usual. Keep this page open.'),
  ).toBeVisible({
    timeout: 12000,
  });
  release();
  await expect(card.getByText('Picture saved.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(api.posts).toHaveLength(1);
  const sent = api.posts[0]!;
  expect(sent.headers['x-expected-version']).toBe('0');
  expect(sent.headers['x-command-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(['image/webp', 'image/png']).toContain(sent.headers['content-type']);
  expect(sent.headers['x-corridra-customer-subject']).toBe('synthetic-alice');
  await expect(card.getByRole('img', { name: 'Your profile picture' })).toHaveAttribute(
    'src',
    /size=large&v=1/,
  );
  await expect(card.getByRole('button', { name: 'Change Picture' })).toBeVisible();
});

test('a refused picture says why in plain words, and a lost upload retries with the same command', async ({
  page,
}) => {
  const api = fresh();
  api.post = (route) => route.fulfill({ status: 422, json: { code: 'animated', error: 'x' } });
  const card = await open(page, api);
  await chooser(page).setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  const dialog = page.getByRole('dialog', { name: 'Frame Your Picture' });
  await dialog.getByRole('button', { name: 'Save Picture' }).click();
  await expect(
    dialog.getByText('Moving pictures are not supported. Choose a still picture.'),
  ).toBeVisible();
  api.post = (route) => route.abort('internetdisconnected');
  await dialog.getByRole('button', { name: 'Save Picture' }).click();
  await expect(
    dialog.getByText('The upload did not finish. Check your connection and try again.'),
  ).toBeVisible();
  api.post = undefined;
  await dialog.getByRole('button', { name: 'Save Picture' }).click();
  await expect(card.getByText('Picture saved.')).toBeVisible();
  // The refused try had its own command; the lost one and its retry share one.
  const ids = api.posts.map((p) => p.headers['x-command-id']);
  expect(ids).toHaveLength(3);
  expect(ids[1]).toBe(ids[2]);
  expect(ids[0]).not.toBe(ids[1]);
});

test('remove asks first, then deletes and shows the initials again', async ({ page }) => {
  const api: Api = { ...fresh(), version: 3, picture: true };
  const card = await open(page, api);
  await card.getByRole('button', { name: 'Remove Picture' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove Your Picture?' });
  await expect(confirm.getByText('The stored picture is deleted.', { exact: false })).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep Picture' }).click();
  expect(api.deletes).toEqual([]);
  await card.getByRole('button', { name: 'Remove Picture' }).click();
  await confirm.getByRole('button', { name: 'Remove Picture' }).click();
  await expect(card.getByText('Picture removed.')).toBeVisible();
  await expect(card.getByText('No picture yet. Your initials are shown instead.')).toBeVisible();
  expect(api.deletes).toHaveLength(1);
  expect(api.deletes[0]).toMatchObject({ expectedVersion: 3 });
});

test('switched off: no picture row and no picture request', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/account/picture'))
      asked.push(request.url());
  });
  const card = await open(page, fresh(), '?picture=off');
  await expect(card.getByText('Verified account email')).toBeVisible();
  await expect(card.getByRole('button', { name: /^Edit / }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card.getByRole('heading', { name: 'Profile Picture' })).toHaveCount(0);
  expect(asked).toEqual([]);
});

for (const width of [320, 390, 768, 1440])
  test(`axe clean with no sideways scroll at ${width} px, empty and framing`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const card = await open(page, fresh());
    await expect(card.getByRole('button', { name: 'Choose a Picture' })).toBeVisible();
    expect(await noSideways(page)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('section.ux-account-profile').analyze()).violations,
    ).toEqual([]);
    if (width <= 768) {
      const box = await card.getByRole('button', { name: 'Choose a Picture' }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await chooser(page).setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    const dialog = page.getByRole('dialog', { name: 'Frame Your Picture' });
    await expect(dialog).toBeVisible();
    expect(await noSideways(page)).toBe(true);
    expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  });
