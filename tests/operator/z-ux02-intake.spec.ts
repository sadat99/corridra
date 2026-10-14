import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('UX-02 discovery completes a synthetic brief with original money, retry, duplicate and receipt denial semantics', async ({
  page,
}) => {
  test.setTimeout(120000);
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const server = spawn(process.execPath, [tsx, 'scripts/ux02-intake-browser-server.ts'], {
    cwd: resolve('.'),
    stdio: 'ignore',
    env: { PATH: process.env.PATH },
  });
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3450/')).status()).toBe(200);
    }).toPass({ timeout: 30000 });
    const email = `ux02-${randomUUID()}@example.invalid`;
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto('http://127.0.0.1:3450/');
    await page
      .getByRole('combobox', { name: "I'm trying to" })
      .selectOption('machinery_procurement');
    await page
      .getByRole('combobox', { name: 'Commercial direction', exact: true })
      .selectOption('bangladesh-china');
    await page.getByRole('link', { name: 'Prepare this test brief' }).click();
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      'machinery_procurement',
    );
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
    ).toHaveValue('BD');
    await expect(
      page.getByRole('combobox', { name: 'Which market is involved?', exact: true }),
    ).toHaveValue('CN');
    await page.getByLabel('Yes', { exact: true }).check();
    await page.getByLabel('From', { exact: true }).fill('2026-11-10');
    await page.getByLabel('To', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('End date must follow the start date')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Check this step.' })).toBeFocused();
    await page.getByLabel('To', { exact: true }).fill('2026-11-15');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByLabel('Your offer or requirement')
      .fill('原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।');
    await page
      .getByLabel('Technical purpose (optional)', { exact: true })
      .fill('Synthetic equipment assessment');
    await page.getByText('Budget context (optional)', { exact: true }).click();
    await page.getByLabel('Budget in original currency (optional)', { exact: true }).fill('1.234');
    await page
      .getByRole('combobox', { name: 'Original currency', exact: true })
      .selectOption('BHD');
    await page
      .getByLabel('Budget basis, such as total equipment budget', { exact: true })
      .fill('Original synthetic equipment quote');
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Your test brief' })).toContainText(
      '1.234 BHD',
    );
    await expect(page.getByLabel('Your offer or requirement')).toHaveValue(
      '原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।',
    );
    await mkdir('.cache/ux02/after', { recursive: true });
    await page.screenshot({ path: '.cache/ux02/after/intake-original-390.png', fullPage: true });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Relevant meetings', { exact: true }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('UX Two Synthetic Person');
    await page.getByLabel('Company', { exact: true }).fill('UX Two Invented Equipment Company');
    await page.getByLabel('Work email', { exact: true }).fill('do-not-send@example.com');
    await page.getByLabel('I have read the test intake notice', { exact: false }).check();
    let writes = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/intake') && request.method() === 'POST') writes++;
    });
    await page.getByRole('button', { name: 'Submit mission brief', exact: true }).click();
    await expect(page.getByLabel('Work email', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(writes).toBe(0);
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.route('**/api/intake', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic transport interruption. Retry the same brief.' }),
      }),
    );
    await page.getByRole('button', { name: 'Submit mission brief', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic transport interruption');
    await expect(page.getByLabel('Work email', { exact: true })).toHaveValue(email);
    await page.unroute('**/api/intake');
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/intake') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit mission brief', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const payload = response.request().postDataJSON();
    expect(payload.brief.experience.requirements).toMatchObject({
      budgetMinor: '1234',
      currency: 'BHD',
    });
    expect(payload.brief.offer).toBe('原始机器要求。 কাল্পনিক যন্ত্রপাতির পরীক্ষামূলক বিবরণ।');
    const result = await response.json();
    const duplicate = await page.request.post('http://127.0.0.1:3450/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3450' },
      data: payload,
    });
    expect(duplicate.status()).toBe(201);
    expect(await duplicate.json()).toMatchObject({
      id: result.id,
      receipt: result.receipt,
      duplicate: true,
    });
    expect(typeof result.id).toBe('string');
    expect(typeof result.receipt).toBe('string');
    const sameBriefNewKey = await page.request.post('http://127.0.0.1:3450/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3450' },
      data: { ...payload, key: randomUUID() },
    });
    expect(sameBriefNewKey.status()).toBe(201);
    expect(await sameBriefNewKey.json()).toEqual({ duplicate: true });
    await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
    await page.reload();
    await expect(page.getByLabel('Private receipt code')).toHaveValue(result.receipt);
    await page.getByRole('button', { name: 'Check status and replies' }).click();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
    await page.getByLabel('Receipt code', { exact: true }).fill('0'.repeat(64));
    const rejected = page.waitForResponse((response) =>
      response.url().endsWith('/api/intake/receipt'),
    );
    await page.getByRole('button', { name: 'Check status and replies' }).click();
    expect((await rejected).ok()).toBe(false);
    await expect(page.getByText('DRAFT', { exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    server.kill('SIGTERM');
  }
});
