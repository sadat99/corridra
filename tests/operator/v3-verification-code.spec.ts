import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('V3 signup exposes the delivered-code input immediately and preserves verification failure, retry and resend', async ({
  page,
}) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const origin = 'http://127.0.0.1:3412';
  const server = spawn(process.execPath, [cli, 'start', '--port', '3412'], {
    cwd: resolve('apps/web'),
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      CORRIDRA_NEON_AUTH_ENABLED: 'true',
      NEON_AUTH_BASE_URL:
        'https://ep-v3-otp-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
      NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
      APP_ORIGIN: origin,
    },
  });
  try {
    await expect(async () => {
      expect((await page.request.get(origin + '/signup')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    // UI transport fixture only. It cannot prove delivery or consume an actual provider OTP.
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    let rejectVerification = true;
    await page.route('**/api/auth/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST')
        calls.push({ path, body: route.request().postDataJSON() });
      const denied = path.endsWith('/verify-email') && rejectVerification;
      await route.fulfill({
        status: denied ? 400 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          denied
            ? { message: 'Synthetic invalid or expired code' }
            : {
                status: true,
                success: true,
                token: null,
                user: { id: 'synthetic-user', emailVerified: false },
              },
        ),
      });
    });
    await page.goto(origin + '/signup');
    await page.getByLabel('Name', { exact: true }).fill('Synthetic OTP walkthrough');
    await page.getByLabel('Email', { exact: true }).fill('synthetic-otp@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('Synthetic long password only');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL(origin + '/verify-email');
    const code = page.getByLabel('Verification code', { exact: true });
    await expect(code).toBeVisible();
    expect(calls.map((call) => call.path)).toEqual(['/api/auth/sign-up/email']);
    await page.getByLabel('Email', { exact: true }).fill('synthetic-otp@example.invalid');
    await expect(code).toBeVisible();
    await code.fill('12345');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    expect(calls).toHaveLength(1);
    await code.fill('123456');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Synthetic invalid or expired code',
    );
    await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
    await expect(page).toHaveURL(origin + '/verify-email');
    await expect(code).toHaveValue('123456');
    expect(calls[1]).toEqual({
      path: '/api/auth/email-otp/verify-email',
      body: { email: 'synthetic-otp@example.invalid', otp: '123456' },
    });
    rejectVerification = false;
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page).toHaveURL(origin + '/signin');
    expect(calls).toHaveLength(3);
    expect(calls.some((call) => call.path.includes('send-verification-otp'))).toBe(false);

    // A reload/direct visit also exposes the field without saving email or codes in storage/URLs.
    await page.goto(origin + '/verify-email');
    await page.reload();
    await expect(code).toBeVisible();
    await expect(code).toBeEmpty();
    await expect(page.getByLabel('Email', { exact: true })).toBeEmpty();
    const request = page.getByRole('button', { name: 'Request verification code', exact: true });
    await request.click();
    expect(calls).toHaveLength(3);
    await page.getByLabel('Email', { exact: true }).fill('synthetic-otp@example.invalid');
    await code.fill('12');
    await request.click();
    await expect(page.getByRole('status')).toContainText('If verification is needed');
    await expect(code).toBeVisible();
    await expect(code).toBeEmpty();
    expect(calls[3]).toEqual({
      path: '/api/auth/email-otp/send-verification-otp',
      body: { email: 'synthetic-otp@example.invalid', type: 'email-verification' },
    });
    expect(calls).toHaveLength(4);
    await mkdir('.cache/v3-otp/after', { recursive: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: `.cache/v3-otp/after/verify-${width}.png`, fullPage: true });
    }
  } finally {
    server.kill('SIGTERM');
  }
});
