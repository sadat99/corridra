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
      contents: `import { createRoot } from 'react-dom/client';
        import { SavedMissions } from ${JSON.stringify(resolve('apps/web/app/account/saved-missions.tsx'))};
        import { SavedCommercialReport } from ${JSON.stringify(resolve('apps/web/app/account/missions/saved-commercial-report.tsx'))};
        const query = new URLSearchParams(location.search);
        const subject = query.get('subject') || 'synthetic-alice';
        const issuer = query.get('issuer') || ${JSON.stringify(issuer)};
        
        const root=createRoot(document.getElementById('fixture'));
        const render=(subject,issuer)=>query.get('mode')==='report'?<SavedCommercialReport subject={subject} issuer={issuer} resourceId="00000000-0000-4000-8000-000000000001"/>:<SavedMissions subject={subject} issuer={issuer}/>;root.render(query.has('before')?null:render(subject,issuer));
        window.addEventListener('fixture-customer-change',event=>root.render(render(event.detail.subject,event.detail.issuer)));`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Components import their own stylesheets; this spec does not mount them for styling.
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
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
    } else if (path === '/') {
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

const id = '00000000-0000-4000-8000-000000000001',
  token = 'a'.repeat(64);
const expires = '2026-12-01T00:00:00Z';
const metadata = {
  id,
  available: true,
  removed: false,
  title: 'Synthetic approved commercial scope',
  expiresAt: expires,
};
const list = (missions: unknown[] = []) => ({ missions, nextAfter: null, synthetic: true });
const report = () => ({
  resourceId: id,
  report: {
    schemaVersion: 1,
    scopeId: '00000000-0000-4000-8000-000000000009',
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic approved commercial progress',
    programme: null,
    generatedAt: '2026-10-18T00:00:00Z',
    expiresAt: expires,
    allowExport: false,
    approvedParticipants: 1,
    approvedCompanies: 1,
    qualifiedCounterparties: 0,
    totals: [],
    attribution:
      'Synthetic protocol fixture. Contracts,invoices and confirmed cash remain distinct.',
    missions: [
      {
        publicationId: '00000000-0000-4000-8000-000000000003',
        title: 'Synthetic machinery sourcing',
        company: 'Fictional Company',
        objective: 'Review approved suppliers and technical scope',
        brief: 'Original approved requirements 工厂 বাংলা',
        nextAction: 'Review installation exclusions with the operator',
        dueAt: expires,
        reviewedAt: '2026-10-18T00:00:00Z',
        status: 'DRAFT',
        updatedAt: '2026-10-18T00:00:00Z',
        itinerary: [
          { label: 'Proposed factory meeting', status: 'PROPOSED', scheduleChanged: false },
        ],
        requests: [],
        outcomes: {
          opportunities: 0,
          qualified: 0,
          proposals: 0,
          contracts: 0,
          rfqs: 0,
          samples: 0,
          heldMeetings: 0,
        },
        totals: [],
        experience: {
          schemaVersion: 1,
          requirements: {
            version: 1,
            fields: {
              objective: 'Source suitable machinery',
              role: 'IMPORTER',
              product: 'Synthetic packaging machine',
              specifications: 'Original technical specification 工厂',
              quantity: '1',
              unit: 'machine',
              machinery: { commissioning: 'Acceptance testing required' },
            },
            sourceKind: 'CUSTOMER_SUBMISSION',
            claimStatus: 'UNVERIFIED',
            current: true,
          },
          shortlist: [
            {
              id: '00000000-0000-4000-8000-000000000004',
              company: 'Synthetic supplier 工厂',
              country: 'CN',
              fit: 'RESEARCH',
              rationale: 'Declared capability needs review',
              uncertainty: 'Installation has not been confirmed',
              gaps: 'Commissioning scope missing',
              verification: 'Source-reported,not independently verified',
            },
          ],
          quotations: [
            {
              id: '00000000-0000-4000-8000-000000000005',
              targetId: '00000000-0000-4000-8000-000000000004',
              currency: 'BHD',
              terms: {
                specification: 'Original technical specification 工厂',
                quantity: '1',
                unit: 'machine',
                totalPriceMinor: '1234',
                incoterm: 'EXW',
                shipping: 'EXCLUDED',
              },
              revision: 1,
              uncertainties: 'Installation and commissioning not quoted',
              sourceKind: 'SUPPLIER_SUBMISSION',
              claimStatus: 'UNVERIFIED',
              superseded: false,
              assignmentCurrent: true,
            },
          ],
          agenda: [],
          documentAccess: 'Original documents remain in the operator-controlled review process.',
        },
      },
    ],
  },
});
test('explicitly saves and removes an invitation with scoped headers and no browser persistence', async ({
  page,
}) => {
  let stored = false,
    saves = 0;
  await page.route('**/api/customer-saved-missions', async (route) => {
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    expect(route.request().headers()['x-corridra-customer-issuer']).toBe(issuer);
    if (route.request().method() === 'GET')
      return route.fulfill({ json: list(stored ? [metadata] : []) });
    const body = route.request().postDataJSON();
    if (body.action === 'save') {
      saves++;
      expect(body).toMatchObject({ action: 'save', token, acknowledged: true });
      stored = true;
      await route.fulfill({ json: metadata });
    } else {
      expect(body).toMatchObject({ action: 'remove', resourceId: id });
      stored = false;
      await route.fulfill({ json: { id, removed: true } });
    }
  });
  await page.goto(origin);
  await expect(page.getByText('No commercial mission invitations saved yet.')).toBeVisible();
  await page.getByText('Save an invitation', { exact: true }).click();
  await page.getByLabel('Private client mission invitation').fill(origin + '/client#' + token);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save invitation to this account' }).click();
  await expect(page.getByRole('link', { name: 'Open approved commercial report' })).toHaveAttribute(
    'href',
    '/account/missions/' + id,
  );
  await expect(page.getByRole('button', { name: 'Save invitation to this account' })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(saves).toBe(1);
  await page.getByRole('button', { name: 'Remove from my saved missions' }).click();
  await expect(page.getByText('No commercial mission invitations saved yet.')).toBeVisible();
  await expect(page.getByText(/were not cancelled/)).toBeVisible();
});
test('lost save response freezes the exact command and retries without claiming success', async ({
  page,
}) => {
  const commands: unknown[] = [];
  await page.route('**/api/customer-saved-missions', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: list() });
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) await route.abort('failed');
    else await route.fulfill({ json: metadata });
  });
  await page.goto(origin);
  await page.getByText('Save an invitation', { exact: true }).click();
  await page.getByLabel('Private client mission invitation').fill(origin + '/client#' + token);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save invitation to this account' }).click();
  await expect(page.getByText(/Saving could not be confirmed/)).toBeVisible();
  await expect(page.getByLabel('Private client mission invitation')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same invitation' }).click();
  await expect(page.getByText(/Invitation saved to this account/)).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('unavailable and malformed saved lists recover without showing a stale title', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/customer-saved-missions', async (route) => {
    calls++;
    await route.fulfill(
      calls === 1
        ? { status: 503, json: { error: 'unavailable' } }
        : calls === 2
          ? {
              json: {
                missions: [{ id, available: true, title: 'Do not show' }],
                synthetic: true,
                nextAfter: null,
              },
            }
          : { json: list() },
    );
  });
  await page.goto(origin);
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Refresh saved commercial missions' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByText('Do not show', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh saved commercial missions' }).click();
  await expect(page.getByText('No commercial mission invitations saved yet.')).toBeVisible();
});
test('approved commercial report reuses requirements,qualification,original quotation and exact proposed meeting status', async ({
  page,
}) => {
  await page.route('**/api/customer-saved-missions', (route) => route.fulfill({ json: report() }));
  await page.goto(origin + '/?mode=report');
  await expect(
    page.getByText('Original approved requirements 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Synthetic supplier 工厂', { exact: true })).toBeVisible();
  await expect(page.getByText(/Installation and commissioning not quoted/)).toBeVisible();
  await expect(page.getByText(/BHD.*1\.234/).first()).toBeVisible();
  await expect(page.getByText('PROPOSED', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send response' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My shared missions' })).toHaveAttribute(
    'href',
    '/account#customer-missions',
  );
});
test('account changes and revoked scopes clear all previous commercial report content', async ({
  page,
}) => {
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill(
      route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice'
        ? { json: report() }
        : { status: 403, json: { error: 'denied' } },
    ),
  );
  await page.goto(origin + '/?mode=report');
  await expect(
    page.getByText('Original approved requirements 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (issuer) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer },
        }),
      ),
    issuer,
  );
  await expect(page.getByRole('alert')).toContainText('No commercial report content');
  await expect(page.getByText('Original approved requirements 工厂 বাংলা')).toHaveCount(0);
});
test('page restoration rechecks saved scope and malformed report cannot fabricate commercial progress', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/customer-saved-missions', async (route) => {
    calls++;
    await route.fulfill(
      calls === 1
        ? { json: report() }
        : calls === 2
          ? {
              json: {
                resourceId: id,
                report: { schemaVersion: 1, audience: 'CLIENT_PROGRESS', missions: [] },
              },
            }
          : { status: 403, json: { error: 'denied' } },
    );
  });
  await page.goto(origin + '/?mode=report');
  await expect(
    page.getByText('Original approved requirements 工厂 বাংলা', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByText('Original approved requirements 工厂 বাংলা')).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await page.getByRole('button', { name: 'Refresh approved commercial report' }).click();
  await expect(page.getByRole('alert')).toContainText('No commercial report content');
});
test('saved list and approved report support keyboard,axe and three responsive widths', async ({
  page,
}) => {
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill({ json: route.request().method() === 'GET' ? list([metadata]) : report() }),
  );
  await mkdir('.cache/v3-saved-commercial/after', { recursive: true });
  for (const width of [1440, 768, 390])
    for (const mode of ['list', 'report']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + '/?mode=' + mode);
      await expect(
        mode === 'list'
          ? page.getByRole('link', { name: 'Open approved commercial report' })
          : page.getByText('Original approved requirements 工厂 বাংলা', { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: '.cache/v3-saved-commercial/after/' + mode + '-' + width + '.png',
        fullPage: true,
      });
    }
  await page
    .getByText('Companies,qualification,requirements and original quotations', { exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synthetic supplier 工厂', { exact: true })).not.toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synthetic supplier 工厂', { exact: true })).toBeVisible();
});

