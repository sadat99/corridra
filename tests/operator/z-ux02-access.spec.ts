import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

test('UX-02 customer access preserves SDK requests, interrupted retry, single submission and incomplete-link recovery', async ({
  page,
}) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3400'],
    {
      cwd: resolve('apps/web'),
      stdio: 'ignore',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        CORRIDRA_NEON_AUTH_ENABLED: 'true',
        NEON_AUTH_BASE_URL:
          'https://ep-ux02-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
        NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
        APP_ORIGIN: 'http://127.0.0.1:3400',
      },
    },
  );
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3400/signin')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    // Reject every auth transport request. No provider activation or successful auth is simulated.
    const submissions: { path: string; method: string }[] = [];
    let release!: () => void;
    let received!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    let delay = true;
    await page.route('**/api/auth/**', async (route) => {
      if (route.request().method() === 'POST')
        submissions.push({
          path: new URL(route.request().url()).pathname,
          method: route.request().method(),
        });
      received();
      if (delay) await hold;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Synthetic identity transport interruption' }),
      });
    });
    await page.goto('http://127.0.0.1:3400/signin');
    await page.getByLabel('Email', { exact: true }).fill('synthetic-access@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('Synthetic test password only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await started;
    await expect(page.getByLabel('Email', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled();
    await page
      .getByRole('form', { name: 'Account access' })
      .evaluate((form) =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    expect(submissions).toHaveLength(1);
    release();
    delay = false;
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Synthetic identity transport interruption',
    );
    await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
      'synthetic-access@example.invalid',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[0]).toMatchObject({ path: '/api/auth/sign-in/email', method: 'POST' });
    await page.goto('http://127.0.0.1:3400/reset-password');
    await page
      .getByLabel('New password', { exact: true })
      .fill('Synthetic replacement password only');
    await page.getByRole('button', { name: 'Set new password', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'reset link is incomplete',
    );
    expect(submissions).toHaveLength(2);
    await page.getByRole('link', { name: 'Back to sign-in' }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3400/signin');
    for (const path of ['signup', 'forgot-password', 'verify-email']) {
      await page.goto('http://127.0.0.1:3400/' + path);
      await expect(page.getByRole('form', { name: 'Account access' })).toBeVisible();
      await expect(page.getByRole('main')).toContainText('Customer identity is separate');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  } finally {
    server.kill('SIGTERM');
  }
});
