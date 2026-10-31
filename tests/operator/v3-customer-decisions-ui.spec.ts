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
      contents: `import {createRoot} from 'react-dom/client';import {DecisionHistory} from ${JSON.stringify(resolve('apps/web/app/account/missions/decision-history.tsx'))};import {DecisionDisclosures} from ${JSON.stringify(resolve('apps/web/app/operator/decision-disclosures.tsx'))};const root=createRoot(document.getElementById('fixture'));const props={subject:'synthetic-alice',issuer:${JSON.stringify(issuer)},resourceId:'00000000-0000-4000-8000-000000000001'};const staff=new URLSearchParams(location.search).has('staff');root.render(staff?<DecisionDisclosures tenant='00000000-0000-4000-8000-000000000004' publications={[{id:'00000000-0000-4000-8000-000000000005',copy:{title:'Original client publication'},revoked:false}]}/>:<DecisionHistory {...props}/>);window.addEventListener('fixture-customer-change',event=>root.render(<DecisionHistory {...props} {...event.detail}/>));`,
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

const resource = '00000000-0000-4000-8000-000000000001',
  decisionId = '00000000-0000-4000-8000-000000000002',
  target = '00000000-0000-4000-8000-000000000003',
  publication = '00000000-0000-4000-8000-000000000005';
