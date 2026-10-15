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
      await expect(page.getByRole('main')).toContainText(
        path === 'forgot-password'
          ? 'It does not change an operator password or authenticator.'
          : 'missions explicitly shared with you.',
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  } finally {
    server.kill('SIGTERM');
  }
});

test('UX-02 customer account forms validate, submit once and show non-disclosing outcomes for sign-up, reset request and email verification', async ({
  page,
}) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3401'],
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
        APP_ORIGIN: 'http://127.0.0.1:3401',
      },
    },
  );
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3401/signup')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    // Synthetic transport only: every auth call is answered locally and recorded. No provider is reached.
    const calls: { path: string; body: string }[] = [];
    await page.route('**/api/auth/**', async (route) => {
      if (route.request().method() === 'POST')
        calls.push({
          path: new URL(route.request().url()).pathname,
          body: route.request().postData() ?? '',
        });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: true,
          success: true,
          token: null,
          user: { id: 'synthetic-user', email: 'synthetic@example.invalid', emailVerified: false },
        }),
      });
    });
    // Sign-up: browser validation blocks a short password before any request is sent.
    await page.goto('http://127.0.0.1:3401/signup');
    await page.getByLabel('Name', { exact: true }).fill('Synthetic Person');
    await page.getByLabel('Email', { exact: true }).fill('synthetic-signup@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('too short');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(calls).toHaveLength(0);
    await page.getByLabel('Password', { exact: true }).fill('Synthetic long password only');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3401/verify-email');
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toContain('sign-up');
    // Reset request: the answer never says whether the address has an account.
    await page.goto('http://127.0.0.1:3401/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill('synthetic-reset@example.invalid');
    await page.getByRole('button', { name: 'Request reset email', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(
      'If an account uses this address, you will receive a password reset email.',
    );
    await expect(page.getByRole('button', { name: 'Request reset email' })).toHaveCount(0);
    expect(calls).toHaveLength(2);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // Email verification: request a code, reject a malformed code, then verify a six-digit one.
    await page.goto('http://127.0.0.1:3401/verify-email');
    await page.getByLabel('Email', { exact: true }).fill('synthetic-verify@example.invalid');
    await page.getByRole('button', { name: 'Request verification code', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(
      'If verification is needed for this account, a code will be sent to this address.',
    );
    expect(calls).toHaveLength(3);
    await page.getByLabel('Verification code', { exact: true }).fill('12345');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    expect(calls).toHaveLength(3);
    await page.getByRole('button', { name: 'Request a new code' }).click();
    await expect(page.getByLabel('Verification code', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Request verification code', exact: true }).click();
    await page.getByLabel('Verification code', { exact: true }).fill('123456');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3401/signin');
    expect(calls.filter((call) => call.path.includes('verify-email'))).toHaveLength(1);
  } finally {
    server.kill('SIGTERM');
  }
});
