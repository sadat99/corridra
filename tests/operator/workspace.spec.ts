import { operatorEvidence } from './operator-evidence';
import { openSection } from './workspace-nav';
import { participantEvidence } from './participant-evidence';
import { test, expect } from '@playwright/test';
import { Pool } from '../../packages/db/src/index';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { clearSignInLimits } from './operator-signin';
import { createHmac, randomUUID } from 'node:crypto';
import { intakeTemplate } from '../../packages/delivery/src/import';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
test('anonymous five-step intake preserves draft, retries safely and returns a private receipt', async ({
  page,
}) => {
  await page.goto('/plan');
  expect((await page.request.get('/api/workspace/tenants')).status()).toBe(401);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Choose what you want to do', { exact: true })).toBeVisible();
  await page.getByLabel('Sell in a new market', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .selectOption('BD');
  await page
    .getByRole('combobox', { name: 'Which market is involved?', exact: true })
    .selectOption('ES');
  await page.getByLabel('Yes', { exact: true }).check();
  await page.getByLabel('From', { exact: true }).fill('2026-11-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('End date must follow the start date')).toBeVisible();
  await page.getByLabel('To', { exact: true }).fill('2026-11-07');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByLabel('Your offer or requirement')
    .fill('Synthetic browser hotel towels for hospitality distributors.');
  await page.reload();
  await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
    'Synthetic browser hotel towels for hospitality distributors.',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Relevant meetings', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Browser Person');
  await page.getByLabel('Company', { exact: true }).fill('Browser Mission Test Company');
  await page.getByLabel('Work email', { exact: true }).fill('intake@example.invalid');
  await page.getByLabel('I have read the test intake notice', { exact: false }).check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.route('**/api/intake', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary test failure. Retry your brief.' }),
    }),
  );
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Temporary test failure');
  await expect(page.getByLabel('Work email', { exact: true })).toHaveValue(
    'intake@example.invalid',
  );
  await page.unroute('**/api/intake');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  const payload = saved.request().postDataJSON();
  const result = await saved.json();
  const duplicate = await page.request.post('/api/intake', {
    headers: { Origin: 'http://127.0.0.1:3200' },
    data: payload,
  });
  expect(duplicate.status()).toBe(201);
  expect(await duplicate.json()).toMatchObject({
    id: result.id,
    receipt: result.receipt,
    duplicate: true,
  });
  await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
  await page.reload();
  await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
  await page.getByRole('button', { name: 'Check status and replies' }).click();
  // D6: a request with a receipt was sent, so the customer sees it as received, not as a draft.
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await writeFile('.cache/part04-browser-receipt.json', JSON.stringify(result), { mode: 0o600 });
});
test('invited operator enrolls MFA, records provenance, manages flags and signs out', async ({
  page,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  await page.goto('/signin');
  await expect(page).toHaveURL(/operator\/signin/);
  await page.goto('/operator/signin?next=%2Foperator%23ops-gates');
  expect((await page.request.get('/api/workspace/tenants')).status()).toBe(401);
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  expect(await (await page.request.get('/api/workspace/tenants')).json()).toEqual([]);
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await expect(page.getByLabel('Authenticator setup key')).toBeVisible();
  const secret = await page.getByLabel('Authenticator setup key').inputValue();
  await writeFile('.cache/part06-browser-authenticator.json', JSON.stringify({ secret }), {
    mode: 0o600,
  });
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  await expect(page).toHaveURL(/\/operator#ops-gates$/);
  await expect(page.locator('#ops-gates')).toBeFocused();
  await openSection(page, 'main');
  const shortcuts = page.getByRole('navigation', { name: 'Mission workflow' });
  await expect(shortcuts.getByRole('link')).toHaveCount(5);
  await expect(page.locator('#workspace-navigation details')).not.toHaveAttribute('open');
  await page.getByText('Manage this workspace', { exact: true }).click();
  const administration = page.getByRole('navigation', { name: 'Administration', exact: true });
  await expect(administration.getByRole('link')).toHaveCount(5);
  await expect(
    administration.getByRole('link', { name: 'People and workspace controls', exact: true }),
  ).toHaveAttribute('href', '#workspace-controls');
  await expect(
    administration.getByRole('link', { name: 'Control Center', exact: true }),
  ).toHaveAttribute('href', '#ops-center');
  await page.getByText('Manage this workspace', { exact: true }).click();
  await mkdir('.cache/ux06/after', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole('heading', { name: 'Your workspace.', exact: true })
      .evaluate((heading) => heading.scrollIntoView());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).include('.workspace-start').analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: `.cache/ux06/after/admin-start-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    await shortcuts
      .locator('a')
      .evaluateAll((links) =>
        links.every((link) => !!document.getElementById((link as HTMLAnchorElement).hash.slice(1))),
      ),
  ).toBe(true);
  await page.evaluate(() => {
    window.location.hash = 'missing-tool';
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toBeVisible();
  await shortcuts.getByRole('link', { name: 'Missions and requirements', exact: false }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toHaveCount(0);
  await openSection(page, 'workspace-navigation');
  const sectionNav = page.getByRole('navigation', { name: 'Workspace sections' });
  await expect(sectionNav).toBeVisible();
  await expect(sectionNav.locator('details')).toHaveAttribute('open');
  expect(await sectionNav.locator('a').count()).toBeGreaterThanOrEqual(10);
  expect(
    await sectionNav
      .locator('a')
      .evaluateAll((links) =>
        links.every((link) => !!document.getElementById((link as HTMLAnchorElement).hash.slice(1))),
      ),
  ).toBe(true);
  await sectionNav.getByRole('link', { name: 'Global operations', exact: true }).click();
  const operations = page.locator('#workspace-operations');
  const operationNavigation = page.getByRole('navigation', { name: 'Operations sections' });
  await expect(operationNavigation.getByRole('link')).toHaveCount(4);
  await expect(
    operations.getByRole('button', { name: 'Refresh operations', exact: true }),
  ).toBeVisible();
  await expect(
    operations.getByText(
      'Current tenant and authorized records; all filtered missions contribute to totals, only the mission list is paginated',
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await operationNavigation
      .locator('a')
      .evaluateAll((links) =>
        links.every((link) => !!document.getElementById((link as HTMLAnchorElement).hash.slice(1))),
      ),
  ).toBe(true);
  await operationNavigation
    .getByRole('link', { name: 'Production readiness', exact: true })
    .click();
  await expect(page.locator('#ops-gates')).toBeFocused();
  await expect(operations.locator('.ux-operations-panel:visible')).toHaveCount(1);
  await expect(page.locator('#ops-dashboard')).toBeHidden();
  await expect(
    operations.getByRole('region', { name: 'External production prerequisites' }),
  ).toContainText('BLOCKED: external prerequisite');
  await operationNavigation
    .getByRole('link', { name: 'Mission dashboard and economics', exact: true })
    .click();
  await operations
    .getByRole('textbox', { name: 'Recorded industry', exact: true })
    .fill('unrecorded synthetic sector');
  await operations.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(
    operations
      .locator('.operations-metrics > div')
      .filter({ has: page.getByText('submitted', { exact: true }) })
      .locator('dd'),
  ).toHaveText('0');
  await expect(
    operations.locator('caption').filter({ hasText: 'Customer trade amounts' }),
  ).toHaveCount(0);
  await operations.getByRole('textbox', { name: 'Recorded industry', exact: true }).fill('');
  await operations.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(
    operations.getByRole('button', { name: 'Refresh operations', exact: true }),
  ).toBeEnabled();
  expect(
    (await new AxeBuilder({ page }).include('#workspace-operations').analyze()).violations,
  ).toEqual([]);
  await openSection(page, 'workspace-sources');
  await expect(page).toHaveURL(/#workspace-sources$/);
  await expect(page.locator('#workspace-sources')).toBeFocused();
  await openSection(page, 'workspace-settings');
  const settings = page.getByRole('region', { name: 'Corridor and policy settings' });
  await settings.getByText('Create a directional corridor route', { exact: true }).click();
  await settings.getByLabel('Demand-origin market').selectOption('JP');
  await settings.getByRole('combobox', { name: 'Target market', exact: true }).selectOption('KE');
  await settings.getByLabel('Route review reason').fill('Synthetic navigation route review');
  await settings.getByRole('button', { name: 'Create reviewed route', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Saved reference:');
  await settings
    .getByText('Current route packs and definition references', { exact: true })
    .click();
  await expect(settings.getByText(/JP → KE · [0-9a-f-]{36}/)).toBeVisible();
  await settings.getByText('Advanced versioned policy review', { exact: true }).click();
  await settings.getByLabel('Reviewed command JSON').fill('{');
  await settings.getByRole('checkbox').check();
  await settings.getByRole('button', { name: 'Save reviewed configuration' }).click();
  await expect(settings.getByRole('status')).toContainText('valid JSON object');
  await expect(settings.getByLabel('Reviewed command JSON')).toHaveValue('{');
  await settings.getByLabel('Reviewed configuration action').selectOption('ai-rights');
  await settings.getByLabel('Reviewed command JSON').fill('{"unfinished":true}');
  await settings.getByLabel('Reviewed configuration action').selectOption('corridor-pack');
  await expect(settings.getByLabel('Reviewed command JSON')).toHaveValue('{');
  await openSection(page, 'workspace-sources');
  await page.getByLabel('Source description').fill('Synthetic browser inspection');
  await page.getByRole('button', { name: 'Record source', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Saved.');
  await page
    .getByRole('combobox', { name: 'Source', exact: true })
    .selectOption({ label: 'Synthetic browser inspection' });
  await page.getByRole('textbox', { name: 'Claim', exact: true }).fill('Synthetic browser claim');
  await page.getByRole('button', { name: 'Record claim', exact: true }).click();
  await expect(page.getByText('Synthetic browser claim', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('No current verified facts.')).toBeVisible();
  await openSection(page, 'workspace-missions');
  const mission = JSON.parse(await readFile('.cache/part04-browser-receipt.json', 'utf8'));
  const card = page.locator('.mission-card').filter({
    has: page.getByRole('heading', { name: 'Browser Mission Test Company', exact: true }),
  });
  await expect(card).toHaveCount(1);
  // CQ-32: the notice version is kept in the record details, not in the summary line.
  await card.getByText('Record details', { exact: true }).click();
  await expect(card.getByText('synthetic-intake-2026-10-05-v1', { exact: false })).toBeVisible();
  await card.getByLabel('Structured market').selectOption('ES');
  await card
    .getByLabel('Target profile')
    .fill('Hospitality distributors for synthetic hotel towels');
  const missionNavigation = page.getByRole('navigation', { name: 'Mission work sections' });
  await missionNavigation
    .getByRole('link', { name: 'Companies and research', exact: true })
    .click();
  const retainedCard = page.locator('.mission-card').filter({
    has: page.getByRole('heading', {
      name: 'Browser Mission Test Company',
      exact: true,
      includeHidden: true,
    }),
  });
  await expect(retainedCard).toBeHidden();
  await expect(retainedCard).toHaveCount(1);
  await missionNavigation
    .getByRole('link', { name: 'Missions and requirements', exact: true })
    .click();
  await expect(card.getByLabel('Target profile')).toHaveValue(
    'Hospitality distributors for synthetic hotel towels',
  );
  await expect(page.locator('.ux-panel:visible')).toHaveCount(1);

  for (const action of ['qualify', 'activate', 'pause', 'resume']) {
    await card.getByLabel('Mission action').selectOption(action);
    await card.getByLabel('Reason for change').fill(`Synthetic browser ${action} decision`);
    await card.getByRole('button', { name: 'Save mission action' }).click();
    await expect(
      card.getByText(`Synthetic browser ${action} decision`, { exact: false }),
    ).toBeVisible();
  }
  await card
    .getByLabel('Reply visible on the private receipt')
    .fill('Please confirm the synthetic target requirements.');
  await card.getByRole('button', { name: 'Post receipt reply' }).click();
  await expect(
    card.getByText('Please confirm the synthetic target requirements.', { exact: true }),
  ).toBeVisible();
  const receiptResponse = await page.request.post('/api/intake/receipt', {
    headers: { Origin: 'http://127.0.0.1:3200' },
    data: { receipt: mission.receipt },
  });
  expect(await receiptResponse.json()).toMatchObject({
    status: 'ACTIVE',
    replies: [{ body: 'Please confirm the synthetic target requirements.' }],
  });
  await openSection(page, 'workspace-research');
  const research = page.locator('.research-workspace');
  await research.getByText('Record a research source and company', { exact: true }).click();
  await research
    .getByLabel('Research source locator')
    .fill('https://example.invalid/browser-registry');
  await research.getByRole('button', { name: 'Save research source', exact: true }).click();
  await expect(research.getByRole('status')).toHaveText('Research saved.');
  await research
    .getByLabel('Public identity source')
    .selectOption({ label: 'https://example.invalid/browser-registry' });
  await research
    .getByLabel('Company name', { exact: true })
    .fill('Synthetic Browser Distributor A');
  await research.getByLabel('Company country').selectOption('ES');
  await research.getByLabel('Company domain (madeup)').fill('browser.example.invalid');
  await research.getByLabel('Public business address').fill('Synthetic Browser Business Park');
  await research.getByLabel('Country-scoped identifier').fill('BROWSER-A');
  await research.getByRole('button', { name: 'Add company record', exact: true }).click();
  await expect(
    research.getByRole('button', { name: /Synthetic Browser Distributor A/ }),
  ).toBeVisible();
  await research
    .getByLabel('Company name', { exact: true })
    .fill('Synthetic Browser Distributor B');
  await research.getByLabel('Country-scoped identifier').fill('BROWSER-B');
  await research.getByRole('button', { name: 'Add company record', exact: true }).click();
  await expect(
    research.getByRole('button', { name: /Synthetic Browser Distributor B/ }),
  ).toBeVisible();
  await research.getByRole('button', { name: /Synthetic Browser Distributor A/ }).click();
  await expect(
    research.getByRole('heading', { name: 'Synthetic Browser Distributor A', exact: true }),
  ).toBeVisible();
  await research.getByText('Add a private relationship, contact or note', { exact: true }).click();
  await research
    .getByLabel('Relationship owner', { exact: true })
    .selectOption({ label: 'Synthetic Browser Operator' });
  await research.getByLabel('Relationship visibility').selectOption('TEAM');
  await research
    .getByLabel('Relationship context')
    .fill('Synthetic hospitality buying relationship');
  await research.getByRole('button', { name: 'Add private relationship', exact: true }).click();
  await expect(research.getByText('Shared with this workspace', { exact: true })).toBeVisible();
  await research
    .getByLabel('Contact relationship')
    .selectOption({ label: 'Synthetic hospitality buying relationship' });
  await research
    .getByLabel('Contact source')
    .selectOption({ label: 'https://example.invalid/browser-registry' });
  await research.getByLabel('Contact name', { exact: true }).fill('Synthetic Buyer');
  await research.getByLabel('Contact job title').fill('Synthetic procurement manager');
  await research.getByLabel('Contact email (madeup)').fill('buyer@example.invalid');
  await research.getByRole('button', { name: 'Add private contact', exact: true }).click();
  await expect(research.getByText(/Synthetic Buyer.*buyer@example.invalid/)).toBeVisible();
  await research
    .getByLabel('Note relationship')
    .selectOption({ label: 'Synthetic hospitality buying relationship' });
  await research
    .getByLabel('Private note source')
    .selectOption({ label: 'https://example.invalid/browser-registry' });
  await research.getByLabel('Private research note').fill('Synthetic private procurement context');
  await research.getByRole('button', { name: 'Add private note', exact: true }).click();
  await expect(
    research.getByText(/Private note: Synthetic private procurement context/),
  ).toBeVisible();
  await research
    .getByText('Add sourced product, capability, certificate, requirement or market', {
      exact: true,
    })
    .click();
  await research
    .getByLabel('Research claim source')
    .selectOption({ label: 'https://example.invalid/browser-registry' });
  await research
    .getByLabel('Research claim statement')
    .fill('Synthetic distributor supplies hotel towels');
  await research.getByRole('button', { name: 'Record research claim', exact: true }).click();
  await expect(research.getByRole('status')).toHaveText('Research saved.');
  await research.getByLabel('Company detail type').selectOption('capability');
  await research
    .getByLabel('Attach original claim')
    .selectOption({ label: 'Synthetic distributor supplies hotel towels' });
  await research.getByRole('button', { name: 'Attach company detail', exact: true }).click();
  await expect(
    research.getByText('SELF_DECLARED · Original claim: self_declared', { exact: true }),
  ).toBeVisible();
  await research
    .getByRole('button', { name: 'Find deterministic candidates', exact: true })
    .click();
  await expect(research.getByText(/Exact domain; may be shared by a group/)).toBeVisible();
  await research.getByLabel('Entity decision').selectOption('MERGE');
  await research
    .getByLabel('Canonical survivor')
    .selectOption({ label: 'Synthetic Browser Distributor A' });
  await research
    .getByLabel('Entity review reason')
    .fill('Synthetic source review confirms duplicate attribution');
  await research.getByRole('button', { name: 'Record entity decision', exact: true }).click();
  await expect(research.getByText(/MERGE: Synthetic source review/)).toBeVisible();
  page.once('dialog', (dialog) =>
    dialog.accept('Synthetic new evidence confirms distinct entities'),
  );
  await research.getByRole('button', { name: 'Reverse entity decision', exact: true }).click();
  await expect(research.getByText(/REVERSE: Synthetic new evidence/)).toBeVisible();
  await research.getByText('Add this relationship to a mission shortlist', { exact: true }).click();
  await research
    .getByLabel('Target mission', { exact: true })
    .selectOption({ label: 'Browser Mission Test Company' });
  await research
    .getByLabel('Target relationship', { exact: true })
    .selectOption({ label: 'Synthetic hospitality buying relationship' });
  await research.getByLabel('Optional target contact').selectOption({ label: 'Synthetic Buyer' });
  await research
    .getByLabel('Synthetic distributor supplies hotel towels · SELF_DECLARED', { exact: true })
    .check();
  await research.getByLabel('Fit judgment', { exact: true }).selectOption('POSSIBLE');
  await research
    .getByLabel('Fit rationale', { exact: true })
    .fill('Declared distribution capability fits hospitality targets');
  await research
    .getByLabel('Remaining uncertainty', { exact: true })
    .fill('Buyer interest and volume are unconfirmed');
  await research
    .getByLabel('Evidence gaps', { exact: true })
    .fill('Independent distribution evidence still needed');
  await research
    .getByLabel('Target next action', { exact: true })
    .fill('Request evidence and confirm synthetic interest');
  await research.getByRole('button', { name: 'Add mission target', exact: true }).click();
  await expect(research.getByRole('status')).toHaveText('Research saved.');
  await research
    .getByLabel('Shortlist mission')
    .selectOption({ label: 'Browser Mission Test Company · ACTIVE' });
  const targetCard = research.locator('.research-evidence').filter({
    has: page.getByRole('heading', { name: 'Synthetic Browser Distributor A', exact: true }),
  });
  await expect(targetCard.getByText(/Why: Declared distribution capability/)).toBeVisible();
  await expect(targetCard.getByText(/Uncertainty: Buyer interest/)).toBeVisible();
  await targetCard.getByText('Revise fit assessment', { exact: true }).click();
  await targetCard.getByLabel('Fit judgment', { exact: true }).selectOption('STRONG');
  await targetCard.getByRole('button', { name: 'Save fit assessment', exact: true }).click();
  await expect(
    targetCard.getByText('Fit: STRONG · Assessment version 2', { exact: true }),
  ).toBeVisible();
  const exported = await page.request.get(
    `/api/workspace/shortlist-export?tenant=${seed.tenantId}&mission=${mission.id}`,
  );
  expect(exported.ok()).toBe(true);
  expect(exported.headers()['cache-control']).toBe('no-store');
  expect((await exported.json()).targets[0]).toMatchObject({
    fit: 'STRONG',
    version: 2,
    contacts: [{ email: 'buyer@example.invalid' }],
  });
  expect((await page.request.get(`/api/workspace/research?tenant=${randomUUID()}`)).status()).toBe(
    403,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await openSection(page, 'workspace-missions');
  await expect(card).toHaveCount(1);
  await page.getByLabel('Show missions').selectOption('all');
  await card.getByLabel('Mission action').selectOption('cancel');
  await card.getByLabel('Reason for change').fill('Synthetic browser cancellation');
  await card.getByRole('button', { name: 'Save mission action' }).click();
  await expect(card.getByText('CANCELLED', { exact: false })).toBeVisible();
  expect((await page.request.get(`/api/workspace/workspace?tenant=${randomUUID()}`)).status()).toBe(
    403,
  );
  expect(
    (
      await page.request.post(`/api/workspace/config?tenant=${seed.tenantId}`, {
        headers: { Origin: 'https://untrusted.invalid' },
        data: { key: 'evidence.uploads', enabled: true },
      })
    ).status(),
  ).toBe(403);
  const audit = await page.request.get(`/api/workspace/audit?tenant=${seed.tenantId}`);
  expect(audit.ok()).toBe(true);
  expect((await audit.json()).some((e: { type: string }) => e.type === 'claim.insert')).toBe(true);
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  try {
    await db.query("UPDATE identity.assurance SET verified_at=now()-interval '6 minutes'");
  } finally {
    await db.end();
  }
  await openSection(page, 'workspace-controls');
  await page.getByRole('button', { name: 'Enable evidence verification', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText(
    'Verify your authenticator again to continue',
  );
  await openSection(page, 'workspace-authenticator');
  await page.getByLabel('Current authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify again', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Saved.');
  await openSection(page, 'workspace-controls');
  await page.getByRole('button', { name: 'Enable evidence verification', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Evidence verification', exact: true })
      .getByText('Enabled', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('article', { name: 'Evidence verification', exact: true })
      .getByText('Enabled', { exact: true }),
  ).toBeVisible();
  await openSection(page, 'workspace-evidence');
  await expect(
    page.getByRole('button', { name: 'Submit for validation', exact: true }),
  ).toBeDisabled();
  await openSection(page, 'workspace-controls');
  await expect(
    page
      .getByRole('article', { name: 'Research intake', exact: true })
      .getByText('Enabled', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Disable research intake', exact: true }).click();
  await expect(
    page
      .getByRole('article', { name: 'Research intake', exact: true })
      .getByText('Disabled', { exact: true }),
  ).toBeVisible();
  const controls = page.locator('#workspace-controls');
  await expect(
    controls.getByRole('heading', { name: 'Workspace controls', exact: true }),
  ).toBeVisible();
  await expect(controls.getByRole('article')).toHaveCount(10);
  await expect(
    controls.getByRole('combobox', { name: 'Workspace member', exact: true }),
  ).toBeDisabled();
  await expect(
    controls.getByRole('button', { name: 'Update membership', exact: true }),
  ).toBeDisabled();
  await controls.getByRole('button', { name: 'Load workspace members', exact: true }).click();
  await expect(
    controls.getByRole('combobox', { name: 'Workspace member', exact: true }),
  ).toBeEnabled();
  await expect(
    controls.getByRole('button', { name: 'Refresh workspace members', exact: true }),
  ).toBeVisible();
  await controls.getByRole('combobox', { name: 'Role', exact: true }).selectOption('reviewer');
  await controls.getByRole('checkbox', { name: 'Revoke membership', exact: false }).check();
  await expect(controls.getByRole('checkbox')).toBeChecked();
  await controls.getByRole('checkbox').uncheck();
  await controls
    .getByRole('combobox', { name: 'Workspace member', exact: true })
    .selectOption(seed.principalId);
  const deniedMembership = page.waitForResponse(
    (response) =>
      response.url().includes('/api/workspace/member?') && response.request().method() === 'POST',
  );
  await controls.getByRole('button', { name: 'Update membership', exact: true }).click();
  expect((await deniedMembership).status()).toBe(409);
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText(
    'The tenant must retain an active owner',
  );
  await controls.getByRole('combobox', { name: 'Role', exact: true }).selectOption('owner');
  const savedMembership = page.waitForResponse(
    (response) =>
      response.url().includes('/api/workspace/member?') && response.request().method() === 'POST',
  );
  await controls.getByRole('button', { name: 'Update membership', exact: true }).click();
  expect((await savedMembership).status()).toBe(201);
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Saved.');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await controls.scrollIntoViewIfNeeded();
    expect(
      await page.locator('.site-header').evaluate((header) => getComputedStyle(header).position),
    ).toBe('static');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: `.cache/ux06/after/workspace-controls-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.locator('.skip-link').evaluate((link) => getComputedStyle(link).clipPath),
    ).not.toBe('none');
    if (width === 390) {
      await controls.evaluate((panel) => panel.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: '.cache/ux06/after/workspace-controls-mobile-viewport.png' });
    }
  }
  await page.locator('.skip-link').focus();
  await expect(page.locator('.skip-link')).toBeInViewport();
  expect(await page.locator('.skip-link').evaluate((link) => getComputedStyle(link).clipPath)).toBe(
    'none',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await openSection(page, 'workspace-controls');
  await page.setViewportSize({ width: 1280, height: 720 });

  await operatorEvidence(page, research, 'research');
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  // Presentation follows the trusted snapshot purpose; public settings grant no authority.
  await page.route('**/api/workspace/workspace?*', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      response,
      json: { ...(await response.json()), purpose: 'commercial_qualification', scanMode: 'bypass' },
    });
  });
  await page.reload();
  await openSection(page, 'main');
  await expect(page.getByText('Operational workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Evidence scanning is deferred');
  await expect(page.locator('.ux-testmode')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.reload();
  await openSection(page, 'main');
  await expect(page.getByText('Preview workspace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect(
    (await page.request.get(`/api/workspace/workspace?tenant=${seed.tenantId}`)).status(),
  ).toBe(401);
});
test('all 18 operator destinations render with scoped audit, working policy jumps and retained forms', async ({
  page,
}) => {
  test.setTimeout(360000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  const workspace = page.getByRole('combobox', { name: 'Workspace', exact: true });
  if ((await workspace.inputValue()) !== seed.tenantId) await workspace.selectOption(seed.tenantId);
  await expect(workspace).toHaveValue(seed.tenantId);
  await expect(page).toHaveTitle('Operator workspace | Corridra');
  await mkdir('.cache/ux06/after/operator-subtabs', { recursive: true });
  for (const section of workspaceSections) {
    await openSection(page, section.id);
    const panel = page.locator('#' + section.id);
    await expect(panel.getByRole('heading').first()).toBeVisible();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        section.id + ' overflow at ' + width,
      ).toBe(true);
      expect(
        await page.locator('.ux-area-bar').evaluate((bar) => getComputedStyle(bar).position),
      ).toBe('static');
      if (width === 1440 || width === 390)
        expect(
          (await new AxeBuilder({ page }).analyze()).violations,
          section.id + ' accessibility at ' + width,
        ).toEqual([]);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `.cache/ux06/after/operator-subtabs/${section.id}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await openSection(page, 'workspace-audit');
  const audit = page.locator('#workspace-audit');
  await expect(audit.getByText('Review access when you need it', { exact: true })).toBeVisible();
  await audit.getByRole('button', { name: 'Load access and recent changes', exact: true }).click();
  await expect(audit.getByText('Synthetic Browser Operator', { exact: true })).toBeVisible();
  await expect(audit.getByText('Active membership', { exact: true })).toBeVisible();
  const event = audit.locator('.ux-audit-events > li').first();
  await expect(event.locator('time')).toHaveAttribute('datetime', /\d{4}-/);
  await event.getByText('Event references', { exact: true }).click();
  await expect(event.getByText('Event type', { exact: true })).toBeVisible();
  await expect(event.locator('code').first()).not.toBeEmpty();
  const firstEvent = await event.getAttribute('data-event');
  await expect(audit.locator('.ux-audit-events > li')).toHaveCount(10);
  await audit.getByRole('button', { name: 'Next changes', exact: true }).click();
  await expect(event).not.toHaveAttribute('data-event', firstEvent!);
  await audit.getByRole('button', { name: 'Previous changes', exact: true }).click();
  await expect(event).toHaveAttribute('data-event', firstEvent!);
  await event.getByText('Event references', { exact: true }).click();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: `.cache/ux06/after/operator-subtabs/audit-loaded-${width}.png`,
      fullPage: true,
    });
  }
  await openSection(page, 'workspace-settings');
  const settings = page.locator('#workspace-settings');
  for (const label of [
    'Mission templates',
    'Directional route',
    'Source rights and model policies',
    'Pinned configuration references',
  ]) {
    await settings.getByRole('button', { name: label, exact: true }).click();
    await expect(settings.locator('details[open]')).not.toHaveCount(0);
  }
  await expect(
    settings.getByRole('combobox', { name: 'Reviewed configuration action', exact: true }),
  ).toBeVisible();
  await settings
    .getByRole('textbox', { name: 'Reviewed command JSON', exact: true })
    .fill('{"reason":"retained scoped UI draft"}');
  await openSection(page, 'workspace-authenticator');
  await expect(page.getByLabel('Current authenticator code', { exact: true })).toHaveAttribute(
    'maxlength',
    '6',
  );
  await openSection(page, 'workspace-settings');
  await expect(
    settings.getByRole('textbox', { name: 'Reviewed command JSON', exact: true }),
  ).toHaveValue('{"reason":"retained scoped UI draft"}');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: `.cache/ux06/after/operator-subtabs/policies-expanded-${width}.png`,
      fullPage: true,
    });
  }
});

test('controlled buyer response progresses through durable delivery, a held meeting and owned follow-up', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  const verification = page.waitForResponse((r) => r.url().endsWith('/two-factor/verify-totp'));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  expect((await verification).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  const cookieMetadata = (await page.context().cookies()).map(
    ({ name, domain, path, expires }) => ({ name, domain, path, expires }),
  );
  expect(
    (await page.request.get('/api/workspace/tenants')).status(),
    JSON.stringify(cookieMetadata),
  ).toBe(200);
  const headers = { Origin: 'http://127.0.0.1:3200' };
  async function post(action: string, input: Record<string, unknown>) {
    const r = await page.request.post(`/api/workspace/${action}?tenant=${seed.tenantId}`, {
      headers,
      data: input,
    });
    const result = await r.json();
    expect(r.ok(), `Command ${action} failed (${r.status()}): ${result.error ?? ''}`).toBe(true);
    return result;
  }
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  for (const key of [
    'research.ingestion',
    'communications.introductions',
    'communications.dispatch',
  ])
    await post('config', { key, enabled: true });
  const intake = await page.request.post('/api/intake', {
    headers,
    data: {
      key: randomUUID(),
      websiteCheck: '',
      brief: {
        objective: 'Sell in a new market',
        market: 'Spain',
        attendance: 'No',
        startDate: '',
        endDate: '',
        timezone: 'Europe/Madrid',
        offer: 'Synthetic Part 06 hospitality textiles',
        website: '',
        outcomes: ['Relevant meetings'],
        notes: 'Private synthetic negotiation notes',
        name: 'Synthetic Part Six Person',
        company: 'Part Six Supplier',
        email: 'part06@example.invalid',
        acknowledged: true,
      },
    },
  });
  expect(intake.ok()).toBe(true);
  const mission = await intake.json();
  for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
    await post('mission', {
      id: mission.id,
      version: i + 1,
      commandId: randomUUID(),
      action,
      reason: 'Synthetic controlled access',
      ownerId: seed.principalId,
      nextAction: 'Prepare an approved introduction',
      dueAt: tomorrow,
      marketCode: 'ES',
      targetProfile: 'Synthetic hospitality distributor',
    });
  const catalogue = await (
    await page.request.get(
      `/api/workspace/research?tenant=${seed.tenantId}&q=Synthetic%20Browser%20Distributor%20A`,
    )
  ).json();
  const detail = await (
    await page.request.get(
      `/api/workspace/counterparty?tenant=${seed.tenantId}&id=${catalogue.organisations.find((o: { name: string }) => o.name === 'Synthetic Browser Distributor A').id}`,
    )
  ).json();
  const target = await post('research', {
    action: 'target',
    commandId: randomUUID(),
    missionId: mission.id,
    relationshipId: detail.relationships[0].id,
    contactId: detail.contacts[0].id,
    claimIds: [detail.attributes[0].claim_id],
    fit: 'POSSIBLE',
    rationale: 'Declared distribution fits the invented offer',
    uncertainty: 'Buyer demand remains unconfirmed',
    gaps: 'Need an actual response',
    nextAction: 'Review introduction',
    dueAt: tomorrow,
  });
  await page.reload();
  await openSection(page, 'workspace-meetings');
  await page.getByText('Approved communication policy and templates', { exact: true }).click();
  const policy = page.getByRole('form', { name: 'Approve communication policy' });
  await policy
    .getByLabel('Policy basis', { exact: true })
    .fill('Approved invented demonstration only. No real legal basis asserted.');
  await policy.getByRole('button', { name: 'Approve policy', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText('Saved.');
  const template = page.getByRole('form', { name: 'Approve communication template' });
  await template.getByLabel('Template name').fill('Part Six introduction');
  await template
    .getByLabel('Approved introduction text')
    .fill('Would a short conversation about hospitality requirements be useful?');
  await template.getByRole('button', { name: 'Approve template', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText('Saved.');
  await page.locator('summary', { hasText: 'Review and create a private introduction' }).click();
  const form = page.getByRole('form', { name: 'Create private introduction' });
  await form.getByLabel('Introduction target').selectOption(target.id);
  await form.getByLabel('Introduction recipient').selectOption(detail.contacts[0].id);
  await form
    .getByRole('combobox', { name: 'Approved policy', exact: true })
    .selectOption({ index: 1 });
  await form
    .getByRole('combobox', { name: 'Approved template', exact: true })
    .selectOption({ index: 1 });
  for (const [label, value] of [
    ['Relevant capability', 'Synthetic hotel towels'],
    ['Reason there may be a fit', 'Declared hospitality distribution requirement'],
    [
      'Evidence highlights for the buyer',
      'Supplier offer is self-declared. No independently verified capacity evidence.',
    ],
    ['What remains unverified for the buyer', 'Capacity and buyer demand are unverified.'],
    ['Proposed conversation purpose', 'Compare declared requirements'],
    ['Available conversation dates', 'Dates by agreement'],
  ])
    await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByLabel('I reviewed this introduction', { exact: false }).check();
  await form.getByRole('button', { name: 'Create private introduction', exact: true }).click();
  await expect(page.getByLabel('New private buyer link')).toBeVisible();
  const buyerLink = await page.getByLabel('New private buyer link').inputValue();
  await page.getByRole('button', { name: 'Dispatch pending introductions', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toContainText(
    'Delivery work started',
  );
  await expect
    .poll(
      async () => {
        const c = await (
          await page.request.get(`/api/workspace/communications?tenant=${seed.tenantId}`)
        ).json();
        return c.messages.find(
          (m: { presentation: { company: string } }) =>
            m.presentation.company === 'Part Six Supplier',
        ).delivery_status;
      },
      { timeout: 30000 },
    )
    .toBe('DELIVERED');
  const buyerContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:3200',
      viewport: { width: 390, height: 844 },
    }),
    buyer = await buyerContext.newPage();
  const token = new URL(buyerLink).hash.slice(1);
  expect((await buyer.request.get('/api/buyer?token=' + token)).status()).toBe(405);
  expect(
    (await buyer.request.get(`/api/workspace/communications?tenant=${seed.tenantId}`)).status(),
  ).toBe(401);
  await buyer.goto(buyerLink);
  await expect(
    buyer.getByRole('heading', { name: 'Would this company be relevant to you?' }),
  ).toBeVisible();
  await expect(buyer.getByText('Part Six Supplier', { exact: true })).toBeVisible();
  await expect(
    buyer.getByText('You will not be added to a mailing list by responding.'),
  ).toBeVisible();
  expect(await buyer.locator('body').innerText()).not.toContain('Private synthetic negotiation');
  expect(
    await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect((await new AxeBuilder({ page: buyer }).analyze()).violations).toEqual([]);
  await participantEvidence(buyer, 'buyer');
  await buyer.reload();
  await expect(buyer.getByRole('button', { name: 'Interested', exact: true })).toBeEnabled();
  let buyerFailed: Record<string, unknown> | undefined;
  await buyer.route('**/api/buyer', (route) => {
    const input = route.request().postDataJSON();
    if (input.action === 'respond') {
      buyerFailed = input;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic buyer transport interruption' }),
      });
    }
    return route.continue();
  });
  await buyer.getByRole('button', { name: 'Interested', exact: true }).click();
  await expect(buyer.getByRole('button', { name: 'Retry the same response' })).toBeVisible();
  await expect(
    buyer.getByLabel('Do not send me further introductions', { exact: false }),
  ).toBeDisabled();
  await buyer.unroute('**/api/buyer');
  const buyerRetry = buyer.waitForResponse(
    (r) => r.url().endsWith('/api/buyer') && r.request().postDataJSON().action === 'respond',
  );
  await buyer.getByRole('button', { name: 'Retry the same response' }).click();
  expect((await buyerRetry).request().postDataJSON()).toEqual(buyerFailed);
  await expect(buyer.getByRole('status')).toContainText('response has been recorded');
  const duplicate = await buyer.request.post('/api/buyer', {
    headers,
    data: {
      action: 'respond',
      token,
      responseId: randomUUID(),
      decision: 'INTERESTED',
      optOut: false,
    },
  });
  expect(duplicate.ok()).toBe(true);
  expect(
    (
      await buyer.request.post('/api/buyer', {
        headers: { Origin: 'https://untrusted.invalid' },
        data: {
          action: 'respond',
          token,
          responseId: randomUUID(),
          decision: 'NOT_RELEVANT',
          optOut: false,
        },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'Refresh access and meetings' }).click();
  await page.locator('summary', { hasText: 'Propose a meeting' }).click();
  const proposal = page.getByRole('form', { name: 'Propose meeting' });
  await proposal
    .getByRole('combobox', { name: 'Meeting introduction', exact: true })
    .selectOption({ label: 'Part Six Supplier (INTERESTED)' });
  await proposal.getByLabel('Meeting title').fill('Part Six buyer discussion');
  await proposal
    .getByLabel('Meeting brief', { exact: true })
    .fill('Compare requirements and remaining evidence gaps.');
  await proposal
    .getByLabel('Meeting participants, one per line')
    .fill('Synthetic supplier person\nSynthetic buyer person');
  await proposal
    .getByLabel('Meeting next action', { exact: true })
    .fill('Confirm the conversation');
  await proposal
    .getByLabel('Meeting command reason')
    .fill('Buyer expressed interest in the synthetic introduction');
  await proposal.getByRole('button', { name: 'Propose meeting', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Access status' })).toHaveText('Saved.');
  const card = page
    .locator('.meeting-card')
    .filter({ has: page.getByRole('heading', { name: 'Part Six buyer discussion', exact: true }) });
  await card
    .getByLabel('Meeting command reason')
    .fill('Attribute acceptance to the recorded buyer response');
  await card.getByRole('button', { name: 'Record meeting change' }).click();
  await expect(card.getByText(/State: Accepted/)).toBeVisible();
  const start = new Date(Date.now() - 3600000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 1800000);
  await card.getByLabel('Next meeting state').selectOption('SCHEDULED');
  await card.getByLabel('Meeting timezone', { exact: true }).fill('Etc/UTC');
  await card
    .getByLabel('Local meeting start', { exact: true })
    .fill(start.toISOString().slice(0, 16));
  await card.getByLabel('Local meeting end', { exact: true }).fill(end.toISOString().slice(0, 16));
  await card.getByLabel('Meeting start with UTC offset').fill(start.toISOString());
  await card.getByLabel('Meeting end with UTC offset').fill(end.toISOString());
  await card.getByLabel('Meeting location').fill('Synthetic meeting room');
  await card.getByLabel('Meeting command reason').fill('Record the agreed synthetic schedule');
  await card.getByRole('button', { name: 'Record meeting change' }).click();
  await expect(card.getByText(/State: Scheduled/)).toBeVisible();
  await card.getByLabel('Next meeting state').selectOption('HELD');
  await card
    .getByLabel('Observed meeting outcome')
    .fill('Both synthetic participants attended and agreed to share requirements.');
  await card
    .getByLabel('Meeting next action', { exact: true })
    .fill('Send the agreed requirement summary');
  await card
    .getByLabel('Meeting command reason')
    .fill('Record observed attendance and owned follow-up');
  await card.getByRole('button', { name: 'Record meeting change' }).click();
  await expect(card.getByText(/State: Held/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Send the agreed requirement summary', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card.getByText(/State: Held/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const heldSnapshot = await (
    await page.request.get(`/api/workspace/meetings?tenant=${seed.tenantId}`)
  ).json();
  expect(
    heldSnapshot.meetings.find((m: { title: string }) => m.title === 'Part Six buyer discussion')
      .mission_id,
  ).toBe(mission.id);
  await writeFile(
    '.cache/part07-browser-origin.json',
    JSON.stringify({
      missionId: mission.id,
      meetingId: heldSnapshot.meetings.find(
        (m: { title: string }) => m.title === 'Part Six buyer discussion',
      ).id,
    }),
    { mode: 0o600 },
  );
  await buyer.getByRole('button', { name: 'Stop further introductions' }).click();
  await expect(buyer.getByRole('status')).toContainText('Further introductions');
  await operatorEvidence(page, page.locator('#workspace-meetings'), 'meetings');
  await buyerContext.close();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect((await page.request.get(`/api/workspace/meetings?tenant=${seed.tenantId}`)).status()).toBe(
    401,
  );
});
test('operator follows the intake and held meeting through confirmed cash, recurrence, compensation and report replay', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8')),
    { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8')),
    origin = JSON.parse(await readFile('.cache/part07-browser-origin.json', 'utf8'));
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  const verification = page.waitForResponse((r) => r.url().endsWith('/two-factor/verify-totp'));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  expect((await verification).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  expect((await page.request.get('/api/workspace/tenants')).status()).toBe(200);
  const headers = { Origin: 'http://127.0.0.1:3200' };
  async function post(action: string, input: Record<string, unknown>) {
    const r = await page.request.post(`/api/workspace/${action}?tenant=${seed.tenantId}`, {
      headers,
      data: input,
    });
    const d = await r.json();
    expect(r.ok(), `${action}: ${r.status()} ${d.error ?? ''}`).toBe(true);
    return d;
  }
  await post('config', { key: 'opportunities.commands', enabled: true });
  for (const [i, action] of ['outreach', 'meetings', 'followup'].entries())
    await post('mission', {
      id: origin.missionId,
      version: 4 + i,
      commandId: randomUUID(),
      action,
      ownerId: seed.principalId,
      nextAction: 'Follow the invented opportunity',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      reason: 'Connect held meeting and commercial progression',
      marketCode: 'ES',
      targetProfile: 'Synthetic hospitality distributor',
    });
  const source = await post('source', {
    kind: 'observation',
    locator: 'Synthetic Part Seven accounting statement',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
    aiPolicy: 'DENY',
  });
  await openSection(page, 'workspace-commercial');
  const section = page.getByRole('region', { name: 'Commercial progress' }),
    status = page.getByRole('status', { name: 'Commercial status' });
  await page.getByRole('button', { name: 'Refresh commercial progress', exact: true }).click();
  await expect(
    section.getByText('Commercial commands are disabled.', { exact: false }),
  ).toHaveCount(0);
  await section.getByText('Create an opportunity from a held meeting', { exact: true }).click();
  const create = section.getByRole('form', { name: 'Create commercial opportunity' });
  await create.getByLabel('Opportunity origin meeting').selectOption(origin.meetingId);
  await create.getByLabel('Opportunity title').fill('Part Seven buyer opportunity');
  await create
    .getByLabel('Mission attribution and limits')
    .fill(
      'Corridra arranged the invented meeting. Sales causation is not independently established.',
    );
  await create.getByLabel('Commercial next action').fill('Qualify the observed requirement');
  await create
    .getByLabel('Commercial command reason')
    .fill('Record commercial follow-through from the held meeting');
  await create.getByRole('button', { name: 'Create commercial opportunity', exact: true }).click();
  await expect(status).toHaveText('Commercial progress saved.');
  const card = section.getByRole('article', { name: 'Part Seven buyer opportunity' });
  await expect(card.getByText(/Opportunity state: LEAD/)).toBeVisible();
  await section.getByLabel('Commercial report mission').selectOption(origin.missionId);
  await card.getByText('Change opportunity or follow-up', { exact: true }).click();
  async function advance(state: string) {
    const form = card.getByRole('form', {
      name: 'Change opportunity Part Seven buyer opportunity',
    });
    await form.getByLabel('Next opportunity action').selectOption(state);
    await form
      .getByLabel('Commercial command reason')
      .fill('Progress using the recorded commercial evidence');
    await form.getByRole('button', { name: 'Save opportunity change' }).click();
    await expect(card.getByText(`Opportunity state: ${state}`, { exact: false })).toBeVisible();
  }
  await advance('QUALIFIED_OPPORTUNITY');
  await card.getByText('Record RFQ, sample or commercial evidence', { exact: true }).click();
  const record = card.getByRole('form', {
    name: 'Record commercial evidence for Part Seven buyer opportunity',
  });
  const older = new Date(Date.now() - 180000).toISOString().slice(0, 16),
    later = new Date(Date.now() - 60000).toISOString().slice(0, 16);
  async function evidence(
    kind: string,
    reference: string,
    parent?: string,
    amount?: string,
    date = older,
    prior?: string,
  ) {
    await record.getByLabel('Commercial record type').selectOption(kind);
    if (parent)
      await record.getByLabel('Related commercial record').selectOption({ label: parent });
    if (prior) await record.getByLabel('Earlier confirmed receipt').selectOption({ label: prior });
    if (amount) {
      await record.getByLabel('Commercial currency').selectOption('EUR');
      await record.getByLabel('Commercial amount').fill(amount);
    }
    await record
      .getByRole('combobox', { name: 'Observation source', exact: true })
      .selectOption(source.id);
    await record.getByLabel('Observed date (UTC)').fill(date);
    await record
      .getByLabel('Commercial observation')
      .fill('Observed invented ' + kind.toLowerCase().replaceAll('_', ' '));
    await record.getByLabel('Commercial external reference').fill(reference);
    await record
      .getByLabel('Commercial command reason')
      .fill('Record invented evidence with source and date');
    await record.getByRole('button', { name: 'Record commercial evidence', exact: true }).click();
    await expect(card.getByLabel(reference, { exact: true })).toBeVisible();
    await expect(status).toHaveText('Commercial progress saved.');
  }
  await evidence('RFQ', 'part07-rfq');
  await evidence('SAMPLE', 'part07-sample');
  await evidence('PROPOSAL', 'part07-proposal', undefined, '250.00');
  await advance('PROPOSAL');
  await evidence('COMMITMENT', 'part07-commitment', 'part07-proposal · EUR 250.00', '250.00');
  await advance('COMMITMENT');
  await evidence('CONTRACT', 'part07-contract', 'part07-commitment · EUR 250.00', '250.00');
  await advance('CONTRACT');
  await evidence('INVOICE', 'part07-invoice', 'part07-contract · EUR 250.00', '125.00');
  await advance('INVOICE');
  await evidence('CASH_RECEIPT', 'part07-cash', 'part07-invoice · EUR 125.00', '125.00');
  const totals = section.getByLabel('EUR commercial totals');
  await expect(totals.getByText('Confirmed cash: EUR 0.00', { exact: true })).toBeVisible();
  const first = card.getByLabel('part07-cash', { exact: true });
  await expect(first.getByText('Reported receipt; accounting confirmation pending')).toBeVisible();
  async function confirm(reference: string) {
    const row = card.getByLabel(reference, { exact: true });
    await row.getByText('Confirm this cash observation', { exact: true }).click();
    const form = row.getByRole('form', { name: `Confirm cash ${reference}` });
    await form.getByLabel('Observation source').selectOption(source.id);
    await form
      .getByLabel('Accounting confirmation basis')
      .fill(
        'Human checked the invented accounting statement against the invoice and receipt reference.',
      );
    await form
      .getByLabel('Commercial command reason')
      .fill('Confirm the separately observed accounting record');
    await form.getByRole('button', { name: 'Confirm observed cash' }).click();
    await expect(row.getByText(/Accounting confirmed:/)).toBeVisible();
  }
  await confirm('part07-cash');
  await advance('CASH_COLLECTED');
  await expect(totals.getByText('Confirmed cash: EUR 125.00', { exact: true })).toBeVisible();
  await evidence(
    'INVOICE',
    'part07-repeat-invoice',
    'part07-contract · EUR 250.00',
    '125.00',
    later,
  );
  await evidence(
    'CASH_RECEIPT',
    'part07-repeat-cash',
    'part07-repeat-invoice · EUR 125.00',
    '125.00',
    later,
  );
  await confirm('part07-repeat-cash');
  await evidence(
    'REPEAT_ORDER',
    'part07-repeat-order',
    'part07-repeat-cash · EUR 125.00',
    undefined,
    later,
    'part07-cash',
  );
  await advance('RECURRING_REVENUE');
  await expect(totals.getByText('Confirmed cash: EUR 250.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('Repeat cash within confirmed cash: EUR 125.00')).toBeVisible();
  const before = await (
    await page.request.get(
      `/api/workspace/opportunities?tenant=${seed.tenantId}&mission=${origin.missionId}`,
    )
  ).json();
  await section
    .getByText('Rebuild commercial reports from retained events', { exact: true })
    .click();
  const rebuild = section.getByRole('form', { name: 'Rebuild commercial projections' });
  await rebuild
    .getByLabel('Commercial command reason')
    .fill('Check deterministic replay of recorded outcomes');
  await rebuild.getByRole('button', { name: 'Rebuild commercial reports', exact: true }).click();
  await expect(status).toHaveText('Commercial progress saved.');
  const after = await (
    await page.request.get(
      `/api/workspace/opportunities?tenant=${seed.tenantId}&mission=${origin.missionId}`,
    )
  ).json();
  expect(after.totals).toEqual(before.totals);
  expect(after.metrics).toEqual(before.metrics);
  const second = card.getByLabel('part07-repeat-cash', { exact: true });
  await second.getByText('Correct this amount with full compensation', { exact: true }).click();
  const reverse = second.getByRole('form', { name: 'Compensate part07-repeat-cash' });
  await reverse.getByLabel('Observation source').selectOption(source.id);
  await reverse
    .getByLabel('Commercial command reason')
    .fill('Correct the invented repeat receipt in full');
  await reverse.getByRole('button', { name: 'Record full compensation' }).click();
  await expect(second.getByText(/Compensation recorded/)).toBeVisible();
  await expect(totals.getByText('Confirmed cash: EUR 250.00', { exact: true })).toBeVisible();
  const report = await (
    await page.request.get(
      `/api/workspace/opportunities?tenant=${seed.tenantId}&mission=${origin.missionId}`,
    )
  ).json();
  const negative = report.records.find(
    (r: { reverse_of: string | null }) =>
      r.reverse_of ===
      before.records.find(
        (r: { external_reference: string }) => r.external_reference === 'part07-repeat-cash',
      ).id,
  );
  await confirm(negative.external_reference);
  await expect(totals.getByText('Confirmed cash: EUR 125.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('Repeat cash within confirmed cash: EUR 0.00')).toBeVisible();
  await page.reload();
  await expect(card.getByText(/Opportunity state: RECURRING_REVENUE/)).toBeVisible();
  await expect(totals.getByText('Confirmed cash: EUR 125.00', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const oldState = await page.context().storageState();
  await operatorEvidence(page, page.locator('#workspace-commercial'), 'commercial-progress');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  const stale = await browser.newContext({ storageState: oldState });
  expect(
    (
      await stale.request.get(
        `http://127.0.0.1:3200/api/workspace/opportunities?tenant=${seed.tenantId}`,
      )
    ).status(),
  ).toBe(401);
  expect(
    (
      await stale.request.post(
        `http://127.0.0.1:3200/api/workspace/opportunity?tenant=${seed.tenantId}`,
        { headers, data: { action: 'confirm' } },
      )
    ).status(),
  ).toBe(401);
  await stale.close();
});

