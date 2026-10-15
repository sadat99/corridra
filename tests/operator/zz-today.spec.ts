import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

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
const mission = (id: string, status: string, company: string, dueAt: string) => ({
  id,
  status,
  due_at: dueAt,
  brief: { company, objective: 'Source suppliers', market: 'China' },
});

test('Operator Today panel reads the real mission list, shows new and overdue work and never blocks the workspace', async ({
  page,
}) => {
  test.setTimeout(120000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8')),
    { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  // A code from an earlier test in the same 30 second step could be refused as a replay.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  // Real server reads: the panel loads and shows three counts.
  const today = page.getByRole('region', { name: 'Today' });
  await expect(
    today.getByRole('list', { name: 'Mission counts' }).getByRole('listitem'),
  ).toHaveCount(3);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Synthetic answers prove the new-request and overdue lists.
  await page.route('**/api/workspace/missions?*view=today*', async (route) => {
    const url = new URL(route.request().url());
    const draft = url.searchParams.get('stage') === 'DRAFT';
    const overdue = url.searchParams.get('filter') === 'overdue';
    const rows = draft
      ? [
          mission(
            '11111111-1111-4111-8111-111111111111',
            'DRAFT',
            'Invented Towels Ltd',
            '2026-10-20T00:00:00Z',
          ),
        ]
      : overdue
        ? [
            mission(
              '22222222-2222-4222-8222-222222222222',
              'OUTREACH',
              'Invented Machinery Co',
              '2026-10-01T00:00:00Z',
            ),
            mission(
              '33333333-3333-4333-8333-333333333333',
              'FOLLOW_UP',
              'Invented Foods Co',
              '2026-10-02T00:00:00Z',
            ),
          ]
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ missions: rows, total: draft ? 1 : overdue ? 2 : 7 }),
    });
  });
  await page.reload();
  await expect(today.getByText('new request to review', { exact: true })).toBeVisible();
  await expect(today.getByText('missions past their due date', { exact: true })).toBeVisible();
  await expect(today.getByText('open missions', { exact: true })).toBeVisible();
  await expect(
    today.getByRole('region', { name: 'New requests to review' }).getByText('Invented Towels Ltd'),
  ).toBeVisible();
  const late = today.getByRole('region', { name: 'Past their due date' });
  await expect(late.getByText('Invented Machinery Co')).toBeVisible();
  await expect(late.getByText('Invented Foods Co')).toBeVisible();
  await expect(today.getByRole('link', { name: 'Open the mission list' })).toHaveAttribute(
    'href',
    '#workspace-missions',
  );
  await mkdir('.cache/today', { recursive: true });
  await today.screenshot({ path: '.cache/today/today-panel.png' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // A failed read says so and leaves the mission list working.
  await page.unroute('**/api/workspace/missions?*view=today*');
  await page.route('**/api/workspace/missions?*view=today*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic interruption' }),
    }),
  );
  await page.reload();
  await expect(today.getByRole('status')).toContainText("Today's list could not be loaded.");
  await expect(page.locator('#workspace-missions')).toBeVisible();
});
