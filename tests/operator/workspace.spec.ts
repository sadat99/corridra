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
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  await page.getByLabel('Source description').fill('Synthetic browser inspection');
  await page.getByRole('button', { name: 'Record source', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
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
  await expect(page.getByRole('status')).toHaveText('Verify your authenticator again to continue');
  await page.getByLabel('Current authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify again', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.getByRole('button', { name: 'Change evidence.verification', exact: true }).click();
  await expect(page.getByText('evidence.verification: enabled', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('evidence.verification: enabled', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Submit for validation', exact: true }),
  ).toBeDisabled();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/operator\/signin/);
  expect(
    (await page.request.get(`/api/workspace/workspace?tenant=${seed.tenantId}`)).status(),
  ).toBe(401);
});
