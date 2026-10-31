import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

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

test('V3 founder clarity retains source-backed operations and denies the ordinary operator context', async ({
  page,
}) => {
  test.setTimeout(180000);
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
  await page.goto(`/operator?workspace=${seed.tenantId}#ops-center`);
  const overview = page.getByRole('region', { name: 'Business overview' });
  await expect(overview).toBeVisible();
  // The answers fold behind their summary line; open them before reading the links.
  await overview
    .getByText('What Corridra can do, what is on and what is blocked (5 answers)', { exact: true })
    .click();
  await expect(overview).toContainText('Live, small scale.');
  await expect(overview).toContainText('MISSING');
  await expect(overview).toContainText('GATED');
  await expect(
    overview.getByRole('link', { name: 'Source-backed activity and outcomes' }),
  ).toHaveAttribute('href', '#ops-dashboard');
  const out = 'docs/v3/phase-4/founder/browser';
  await mkdir(out, { recursive: true });
  const measurements = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const axe = await new AxeBuilder({ page })
      .include('[aria-labelledby="founder-overview-title"]')
      .analyze();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(axe.violations).toEqual([]);
    expect(overflow).toBeLessThanOrEqual(1);
    await overview.screenshot({ path: `${out}/overview-${width}.png` });
    measurements.push({ width, axeViolations: axe.violations.length, overflowPx: overflow });
  }
  await writeFile(`${out}/observations.json`, JSON.stringify(measurements, null, 2) + '\n');
  await overview.getByRole('link', { name: 'Sample mission explorer (madeup)' }).click();
  await expect(page.getByRole('region', { name: 'Sample mission' })).toBeVisible();
  const memberships = await (await page.request.get('/api/workspace/tenants')).json();
  const operator = memberships.find((m: { role: string }) => m.role === 'operator');
  expect(operator).toBeTruthy();
  await page.goto(`/operator?workspace=${operator.id}#ops-center`);
  await expect(page.getByRole('region', { name: 'Business overview' })).toHaveCount(0);
  await expect(page.locator('#ops-center')).toHaveCount(0);
  expect(
    (await page.request.get(`/api/workspace/operations-controls?tenant=${operator.id}`)).status(),
  ).toBe(403);
});
