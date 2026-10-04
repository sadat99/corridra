import { test, expect } from '@playwright/test';
import { Pool } from '../../packages/db/src/index';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
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
test('invited operator enrolls MFA, records provenance, manages flags and signs out', async ({
  page,
}) => {
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  await page.goto('/operator');
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
