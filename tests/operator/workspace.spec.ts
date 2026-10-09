import { test, expect } from '@playwright/test';
import { Pool } from '../../packages/db/src/index';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
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
  await page.getByRole('button', { name: 'Submit mission brief', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Temporary test failure');
  await expect(page.getByLabel('Work email', { exact: true })).toHaveValue(
    'intake@example.invalid',
  );
  await page.unroute('**/api/intake');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/intake') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Submit mission brief', exact: true }).click();
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
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await writeFile('.cache/part04-browser-receipt.json', JSON.stringify(result), { mode: 0o600 });
});
test('invited operator enrolls MFA, records provenance, manages flags and signs out', async ({
  page,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  await page.goto('/signin');
  await expect(page).toHaveURL(/operator\/signin/);
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
  const mission = JSON.parse(await readFile('.cache/part04-browser-receipt.json', 'utf8'));
  const card = page.locator('.mission-card').filter({
    has: page.getByRole('heading', { name: 'Browser Mission Test Company', exact: true }),
  });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('synthetic-intake-2026-10-05-v1', { exact: false })).toBeVisible();
  await card.getByLabel('Structured market').selectOption('ES');
  await card
    .getByLabel('Target profile')
    .fill('Hospitality distributors for synthetic hotel towels');
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
  await research.getByLabel('Invented company domain').fill('browser.example.invalid');
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
  await research.getByLabel('Invented contact email').fill('buyer@example.invalid');
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
  await page.getByRole('button', { name: 'Change evidence.verification', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText(
    'Verify your authenticator again to continue',
  );
  await page.getByLabel('Current authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify again', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Workspace status' })).toHaveText('Saved.');
  await page.getByRole('button', { name: 'Change evidence.verification', exact: true }).click();
  await expect(page.getByText('evidence.verification: enabled', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('evidence.verification: enabled', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Submit for validation', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('research.ingestion: enabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change research.ingestion', exact: true }).click();
  await expect(page.getByText('research.ingestion: disabled', { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect(
    (await page.request.get(`/api/workspace/workspace?tenant=${seed.tenantId}`)).status(),
  ).toBe(401);
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
  await buyer.reload();
  await expect(buyer.getByRole('button', { name: 'Interested', exact: true })).toBeEnabled();
  await buyer.getByRole('button', { name: 'Interested', exact: true }).click();
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
  await expect(card.getByText(/State: ACCEPTED/)).toBeVisible();
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
  await expect(card.getByText(/State: SCHEDULED/)).toBeVisible();
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
  await expect(card.getByText(/State: HELD/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Send the agreed requirement summary', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card.getByText(/State: HELD/)).toBeVisible();
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