test('scoped delivery imports every row, serves client requests and downloads complete programme reports', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  // This test runs after the established operator enrollment journey below.
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  // Earlier journeys sign in repeatedly from this one test address, and sign-in and two-factor
  // requests are limited to 5 per minute, so CI saw 429 here. Start with empty counters in the
  // dedicated local test database; the limits themselves and the real sign-in stay unchanged.
  const limits = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  try {
    await limits.query('DELETE FROM identity."rateLimit"');
  } finally {
    await limits.end();
  }
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  // The streamed page heading can arrive before the protected snapshot mounts.
  // Await both real authorized reads; retain all navigation and delivery assertions.
  const workspaceRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/workspace/workspace' &&
      new URL(response.url()).searchParams.get('tenant') === seed.tenantId,
  );
  const configRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/workspace/config' &&
      response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('tenant') === seed.tenantId,
  );
  const verification = page.waitForResponse((r) => r.url().endsWith('/two-factor/verify-totp'));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  const verified = await verification;
  if (!verified.ok())
    throw new Error(
      `MFA verification returned ${verified.status()}: ${(await verified.text()).slice(0, 200)}`,
    );
  const [snapshot, configuration] = await Promise.all([workspaceRead, configRead]);
  expect(snapshot.status()).toBe(200);
  expect(configuration.status()).toBe(200);
  expect((await snapshot.json()).role).toBe('owner');
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  await openSection(page, 'workspace-delivery');
  const panel = page.locator('.delivery-ops');
  await panel.locator('summary').filter({ hasText: 'Create programme' }).click();
  await panel.getByLabel('Programme name', { exact: true }).fill('Part Eight Browser Programme');
  await panel
    .getByLabel('Reporting purpose', { exact: true })
    .fill('Synthetic programme outcome review');
  await panel.getByRole('button', { name: 'Create programme', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Programme', exact: true })).not.toHaveValue('');
  const programmeId = await panel
    .getByRole('combobox', { name: 'Programme', exact: true })
    .inputValue();
  const template = intakeTemplate().split('\r\n');
  await panel.getByLabel('CSV or Excel intake').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`${template[0]}\r\n${template[1]}\r\n\r\n${template[1]}\r\n`),
  });
  await panel.getByRole('button', { name: 'Preview intake', exact: true }).click();
  await expect(panel.getByRole('table')).toBeVisible();
  await expect(panel.getByRole('table').locator('tbody tr')).toHaveCount(3);
  await panel.getByLabel('I reviewed every row', { exact: false }).check();
  await panel.getByRole('button', { name: 'Confirm intake', exact: true }).click();
  await expect(panel.getByLabel('Confirmed intake results').locator('li')).toHaveCount(3);
  await panel
    .getByLabel('Confirmed intake results')
    .getByRole('button', { name: 'Review imported mission' })
    .first()
    .click();
  await panel.locator('summary').filter({ hasText: 'Review client publication' }).click();
  await panel.getByLabel('Client title', { exact: true }).fill('Reviewed delivery progress');
  await panel.getByLabel('Approved company name').fill('Synthetic Browser Cohort');
  await panel.getByLabel('Approved objective').fill('Review suitable market conversations');
  await panel
    .getByLabel('Approved request', { exact: true })
    .fill('Approved synthetic brief. Private intake contacts and negotiation notes are withheld.');
  await panel.getByLabel('Client next action').fill('Respond to the approved requirement request');
  const deadline = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await panel.getByLabel('Next action deadline').fill(deadline);
  await panel.getByLabel('I reviewed this copy', { exact: false }).check();
  await panel.getByRole('button', { name: 'Approve publication', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Delivery status' })).toHaveText('Saved.');
  await panel.locator('summary').filter({ hasText: 'Create evidence request' }).click();
  await panel.getByLabel('Request title', { exact: true }).fill('Confirm synthetic requirements');
  await panel
    .getByLabel('Approved instructions')
    .fill('Describe the synthetic requirement. Documents follow operator collection and review.');
  await panel.getByLabel('Response deadline').fill(deadline);
  await panel.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(panel.getByRole('status', { name: 'Delivery status' })).toHaveText('Saved.');
  await panel.locator('summary').filter({ hasText: 'Share approved view' }).click();
  await panel
    .getByRole('group', { name: 'Approved publications' })
    .getByRole('checkbox')
    .first()
    .check();
  await panel.getByLabel('Approved sharing purpose').fill('Synthetic client mission progress');
  await panel.getByLabel('Link expiry', { exact: false }).fill(deadline);
  await panel.getByLabel('I approve this audience', { exact: false }).check();
  await panel.getByRole('button', { name: 'Create private link', exact: true }).click();
  const clientLink = await panel.getByLabel('Private link', { exact: true }).inputValue();
  const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await clientContext.newPage();
  expect((await client.request.get('/api/delivery')).status()).toBe(405);
  expect(
    (await client.request.get(`/api/workspace/delivery?tenant=${seed.tenantId}`)).status(),
  ).toBe(401);
  await client.goto(clientLink);
  await expect(
    client.getByRole('heading', { name: 'Synthetic Browser Cohort: Reviewed delivery progress' }),
  ).toBeVisible();
  expect(await client.locator('body').innerText()).not.toContain('participant@example.invalid');
  expect(
    await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect((await new AxeBuilder({ page: client }).analyze()).violations).toEqual([]);
  await participantEvidence(client, 'client-response');
  await client
    .getByLabel('Response', { exact: true })
    .fill('Invented requirement supplied as a declaration.');
  await client.getByLabel('This response is my declaration', { exact: false }).check();
  let evidenceFailed: Record<string, unknown> | undefined;
  await client.route('**/api/delivery', (route) => {
    const input = route.request().postDataJSON();
    if (input.action === 'respond') {
      evidenceFailed = input;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic evidence response interruption' }),
      });
    }
    return route.continue();
  });
  await client.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect(client.getByLabel('Response', { exact: true })).toHaveValue(
    'Invented requirement supplied as a declaration.',
  );
  await expect(client.getByLabel('Response', { exact: true })).toBeDisabled();
  await client.unroute('**/api/delivery');
  const evidenceRetry = client.waitForResponse(
    (r) => r.url().endsWith('/api/delivery') && r.request().postDataJSON().action === 'respond',
  );
  await client.getByRole('button', { name: 'Retry same evidence response' }).click();
  expect((await evidenceRetry).request().postDataJSON()).toEqual(evidenceFailed);
  await expect(client.getByRole('status').filter({ hasText: 'Response received' })).toBeVisible();
  await page.reload();
  const evidenceRequest = panel.locator('li').filter({ hasText: 'Confirm synthetic requirements' });
  await expect(
    evidenceRequest.getByText('Self-declared response:', { exact: false }),
  ).toBeVisible();
  await evidenceRequest.getByRole('button', { name: 'Mark fulfilled', exact: true }).click();
  await expect(evidenceRequest).toContainText('completed');
  await panel
    .getByRole('navigation', { name: 'Publication and reporting sections' })
    .getByRole('button', { name: 'Programmes', exact: true })
    .click();
  await panel.getByLabel('Programme name', { exact: true }).fill('UX-04 unsaved programme draft');
  const oldProgramme = await panel
    .getByRole('combobox', { name: 'Programme', exact: true })
    .inputValue();
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await panel
    .getByRole('combobox', { name: 'Programme', exact: true })
    .selectOption(oldProgramme === programmeId ? '' : programmeId);
  await expect(panel.getByRole('combobox', { name: 'Programme', exact: true })).toHaveValue(
    oldProgramme,
  );
  await expect(panel.getByLabel('Programme name', { exact: true })).toHaveValue(
    'UX-04 unsaved programme draft',
  );
  await panel
    .getByLabel('Programme name', { exact: true })
    .evaluate((input) => (input.closest('form') as HTMLFormElement).reset());
  let releaseScope!: () => void;
  const scopeGate = new Promise<void>((resolve) => {
    releaseScope = resolve;
  });
  const scopeRoute = '**/api/workspace/delivery?*';
  await page.route(scopeRoute, async (route) => {
    if (
      route.request().method() === 'GET' &&
      new URL(route.request().url()).searchParams.get('programme') === programmeId &&
      !new URL(route.request().url()).searchParams.has('action')
    ) {
      const response = await route.fetch();
      await scopeGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const scopedRequest = page.waitForRequest(
    (r) =>
      r.method() === 'GET' &&
      new URL(r.url()).searchParams.get('programme') === programmeId &&
      !new URL(r.url()).searchParams.has('action'),
  );
  await panel.getByRole('combobox', { name: 'Programme', exact: true }).selectOption(programmeId);
  await scopedRequest;
  try {
    await expect(panel.getByRole('combobox', { name: 'Programme', exact: true })).toBeHidden();
  } finally {
    releaseScope();
  }
  await expect(panel.getByRole('combobox', { name: 'Programme', exact: true })).toHaveValue(
    programmeId,
  );
  await page.unroute(scopeRoute);
  await panel.locator('summary').filter({ hasText: 'Share approved view' }).click();
  await panel
    .getByRole('group', { name: 'Approved publications' })
    .getByRole('checkbox')
    .first()
    .check();
  await panel
    .getByRole('combobox', { name: 'Audience', exact: true })
    .selectOption('INSTITUTION_REPORT');
  await panel.getByLabel('Approved sharing purpose').fill('Synthetic programme outcome review');
  await panel.getByLabel('Link expiry', { exact: false }).fill(deadline);
  await panel.getByLabel('Allow CSV and PDF reports', { exact: false }).check();
  await panel.getByLabel('I approve this audience', { exact: false }).check();
  await panel.getByRole('button', { name: 'Create private link', exact: true }).click();
  const institutionLink = await panel.getByLabel('Private link', { exact: true }).inputValue();
  await client.goto(institutionLink);
  await expect(client.getByRole('button', { name: 'Download CSV', exact: true })).toBeVisible();
  expect(await client.locator('body').innerText()).not.toContain('Invented requirement supplied');
  await operatorEvidence(page, panel, 'delivery');
  const reportNavigation = client.getByRole('navigation', { name: 'Approved report sections' });
  await reportNavigation.getByRole('button', { name: 'Programme overview', exact: true }).focus();
  await client.keyboard.press('Enter');
  await expect(
    client.getByRole('heading', { name: 'Programme overview', exact: true }),
  ).toBeFocused();
  await expect(client.locator('.ux-programme-overview')).toContainText(
    'Only the approved participants',
  );
  await participantEvidence(client, 'institution');
  for (const format of ['CSV', 'PDF']) {
    const response = client.waitForResponse(
      (r) => r.url().endsWith('/api/delivery') && r.request().postDataJSON().action === 'export',
    );
    const download = client.waitForEvent('download');
    await client.getByRole('button', { name: `Download ${format}`, exact: true }).click();
    const r = await response;
    expect(r.status()).toBe(200);
    const downloaded = await download;
    const downloadPath = await downloaded.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await readFile(downloadPath!);
    expect(bytes.length).toBeGreaterThan(100);
    if (format === 'CSV') expect(bytes.toString()).toContain('Reviewed delivery progress');
    else expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(downloaded.suggestedFilename()).toBe(`corridra-programme.${format.toLowerCase()}`);
    const replay = await client.request.post('/api/delivery', {
      headers: { Origin: 'http://127.0.0.1:3200' },
      data: r.request().postDataJSON(),
    });
    expect(replay.status()).toBe(200);
    expect(await replay.body()).toEqual(bytes);
  }
  expect((await new AxeBuilder({ page: client }).analyze()).violations).toEqual([]);
  const institutionalAccess = panel.locator('li').filter({
    hasText: 'institution report · Synthetic programme outcome review',
  });
  const revocation = page.waitForResponse(
    (r) =>
      r.url().includes('/api/workspace/delivery') &&
      r.request().method() === 'POST' &&
      r.request().postDataJSON().action === 'revoke',
  );
  await institutionalAccess.getByRole('button', { name: 'Revoke link', exact: true }).click();
  expect((await revocation).ok()).toBe(true);
  await expect(institutionalAccess).toContainText('Revoked');
  await client.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(client.getByRole('alert').filter({ hasText: 'Access denied' })).toContainText(
    'unavailable',
  );
  await clientContext.close();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect((await page.request.get(`/api/workspace/delivery?tenant=${seed.tenantId}`)).status()).toBe(
    401,
  );
});

test('route-aware machinery requirements and evidence-aware supplier comparison work in the existing workspace', async ({
  page,
}) => {
  test.setTimeout(240000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  // Preserve the shared-IP five-per-minute MFA budget after the preceding journeys.
  const rateWindowEnd = Date.now() + 60000;
  await expect
    .poll(() => Date.now(), { timeout: 65000, intervals: [1000] })
    .toBeGreaterThanOrEqual(rateWindowEnd);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const counter = Math.floor(Date.now() / 30000);
  await expect
    .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [500] })
    .not.toBe(counter);
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  const verification = page.waitForResponse((r) => r.url().endsWith('/two-factor/verify-totp'));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  const verified = await verification;
  // Sign-in leaves with a full page load once the code is accepted (KI-30), which takes the response
  // body with it, so the body is read only for the failure message, when the form stays.
  const verificationResult = verified.ok() ? {} : await verified.json();
  expect(
    verified.ok(),
    JSON.stringify({
      status: verified.status(),
      errorCode: verificationResult.code,
      error: verificationResult.message,
    }),
  ).toBe(true);
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  expect((await page.request.get('/api/workspace/tenants')).status()).toBe(200);
  const headers = { Origin: 'http://127.0.0.1:3200' },
    reason = 'Explicit invented machinery browser acceptance';
  async function post(action: string, data: Record<string, unknown>) {
    const r = await page.request.post(`/api/workspace/${action}?tenant=${seed.tenantId}`, {
      headers,
      data,
    });
    const result = await r.json();
    expect(r.ok(), `${action}: ${result.error ?? r.status()}`).toBe(true);
    return result;
  }
  const intake = await page.request.post('/api/intake', {
    headers,
    data: {
      key: randomUUID(),
      websiteCheck: '',
      brief: {
        objective: 'Source suppliers',
        market: 'China',
        attendance: 'No',
        startDate: '',
        endDate: '',
        timezone: 'Asia/Dhaka',
        offer: 'Invented machinery procurement for browser validation',
        website: '',
        outcomes: ['Supplier visits'],
        notes: 'Synthetic only',
        name: 'Synthetic Importer',
        company: 'Synthetic Machinery Browser',
        email: 'machinery@example.invalid',
        acknowledged: true,
      },
    },
  });
  expect(intake.ok()).toBe(true);
  const missionId = (await intake.json()).id;
  const dueAt = new Date(Date.now() + 86400000).toISOString();
  for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
    await post('mission', {
      id: missionId,
      version: i + 1,
      commandId: randomUUID(),
      action,
      ownerId: seed.principalId,
      nextAction: 'Request supplier documentation',
      dueAt,
      marketCode: 'CN',
      targetProfile: 'Declared machinery technical needs',
      reason,
    });
  await post('mission-templates', {});
  const catalogue = await (
    await page.request.get(`/api/workspace/mission-catalogue?tenant=${seed.tenantId}`)
  ).json();
  const requirementDefinition = catalogue.requirements.find(
      (r: { schema: { typeKey: string } }) => r.schema.typeKey === 'machinery_procurement',
    ),
    assessmentDefinition = catalogue.assessments.find(
      (r: { schema: { typeKey: string } }) => r.schema.typeKey === 'machinery_procurement',
    );
  const routeId = randomUUID(),
    packId = randomUUID(),
    assignmentId = randomUUID();
  await post('corridor-route', { id: routeId, origin: 'BD', destination: 'CN', reason });
  await post('corridor-pack', {
    id: packId,
    routeId,
    version: 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      currencies: ['CNY'],
      missionTypes: ['machinery_procurement'],
      requirements: [requirementDefinition.id],
      assessments: [assessmentDefinition.id],
    },
  });
  await post('mission-route', {
    id: assignmentId,
    missionId,
    packId,
    missionTypeId: catalogue.types.find((t: { key: string }) => t.key === 'machinery_procurement')
      .id,
    version: 1,
    reason,
  });
  const source = await post('source', {
    kind: 'public_record',
    locator: 'https://example.invalid/machinery-browser',
    observedAt: new Date().toISOString(),
    classification: 'PUBLIC',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 604800000).toISOString(),
    aiPolicy: 'DENY',
  });
  const claim = await post('claim', {
    sourceId: source.id,
    statement: 'Invented supplier machine capacity declaration, unverified',
  });
  const company = await post('research', {
    action: 'ingest',
    commandId: randomUUID(),
    sourceId: source.id,
    name: 'Synthetic Machinery Supplier 原始机械',
    country: 'CN',
    domain: 'machinery.example.invalid',
    address: 'Synthetic factory site',
    identifierType: 'registry',
    identifier: randomUUID(),
  });
  await post('research', {
    action: 'attribute',
    commandId: randomUUID(),
    organisationId: company.id,
    kind: 'capability',
    claimId: claim.id,
    validUntil: new Date(Date.now() + 518400000).toISOString(),
  });
  const relationship = await post('research', {
    action: 'relationship',
    commandId: randomUUID(),
    organisationId: company.id,
    ownerId: seed.principalId,
    visibility: 'OWNER',
    note: 'Synthetic supplier relationship',
  });
  const recipientContact = await post('research', {
    action: 'contact',
    commandId: randomUUID(),
    relationshipId: relationship.id,
    sourceId: source.id,
    name: 'Invented Supplier Representative',
    jobTitle: 'Equipment coordinator',
    email: 'supplier-role@example.invalid',
    validUntil: new Date(Date.now() + 518400000).toISOString(),
  });
  const target = await post('research', {
    action: 'target',
    commandId: randomUUID(),
    missionId,
    relationshipId: relationship.id,
    contactId: recipientContact.id,
    claimIds: [claim.id],
    fit: 'POSSIBLE',
    rationale: 'Declared capacity may fit',
    uncertainty: 'No independent engineering assessment',
    gaps: 'Need technical documents',
    nextAction: 'Request supplier documents',
    dueAt,
  });
  await page.reload();
  await openSection(page, 'workspace-missions');
  const card = page.locator('.mission-card').filter({
    has: page.getByRole('heading', { name: 'Synthetic Machinery Browser', exact: true }),
  });
  await expect(card.getByRole('combobox', { name: 'Structured market', exact: true })).toHaveValue(
    'CN',
  );
  await openSection(page, 'workspace-research');
  await page.getByText('Record a research source and company', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Company country', exact: true }).selectOption('CN');
  await page.getByText('Record a research source and company', { exact: true }).click();
  await openSection(page, 'workspace-missions');
  await card.getByRole('button', { name: 'Review requirements, offers and visits' }).click();
  await expect(card.getByText('BD → CN', { exact: false })).toBeVisible();
  await card
    .getByRole('combobox', { name: 'Declared source', exact: true })
    .selectOption(source.id);
  await card
    .getByRole('combobox', { name: 'Source declaration', exact: true })
    .selectOption(claim.id);
  await card
    .getByLabel('Commercial objective', { exact: true })
    .fill('Procure a machine against declared requirements');
  const ux04Guide = card.getByRole('navigation', {
    name: /Requirements and offer sections for mission/,
  });
  const ux04Hash = new URL(page.url()).hash;
  await ux04Guide.getByRole('button', { name: 'History', exact: true }).click();
  await expect(card.getByLabel('Commercial objective', { exact: true })).toHaveValue(
    'Procure a machine against declared requirements',
  );
  expect(new URL(page.url()).hash).toBe(ux04Hash);
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await card.getByRole('combobox', { name: 'Next task', exact: true }).selectOption('quotation');
  await expect(card.getByRole('combobox', { name: 'Next task', exact: true })).toHaveValue(
    'requirements',
  );
  await expect(card.getByLabel('Commercial objective', { exact: true })).toHaveValue(
    'Procure a machine against declared requirements',
  );
  const oldQueueFilter = await page
    .getByRole('combobox', { name: 'Show missions', exact: true })
    .inputValue();
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page
    .getByRole('combobox', { name: 'Show missions', exact: true })
    .selectOption(oldQueueFilter === 'all' ? 'open' : 'all');
  await expect(page.getByRole('combobox', { name: 'Show missions', exact: true })).toHaveValue(
    oldQueueFilter,
  );
  await expect(card.getByLabel('Commercial objective', { exact: true })).toHaveValue(
    'Procure a machine against declared requirements',
  );
  await card
    .getByRole('combobox', { name: 'Commercial role', exact: true })
    .selectOption('IMPORTER');
  await card.getByLabel('Product or service', { exact: true }).fill('Synthetic production machine');
  await card.getByText('Machine technical requirements', { exact: true }).click();
  await card
    .getByLabel('Throughput and capacity', { exact: true })
    .fill('One hundred pieces per hour');
  await card.getByLabel('Reason for recording this change', { exact: true }).fill(reason);
  await card.getByRole('button', { name: 'Save requirements', exact: true }).click();
  await expect(card.getByRole('status').filter({ hasText: 'Saved with source' })).toBeVisible();
  const snapshot = await (
    await page.request.get(
      `/api/workspace/commercial-mission?tenant=${seed.tenantId}&mission=${missionId}`,
    )
  ).json();
  const requirementId = snapshot.requirements[0].id;
  await ux04Guide.getByRole('button', { name: 'Requirements', exact: true }).click();
  await expect(card.locator('summary').filter({ hasText: 'Requirements, version' })).toBeFocused();

  await card.getByRole('combobox', { name: 'Next task', exact: true }).selectOption('assessment');
  await card
    .getByRole('combobox', { name: 'Declared source', exact: true })
    .selectOption(source.id);
  await card
    .getByRole('combobox', { name: 'Source declaration', exact: true })
    .selectOption(claim.id);
  await card.getByRole('combobox', { name: 'Counterparty', exact: true }).selectOption(target.id);
  for (let i = 0; i < 3; i++) {
    await card
      .getByLabel('Requirement assessed', { exact: true })
      .nth(i)
      .fill('Declared machine capacity and supplier fit');
    await card
      .getByLabel('Evidence or declared basis', { exact: true })
      .nth(i)
      .fill('Supplier declaration only; independent documentation not reviewed');
  }
  await card
    .getByLabel('unknowns', { exact: true })
    .fill('Utilities and installation remain unknown');
  await card
    .getByLabel('gaps', { exact: true })
    .fill('Request technical documentation and references');
  await card
    .getByLabel('rationale', { exact: true })
    .fill('Discuss requirements before any supplier selection');
  await card.getByLabel('Reason for recording this change', { exact: true }).fill(reason);
  await card.getByRole('button', { name: 'Save assessment', exact: true }).click();
  await expect(card.getByRole('status').filter({ hasText: 'Saved with source' })).toBeVisible();
  const technicalTable = card.getByRole('table', {
    name: 'Machinery observations against the current requirements',
    exact: true,
  });
  await expect(technicalTable).toContainText('UNKNOWN');
  const base = { missionId, reason, sourceId: source.id, claimId: claim.id };
  const rfq = await post('commercial-mission', {
    ...base,
    action: 'rfq',
    commandId: randomUUID(),
    requirementId,
    targetIds: [target.id],
    buyerContext: 'Synthetic importer machinery request',
    requestedTerms: 'Capacity, installation and shipping scope',
    dueAt,
  });
  await card.getByRole('combobox', { name: 'Next task', exact: true }).selectOption('quotation');
  await card
    .getByRole('combobox', { name: 'Declared source', exact: true })
    .selectOption(source.id);
  await card
    .getByRole('combobox', { name: 'Source declaration', exact: true })
    .selectOption(claim.id);
  await card.getByRole('combobox', { name: 'Counterparty', exact: true }).selectOption(target.id);
  // The RFQ was appended through the same authenticated API; refresh the panel before selection.
  await card.getByRole('button', { name: 'Review requirements, offers and visits' }).click();
  await card.getByRole('combobox', { name: 'RFQ', exact: true }).selectOption(rfq.id);
  await card.getByLabel('unitPrice (original currency amount)', { exact: true }).fill('1200.00');
  await card
    .getByLabel('Explicit uncertainties', { exact: true })
    .fill('Quantity, Incoterm and installation not supplied');
  await card.getByLabel('Reason for recording this change', { exact: true }).fill(reason);
  await card.getByRole('button', { name: 'Save quotation', exact: true }).click();
  await expect(card.getByRole('status').filter({ hasText: 'Saved with source' })).toBeVisible();
  await expect(card.getByRole('cell', { name: 'NOT COMPARABLE', exact: false })).toBeVisible();
  await expect(card.getByRole('cell', { name: 'CNY 1200.00', exact: true })).toBeVisible();
  await card.getByText('Terms and calculation basis', { exact: true }).click();
  await expect(card.getByText('NOT SUPPLIED', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.mission-card').analyze()).violations).toEqual(
    [],
  );
  await mkdir('.cache/v2-part-02', { recursive: true });
  await card.screenshot({ path: '.cache/v2-part-02/machinery-requirements-and-comparison.png' });
  expect(
    (
      await page.request.post(`/api/workspace/commercial-mission?tenant=${seed.tenantId}`, {
        headers: { Origin: 'https://untrusted.example.invalid' },
        data: { action: 'quotation' },
      })
    ).status(),
  ).toBe(403);
  // Part 3 uses the same actual MFA session and its scoped recipient/publication services.
  async function deliveryAction(action: string, input: Record<string, unknown>) {
    return post('delivery', { action, input: { commandId: randomUUID(), ...input } });
  }
  const commercialData = await (
    await page.request.get(
      `/api/workspace/commercial-mission?tenant=${seed.tenantId}&mission=${missionId}`,
    )
  ).json();
  const publication = await deliveryAction('publication', {
    missionId,
    title: 'Approved machinery participant detail',
    company: 'Synthetic Machinery Browser',
    objective: 'Review original machinery requirements',
    brief:
      'Only explicitly approved synthetic requirements and the original offer for this participant.',
    nextAction: 'Review missing supplier terms',
    dueAt,
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  await deliveryAction('experience-publication', {
    publicationId: publication.id,
    requirementId,
    targetIds: [target.id],
    quotationIds: [commercialData.quotations[0].id],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const client = await deliveryAction('share', {
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: reason,
    expiresAt: dueAt,
    allowExport: false,
    approved: true,
  });
  const ux03Local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const ux03Owner = new Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: ux03Local.ownerPassword,
    database: 'corridra_browser',
  });
  try {
    const { seedSyntheticWorkspace } = await import('../../packages/auth/src/bootstrap');
    const other = await seedSyntheticWorkspace(ux03Owner, {
      email: `ux03-other-${randomUUID()}@example.invalid`,
      password: randomUUID() + randomUUID(),
      name: 'UX-03 Unrelated Synthetic Owner',
    });
    expect(
      (await page.request.get(`/api/workspace/delivery?tenant=${other.tenantId}`)).status(),
    ).toBe(403);
    const scoped = await page.request.get(`/api/workspace/delivery?tenant=${seed.tenantId}`);
    expect(scoped.ok()).toBe(true);
    expect(JSON.stringify(await scoped.json())).not.toContain(other.tenantId);
  } finally {
    await ux03Owner.end();
  }
  const guestContext = await page
    .context()
    .browser()!
    .newContext({ baseURL: 'http://127.0.0.1:3200' });
  const clientPage = await guestContext.newPage();
  expect((await clientPage.request.get('/api/workspace/tenants')).status()).toBe(401);
  await clientPage.goto(`/client#${client.token}`);
  await expect(clientPage.getByRole('region', { name: 'Approved next action' })).toBeVisible();
  await expect(clientPage.locator('.ux-mission-detail')).not.toHaveAttribute('open', '');
  await participantEvidence(clientPage, 'client-mission-overview');
  await clientPage
    .getByRole('navigation', { name: 'Approved report sections' })
    .getByRole('button', { name: 'Requirements', exact: true })
    .focus();
  await clientPage.keyboard.press('Enter');
  await expect(clientPage.locator('.ux-mission-detail')).toHaveAttribute('open', '');
  await expect(
    clientPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toBeVisible();
  await expect(
    clientPage.getByRole('heading', { name: 'Target shortlist and fit', exact: true }),
  ).toBeVisible();
  await expect(
    clientPage.getByRole('heading', { name: /Synthetic Machinery Supplier 原始机械/ }),
  ).toBeVisible();
  await expect(
    clientPage.getByText('Original unit price: CNY 1,200.00', { exact: true }),
  ).toBeVisible();
  await expect(clientPage.getByText('NOT COMPARABLE.', { exact: false })).toBeVisible();
  expect(await clientPage.locator('body').innerText()).not.toContain(
    'supplier-role@example.invalid',
  );
  expect(
    (await new AxeBuilder({ page: clientPage }).include('.delivery-view').analyze()).violations,
  ).toEqual([]);
  await mkdir('.cache/v2-part-03', { recursive: true });
  await operatorEvidence(
    page,
    card.locator(':scope > .operator-section').first(),
    'requirements-and-offers',
  );
  const missionNavigation = clientPage.getByRole('navigation', {
    name: 'Approved report sections',
  });
  await missionNavigation.getByRole('button', { name: 'Supplier offers', exact: true }).focus();
  await clientPage.keyboard.press('Enter');
  await expect(
    clientPage.getByRole('heading', { name: 'Original quotations and comparison', exact: true }),
  ).toBeFocused();
  await clientPage.getByLabel('Evidence lens', { exact: true }).selectOption('current');
  await missionNavigation.getByRole('button', { name: 'Next decision', exact: true }).click();
  await expect(clientPage.getByRole('heading', { name: 'Next action', exact: true })).toBeFocused();
  await expect(clientPage.getByLabel('Evidence lens', { exact: true })).toHaveValue('current');
  await clientPage.locator('.ux-mission-detail > summary').click();
  await expect(clientPage.locator('.ux-mission-detail')).not.toHaveAttribute('open', '');
  await missionNavigation.getByRole('button', { name: 'Supplier offers', exact: true }).focus();
  await clientPage.keyboard.press('Enter');
  await expect(clientPage.locator('.ux-mission-detail')).toHaveAttribute('open', '');
  await expect(clientPage.getByLabel('Evidence lens', { exact: true })).toHaveValue('current');
  await clientPage.getByLabel('Evidence lens', { exact: true }).selectOption('all');
  await expect(
    clientPage.getByRole('complementary', { name: 'Mission at a glance' }),
  ).toContainText('Approved quotations');
  await participantEvidence(clientPage, 'client-mission');
  await expect(
    clientPage.getByRole('region', { name: 'Original quotation comparison' }),
  ).toContainText('CNY 1,200.00');
  await clientPage.getByLabel('Evidence lens', { exact: true }).selectOption('review');
  await clientPage.getByLabel('Evidence lens', { exact: true }).selectOption('all');
  await clientPage.getByLabel('Date and number display', { exact: true }).selectOption('bn-BD');
  await expect(
    clientPage.getByRole('region', { name: 'Original quotation comparison' }),
  ).toContainText('CNY');
  await expect(
    clientPage.getByRole('heading', { name: /Synthetic Machinery Supplier 原始机械/ }),
  ).toBeVisible();
  await clientPage.getByLabel('Date and number display', { exact: true }).selectOption('en');
  let releaseOldRead: (() => void) | undefined;
  let oldReadStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    oldReadStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseOldRead = resolve;
  });
  await clientPage.route('**/api/delivery', async (route) => {
    const input = route.request().postDataJSON();
    if (input.action === 'view' && input.token === client.token) {
      const real = await route.fetch();
      oldReadStarted?.();
      await release;
      await route.fulfill({ response: real }).catch(() => {});
    } else await route.continue();
  });
  await clientPage.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await Promise.race([
    started,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Delayed scope read did not start')), 15000),
    ),
  ]);
  await clientPage.evaluate(() => {
    window.location.hash = '0'.repeat(64);
  });
  await expect(clientPage.locator('.ux-workspace').getByRole('alert')).toBeVisible();
  await expect(
    clientPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toHaveCount(0);
  releaseOldRead?.();
  await clientPage.unroute('**/api/delivery');
  await clientPage.evaluate((token) => {
    window.location.hash = token;
  }, client.token);
  await clientPage
    .getByRole('navigation', { name: 'Approved report sections' })
    .getByRole('button', { name: 'Requirements', exact: true })
    .click();
  await expect(
    clientPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toBeVisible();
  await clientPage.screenshot({
    path: '.cache/v2-part-03/client-machinery-detail.png',
    fullPage: true,
  });
  const policy = await post('communication', {
    action: 'policy',
    commandId: randomUUID(),
    jurisdiction: 'CN',
    channel: 'SYNTHETIC',
    contactPurpose: 'official_company_channel',
    basis: 'Invented policy for scoped supplier browser acceptance only',
    validUntil: new Date(Date.now() + 432000000).toISOString(),
    enabled: true,
  });
  const template = await post('communication', {
    action: 'template',
    commandId: randomUUID(),
    name: 'Approved synthetic supplier request',
    contactPurpose: 'official_company_channel',
    body: 'Please review only the explicitly shared requirement for this invented request.',
  });
  const intro = await post('communication', {
    action: 'introduce',
    commandId: randomUUID(),
    targetId: target.id,
    contactId: recipientContact.id,
    policyId: policy.id,
    templateId: template.id,
    expiresAt: dueAt,
    introduction: {
      company: 'Synthetic Machinery Browser',
      country: 'BD',
      capability: 'Invented machinery procurement requirement',
      fit: 'Technical suitability needs supplier clarification',
      evidence: 'The buyer context is self-declared; no independent verification',
      uncertainty: 'Installation and shipping conditions remain unresolved',
      conversationPurpose: 'Clarify the original technical request',
      availableDates: 'Dates require actual confirmation',
    },
  });
  await deliveryAction('recipient-disclosure', {
    linkId: intro.id,
    role: 'SUPPLIER',
    sharedRequirements:
      'Only the invented machinery requirement is shareable; no private contact or other supplier quotation is included.',
    uncertainty: 'Technical suitability remains unverified',
    rfqId: rfq.id,
    allowQuotation: true,
    allowMeetingInterest: true,
    approved: true,
    reason,
  });
  const recipientPage = await guestContext.newPage();
  await recipientPage.goto(intro.buyerPath);
  await expect(
    recipientPage.getByRole('heading', { name: 'Explicitly shared requirements', exact: true }),
  ).toBeVisible();
  await recipientPage
    .getByLabel('Your response', { exact: true })
    .fill('供应商原文答复：请确认技术参数。');
  await recipientPage.getByLabel('Include a supplier-declared quotation', { exact: true }).check();
  await recipientPage
    .getByRole('combobox', { name: 'Original currency', exact: true })
    .selectOption('CNY');
  await recipientPage
    .getByLabel('Unit price (original currency amount) (optional)', { exact: true })
    .fill('123.45');
  await recipientPage
    .getByLabel('Missing information and uncertainties', { exact: true })
    .fill('Shipping and installation are not supplied');
  await recipientPage
    .getByLabel('This is my declaration for this request.', { exact: false })
    .check();
  await recipientPage
    .getByLabel('Unit price (original currency amount)', { exact: false })
    .fill('123.456');
  await recipientPage.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(recipientPage.locator('.buyer-card').getByRole('alert')).toBeFocused();
  await expect(recipientPage.getByLabel('Your response', { exact: true })).toHaveValue(
    '供应商原文答复：请确认技术参数。',
  );
  await recipientPage
    .getByLabel('Unit price (original currency amount)', { exact: false })
    .fill('123.45');
  let supplierFailed: Record<string, unknown> | undefined;
  await recipientPage.route('**/api/buyer', (route) => {
    const input = route.request().postDataJSON();
    if (input.action === 'detail-response') {
      supplierFailed = input;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic supplier interruption' }),
      });
    }
    return route.continue();
  });
  await recipientPage.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(recipientPage.getByLabel('Your response', { exact: true })).toBeDisabled();
  await recipientPage.unroute('**/api/buyer');
  const supplierRetry = recipientPage.waitForResponse(
    (r) =>
      r.url().endsWith('/api/buyer') && r.request().postDataJSON().action === 'detail-response',
  );
  await recipientPage.getByRole('button', { name: 'Retry the same declaration' }).click();
  expect((await supplierRetry).request().postDataJSON()).toEqual(supplierFailed);
  await expect(
    recipientPage.getByRole('heading', { name: 'Your recorded response', exact: true }),
  ).toBeVisible();
  await expect(
    recipientPage.getByRole('heading', { name: 'Your recorded response', exact: true }),
  ).toBeFocused();
  await expect(
    recipientPage.getByText('Original quoted unit price: CNY 123.45', { exact: true }),
  ).toBeVisible();
  expect(await recipientPage.locator('body').innerText()).not.toContain(
    'supplier-role@example.invalid',
  );
  expect((await new AxeBuilder({ page: recipientPage }).analyze()).violations).toEqual([]);
  await participantEvidence(recipientPage, 'supplier');
  await recipientPage.screenshot({
    path: '.cache/v2-part-03/supplier-declared-response.png',
    fullPage: true,
  });
  const shortExpiry = Date.now() + 5000;
  const short = await deliveryAction('share', {
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: reason,
    expiresAt: new Date(shortExpiry).toISOString(),
    allowExport: false,
    approved: true,
  });
  const expiredPage = await guestContext.newPage();
  await expiredPage.goto(`/client#${short.token}`);
  await expiredPage
    .getByRole('navigation', { name: 'Approved report sections' })
    .getByRole('button', { name: 'Requirements', exact: true })
    .click();
  await expect(
    expiredPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => Date.now(), { timeout: 8000, intervals: [1000] })
    .toBeGreaterThan(shortExpiry);
  await expiredPage.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(expiredPage.locator('.ux-workspace').getByRole('alert')).toBeVisible();
  await expect(
    expiredPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toHaveCount(0);
  await expiredPage.getByRole('button', { name: 'Try again' }).click();
  await expect(expiredPage.locator('.ux-workspace').getByRole('alert')).toBeVisible();
  await expiredPage.close();
  const wrongAudience = await guestContext.newPage();
  await wrongAudience.goto(`/programme#${client.token}`);
  await expect(wrongAudience.locator('.ux-workspace').getByRole('alert')).toBeVisible();
  await expect(
    wrongAudience.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toHaveCount(0);
  await wrongAudience.close();
  await deliveryAction('revoke', { linkId: client.id, publicationId: null, reason });
  await clientPage.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(
    clientPage.getByRole('heading', { name: 'Requirements and decisions', exact: true }),
  ).toHaveCount(0);
  await expect(
    clientPage
      .getByRole('alert')
      .filter({ hasText: 'This private link has expired or was replaced' }),
  ).toBeVisible();
  await post('communication', {
    action: 'revoke',
    commandId: randomUUID(),
    linkId: intro.id,
    reason,
  });
  await recipientPage.reload();
  await expect(recipientPage.getByRole('status')).toContainText('unavailable or expired');
  await clientPage.close();
  await recipientPage.close();
  await guestContext.close();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect(
    (
      await page.request.get(
        `/api/workspace/commercial-mission?tenant=${seed.tenantId}&mission=${missionId}`,
      )
    ).status(),
  ).toBe(401);
});

test('governed SDK fixture review and mobile non-member execution preserve independent rewards and offline retries', async ({
  page,
  browser,
}) => {
  test.setTimeout(420000);
  page.setDefaultTimeout(10000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  let { secret } = JSON.parse(
    await readFile('.cache/part06-browser-authenticator.json', 'utf8').catch(() => '{"secret":""}'),
  );
  const budgetAfter = Date.now() + 60000;
  await expect
    .poll(() => Date.now(), { timeout: 65000, intervals: [1000] })
    .toBeGreaterThanOrEqual(budgetAfter);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Set up your authenticator|Verify your authenticator/ }),
  ).toBeVisible();
  const firstEnrollment = await page
    .getByRole('heading', { name: 'Set up your authenticator' })
    .isVisible();
  if (firstEnrollment) {
    await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    secret = await page.getByLabel('Authenticator setup key').inputValue();
  }
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  const headers = { Origin: 'http://127.0.0.1:3200' },
    reason = 'Synthetic governed AI and network browser validation';
  async function post(action: string, input: Record<string, unknown>) {
    const r = await page.request.post(`/api/workspace/${action}?tenant=${seed.tenantId}`, {
      headers,
      data: input,
    });
    const data = await r.json();
    expect(r.ok(), `${action}: ${data.error ?? r.status()}`).toBe(true);
    return data;
  }
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  const runtime = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'corridra_runtime_local',
    password: local.runtimePassword,
  });
  const operatorContext = await browser.newContext(),
    contributorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    // Use the session that actually completed this browser's MFA flow, rather
    // than guessing the latest session for a fixture principal in another pool.
    await expect(page.getByRole('navigation', { name: 'Workspace sections' })).toBeVisible();
    const sessionResponse = await page.request.get('/api/operator-auth/get-session');
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();
    expect(session?.session?.token).toBeTruthy();
    const ctx = {
      token: session.session.token,
      tenantId: seed.tenantId,
      purpose: 'synthetic_validation',
    };
    const { provisionSyntheticContributor } = await import('../../packages/auth/src/bootstrap');
    const { withTenant } = await import('../../packages/db/src/index');
    const contributorPassword = 'synthetic-browser-contributor-strong-password',
      reviewerPassword = 'synthetic-browser-reviewer-strong-password';
    const contributor = await provisionSyntheticContributor(db, ctx, {
      email: 'contributor@example.invalid',
      name: 'Synthetic contributor',
      password: contributorPassword,
      operatingCountry: 'BD',
    });
    const reviewer = await provisionSyntheticContributor(db, ctx, {
      email: 'taskreviewer@example.invalid',
      name: 'Synthetic task reviewer',
      password: reviewerPassword,
      operatingCountry: 'BD',
    });
    await withTenant(runtime, ctx, 'members.manage', async (t) =>
      t.db.query(
        "INSERT INTO app.membership(tenant_id,user_id,role,allowed_countries) VALUES($1,$2,'operator',ARRAY['BD'])",
        [seed.tenantId, reviewer.principalId],
      ),
    );
    await post('config', { key: 'ai.enabled', enabled: true });
    await post('config', { key: 'network.enabled', enabled: true });
    const until = new Date(Date.now() + 10 * 86400000).toISOString(),
      soon = new Date(Date.now() + 86400000).toISOString();
    const source = (
      await post('source', {
        kind: 'public_record',
        locator: 'Synthetic public machine capacity protocol fixture',
        observedAt: new Date().toISOString(),
        classification: 'PUBLIC',
        purpose: 'synthetic_validation',
        retentionUntil: until,
        aiPolicy: 'REVIEW_REQUIRED',
      })
    ).id;
    const claim = (
      await post('claim', {
        sourceId: source,
        statement: 'Synthetic machine capacity is 100 units per hour.',
      })
    ).id;
    await post('ai-rights', {
      id: randomUUID(),
      version: 1,
      policy: {
        sourceId: source,
        licence: 'Synthetic fixture-only review',
        permittedReuse: ['AI_REVIEW'],
        role: 'CONTROLLER',
        purpose: 'synthetic_validation',
        classification: 'PUBLIC',
        jurisdictions: ['DE'],
        subjectLocations: [],
        processingLocations: ['DE'],
        retentionUntil: until,
        legalHold: false,
        aiPermission: 'REVIEW_REQUIRED',
        transferStatus: 'APPROVED',
        transferMechanism: 'Synthetic protocol fixture',
      },
      effectiveFrom: new Date().toISOString(),
      reason,
    });
    const policyId = randomUUID();
    await post('ai-policy', {
      policy: {
        id: policyId,
        version: 1,
        adapter: 'openai',
        model: 'synthetic-golden-v1',
        secretRef: 'CORRIDRA_OPENAI_API_KEY',
        approved: true,
        evaluationStatus: 'SYNTHETIC_ONLY',
        evaluationSourceId: source,
        processingLocations: ['DE'],
        tasks: ['commercial_intent'],
        inputRateMinorPerMillion: '100',
        outputRateMinorPerMillion: '200',
        maxCostMinor: '100',
        currency: 'USD',
        effectiveUntil: until,
      },
      key: 'browser-protocol-fixture',
      termsSourceId: source,
      dailyBudgetMinor: '1000',
      effectiveFrom: new Date().toISOString(),
      reason,
    });
    const intake = await page.request.post('/api/intake', {
      headers,
      data: {
        key: randomUUID(),
        websiteCheck: '',
        brief: {
          objective: 'Source suppliers',
          market: 'China',
          attendance: 'No',
          startDate: '',
          endDate: '',
          timezone: 'Asia/Dhaka',
          offer: 'Synthetic governed machinery and contributor journey',
          website: '',
          outcomes: ['Supplier visits'],
          notes: 'Invented records only',
          name: 'Synthetic machine buyer',
          company: 'Synthetic Part 4 Browser',
          email: 'part4@example.invalid',
          acknowledged: true,
        },
      },
    });
    expect(intake.ok()).toBe(true);
    const missionId = (await intake.json()).id;
    for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
      await post('mission', {
        id: missionId,
        version: i + 1,
        commandId: randomUUID(),
        action,
        ownerId: seed.principalId,
        nextAction: 'Review synthetic machine evidence',
        dueAt: soon,
        marketCode: 'CN',
        targetProfile: 'Synthetic technical supplier needs',
        reason,
      });
    await post('mission-templates', {});
    const catalogue = await (
      await page.request.get(`/api/workspace/mission-catalogue?tenant=${seed.tenantId}`)
    ).json();
    let route = (
      await db.query(
        "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='CN'",
        [seed.tenantId],
      )
    ).rows[0];
    if (!route) {
      route = { id: randomUUID() };
      await post('corridor-route', { id: route.id, origin: 'BD', destination: 'CN', reason });
    }
    const version =
      (
        await db.query(
          'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2',
          [seed.tenantId, route.id],
        )
      ).rows[0].n + 1;
    const packId = randomUUID(),
      assignmentId = randomUUID();
    await post('corridor-pack', {
      id: packId,
      routeId: route.id,
      version,
      status: 'TESTING',
      effectiveFrom: new Date().toISOString(),
      reason,
      configuration: {
        ...initialRouteConfiguration(initialRoutes[2]),
        missionTypes: ['machinery_procurement'],
        requiredCapabilities: ['supplier_research'],
        aiPolicyRef: policyId,
      },
    });
    await post('mission-route', {
      id: assignmentId,
      missionId,
      packId,
      missionTypeId: catalogue.types.find((x: { key: string }) => x.key === 'machinery_procurement')
        .id,
      version: 1,
      reason,
    });
    await page.reload();
    await openSection(page, 'workspace-ai');
    const aiPanel = page.getByRole('region', { name: 'Governed AI review' });
    await aiPanel.getByLabel('Mission reference', { exact: true }).fill(missionId);
    await aiPanel.getByLabel('Reviewed model policy').selectOption(policyId);
    await aiPanel.getByLabel('Approved public claim references, separated by commas').fill(claim);
    const aiSubmissions: unknown[] = [];
    await page.route('**/api/workspace/ai-run?*', async (route) => {
      aiSubmissions.push(route.request().postDataJSON());
      if (aiSubmissions.length === 1) {
        await route.fetch();
        await route.abort('connectionfailed');
      } else await route.continue();
    });
    await aiPanel.getByRole('button', { name: 'Prepare a draft' }).click();
    await expect(aiPanel.getByRole('status')).toContainText('Receipt not confirmed.');
    await aiPanel
      .getByLabel('Approved public claim references, separated by commas')
      .fill(randomUUID());
    await aiPanel.getByRole('button', { name: 'Prepare a draft' }).click();
    expect(aiSubmissions).toHaveLength(2);
    expect(aiSubmissions[1]).toEqual(aiSubmissions[0]);
    await page.unroute('**/api/workspace/ai-run?*');
    await aiPanel.getByLabel('Approved public claim references, separated by commas').fill(claim);
    await expect(
      aiPanel
        .getByText('Synthetic provider fixture only; acceptance unknown', { exact: false })
        .first(),
    ).toBeVisible();
    await expect(aiPanel.getByText('Unverified AI draft', { exact: true }).first()).toBeVisible();
    const blockedCommands: { commandId: string }[] = [];
    await page.route('**/api/workspace/ai-run?*', async (route) => {
      blockedCommands.push(route.request().postDataJSON());
      await route.continue();
    });
    await aiPanel
      .getByLabel('Approved public claim references, separated by commas')
      .fill(randomUUID());
    const rejectedBeforeIntent = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/workspace/ai-run' && r.request().method() === 'POST',
    );
    await aiPanel.getByRole('button', { name: 'Prepare a draft' }).click();
    expect((await rejectedBeforeIntent).status()).toBe(403);
    await expect(aiPanel.getByRole('status')).not.toContainText('Receipt not confirmed.');
    const contactClaim = (
      await post('claim', {
        sourceId: source,
        statement:
          'Synthetic protocol-only contact fixture@example.invalid is not approved model input.',
      })
    ).id;
    await aiPanel
      .getByLabel('Approved public claim references, separated by commas')
      .fill(contactClaim);
    const contactDenied = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/workspace/ai-run' && r.request().method() === 'POST',
    );
    await aiPanel.getByRole('button', { name: 'Prepare a draft' }).click();
    expect((await contactDenied).status()).toBe(403);
    await expect(aiPanel.getByRole('status')).not.toContainText('Receipt not confirmed.');
    const largeClaims: string[] = [];
    for (let i = 0; i < 4; i++)
      largeClaims.push(
        (await post('claim', { sourceId: source, statement: `${i}${'合成'.repeat(999)}` })).id,
      );
    await aiPanel
      .getByLabel('Approved public claim references, separated by commas')
      .fill(largeClaims.join(','));
    const oversizedAfterIntent = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/workspace/ai-run' && r.request().method() === 'POST',
    );
    await aiPanel.getByRole('button', { name: 'Prepare a draft' }).click();
    expect((await oversizedAfterIntent).status()).toBe(413);
    await expect(aiPanel.getByRole('status')).toContainText('Request recorded.');
    expect(blockedCommands).toHaveLength(3);
    expect(new Set(blockedCommands.map((command) => command.commandId)).size).toBe(3);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM app.ai_run WHERE id=$1', [
          blockedCommands[0].commandId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM app.ai_run WHERE id=$1', [
          blockedCommands[1].commandId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM app.ai_run WHERE id=$1', [
          blockedCommands[2].commandId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM app.ai_attempt WHERE run_id=ANY($1::uuid[])', [
          blockedCommands.map((command) => command.commandId),
        ])
      ).rows[0].n,
    ).toBe(0);
    await page.unroute('**/api/workspace/ai-run?*');
    await aiPanel.getByLabel('Approved public claim references, separated by commas').fill(claim);
    await aiPanel.getByRole('button', { name: 'Inspect original sources' }).click();
    await expect(
      aiPanel.getByText('Authorized original source quotations and rights'),
    ).toBeVisible();
    await aiPanel.getByRole('button', { name: 'Close source inspection' }).click();
    await aiPanel.getByLabel('Review reason', { exact: true }).fill(reason);
    await page.route('**/api/workspace/intelligence?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic post-receipt refresh outage' }),
      }),
    );
    await aiPanel.getByRole('button', { name: 'Save human review' }).click();
    await expect(aiPanel.getByRole('status')).toContainText('Review received. Refresh failed');
    await page.unroute('**/api/workspace/intelligence?*');
    await aiPanel.getByRole('button', { name: 'Refresh AI review', exact: true }).click();
    await expect(aiPanel.getByText('SUCCEEDED · ACCEPT', { exact: false })).toBeVisible();
    const profileId = randomUUID();
    await post('network-profile', {
      id: profileId,
      principalId: contributor.principalId,
      version: 1,
      alias: 'Synthetic remote engineer',
      categories: ['technical_adviser'],
      capabilities: ['supplier_research'],
      markets: ['CN'],
      languages: ['en'],
      sectors: ['machinery'],
      workCountries: ['BD'],
      available: true,
      status: 'ACTIVE',
      eligibilitySourceId: source,
      expiresAt: until,
      reason,
    });
    const ruleId = randomUUID();
    await post('network-rule', {
      id: ruleId,
      key: 'browser-reward',
      version: 1,
      amountMinor: '1000',
      currency: 'CNY',
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
      effectiveUntil: until,
      reason,
    });
    const taskId = randomUUID();
    await post('network-task', {
      id: taskId,
      missionId,
      routeAssignmentId: assignmentId,
      kind: 'supplier_research',
      market: 'CN',
      workCountry: 'BD',
      location: 'Declared remote synthetic work location',
      language: 'en',
      sector: 'machinery',
      capabilities: ['supplier_research'],
      instructions: 'Review only the disclosed synthetic machine capacity statement.',
      deadline: soon,
      expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      evidenceRequired: 'Original source-reported machine capacity statement',
      effort: 'Two hours of synthetic review; no guaranteed earnings',
      dataHandling: 'Synthetic disclosed information only; no private contacts',
      cancellationTerms: 'Owner reviews cancellation with a recorded reason',
      disputeTerms: 'Independent reviewer assesses original evidence and dispute',
      reviewerId: reviewer.principalId,
      rewardRuleId: ruleId,
      reason,
    });
    await post('network-event', {
      commandId: randomUUID(),
      taskId,
      version: 0,
      action: 'ASSIGN',
      details: {
        kind: 'assignment',
        profileId,
        relationshipDisclosure: 'Synthetic invited engineer; no counterparty relationship',
      },
      reason,
    });
    async function enrolled(
      p: import('@playwright/test').Page,
      email: string,
      password: string,
      path: string,
    ) {
      p.setDefaultTimeout(10000);
      await p.goto(path);
      await p.getByLabel('Email', { exact: true }).fill(email);
      await p.getByLabel('Password', { exact: true }).fill(password);
      await p.getByRole('button', { name: 'Continue', exact: true }).click();
      await p.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
      const secret = await p.getByLabel('Authenticator setup key').inputValue();
      await p.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
      await p.getByRole('button', { name: 'Verify and open workspace' }).click();
      return secret;
    }
    const contributorPage = await contributorContext.newPage();
    const contributorSecret = await enrolled(
      contributorPage,
      'contributor@example.invalid',
      contributorPassword,
      `/contributor?workspace=${seed.tenantId}`,
    );
    let contributorCounter = Math.floor(Date.now() / 30000);
    await expect(
      contributorPage.getByRole('heading', { name: 'Your assigned tasks.' }),
    ).toBeVisible();
    await expect(
      contributorPage.getByText('Review only the disclosed synthetic machine capacity statement.'),
    ).toBeVisible();
    expect(
      (
        await contributorPage.request.get(`/api/workspace/missions?tenant=${seed.tenantId}`)
      ).status(),
    ).toBe(403);
    expect(await (await contributorPage.request.get('/api/workspace/tenants')).json()).toEqual([]);
    expect(
      (await db.query('SELECT * FROM app.membership WHERE user_id=$1', [contributor.principalId]))
        .rowCount,
    ).toBe(0);
    await contributorPage
      .getByLabel('Acceptance and relationship confirmation')
      .fill('I accept the disclosed synthetic task and relationship limits');
    await contributorPage.getByRole('button', { name: 'Accept the disclosed task' }).click();
    await expect(contributorPage.getByLabel('Original work and evidence statement')).toBeVisible();
    await contributorPage
      .getByLabel('Original work and evidence statement')
      .fill('Original synthetic work: declared machine capacity remains unverified.');
    await contributorPage
      .getByLabel('Submission context')
      .fill('Synthetic evidence submission, no independent verification');
    await contributorContext.setOffline(true);
    await contributorPage.getByRole('button', { name: 'Submit for evidence review' }).click();
    await expect(contributorPage.getByRole('status')).toContainText('Not received');
    await expect(
      contributorPage.getByRole('button', { name: 'Sign out of assigned work' }),
    ).toBeDisabled();
    const verifyLink = contributorPage.getByRole('link', {
      name: 'Verify your authenticator again',
      exact: false,
    });
    await expect(verifyLink).toHaveAttribute('target', '_blank');
    expect(
      new URL((await verifyLink.getAttribute('href'))!, 'http://127.0.0.1:3200').searchParams.get(
        'next',
      ),
    ).toBe('/contributor?workspace=' + seed.tenantId);
    expect(
      (await db.query('SELECT count(*)::int n FROM app.network_event WHERE task_id=$1', [taskId]))
        .rows[0].n,
    ).toBe(2);
    await contributorContext.setOffline(false);
    await contributorPage.route('**/api/network/tasks?*', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Synthetic post-acknowledgment refresh interruption' }),
          })
        : route.continue(),
    );
    await contributorPage.getByRole('button', { name: 'Retry the same request' }).click();
    await expect(contributorPage.getByRole('status')).toContainText('Received and saved');
    await expect(
      contributorPage.getByRole('button', { name: 'Retry the same request' }),
    ).toHaveCount(0);
    await expect(contributorPage.getByLabel('Original work and evidence statement')).toBeDisabled();
    await contributorPage.unroute('**/api/network/tasks?*');
    await contributorPage.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await expect(contributorPage.getByLabel('Dispute reason')).toBeVisible();
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM app.network_event WHERE task_id=$1 AND action='SUBMIT'",
          [taskId],
        )
      ).rows[0].n,
    ).toBe(1);
    if (firstEnrollment) {
      const resetAt = Date.now() + 60000;
      await expect
        .poll(() => Date.now(), { timeout: 65000, intervals: [1000] })
        .toBeGreaterThanOrEqual(resetAt);
    }
    const reviewerPage = await operatorContext.newPage();
    await enrolled(
      reviewerPage,
      'taskreviewer@example.invalid',
      reviewerPassword,
      '/operator/signin',
    );
    await expect(reviewerPage.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
    await openSection(reviewerPage, 'workspace-network');
    const networkPanel = reviewerPage
      .getByRole('region', { name: 'Execution network' })
      .locator('article')
      .filter({ hasText: 'Review only the disclosed synthetic machine capacity statement.' });
    await networkPanel.getByText('Original work and review history').click();
    await expect(
      networkPanel.getByText(
        'Original synthetic work: declared machine capacity remains unverified.',
      ),
    ).toBeVisible();
    await networkPanel.getByLabel('Evidence quality (0–4)').fill('3');
    await networkPanel.getByLabel('Timeliness (0–4)').fill('4');
    await networkPanel
      .getByLabel('Review rationale')
      .fill('Original source-reported work preserved; no independent verification');
    await networkPanel.getByLabel('Review reason', { exact: true }).first().fill(reason);
    await networkPanel
      .getByRole('button', { name: 'Review original submitted declaration' })
      .click();
    await expect(networkPanel.getByText(/^REVIEW · version/)).toBeVisible();
    await expect(
      networkPanel.getByRole('button', { name: 'Save independent decision' }),
    ).toBeVisible();
    await networkPanel.getByLabel('Review reason', { exact: true }).first().fill(reason);
    await networkPanel.getByLabel('Evidence decision').selectOption('COMPLETE');
    const decisions: unknown[] = [];
    await reviewerPage.route('**/api/workspace/network-event?*', async (route) => {
      decisions.push(route.request().postDataJSON());
      if (decisions.length === 1) {
        await route.fetch();
        await route.abort('connectionfailed');
      } else await route.continue();
    });
    await networkPanel.getByRole('button', { name: 'Save independent decision' }).click();
    await expect(
      reviewerPage.getByRole('region', { name: 'Execution network' }).getByRole('status'),
    ).toContainText('Receipt not confirmed.');
    await networkPanel
      .getByLabel('Review reason', { exact: true })
      .first()
      .fill('Changed after original submission');
    await networkPanel.getByRole('button', { name: 'Save independent decision' }).click();
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
    await reviewerPage.unroute('**/api/workspace/network-event?*');
    await expect(
      networkPanel.getByRole('button', { name: 'Assess contribution once' }),
    ).toBeVisible();
    await networkPanel.getByLabel('Review reason', { exact: true }).first().fill(reason);
    await networkPanel.getByRole('button', { name: 'Assess contribution once' }).click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              'SELECT count(*)::int n FROM app.contribution WHERE tenant_id=$1 AND task_key=$2',
              [seed.tenantId, 'network:' + taskId],
            )
          ).rows[0].n,
      )
      .toBe(1);
    const contribution = (
      await db.query('SELECT * FROM app.contribution WHERE tenant_id=$1 AND task_key=$2', [
        seed.tenantId,
        'network:' + taskId,
      ])
    ).rows[0];
    const reward = await post('network-reward', {
      commandId: randomUUID(),
      contributionId: contribution.id,
      sourceId: contribution.source_id,
      reason,
    });
    await post('network-reward', {
      commandId: randomUUID(),
      contributionId: contribution.id,
      sourceId: contribution.source_id,
      reason,
    });
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM app.service_ledger WHERE contribution_id=$1 AND reverse_of IS NULL',
          [contribution.id],
        )
      ).rows[0].n,
    ).toBe(1);
    await contributorPage.getByRole('button', { name: 'Refresh tasks' }).click();
    await expect(
      contributorPage.getByRole('heading', { name: 'Reviewed reward obligations' }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page: contributorPage }).analyze()).violations).toEqual([]);
    expect(
      await contributorPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mkdir('docs/implementation/evidence/v2-part-04', { recursive: true });
    await participantEvidence(contributorPage, 'contributor');
    await contributorPage.screenshot({
      path: 'docs/implementation/evidence/v2-part-04/contributor-mobile.png',
      fullPage: true,
    });
    await post('network-reverse', {
      commandId: randomUUID(),
      ledgerId: reward.id,
      sourceId: contribution.source_id,
      reason: 'Synthetic compensating reversal acceptance',
    });
    await contributorPage.getByRole('button', { name: 'Refresh tasks' }).click();
    await expect(
      contributorPage.getByText('compensating reversal', { exact: false }),
    ).toBeVisible();
    await post('network-profile', {
      id: randomUUID(),
      principalId: contributor.principalId,
      version: 2,
      alias: 'Synthetic remote engineer',
      categories: ['technical_adviser'],
      capabilities: ['supplier_research'],
      markets: ['CN'],
      languages: ['en'],
      sectors: ['machinery'],
      workCountries: ['BD'],
      available: false,
      status: 'SUSPENDED',
      eligibilitySourceId: source,
      expiresAt: until,
      reason: 'Synthetic access suspension after acceptance',
    });
    await contributorPage.getByRole('button', { name: 'Refresh tasks' }).click();
    await expect(
      contributorPage.getByText('No current reviewed assignment is available.'),
    ).toBeVisible();

    // A refused sign-out says so in place and can be tried again.
    const assignedTasks = contributorPage.getByRole('region', { name: 'Assigned tasks' });
    const signOutButton = contributorPage.getByRole('button', {
      name: 'Sign out of assigned work',
    });
    const signOutRoute = '**/api/operator-auth/sign-out';
    await expect(assignedTasks).toBeVisible();
    await contributorPage.route(signOutRoute, (route) =>
      route.fulfill({ status: 500, json: { message: 'Synthetic sign-out refusal' } }),
    );
    await signOutButton.click();
    await expect(
      contributorPage
        .getByRole('alert')
        .filter({ hasText: 'Sign-out could not be completed. Try again.' }),
    ).toBeVisible();
    await expect(contributorPage).toHaveURL(
      `http://127.0.0.1:3200/contributor?workspace=${seed.tenantId}`,
    );
    await expect(signOutButton).toBeEnabled();
    await contributorPage.unroute(signOutRoute);

    // A confirmed sign-out is a full page load to the contributor page (KI-30). The new document
    // is held for 2 s so the button can be seen to stay disabled after the sign-out succeeded.
    await contributorPage.route('**/contributor', async (route) => {
      if (route.request().resourceType() === 'document')
        await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    await contributorPage.evaluate(() => {
      Object.assign(window, { beforeSignOut: true });
      // The button as the page is replaced, kept in this tab's session storage.
      window.addEventListener('pagehide', () => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => candidate.textContent === 'Sign out of assigned work',
        );
        sessionStorage.setItem(
          'signOutButtonWhenLeaving',
          button ? (button.disabled ? 'disabled' : 'enabled') : '',
        );
      });
    });
    const signedOut = contributorPage.waitForResponse(signOutRoute);
    await signOutButton.click();
    expect((await signedOut).ok()).toBe(true);
    await expect(contributorPage).toHaveURL('http://127.0.0.1:3200/contributor');
    expect(
      await contributorPage.evaluate(() => sessionStorage.getItem('signOutButtonWhenLeaving')),
      'still disabled when the next page replaced it',
    ).toBe('disabled');
    await expect(
      contributorPage.getByRole('heading', { name: 'Your assigned tasks.' }),
    ).toBeVisible();
    expect(
      await contributorPage.evaluate(() => 'beforeSignOut' in window),
      'signed out with a new page',
    ).toBe(false);
    await expect(assignedTasks).toHaveCount(0);
    await contributorPage.unroute('**/contributor');
    expect(
      (await contributorPage.request.get(`/api/network/tasks?workspace=${seed.tenantId}`)).status(),
    ).toBe(401);
    await contributorPage.goBack();
    await expect(assignedTasks).toHaveCount(0);

    // Signing in again opens the task board with nothing left from the earlier session.
    await clearSignInLimits(local.ownerPassword);
    await contributorPage.goto(
      '/operator/signin?next=' + encodeURIComponent(`/contributor?workspace=${seed.tenantId}`),
    );
    await expect(
      contributorPage.getByRole('heading', { name: 'Use your contributor work account' }),
    ).toBeVisible();
    await contributorPage.getByLabel('Email', { exact: true }).fill('contributor@example.invalid');
    await contributorPage.getByLabel('Password', { exact: true }).fill(contributorPassword);
    await contributorPage.getByRole('button', { name: 'Continue', exact: true }).click();
    // A code is used once per window: wait past the window used to sign in.
    await expect
      .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
      .toBeGreaterThan(contributorCounter);
    await contributorPage
      .getByLabel('Six-digit code', { exact: true })
      .fill(totp(contributorSecret));
    contributorCounter = Math.floor(Date.now() / 30000);
    await contributorPage.evaluate(() => Object.assign(window, { beforeSignIn: true }));
    await contributorPage.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(contributorPage).toHaveURL(
      `http://127.0.0.1:3200/contributor?workspace=${seed.tenantId}`,
    );
    // Sign-in returns with a full page load (KI-30), so the task board is a new document.
    await expect(assignedTasks).toBeVisible();
    expect(
      await contributorPage.evaluate(() => 'beforeSignIn' in window),
      'returned with a new page',
    ).toBe(false);
    await expect(
      contributorPage.getByText('No current reviewed assignment is available.'),
    ).toBeVisible();
    await expect(contributorPage.getByText('Received and saved', { exact: false })).toHaveCount(0);

    // A principal with no workspace membership who returns to a workspace sees the existing denial.
    await clearSignInLimits(local.ownerPassword);
    await contributorPage.goto(
      '/operator/signin?next=' + encodeURIComponent(`/operator?workspace=${seed.tenantId}`),
    );
    await contributorPage.getByLabel('Email', { exact: true }).fill('contributor@example.invalid');
    await contributorPage.getByLabel('Password', { exact: true }).fill(contributorPassword);
    await contributorPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect
      .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
      .toBeGreaterThan(contributorCounter);
    await contributorPage
      .getByLabel('Six-digit code', { exact: true })
      .fill(totp(contributorSecret));
    await contributorPage.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(
      contributorPage.getByRole('heading', { name: 'Workspace access is unavailable.' }),
    ).toBeVisible();
  } finally {
    await operatorContext.close();
    await contributorContext.close();
    await db.end();
    await runtime.end();
  }
});

