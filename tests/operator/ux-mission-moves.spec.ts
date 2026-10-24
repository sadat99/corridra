import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The staff panel for setting a Move (Lane 7 of the UX update), mounted with the real stylesheets and
// the interface answered by the test. Proves what the Corridra team sees and sends: the open Moves,
// the form with its limits, a replace-all set with a replay-safe command id, done, clear, the history,
// and the plain message when the authenticator check is stale. No database, no customer.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111';
const mission = '22222222-2222-4222-8222-222222222222';

type Row = {
  id: string;
  verb: string;
  object: string;
  holder: string;
  dueOn: string | null;
  position: number;
  setAt: string;
  setBy: string;
  closed: null | { outcome: 'DONE' | 'CLEARED'; at: string; by: string };
};
const row = (over: Partial<Row>): Row => ({
  id: crypto.randomUUID(),
  verb: 'Add',
  object: 'your import licence number',
  holder: 'customer',
  dueOn: null,
  position: 1,
  setAt: '2026-10-20T09:00:00Z',
  setBy: 'staff',
  closed: null,
  ...over,
});

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{MissionMoves}from ${JSON.stringify(resolve('apps/web/app/operator/mission-moves.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Mission</h1><h2>Requests</h2><h3>One request</h3><MissionMoves tenant=${JSON.stringify(tenant)} missionId=${JSON.stringify(mission)}/></main>);`,
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
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moves fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** Answers the team interface from a small in-memory history and records every command it receives. */
async function open(page: Page, rows: Row[], failure?: { status: number; error: string }) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/move/staff**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
    const body = JSON.parse(request.postData() ?? '{}');
    sent.push(body);
    if (failure)
      return route.fulfill({
        status: failure.status,
        contentType: 'application/json',
        body: JSON.stringify({ error: failure.error }),
      });
    if (body.action === 'set') {
      for (const open of rows.filter((r) => !r.closed))
        open.closed = { outcome: 'CLEARED', at: new Date().toISOString(), by: 'staff' };
      body.moves.forEach((m: Row, index: number) => rows.push(row({ ...m, position: index + 1 })));
    }
    if (body.action === 'done') {
      const found = rows.find((r) => r.id === body.moveId);
      if (found) found.closed = { outcome: 'DONE', at: new Date().toISOString(), by: 'staff' };
    }
    if (body.action === 'clear')
      for (const open of rows.filter((r) => !r.closed))
        open.closed = { outcome: 'CLEARED', at: new Date().toISOString(), by: 'staff' };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ replayed: false, commandId: body.commandId }),
    });
  });
  await page.goto(`${origin}/`);
  return sent;
}

test('shows the open Moves with who holds them, and says plainly when there are none', async ({
  page,
}) => {
  await open(page, [
    row({ verb: 'Confirm', object: 'your visit dates', holder: 'team', dueOn: '2026-11-05' }),
  ]);
  await expect(
    page.getByRole('heading', { name: /Moves for the person who sent this request/ }),
  ).toBeVisible();
  await expect(page.getByText('Confirm your visit dates')).toBeVisible();
  await expect(page.getByText(/The Corridra team · due 2026-11-05/)).toBeVisible();
  await page.unroute('**/api/move/staff**');
  await open(page, []);
  await expect(page.getByText('No open Moves.')).toBeVisible();
});

test('sets Moves as one replacement, with the limits of the words on the form', async ({
  page,
}) => {
  const sent = await open(page, [row({ object: 'an older move' })]);
  await expect(page.getByLabel('What, in a few words')).toHaveAttribute('maxlength', '80');
  await expect(page.getByLabel('Verb').locator('option')).toHaveText([
    'Read',
    'Answer',
    'Add',
    'Confirm',
    'Choose',
    'Send',
  ]);
  await page.getByLabel('Verb').selectOption('Confirm');
  await page.getByLabel('What, in a few words').fill('your visit dates');
  await page.getByLabel('Who holds it').selectOption('team');
  await page.getByRole('button', { name: 'Set these Moves' }).click();
  await expect(page.getByText('Moves set.')).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    action: 'set',
    missionId: mission,
    moves: [{ verb: 'Confirm', object: 'your visit dates', holder: 'team', dueOn: null }],
  });
  expect(String(sent[0].commandId)).toMatch(/^[0-9a-f-]{36}$/);
  // The earlier Move is now history, and the new one is open.
  await expect(page.getByText('Confirm your visit dates')).toBeVisible();
  await page.getByText(/History \(1 closed\)/).click();
  await expect(page.getByText(/an older move/)).toBeVisible();
});

test('offers at most five Moves in one set', async ({ page }) => {
  await open(page, []);
  for (let i = 0; i < 4; i += 1)
    await page.getByRole('button', { name: 'Add another Move' }).click();
  await expect(page.getByRole('group', { name: /Move \d/ })).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Add another Move' })).toHaveCount(0);
});

test('marks one done and clears all, each as its own command', async ({ page }) => {
  const first = row({ object: 'the first thing' });
  const sent = await open(page, [first, row({ object: 'the second thing', position: 2 })]);
  await page.getByRole('button', { name: 'Mark done' }).first().click();
  await expect(page.getByText('Marked done.')).toBeVisible();
  expect(sent[0]).toMatchObject({ action: 'done', moveId: first.id, missionId: mission });
  await page.getByRole('button', { name: 'Clear all open Moves' }).click();
  await expect(page.getByText('Moves cleared.')).toBeVisible();
  expect(sent[1]).toMatchObject({ action: 'clear', missionId: mission });
  expect(sent[0].commandId).not.toBe(sent[1].commandId);
});

test('says the plain reason when a Move is refused, and keeps what was typed', async ({ page }) => {
  await open(page, [], { status: 401, error: 'Verify your authenticator again to continue' });
  await page.getByLabel('What, in a few words').fill('your visit dates');
  await page.getByRole('button', { name: 'Set these Moves' }).click();
  await expect(page.getByText('Verify your authenticator again to continue')).toBeVisible();
  await expect(page.getByLabel('What, in a few words')).toHaveValue('your visit dates');
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide: no sideways scroll and no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, [row({ verb: 'Confirm', object: 'your visit dates', holder: 'team' })]);
    await expect(page.getByText('Confirm your visit dates')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
