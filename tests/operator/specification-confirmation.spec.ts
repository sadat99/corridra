import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
let server: Server, origin: string;
const resourceId = '11111111-1111-4111-8111-111111111111',
  requestId = '22222222-2222-4222-8222-222222222222',
  requirementId = '33333333-3333-4333-8333-333333333333',
  publicationId = '44444444-4444-4444-8444-444444444444',
  ownerId = '55555555-5555-4555-8555-555555555555';
const fields = {
  objective: 'Review suitable machinery',
  role: 'IMPORTER',
  product: 'Synthetic cutting machine',
  specifications: '2.5 metre cutting bed, 380V three-phase',
  quantity: '2',
  unit: 'machines',
  machinery: {
    application: 'Synthetic textile cutting',
    installationReferences: 'Qualified engineer to review installation',
    training: 'Operator training required',
    warrantySpares: 'Confirm warranty and initial spares',
  },
};
const review = (state = 'OPEN') => ({
  requestId,
  requirementId,
  requirementVersion: 1,
  requirementDigest: 'a'.repeat(64),
  state,
  declaration: 'Original synthetic customer requirement, not independently verified',
  fields: state === 'REVIEW_REQUIRED' ? null : fields,
  confirmedAt: state === 'CONFIRMED' ? '2026-10-28T10:00:00Z' : null,
  dueAt: '2026-12-01T00:00:00Z',
});
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';import{SpecificationConfirmation}from ${JSON.stringify(resolve('apps/web/app/account/missions/specification-confirmation.tsx'))};import{SpecificationRequests}from ${JSON.stringify(resolve('apps/web/app/operator/specification-requests.tsx'))};const staff=new URLSearchParams(location.search).has('staff');createRoot(document.getElementById('fixture')).render(staff?<SpecificationRequests tenant="${ownerId}" publications={[{id:"${publicationId}",copy:{title:"Synthetic reviewed machinery request"},revoked:false}]} owners={[{user_id:"${ownerId}",name:"Synthetic Corridra operator"}]}/>:<SpecificationConfirmation resourceId="${resourceId}" subject="synthetic-specification-alice" issuer="https://example.invalid/auth"/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
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
  // Use the production CSS and self-hosted font classes, as the real customer frame does.
  const document = await readFile(resolve('apps/web/.next/server/app/index.html'), 'utf8');
  const fontClass = document.match(/<html[^>]*class="([\w -]+)"/)?.[1];
  expect(fontClass).toBeTruthy();
  const cssPaths = [
    ...new Set(
      [...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)/g)].map((match) => match[1]),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url?.startsWith('/fixture.js')) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].text);
    } else if (
      /^\/_next\/static\/(chunks\/[\w.-]+\.css|media\/[\w.-]+\.woff2)$/.test(req.url ?? '')
    ) {
      res.setHeader('Content-Type', req.url!.endsWith('.css') ? 'text/css' : 'font/woff2');
      void readFile(resolve('apps/web/.next/static', req.url!.slice('/_next/static/'.length)))
        .then((value) => res.end(value))
        .catch(() => {
          res.statusCode = 404;
          res.end();
        });
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><title>Specification review fixture</title><meta name="viewport" content="width=device-width,initial-scale=1">${cssPaths.map((path) => `<link rel="stylesheet" href="${path}">`).join('')}</head><body><main class="operator-page ux-workspace ux-customer" style="padding:24px;max-width:1000px;margin:auto"><h1>Commercial requirement review</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});
async function open(page: Page, state = 'OPEN', status = 200) {
  await page.route('**/api/customer-specification-confirmations**', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        resourceId,
        reviews: [review(state)],
        expiresAt: '2099-01-01T00:00:00Z',
        synthetic: true,
      }),
    }),
  );
  await page.goto(origin);
}
test('customer reviews exact fields and explicitly confirms only the displayed pinned scope', async ({
  page,
}) => {
  await open(page);
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-specification-confirmations', async (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: command.commandId, confirmed: true, replayed: false }),
    });
  });
  await page.getByRole('button', { name: 'Review current requirements' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Synthetic cutting machine' })).toBeVisible();
  await expect(
    page.getByText('2.5 metre cutting bed, 380V three-phase', { exact: true }),
  ).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm these requirements', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('Your confirmation was recorded');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    resourceId,
    requestId,
    requirementId,
    requirementVersion: 1,
    requirementDigest: 'a'.repeat(64),
    acknowledged: true,
  });
  await expect(page.getByRole('status')).toContainText('does not authorise a purchase');
});
test('an interrupted confirmation retries the identical command and never invents success', async ({
  page,
}) => {
  await open(page);
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/customer-specification-confirmations', async (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) await route.abort();
    else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: command.commandId, confirmed: true, replayed: true }),
      });
  });
  await page.getByRole('button', { name: 'Review current requirements' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm these requirements', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('interrupted');
  await page.getByRole('button', { name: 'Retry same confirmation' }).click();
  await expect(page.getByRole('status')).toContainText('confirmation was recorded');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
test('stale scope or access denial clears the displayed requirements and asks for a new review', async ({
  page,
}) => {
  await open(page);
  await page.route('**/api/customer-specification-confirmations', (route) =>
    route.fulfill({ status: 409, body: '{}' }),
  );
  await page.getByRole('button', { name: 'Review current requirements' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm these requirements', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Access or requirements changed');
  await expect(page.getByRole('heading', { name: 'Synthetic cutting machine' })).toHaveCount(0);
});
for (const state of ['CONFIRMED', 'RESPONDED', 'CANCELLED', 'REVIEW_REQUIRED'])
  test(`${state} cannot create a new typed confirmation`, async ({ page }) => {
    await open(page, state);
    await page.getByRole('button', { name: 'Review current requirements' }).click();
    await expect(
      page.getByRole('heading', {
        name:
          state === 'REVIEW_REQUIRED' ? 'Previous requirement review' : 'Synthetic cutting machine',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirm these requirements', exact: true }),
    ).toHaveCount(0);
  });
test('uninstalled module has an honest unavailable state', async ({ page }) => {
  await open(page, 'OPEN', 503);
  await page.getByRole('button', { name: 'Review current requirements' }).click();
  await expect(page.getByRole('status')).toContainText('not available yet');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
test('staff issues an exact reviewed requirement question through the protected route', async ({
  page,
}) => {
  let command: Record<string, unknown> | null = null;
  await page.route('**/api/workspace/specification-confirmations**', async (route) => {
    if (route.request().method() === 'POST') {
      command = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ id: command!.commandId, replayed: false }),
      });
    } else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          publicationId,
          requirement: {
            requirementId,
            requirementVersion: 1,
            requirementDigest: 'a'.repeat(64),
            declaration: 'Original synthetic machinery requirement',
            fields,
          },
          requests: [],
        }),
      });
  });
  await page.goto(origin + '?staff');
  await page.getByText('Request customer specification confirmation', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Reviewed publication' }).selectOption(publicationId);
  await page.getByRole('button', { name: 'Load reviewed requirements' }).click();
  await page.getByRole('textbox', { name: 'Response deadline (UTC)' }).fill('2026-12-01T10:00');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request confirmation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Confirmation requested');
  expect(command).toMatchObject({
    publicationId,
    requirementId,
    requirementVersion: 1,
    requirementDigest: 'a'.repeat(64),
    ownerId,
    approved: true,
    dueAt: '2026-12-01T10:00:00.000Z',
  });
});
for (const width of [320, 390, 768, 1440])
  test(`customer review fits at ${width}px and passes axe`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.getByRole('button', { name: 'Review current requirements' }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic cutting machine' })).toBeVisible();
    const loadedFonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts as FontFaceSet & Iterable<FontFace>)
        .filter((font) => font.status === 'loaded')
        .map((font) => font.family);
    });
    expect(
      loadedFonts.length,
      'Production self-hosted fonts must load before visual acceptance',
    ).toBeGreaterThan(0);
    // KI16: measure the direct customer frame, rather than a nested fixture card.
    await page.evaluate(() => {
      const main = document.querySelector('main')!;
      main.removeAttribute('style');
      const fixture = document.getElementById('fixture')!;
      fixture.replaceWith(...Array.from(fixture.childNodes));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir('docs/design-system/evidence/ux-repair-2026-10-29/after', { recursive: true });
    await page.screenshot({
      path: `docs/design-system/evidence/ux-repair-2026-10-29/after/specification-${width}.png`,
      fullPage: true,
    });
  });
