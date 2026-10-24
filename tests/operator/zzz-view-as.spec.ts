import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { Pool } from '../../packages/db/src/index';

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

test('a signed-out visitor, a bad role and a role not built yet all get the same plain not found', async ({
  request,
}) => {
  for (const path of [
    '/operator/view-as/customer',
    '/operator/view-as/nobody',
    '/operator/view-as/delegate',
    '/operator/view-as/supplier',
    '/operator/view-as/Customer',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    const text = await response.text();
    // The same plain page for every case, and nothing that tells them apart or shows a preview.
    expect(text, path).toContain('This page isn’t here.');
    expect(text, path).not.toContain('PREVIEW AS CUSTOMER');
    expect(text, path).not.toContain('SAMPLE PREVIEW');
  }
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    const response = await request[method]('/operator/view-as/customer', { maxRedirects: 0 });
    expect(response.status(), method).toBe(405);
    expect(response.headers()['allow']).toBe('GET, HEAD');
  }
});

async function signIn(page: Page, seed: { password: string }, secret: string) {
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
}

test('an owner can open the customer preview: marked, read only, inert, logged every time, no network', async ({
  page,
}) => {
  test.setTimeout(240000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const database = new Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
    database: 'corridra_browser',
  });
  const opens = async () =>
    (
      await database.query(
        "SELECT e.payload,a.action FROM app.domain_event e JOIN app.audit_event a ON a.domain_event_id=e.id WHERE e.tenant_id=$1 AND e.type='view_as.open' ORDER BY e.occurred_at",
        [seed.tenantId],
      )
    ).rows;
  try {
    await signIn(page, seed, secret);
    const before = (await opens()).length;
    const requests: string[] = [];
    // Only requests made by the preview itself count. The plain not found page that comes later
    // in this journey prefetches its own links, which says nothing about the preview.
    page.on('request', (r) => {
      if (
        ['fetch', 'xhr', 'websocket', 'eventsource'].includes(r.resourceType()) &&
        r.frame()?.url().includes('/operator/view-as/customer')
      )
        requests.push(`${r.method()} ${r.url()}`);
    });

    const response = await page.goto(`/operator/view-as/customer?workspace=${seed.tenantId}`);
    const headers = response!.headers();
    expect(response!.status()).toBe(200);
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-robots-tag']).toContain('noindex');
    await expect(page).toHaveTitle(/^Preview: customer screen/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const bar = page.getByRole('region', { name: 'Preview notice' });
    await expect(bar).toContainText(
      'PREVIEW AS CUSTOMER. Sample data. This is not a real account. Nothing here can be saved or sent.',
    );
    await expect(bar.getByRole('link', { name: 'Close preview' })).toHaveAttribute(
      'href',
      '/operator',
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'What a customer sees.' }),
    ).toBeVisible();
    // No sign-out, no real name, no real navigation: nothing of a real session is shown.
    await expect(page.getByText('Synthetic Browser Operator')).toHaveCount(0);
    await expect(page.getByText('browser@example.invalid')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
    // The header's account links (sign in, your account, start a request) are not on offer here.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Start a request' })).toBeHidden();

    // Read only: the sample content is inert and holds nothing that can act.
    await expect(page.locator('.view-as-content')).toHaveAttribute('inert', '');
    expect(
      await page.locator('main button, main form, main input, main select, main textarea').count(),
    ).toBe(0);
    expect(await page.locator('main a').count()).toBe(0);

    // Logged: one record for this open, ids and roles only.
    const after = await opens();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toEqual({
      payload: { shown_role: 'customer', viewer_role: 'owner', preview_version: 1 },
      action: 'view_as.open',
    });

    // Every open is logged, including a reload.
    await page.reload();
    expect((await opens()).length).toBe(before + 2);

    // A role that is not built yet is not shown and is not logged.
    expect(
      (await page.goto(`/operator/view-as/delegate?workspace=${seed.tenantId}`))!.status(),
    ).toBe(404);
    expect((await opens()).length).toBe(before + 2);

    // Nothing left the page: no fetch, no request of any kind but the pages themselves.
    expect(requests).toEqual([]);

    await page.goto(`/operator/view-as/customer?workspace=${seed.tenantId}`);
    await mkdir('docs/design-system/evidence/view-as/after', { recursive: true });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect((await new AxeBuilder({ page }).analyze()).violations, `axe ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      // The mark reaches the foot of the stage, not only the top of it.
      const marked = await page.evaluate(() => {
        const stage = document.querySelector('.view-as-stage');
        if (!stage) return false;
        const box = stage.getBoundingClientRect();
        const layer = getComputedStyle(stage, '::before');
        return (
          layer.content.includes('SAMPLE PREVIEW') &&
          parseFloat(layer.height) >= box.height &&
          parseFloat(layer.width) >= box.width
        );
      });
      expect(marked, `mark covers the stage at ${width}`).toBe(true);
      await page.screenshot({
        path: `docs/design-system/evidence/view-as/after/customer-${width}.png`,
        fullPage: true,
      });
    }
    expect((await opens()).length).toBe(before + 3);
  } finally {
    await database.end();
  }
});