test('UX-01 scoped mission read preserves source truth, keyboard navigation and fail-closed recovery', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await page.goto('/operator/signin?next=%2Foperator%23workspace-missions');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(seed.tenantId);
  await expect(page.locator('#workspace-missions')).toBeFocused();
  await page.getByLabel('Show missions').selectOption('all');
  const response = await page.request.get(
    `/api/workspace/missions?tenant=${seed.tenantId}&filter=all`,
  );
  expect(response.status()).toBe(200);
  const queue = await response.json();
  expect(queue.missions.length).toBeGreaterThan(0);
  const mission = queue.missions[0];
  const card = page
    .locator('.mission-card')
    .filter({ has: page.getByRole('heading', { name: mission.brief.company, exact: true }) })
    .first();
  await expect(card).toContainText(mission.brief.offer);
  await operatorEvidence(page, card, 'mission-control');
  await expect(card).toContainText(mission.claim_status);
  await expect(card).toContainText(`VERSION ${mission.version}`);
  await expect(card.locator('.ux-mission-passport')).toContainText(
    'No independent verification implied',
  );
  await page.evaluate(() => {
    const target = document.createElement('input');
    target.id = 'unregistered-workspace-input';
    document.body.append(target);
    window.location.hash = target.id;
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toBeVisible();
  await expect(page.locator('#unregistered-workspace-input')).not.toBeFocused();
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toHaveCount(0);
  const shortcut = page
    .getByRole('navigation', { name: 'Mission workflow' })
    .getByRole('link', { name: 'Missions and requirements', exact: false });
  await shortcut.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-missions')).toBeFocused();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toHaveCount(0);
  await mkdir('.cache/ux10x/after', { recursive: true });
  for (const width of [1440, 1280, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator('#workspace-missions')
      .evaluate((section) => section.scrollIntoView({ block: 'start', behavior: 'instant' }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.cache/ux10x/after/operator-missions-${width}.png` });
    await card.locator('.ux-mission-passport').screenshot({
      path: `.cache/ux10x/after/operator-mission-passport-${width}.png`,
    });
  }
  expect(
    (await new AxeBuilder({ page }).include('#workspace-missions').analyze()).violations,
  ).toEqual([]);
  const anonymous = await browser.newContext();
  expect(
    (
      await anonymous.request.get(
        `http://127.0.0.1:3200/api/workspace/missions?tenant=${seed.tenantId}`,
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
  expect((await page.request.get(`/api/workspace/missions?tenant=${randomUUID()}`)).status()).toBe(
    403,
  );
  // Inject only a transport outage. Recovery goes through the real protected endpoint.
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic connection interruption' }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Workspace could not be loaded',
  );
  await expect(page.locator('.mission-card')).toHaveCount(0);
  await page.unroute('**/api/workspace/workspace?*');
  await page.getByRole('button', { name: 'Retry workspace', exact: true }).click();
  await openSection(page, 'main');
  await expect(page.getByRole('heading', { name: 'Start with a mission.' })).toBeVisible();
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  try {
    await db.query(
      'UPDATE identity.session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
      [seed.userId],
    );
  } finally {
    await db.end();
  }
  await page.reload();
  await expect(page).toHaveURL(/operator\/signin/);
  expect((await page.request.get(`/api/workspace/missions?tenant=${seed.tenantId}`)).status()).toBe(
    401,
  );
  await expect(page.locator('.mission-card')).toHaveCount(0);
});

test('UX-01 tenant switch isolates delayed reads, preserves navigation drafts and respects viewer authority', async ({
  page,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  const other = randomUUID(),
    actor = randomUUID();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [actor],
    );
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [actor, randomUUID(), randomUUID()],
    );
    await db.query(
      "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'UX-01 isolated viewer workspace',true)",
      [other],
    );
    await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [
      other,
      seed.principalId,
    ]);
    await db.query('COMMIT');
  } finally {
    await db.end();
  }
  await page.goto(
    `/operator/signin?next=${encodeURIComponent('/operator?workspace=' + seed.tenantId + '#workspace-sources')}`,
  );
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await page
    .getByLabel('Source description', { exact: true })
    .fill('Unsaved synthetic source draft');
  const nav = page.getByRole('navigation', { name: 'Workspace areas' });
  await nav.getByRole('link', { name: 'Mission work', exact: true }).click();
  await expect(page.locator('#workspace-missions')).toBeVisible();
  await nav.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page.getByLabel('Source description', { exact: true })).toHaveValue(
    'Unsaved synthetic source draft',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(other);
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveValue(
    seed.tenantId,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(other);
  await expect(page).toHaveURL(new RegExp('workspace=' + other));
  await openSection(page, 'main');
  await expect(page.getByRole('region', { name: 'Workspace overview' })).toContainText('viewer');
  await expect(
    page.getByRole('navigation', { name: 'Administration', includeHidden: true, exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace sections' })
      .getByRole('link', { name: 'Global operations', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Source description', { exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/workspace/config?tenant=${other}`, {
        headers: { Origin: 'http://127.0.0.1:3200' },
        data: { key: 'ai.enabled', enabled: true },
      })
    ).status(),
  ).toBe(403);
  await openSection(page, 'workspace-missions');
  await expect(page.getByText('No mission requests yet.', { exact: true })).toBeVisible();
  await openSection(page, 'main');
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route(`**/api/workspace/workspace?tenant=${seed.tenantId}`, async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* Aborting an obsolete read is expected. */
    }
  });
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(seed.tenantId);
  await received;
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(other);
  await expect(page.getByRole('region', { name: 'Workspace overview' })).toContainText('viewer');
  release();
  await page.unroute(`**/api/workspace/workspace?tenant=${seed.tenantId}`);
  await expect(page.getByRole('region', { name: 'Workspace overview' })).toContainText('viewer');
  await expect(page.locator('.mission-card')).toHaveCount(0);
  await expect(page.getByLabel('Source description', { exact: true })).toHaveCount(0);
  await page.route('**/api/operator-auth/sign-out', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic interruption' }),
    }),
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toContainText(
    'Sign-out could not be confirmed',
  );
  await expect(page.getByRole('region', { name: 'Workspace overview' })).toContainText('viewer');
  await page.unroute('**/api/operator-auth/sign-out');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect((await page.request.get(`/api/workspace/missions?tenant=${other}`)).status()).toBe(401);
});