const decision = {
  id: decisionId,
  targetId: target,
  company: 'Original supplier 工厂 বাংলা',
  decision: 'NEED_INFORMATION',
  rationale: 'Independent supplier evidence remains missing',
  nextAction: 'Request original acceptance evidence',
  dueAt: '2026-12-01T00:00:00Z',
  requirementCurrent: false,
  quotationId: null,
  sourceKind: 'synthetic',
  claimStatus: 'self_declared',
};
const approved = () => ({
  resourceId: resource,
  state: 'APPROVED',
  synthetic: true,
  version: 1,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  decisions: [decision],
});
const staffOptions = () => ({
  publicationId: publication,
  synthetic: true,
  nextVersion: 1,
  decisions: [
    {
      id: decisionId,
      target_id: target,
      decision: decision.decision,
      rationale: decision.rationale,
      next_action: decision.nextAction,
      due_at: decision.dueAt,
      quotation_id: null,
      source_kind: decision.sourceKind,
      claim_status: decision.claimStatus,
    },
  ],
  approvals: [],
});
test('customer explicitly loads actual decision fields without pretending selection is an order', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/customer-decisions*', (route) => {
    calls++;
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['x-corridra-customer-subject']).toBe('synthetic-alice');
    return route.fulfill({ json: approved() });
  });
  await page.goto(origin);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Load reviewed decisions' }).click();
  await expect(page.getByRole('heading', { name: decision.company })).toBeVisible();
  await expect(page.getByText(decision.rationale, { exact: true })).toBeVisible();
  await expect(page.getByText(/self_declared/)).toBeVisible();
  await expect(page.getByText(/The requirement has changed/)).toBeVisible();
  await expect(page.getByText(/A selection does not establish an order/)).toBeVisible();
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});
test('denial clears old content and offers same-host account recovery', async ({ page }) => {
  let deny = false;
  await page.route('**/api/customer-decisions*', (r) =>
    deny ? r.fulfill({ status: 403, json: { error: 'denied' } }) : r.fulfill({ json: approved() }),
  );
  await page.goto(origin);
  await page.getByRole('button', { name: 'Load reviewed decisions' }).click();
  await expect(page.getByText(decision.rationale, { exact: true })).toBeVisible();
  deny = true;
  await page.getByRole('button', { name: 'Refresh reviewed decisions' }).click();
  await expect(page.getByText(decision.rationale, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to your account' })).toHaveAttribute(
    'href',
    '/account',
  );
});
test('unapproved,withdrawn,unavailable and malformed histories never invent outcomes', async ({
  page,
}) => {
  for (const [payload, message] of [
    [
      { resourceId: resource, state: 'NOT_APPROVED', synthetic: true, decisions: [] },
      'No commercial decision disclosure has been approved',
    ],
    [
      { resourceId: resource, state: 'SOURCE_UNAVAILABLE', synthetic: true, decisions: [] },
      'Approved decision sources are unavailable',
    ],
    [{ ...approved(), version: 2, decisions: [] }, 'No decisions are included'],
    [
      { ...approved(), decisions: [{ ...decision, decision: 'SIGNED_DEAL' }] },
      'Decision history could not be checked',
    ],
  ] as const) {
    await page.route('**/api/customer-decisions*', (r) => r.fulfill({ json: payload }));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Load reviewed decisions' }).click();
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: decision.company })).toHaveCount(0);
    await page.unroute('**/api/customer-decisions*');
  }
});
test('account change and expiry remove private content instead of retaining a previous report', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/api/customer-decisions*', (r) => r.fulfill({ json: approved() }));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Load reviewed decisions' }).click();
  await expect(page.getByText(decision.rationale, { exact: true })).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(page.getByText(decision.rationale, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh reviewed decisions' }).click();
  await expect(page.getByText(decision.rationale, { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('fixture-customer-change', { detail: { subject: 'synthetic-bob' } }),
    ),
  );
  await expect(page.getByText(decision.rationale, { exact: true })).toHaveCount(0);
});
test('hidden document clears details and requires an explicit fresh read', async ({ page }) => {
  await page.route('**/api/customer-decisions*', (r) => r.fulfill({ json: approved() }));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Load reviewed decisions' }).click();
  await expect(page.getByText(decision.rationale, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText(decision.rationale, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Private details cleared/)).toBeVisible();
});
test('staff approval shows exact fields and retries the same command after uncertain response', async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/workspace/customer-decision-disclosures*', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: staffOptions() });
    const body = r.request().postDataJSON();
    bodies.push(body);
    return bodies.length === 1
      ? r.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : r.fulfill({ json: { id: body.commandId, version: 1 } });
  });
  await page.goto(origin + '?staff=1');
  await page.getByText('Approve commercial decision disclosure', { exact: true }).click();
  await page.getByLabel('Reviewed publication').selectOption(publication);
  await page.getByRole('button', { name: 'Load decision review' }).click();
  await expect(page.getByText(/Independent supplier evidence/)).toBeVisible();
  await page.getByRole('checkbox', { name: /NEED_INFORMATION/ }).check();
  await page.getByLabel('Reason for this disclosure revision').fill('Explicit synthetic review');
  await page.getByRole('checkbox', { name: /I reviewed every selected/ }).check();
  await page.getByRole('button', { name: 'Approve disclosure revision' }).click();
  await expect(page.getByText(/Approval was not confirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry the same approval' }).click();
  await expect(
    page.getByText('Disclosure revision 1 recorded. Reload to inspect current decisions.'),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].decisionIds).toEqual([decisionId]);
});
test('unavailable staff module renders a recovery message without invented review controls', async ({
  page,
}) => {
  await page.route('**/api/workspace/customer-decision-disclosures*', (r) =>
    r.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.goto(origin + '?staff=1');
  await page.getByText('Approve commercial decision disclosure', { exact: true }).click();
  await page.getByLabel('Reviewed publication').selectOption(publication);
  await page.getByRole('button', { name: 'Load decision review' }).click();
  await expect(page.getByText('Reviewed decision disclosure is unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve disclosure revision' })).toHaveCount(0);
});
test('customer and staff review support keyboard,WCAG checks and four viewport widths', async ({
  page,
}) => {
  await page.route('**/api/customer-decisions*', (r) => r.fulfill({ json: approved() }));
  await page.route('**/api/workspace/customer-decision-disclosures*', (r) =>
    r.fulfill({ json: staffOptions() }),
  );
  await mkdir('.cache/v3-decisions/after', { recursive: true });
  for (const staff of [false, true]) {
    await page.goto(origin + (staff ? '?staff=1' : ''));
    if (staff) {
      await page.getByText('Approve commercial decision disclosure', { exact: true }).click();
      await page.getByLabel('Reviewed publication').selectOption(publication);
      await page.getByRole('button', { name: 'Load decision review' }).click();
      await expect(page.getByText(decision.rationale, { exact: false })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Load reviewed decisions' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: decision.company })).toBeVisible();
    }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: '.cache/v3-decisions/after/' + (staff ? 'staff' : 'customer') + '-' + width + '.png',
        fullPage: true,
      });
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
});
