import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v4.1 L9 on the helper home (audit rows public-customer-06, -16, -18 and -19). The real task board with the real
// styles on a small bundled page (no server, no sign-in); the task read is answered by the test. It proves: one next
// step card with the one primary action when two tasks wait, the other task as a row that still opens and can be
// accepted with the same payload, no id shown as the reviewer, plain words, a hint on the acceptance field, facts whose
// name and value look different, and full-size disclosure lines.

const fixturePath = '/__v41-f2-c-helper';
const reviewer = '977cf051-ff6a-47e9-b313-b9d513bce566';
let html = '';

const task = (id: string, kind: string, status: string) => ({
  id,
  version: 1,
  status,
  deadline: '2026-12-01T02:49:00.000Z',
  expiresAt: '2026-12-02T02:49:00.000Z',
  reviewer,
  disclosure: {
    kind,
    market: 'CN',
    workCountry: 'DE',
    location: 'Remote desk',
    instructions: 'Collect declared public information about the listed suppliers.',
    evidenceRequired: 'Public source links only',
    effort: 'About two hours',
    dataHandling: 'No personal data',
    cancellationTerms: 'May be cancelled before acceptance',
    disputeTerms: 'Owner decides disputes',
  },
  reward: null,
  history: [
    {
      version: 1,
      action: 'ASSIGN',
      reason: 'First assignment',
      createdAt: '2026-11-20T08:00:00.000Z',
      details: {},
    },
  ],
  obligations: null,
});
const twoWaiting = [
  task('11111111-1111-4111-8111-111111111111', 'SUPPLIER_RESEARCH', 'ASSIGN'),
  task('22222222-2222-4222-8222-222222222222', 'FAIR_VISIT', 'ASSIGN'),
];

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { TaskBoard } from ${JSON.stringify(resolve('apps/web/app/contributor/task-board.tsx'))};
        createRoot(document.getElementById('app')).render(
          <main id="main" className="operator-page ux-workspace"><h1>Your assigned tasks.</h1><TaskBoard workspace="33333333-3333-4333-8333-333333333333" /></main>,
        );`,
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
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = ['app/globals.css', 'app/contributor/next-step.css', 'app/contributor/task-board.css']
    .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Helper tasks fixture</title><style>${css}</style></head><body><div id="app"></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

async function open(page: Page, width: number, tasks: unknown[]) {
  const posted: unknown[] = [];
  await page.route('**/api/network/tasks**', async (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: tasks });
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: 844 });
  await page.goto(fixturePath);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  return posted;
}

for (const width of [320, 390, 768, 1440]) {
  test(`two waiting tasks at ${width}: one next step card with the one primary`, async ({
    page,
  }) => {
    await open(page, width, twoWaiting);
    await expect(page.locator('main .primary-link')).toHaveCount(1);
    const card = page.locator('article.helper-next');
    await expect(card).toHaveCount(1);
    await expect(card.getByText('Your next step', { exact: true })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Supplier research' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept the Disclosed Task' })).toHaveClass(
      /primary-link/,
    );
    // The other task is a closed row, with its name, its state and the quiet word Open.
    const row = page.locator('details.helper-task-row');
    await expect(row).toHaveCount(1);
    await expect(row).not.toHaveAttribute('open', '');
    await expect(row.locator('> summary')).toContainText('Fair visit');
    await expect(row.locator('> summary')).toContainText('Assigned');
    await expect(row.locator('> summary')).toContainText('Open');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (process.env.F2C_SHOTS)
      await page.screenshot({
        path: `${process.env.F2C_SHOTS}/helper-${width}.png`,
        fullPage: true,
      });
  });
}

test('the other task still opens and is accepted with the same payload', async ({ page }) => {
  const posted = await open(page, 390, twoWaiting);
  const row = page.locator('details.helper-task-row');
  await row.locator('summary').first().click();
  const accept = row.getByRole('button', { name: 'Accept the Disclosed Task' });
  await expect(accept).toBeVisible();
  await expect(accept).not.toHaveClass(/primary-link/);
  await expect(page.locator('main .primary-link')).toHaveCount(1);
  await row.getByLabel('Acceptance and relationship confirmation').fill('I accept and have no tie');
  await accept.click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({
    taskId: '22222222-2222-4222-8222-222222222222',
    version: 1,
    action: 'ACCEPT',
    reason: 'I accept and have no tie',
    details: { kind: 'decision' },
  });
});

test('no id is shown as the reviewer and the words are plain', async ({ page }) => {
  await open(page, 390, twoWaiting);
  await page.locator('details.helper-task-row > summary').click();
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(text).toContain('Independent reviewer');
  // The live words are kept: only a raw status code ("Assign ·") is made plain.
  for (const kept of [
    'EXACT ASSIGNMENT',
    'Accept the Disclosed Task',
    'Acceptance and relationship confirmation',
  ])
    expect(text).toContain(kept);
  expect(text).not.toContain('Assign ·');
  await expect(page.getByText('Assigned · China · work country Germany').first()).toBeVisible();
});

test('the acceptance field keeps its live label, and a fact name and value look different', async ({
  page,
}) => {
  await open(page, 390, twoWaiting);
  const card = page.locator('article.helper-next');
  const field = card.getByLabel('Acceptance and relationship confirmation');
  await expect(field).toHaveAttribute('name', 'reason');
  const styles = await card.evaluate((node) => {
    const read = (selector: string) => {
      const style = getComputedStyle(node.querySelector(selector)!);
      return { weight: style.fontWeight, size: style.fontSize, colour: style.color };
    };
    return { dt: read('dt'), dd: read('dd') };
  });
  expect(styles.dt.weight).not.toBe(styles.dd.weight);
  expect(styles.dt.size).not.toBe(styles.dd.size);
  expect(styles.dt.colour).not.toBe(styles.dd.colour);
});

test('no address is linked twice inside main on the task board', async ({ page }) => {
  await open(page, 390, twoWaiting);
  await page.locator('details.helper-task-row > summary').click();
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((list) => list.map((node) => node.getAttribute('href')));
  expect(hrefs.filter((href, index) => hrefs.indexOf(href) !== index)).toEqual([]);
});

test('a single task that does not wait for the helper has no primary and stays open', async ({
  page,
}) => {
  await open(page, 390, [
    task('44444444-4444-4444-8444-444444444444', 'SUPPLIER_RESEARCH', 'SUBMIT'),
  ]);
  await expect(page.locator('main .primary-link')).toHaveCount(0);
  await expect(page.getByText('Your task', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Submitted · China · work country Germany', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request Dispute Review' })).toBeVisible();
});

for (const width of [320, 390, 768]) {
  test(`disclosure lines are full touch targets at ${width}`, async ({ page }) => {
    await open(page, width, twoWaiting);
    const history = page
      .locator('article.helper-next summary')
      .filter({ hasText: 'Work and review history' });
    expect((await history.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const row = page.locator('details.helper-task-row > summary');
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
}
