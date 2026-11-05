import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
// Actual component protocol fixtures, not provider or database acceptance.
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const workspaceId = '00000000-0000-4000-8000-000000000006';
let server: Server, origin: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {OrganisationProfile} from ${JSON.stringify(resolve('apps/web/app/account/profile/organisation-profile.tsx'))};const root=createRoot(document.getElementById('fixture'));const initial={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},workspaceId:${JSON.stringify(workspaceId)}};const render=p=>{const all={...initial,...p};root.render(<OrganisationProfile key={all.issuer+all.subject+all.workspaceId} {...all}/>)};render({});window.addEventListener('fixture-customer-change',event=>render(event.detail));`,
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
    } else if (path === '/' || path === '/account/profile') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic component protocol fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="main" tabindex="-1" class="operator-page ux-workspace ux-customer" style="max-width:960px;margin:24px auto;padding:16px"><h1>Synthetic component protocol fixture</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
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

const profile = {
  version: 1,
  legalName: 'Synthetic Dhaka Garments Limited',
  countryCode: 'BD',
  website: 'https://garments.example',
  commercialRoles: ['SELLER', 'MANUFACTURER'],
  sectors: ['Knitwear', 'Denim'],
  sizeBand: '201-1000',
  summary: 'Synthetic exporter of knit and denim garments',
  updatedAt: '2026-10-19T00:00:00Z',
};
function view(
  options: { canEdit?: boolean; empty?: boolean; version?: number; ttl?: number } = {},
) {
  const version = options.empty ? 0 : (options.version ?? 1);
  return {
    workspaceId,
    expiresAt: new Date(Date.now() + (options.ttl ?? 60000)).toISOString(),
    organisationId: null,
    canonicalLinked: false,
    provenance: 'SELF_REPORTED',
    verified: false,
    canEdit: options.canEdit ?? true,
    currentVersion: version,
    profile: options.empty
      ? null
      : {
          ...profile,
          version,
          ...((options.canEdit ?? true) ? { reason: 'Synthetic original profile' } : {}),
        },
  };
}
const history = {
  workspaceId,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  revisions: [
    {
      version: 1,
      reason: 'Synthetic original profile',
      createdAt: '2026-10-19T00:00:00Z',
      byYou: true,
    },
  ],
  nextBefore: null,
};
async function mock(
  page: Page,
  handler: {
    get?: () => unknown;
    post?: (body: Record<string, unknown>) => { status?: number; json: unknown };
    seen?: { headers: Record<string, string>[]; urls: string[] };
  } = {},
) {
  await page.route('**/api/customer-organisation-profiles**', (route) => {
    const request = route.request();
    handler.seen?.headers.push(request.headers());
    handler.seen?.urls.push(request.url());
    if (request.method() === 'GET')
      return route.fulfill({
        json:
          new URL(request.url()).searchParams.get('scope') === 'history'
            ? history
            : (handler.get?.() ?? view()),
      });
    const out = handler.post!(request.postDataJSON());
    return route.fulfill({ status: out.status ?? 200, json: out.json });
  });
}
async function fillRequired(page: Page, reason = 'Synthetic revised profile') {
  await page.getByLabel('Reason for this change', { exact: true }).fill(reason);
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
}
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save company profile', exact: true });

test('an empty workspace invites the owner to add a profile and shows the unverified boundary', async ({
  page,
}) => {
  await mock(page, { get: () => view({ empty: true }) });
  await page.goto(origin);
  await expect(page.getByRole('status')).toHaveText(
    'No company profile yet. Add your sample details below.',
  );
  await expect(page.getByText('self-reported', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('not linked to any company record', { exact: false })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Add sample company profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload company profile' })).toBeVisible();
});
test('role choices render as compact rows with the box beside its label', async ({ page }) => {
  await mock(page, { get: () => view({ empty: true }) });
  await page.goto(origin);
  const roles = page.getByRole('group', { name: 'Roles this company plays' });
  const boxes = roles.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  expect(await boxes.count()).toBeGreaterThan(3);
  const rows = await boxes.evaluateAll((inputs) =>
    inputs.map((input) => {
      const box = input.getBoundingClientRect();
      const row = input.closest('label')!.getBoundingClientRect();
      return { box: box.height, row: row.height, offset: box.top - row.top };
    }),
  );
  for (const r of rows) {
    // A 3rem generic input rule once made each row 56px tall with the text below the box.
    expect(r.box).toBeLessThanOrEqual(24);
    expect(r.row).toBeLessThanOrEqual(36);
    expect(r.offset).toBeLessThanOrEqual(4);
  }
});
test('owner saves the exact typed profile with the expected version and account headers', async ({
  page,
}) => {
  const seen = { headers: [] as Record<string, string>[], urls: [] as string[] };
  let command: Record<string, unknown> | null = null;
  await mock(page, {
    seen,
    get: () => (command ? view({ version: 1 }) : view({ empty: true })),
    post: (body) => {
      command = body;
      return { json: { ...view({ version: 1 }), commandId: body.commandId } };
    },
  });
  await page.goto(origin);
  await page
    .getByLabel('Company name (start with Synthetic)')
    .fill('Synthetic Dhaka Garments Limited');
  // CQ-28: the country is chosen by name from the searchable picker.
  await page.getByRole('combobox', { name: 'Country' }).fill('Bangladesh');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('Bangladesh');
  await page.getByLabel('Buyer').check();
  await page.getByLabel('Seller').check();
  await page.getByLabel('Sectors (comma separated, up to ten)').fill(' Knitwear , Denim ,');
  await page.getByLabel('Company size').selectOption('201-1000');
  await page
    .getByLabel('About the company (start with Synthetic)')
    .fill('Synthetic exporter of knit and denim garments');
  // CQ-28: the first save asks for no reason; the history records a fixed first-version reason.
  await expect(page.getByLabel('Reason for this change', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
  await saveButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Company profile saved.');
  expect(command).toMatchObject({
    workspaceId,
    expectedVersion: 0,
    legalName: 'Synthetic Dhaka Garments Limited',
    countryCode: 'BD',
    website: null,
    commercialRoles: ['BUYER', 'SELLER'],
    sectors: ['Knitwear', 'Denim'],
    sizeBand: '201-1000',
    reason: 'First version of the company profile',
    acknowledged: true,
  });
  for (const key of ['organisationId', 'verified', 'provenance', 'canonicalLinked'])
    expect(command).not.toHaveProperty(key);
  expect(
    seen.headers.every(
      (h) =>
        h['x-corridra-customer-subject'] === 'synthetic-alice' &&
        h['x-corridra-customer-issuer'] === issuer,
    ),
  ).toBe(true);
  await expect(page.getByText('Self-reported, not verified')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Profile history' })).toBeVisible();
});
test('a short reason stays editable without sending a rejected save', async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (body) => {
      commands.push(body);
      return { json: { ...view({ version: 2 }), commandId: body.commandId } };
    },
  });
  await page.goto(origin);
  const reason = page.getByLabel('Reason for this change', { exact: true });
  await reason.pressSequentially('ab');
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
  await saveButton(page).click();
  expect(await reason.evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  expect(commands).toHaveLength(0);
  await reason.pressSequentially('c');
  await saveButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Company profile saved.');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ reason: 'abc', expectedVersion: 1 });
});
test('an unmatched acknowledgement retains the exact command for a safe retry', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  await mock(page, {
    post: (body) => {
      commands.push(body);
      return {
        json: {
          ...view({ version: 2 }),
          commandId: commands.length === 1 ? 'wrong' : body.commandId,
        },
      };
    },
  });
  await page.goto(origin);
  await fillRequired(page);
  await saveButton(page).click();
  await expect(page.getByRole('status')).toContainText('Save could not be confirmed');
  await page.getByRole('button', { name: 'Retry same save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Company profile saved.');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('a stale-version rejection clears local details and offers a reload', async ({ page }) => {
  await mock(page, { post: () => ({ status: 409, json: { error: 'changed' } }) });
  await page.goto(origin);
  await fillRequired(page);
  await saveButton(page).click();
  await expect(page.getByRole('status')).toContainText('Reload before editing');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Synthetic Dhaka Garments Limited')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload company profile' })).toBeVisible();
});
for (const status of [401, 403, 503])
  test('save ' + status + ' clears stale details', async ({ page }) => {
    await mock(page, { post: () => ({ status, json: { error: 'Unavailable' } }) });
    await page.goto(origin);
    await fillRequired(page);
    await saveButton(page).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText('Synthetic Dhaka Garments Limited')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload company profile' })).toBeVisible();
  });
test('a rejected input keeps the draft and explains what to check', async ({ page }) => {
  await mock(page, { post: () => ({ status: 400, json: { error: 'Invalid' } }) });
  await page.goto(origin);
  await fillRequired(page, 'Synthetic edit');
  await saveButton(page).click();
  await expect(page.getByRole('status')).toContainText('Check the required text');
  await expect(page.getByLabel('Reason for this change', { exact: true })).toHaveValue(
    'Synthetic edit',
  );
});
test('a member reads the profile without editing controls, reason or history', async ({ page }) => {
  await mock(page, { get: () => view({ canEdit: false }) });
  await page.goto(origin);
  await expect(page.getByText('Synthetic Dhaka Garments Limited', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(saveButton(page)).toHaveCount(0);
  await expect(page.getByText('Synthetic original profile')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Profile history' })).toHaveCount(0);
});
test('a response for another workspace is rejected instead of rendered', async ({ page }) => {
  await mock(page, {
    get: () => ({ ...view(), workspaceId: '00000000-0000-4000-8000-0000000000ff' }),
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('could not be loaded');
  await expect(page.getByText('Synthetic Dhaka Garments Limited')).toHaveCount(0);
});
test('a response claiming verification or a canonical link is rejected', async ({ page }) => {
  await mock(page, { get: () => ({ ...view(), verified: true }) });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('could not be loaded');
  await expect(page.getByText('Synthetic Dhaka Garments Limited')).toHaveCount(0);
});
test('access expiry clears details and the draft without extending permission', async ({
  page,
}) => {
  await mock(page, { get: () => view({ ttl: 700 }) });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('must be checked again');
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('changing the signed-in account discards the previous account data', async ({ page }) => {
  await mock(page, {});
  await page.goto(origin);
  await expect(page.getByText('Synthetic Dhaka Garments Limited', { exact: true })).toBeVisible();
  await mock(page, { get: () => view({ empty: true }) });
  await page.evaluate((issuerValue) => {
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', {
        detail: { subject: 'synthetic-bob', issuer: issuerValue },
      }),
    );
  }, issuer);
  await expect(page.getByRole('status')).toContainText('No company profile yet');
  await expect(page.getByText('Synthetic Dhaka Garments Limited', { exact: true })).toHaveCount(0);
});
for (const width of [320, 390, 768, 1440])
  test('keyboard and accessibility at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mock(page, {});
    await page.goto(origin);
    await expect(page.getByLabel('Company name (start with Synthetic)')).toBeVisible();
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
      await mkdir('.cache/v3-organisation-profiles/after', { recursive: true });
      await page.screenshot({
        path: '.cache/v3-organisation-profiles/after/owner-320.png',
        fullPage: true,
      });
    }
  });
