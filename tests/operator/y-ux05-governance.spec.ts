import { openSection } from './workspace-nav';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';
import { initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { governanceEvidence } from './governance-evidence';
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  return ((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}
test('UX-05 governance keeps evidenced readiness, exact recovery receipts and role-specific economics', async ({
  page,
}) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(10000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  // The preceding real owner/reviewer/contributor journeys share this local IP.
  // Respect the existing five-per-minute sign-in/MFA budget without changing its limits.
  const rateWindowEnd = Date.now() + 60000;
  await expect
    .poll(() => Date.now(), { timeout: 65000, intervals: [1000] })
    .toBeGreaterThanOrEqual(rateWindowEnd);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  const signIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/operator-auth/sign-in/email' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await signIn).status()).toBe(200);
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(seed.tenantId);
  await openSection(page, 'workspace-navigation');
  await page
    .locator('#workspace-navigation')
    .getByRole('link', { name: 'Global operations', exact: true })
    .click();
  const ops = page.locator('#workspace-operations');
  await expect(ops.getByRole('button', { name: 'Refresh operations', exact: true })).toBeVisible();
  async function post(action: string, data: unknown) {
    const response = await page.request.post(`/api/workspace/${action}?tenant=${seed.tenantId}`, {
      headers: { Origin: 'http://127.0.0.1:3200' },
      data,
    });
    expect(response.ok(), action).toBe(true);
    return response.json();
  }
  const reason = 'Synthetic UX-05 independent operations evidence';
  const source = (
    await post('source', {
      kind: 'public_record',
      locator: 'Synthetic UX-05 operations source',
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose: 'synthetic_validation',
      retentionUntil: new Date(Date.now() + 86400000).toISOString(),
      aiPolicy: 'DENY',
    })
  ).id;
  const catalogue = await (
    await page.request.get(`/api/workspace/mission-catalogue?tenant=${seed.tenantId}`)
  ).json();
  const existing = catalogue.routes.find(
    (r: { origin_market: string; destination_market: string }) =>
      r.origin_market === 'CO' && r.destination_market === 'ZA',
  );
  const routeId = existing?.id ?? randomUUID(),
    packId = randomUUID();
  if (!existing)
    await post('corridor-route', { id: routeId, origin: 'CO', destination: 'ZA', reason });
  const versions = catalogue.packs
    .filter((p: { route_id: string }) => p.route_id === routeId)
    .map((p: { version: number }) => p.version);
  await post('corridor-pack', {
    id: packId,
    routeId,
    version: Math.max(0, ...versions) + 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    configuration: initialRouteConfiguration(initialRoutes[2]),
    reason,
  });
  await ops.getByRole('button', { name: 'Refresh operations', exact: true }).click();
  await openSection(page, 'ops-center');
  await ops
    .getByRole('combobox', { name: 'Control Center route', exact: true })
    .selectOption(routeId);
  await ops.getByRole('combobox', { name: 'Route service', exact: true }).selectOption('sourcing');
  const readiness = ops.getByRole('region', { name: 'Route readiness evidence', exact: true });
  await expect(readiness.getByRole('row')).toHaveCount(14);
  await expect(readiness.getByRole('cell', { name: 'Blocked', exact: true })).toHaveCount(13);
  const missingEvidence = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/workspace/operations' && r.request().method() === 'POST',
  );
  await ops
    .getByRole('button', { name: 'Approve route readiness for limited use', exact: true })
    .click();
  expect((await missingEvidence).status()).toBe(409);
  await expect(ops.getByRole('status')).toContainText('Reference:');
  await expect(readiness.getByRole('cell', { name: 'Blocked', exact: true })).toHaveCount(13);
  await expect(ops).toContainText('Release state: Not published');
  await ops
    .getByRole('combobox', { name: 'Readiness dimension', exact: true })
    .selectOption('offer');
  await ops.getByRole('combobox', { name: 'Readiness status', exact: true }).selectOption('PASS');
  // The evidence source is chosen by name from the picker (D9), never typed as an ID.
  await ops
    .getByRole('combobox', { name: 'Readiness evidence source (optional)', exact: true })
    .fill('Synthetic UX-05 operations source');
  await ops
    .getByRole('option', { name: /Synthetic UX-05 operations source/ })
    .first()
    .click();
  expect(source).toBeTruthy();
  // Chromium shortens a datetime-local value that ends in :00 seconds and Playwright then rejects the
  // fill as malformed, so a run that lands on a whole minute failed about one time in sixty.
  const validUntil = new Date(Date.now() + 10000);
  if (validUntil.getUTCSeconds() === 0) validUntil.setUTCSeconds(1);
  const until = validUntil.toISOString();
  await ops.getByLabel('Readiness valid until', { exact: true }).fill(until.slice(0, 19));
  await ops.getByLabel('Readiness rationale', { exact: true }).fill(reason);
  await ops.getByRole('button', { name: 'Record readiness', exact: true }).click();
  await expect(ops.getByRole('status')).toContainText('Recorded.');
  const offer = readiness.getByRole('row').filter({ hasText: 'Commercial offer and pricing' });
  await expect(offer.getByRole('cell', { name: 'Ready', exact: true })).toHaveCount(2);
  await expect
    .poll(() => Date.now(), { timeout: 15000, intervals: [1000] })
    .toBeGreaterThan(Date.parse(until));
  await ops.getByRole('button', { name: 'Refresh operations', exact: true }).click();
  await expect(offer.getByRole('cell', { name: 'Blocked', exact: true })).toHaveCount(1);
  await expect(offer.getByRole('cell', { name: 'Ready', exact: true })).toHaveCount(1);
  await expect(offer).toContainText('Evidence expired or configuration changed');
  await ops
    .getByRole('button', { name: 'Prepare next configuration version', exact: true })
    .click();
  const draft = await ops
    .getByRole('textbox', { name: 'Configuration draft', exact: true })
    .inputValue();
  await ops
    .getByRole('navigation', { name: 'Operations workflow sections', exact: true })
    .getByRole('button', { name: 'Readiness review', exact: true })
    .click();
  await expect(ops.getByRole('textbox', { name: 'Configuration draft', exact: true })).toHaveValue(
    draft,
  );
  const otherRoute = await ops
    .getByRole('combobox', { name: 'Control Center route', exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value');
  if (otherRoute !== routeId) {
    page.once('dialog', (d) => d.dismiss());
    await ops
      .getByRole('combobox', { name: 'Control Center route', exact: true })
      .selectOption(otherRoute!);
    await expect(
      ops.getByRole('combobox', { name: 'Control Center route', exact: true }),
    ).toHaveValue(routeId);
  }
  await ops.getByRole('button', { name: 'Preview configuration effects', exact: true }).click();
  await expect(ops).toContainText('Public operational activation: No.');
  await ops.getByRole('button', { name: 'Submit configuration proposal', exact: true }).click();
  const proposal = ops
    .getByRole('article')
    .filter({
      has: page.getByRole('button', { name: 'Approve and publish exact proposal', exact: true }),
    })
    .first();
  await proposal
    .getByRole('button', { name: 'Approve and publish exact proposal', exact: true })
    .click();
  await expect(ops.getByRole('status')).toContainText(/independent/i);
  const caseKey = 'ux05-recovery-' + randomUUID();
  const command = {
    action: 'case',
    key: caseKey,
    version: 1,
    kind: 'PROVIDER',
    subjectId: null,
    state: 'BLOCKED',
    ownerId: seed.principalId,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    sourceId: null,
    reason,
  };
  await ops
    .getByRole('textbox', { name: 'Operational command JSON', exact: true })
    .fill(JSON.stringify(command));
  await ops
    .getByLabel('I reviewed the evidence, scope, original amounts and authorization.', {
      exact: true,
    })
    .check();
  const sent: unknown[] = [];
  await page.route('**/api/workspace/operations?*', async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) {
      await route.fetch();
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await ops
    .getByRole('button', { name: 'Record reviewed operational command', exact: true })
    .click();
  await expect(ops.getByRole('status')).toContainText(/retry/i);
  await ops
    .getByRole('textbox', { name: 'Operational command JSON', exact: true })
    .fill(JSON.stringify({ ...command, reason: 'Changed while awaiting the original receipt' }));
  const assurance = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: local.ownerPassword,
  });
  try {
    await assurance.query(
      'UPDATE identity.assurance SET verified_at=now()-interval \'20 minutes\' WHERE session_id IN (SELECT s.id FROM identity.session s JOIN identity.principal p ON p.identity_id=s."userId" WHERE p.id=$1)',
      [seed.principalId],
    );
  } finally {
    await assurance.end();
  }
  const staleMfa = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/workspace/operations' && r.request().method() === 'POST',
  );
  await ops
    .getByRole('button', { name: 'Retry original operational command', exact: true })
    .click();
  expect((await staleMfa).status()).toBe(401);
  await expect(ops.getByRole('status')).toContainText('Verify your authenticator again');
  await expect(
    ops.getByRole('button', { name: 'Retry original operational command', exact: true }),
  ).toBeEnabled();
  const nextCounter = (Math.floor(Date.now() / 30000) + 1) * 30000;
  await expect
    .poll(() => Date.now(), { timeout: 35000, intervals: [1000] })
    .toBeGreaterThanOrEqual(nextCounter);
  await openSection(page, 'workspace-authenticator');
  await page.getByLabel('Current authenticator code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify again', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Saved.');
  await openSection(page, 'workspace-operations');
  await ops
    .getByRole('button', { name: 'Retry original operational command', exact: true })
    .click();
  await expect(ops.getByRole('status')).toContainText('Recorded.');
  expect(sent).toHaveLength(3);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[2]).toEqual(sent[0]);
  await page.unroute('**/api/workspace/operations?*');
  await openSection(page, 'ops-health');
  await expect(
    ops.getByRole('region', { name: 'Owned recovery, privacy and fraud cases', exact: true }),
  ).toContainText(caseKey);
  await openSection(page, 'ops-center');
  await ops
    .getByRole('textbox', { name: 'Operational command JSON', exact: true })
    .fill(JSON.stringify({ ...command, version: 2, state: 'RESOLVED' }));
  const missingClosureSource = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/workspace/operations' && r.request().method() === 'POST',
  );
  await ops
    .getByRole('button', { name: 'Record reviewed operational command', exact: true })
    .click();
  expect((await missingClosureSource).status()).toBe(409);
  await expect(ops.getByRole('status')).toContainText('Reference:');
  const unchangedCases = await (
    await page.request.get(`/api/workspace/operations-controls?tenant=${seed.tenantId}`)
  ).json();
  expect(unchangedCases.cases.find((r: { key: string }) => r.key === caseKey)).toMatchObject({
    version: 1,
    state: 'BLOCKED',
  });
  await ops
    .getByRole('textbox', { name: 'Operational command JSON', exact: true })
    .fill(JSON.stringify({ ...command, version: 2, state: 'RESOLVED', sourceId: source }));
  await ops
    .getByRole('button', { name: 'Record reviewed operational command', exact: true })
    .click();
  await expect(ops.getByRole('status')).toContainText('Recorded.');
  const dashboard = await (
    await page.request.get(`/api/workspace/operations-dashboard?tenant=${seed.tenantId}`)
  ).json();
  const missionId = dashboard.missions[0].id;
  const record = async (input: unknown) => {
    await openSection(page, 'ops-center');
    await ops
      .getByRole('textbox', { name: 'Operational command JSON', exact: true })
      .fill(JSON.stringify(input));
    await ops
      .getByRole('button', { name: 'Record reviewed operational command', exact: true })
      .click();
    await expect(ops.getByRole('status')).toContainText('Recorded.');
    await openSection(page, 'ops-dashboard');
  };
  await record({
    action: 'ledger',
    missionId,
    kind: 'DELIVERY_COST',
    amountMinor: '10001',
    currency: 'EUR',
    sourceId: source,
    externalReference: 'ux05-original-cost-' + randomUUID(),
    occurredAt: new Date().toISOString(),
    reverseOf: null,
    reason,
  });
  const economics = ops.getByRole('region', {
    name: 'Per-mission contribution and effort',
    exact: true,
  });
  const costRow = economics
    .getByRole('row')
    .filter({ hasText: missionId })
    .filter({ hasText: 'EUR' });
  await expect(costRow.getByRole('cell', { name: '10001', exact: true })).toHaveCount(1);
  await expect(costRow).toContainText('Unknown; incomplete fee/cost coverage');
  const currentContexts = await (
    await page.request.get(`/api/workspace/operations-controls?tenant=${seed.tenantId}`)
  ).json();
  const version =
    Number(
      currentContexts.contexts.find((r: { mission_id: string }) => r.mission_id === missionId)
        ?.version ?? 0,
    ) + 1;
  await record({
    action: 'context',
    missionId,
    version,
    customerReference: 'synthetic-ux05-client',
    industry: 'machinery',
    acquisitionSource: 'synthetic review',
    payingStatus: 'UNKNOWN',
    revenueComplete: false,
    costComplete: false,
    effortComplete: false,
    sourceId: source,
    reason,
  });
  await record({
    action: 'effort',
    missionId,
    operatorId: seed.principalId,
    minutes: 91,
    sourceId: source,
    occurredAt: new Date().toISOString(),
    reverseOf: null,
    reason,
  });
  await expect(costRow).toContainText('recorded minutes; completeness unknown');
  await expect(costRow).toContainText('Unknown; incomplete fee/cost coverage');
  await expect(
    ops.getByRole('heading', { name: 'Customer trade outcomes', exact: true }),
  ).toBeVisible();
  await expect(ops).toContainText('They are never counted as Corridra revenue.');
  for (const [id, label] of [
    ['ops-dashboard', 'dashboard'],
    ['ops-center', 'control-center'],
    ['ops-health', 'recovery'],
    ['ops-gates', 'readiness-gates'],
    ['workspace-ai', 'ai-review'],
    ['workspace-network', 'network'],
    ['workspace-settings', 'reviewed-policies'],
    ['workspace-audit', 'audit'],
  ] as const) {
    await openSection(page, id);
    if (id === 'workspace-audit')
      await page
        .getByRole('button', { name: 'Load access and recent changes', exact: true })
        .click();
    await governanceEvidence(page, page.locator('#' + id), label);
  }
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
      "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'UX-05 ordinary operator scope',true)",
      [other],
    );
    await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'operator')", [
      other,
      seed.principalId,
    ]);
    await db.query('COMMIT');
  } finally {
    await db.end();
  }
  // Reload the actual authorized membership list, then enter the restricted workspace.
  await page.reload();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(other);
  await openSection(page, 'workspace-navigation');
  await page
    .locator('#workspace-navigation')
    .getByRole('link', { name: 'Global operations', exact: true })
    .click();
  await expect(ops.getByRole('button', { name: 'Refresh operations', exact: true })).toBeVisible();
  await expect(ops.locator('#ops-center')).toHaveCount(0);
  await expect(page.locator('#workspace-audit')).toHaveCount(0);
  await expect(page.locator('#workspace-settings')).toHaveCount(0);
  await expect(ops).toContainText(
    'Financial records require owner/admin access. Their absence here does not mean zero.',
  );
  expect(
    (await page.request.get(`/api/workspace/operations-controls?tenant=${other}`)).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(`/api/workspace/operations?tenant=${other}`, {
        headers: { Origin: 'http://127.0.0.1:3200' },
        data: { ...command, id: randomUUID() },
      })
    ).status(),
  ).toBe(403);
  await expect(ops).not.toContainText(caseKey);
  await governanceEvidence(page, ops, 'ordinary-operator');
});