function responseReport(body?: string) {
  const value = report();
  Object.assign(value.report.missions[0]!, {
    requests: [
      {
        id: '00000000-0000-4000-8000-000000000008',
        title: 'Synthetic evidence request',
        instructions: 'Supply fictional supporting information only.',
        dueAt: expires,
        status: body ? 'RESPONDED' : 'OPEN',
        ...(body ? { response: body } : {}),
      },
    ],
  });
  return value;
}
test('uncertain evidence submission freezes exact text and command until the same self-declaration is acknowledged', async ({
  page,
}) => {
  const commands: Record<string, unknown>[] = [];
  let recorded: string | undefined;
  await page.route('**/api/customer-saved-missions', async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === 'view') return route.fulfill({ json: responseReport(recorded) });
    commands.push(command);
    if (commands.length === 1) return route.abort('failed');
    recorded = command.body;
    return route.fulfill({
      json: { resourceId: id, response: { id: command.commandId, claimStatus: 'self_declared' } },
    });
  });
  await page.goto(origin + '/?mode=report');
  await page
    .getByLabel('Your response', { exact: true })
    .fill('Fictional supporting declaration বাংলা');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect(page.getByText(/Response delivery could not be confirmed/)).toBeVisible();
  await expect(page.getByText(/Response recorded as your self-declaration/)).toHaveCount(0);
  await expect(page.getByLabel('Your response', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same response', exact: true }).click();
  await expect(page.getByText(/Response recorded as your self-declaration/)).toBeVisible();
  await expect(
    page.getByText('Your self-declared response: Fictional supporting declaration বাংলা', {
      exact: true,
    }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('unsent declaration survives same-account page interruption but clears on account denial', async ({
  page,
}) => {
  await page.route('**/api/customer-saved-missions', (route) =>
    route.fulfill(
      route.request().headers()['x-corridra-customer-subject'] === 'synthetic-alice'
        ? { json: responseReport() }
        : { status: 403, json: { error: 'denied' } },
    ),
  );
  await page.goto(origin + '/?mode=report');
  await page
    .getByLabel('Your response', { exact: true })
    .fill('Private unsent fictional declaration');
  await page.getByRole('checkbox').check();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByLabel('Your response', { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByLabel('Your response', { exact: true })).toHaveValue(
    'Private unsent fictional declaration',
  );
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.evaluate(
    (issuer) =>
      window.dispatchEvent(
        new CustomEvent('fixture-customer-change', {
          detail: { subject: 'synthetic-bob', issuer },
        }),
      ),
    issuer,
  );
  await expect(page.getByRole('alert')).toContainText('No commercial report content');
  await expect(page.getByLabel('Your response', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('saved mission pagination preserves earlier scoped entries and appends the next bounded page once', async ({
  page,
}) => {
  const nextId = '00000000-0000-4000-8000-000000000002';
  let laterReads = 0;
  await page.route('**/api/customer-saved-missions*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('after');
    if (cursor) {
      expect(cursor).toBe(id);
      laterReads++;
      await route.fulfill({
        json: list([{ ...metadata, id: nextId, title: 'Second approved mission' }]),
      });
    } else
      await route.fulfill({
        json: { ...list([{ ...metadata, title: 'First approved mission' }]), nextAfter: id },
      });
  });
  await page.goto(origin);
  await expect(
    page.getByRole('heading', { name: 'First approved mission', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load more commercial missions' }).click();
  await expect(
    page.getByRole('heading', { name: 'Second approved mission', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'First approved mission', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open approved commercial report' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Load more commercial missions' })).toHaveCount(0);
  expect(laterReads).toBe(1);
});

test('malformed quotation currencies and meeting time zones fail safely before rendering commercial data', async ({
  page,
}) => {
  let count = 0;
  await page.route('**/api/customer-saved-missions', async (route) => {
    const value = report();
    if (count++ === 0) value.report.missions[0]!.experience.quotations[0]!.currency = 'UNKNOWN';
    else
      Object.assign(value.report.missions[0]!.itinerary[0]!, {
        startsAt: '2026-11-01T00:00:00Z',
        timezone: 'Invalid/Timezone',
      });
    await route.fulfill({ json: value });
  });
  for (let index = 0; index < 2; index++) {
    await page.goto(origin + '/?mode=report');
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await expect(page.getByText('Original approved requirements 工厂 বাংলা')).toHaveCount(0);
    await expect(page.getByText('Recorded commercial progress', { exact: true })).toHaveCount(0);
  }
});
