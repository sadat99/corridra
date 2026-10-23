import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';

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

test('a signed-out visitor is sent to sign in and sees nothing', async ({ request }) => {
  const response = await request.get('/operator/owner', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toContain('/operator/signin');
  expect(await response.text()).not.toContain('What is on and off');
});

test('the Owner page lists what is on and off, read only, for an owner', async ({ page }) => {
  test.setTimeout(240000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  // Respect the unchanged authentication budget and TOTP replay rules of preceding journeys.
  const nextWindow = Date.now() + 60000;
  await expect
    .poll(() => Date.now(), { timeout: 65000, intervals: [1000] })
    .toBeGreaterThanOrEqual(nextWindow);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();

  // The only way in from the workspace is one text link in the management disclosure.
  await page.goto(`/operator?workspace=${seed.tenantId}`);
  await page.getByText('Manage this workspace', { exact: true }).click();
  await page.getByRole('link', { name: 'What is on and off', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/owner$/);
  await expect(page.getByRole('heading', { level: 1, name: 'What is on and off.' })).toBeVisible();
  for (const name of ['What is on and off', 'Waiting on the Corridra team', 'Open gaps'])
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();

  // Read only: nothing on the page can change anything.
  expect(await page.locator('main button, main form, main input, main select').count()).toBe(0);

  // States come from this deployment. The browser server turns these on and leaves the rest off.
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('CORRIDRA_NETWORK_ENABLED')).toContainText('On');
  await expect(row('CORRIDRA_DELIVERY_ENABLED')).toContainText('On');
  await expect(row('CORRIDRA_OWNER_PAGE_ENABLED')).toContainText('On');
  await expect(row('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED')).toContainText('Off');
  await expect(row('CORRIDRA_CUSTOMER_CODE_SIGNIN')).toContainText('Off');
  await expect(row('CORRIDRA_MISSION_EMAIL_ENABLED')).toContainText('Planned, not built yet');
  await expect(row('CORRIDRA_AI_FIXTURE_URL')).toContainText('Set');

  // Real counts from the Today list, each a whole number or an honest unknown.
  const figures = await page.locator('.owner-figure').allTextContents();
  expect(figures).toHaveLength(3);
  for (const figure of figures) expect(figure).toMatch(/^(\d+|Not measurable here yet)$/);

  // Open gaps are copied from the register and none is marked closed.
  for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D08'])
    await expect(page.getByRole('listitem').filter({ hasText: id }).first()).toContainText('Open');
  await expect(page.locator('main')).not.toContainText('Closed');
  await expect(page.getByRole('listitem').filter({ hasText: 'D01' })).toContainText(
    'Deferred; explicitly authorized BYPASSED mode',
  );

  // Secrets and values never reach the page.
  const html = await page.content();
  for (const leaked of [
    seed.password,
    'API_KEY',
    '127.0.0.1:3201',
    'isolated-browser-fixture-not-a-provider-key',
    'OPERATOR_RECOVERY_EMAIL_KEY',
  ])
    expect(html, leaked).not.toContain(leaked);

  // Private page headers and no indexing.
  const response = await page.request.get('/operator/owner');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

  const out = 'docs/design-system/evidence/owner-page/after';
  await mkdir(out, { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const axe = await new AxeBuilder({ page }).analyze();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(axe.violations, `axe at ${width}`).toEqual([]);
    expect(overflow, `overflow at ${width}`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${out}/owner-${width}.png`, fullPage: true });
  }
});
