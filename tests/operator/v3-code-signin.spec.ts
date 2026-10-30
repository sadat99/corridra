import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

// UI transport fixture only. It stubs the provider's same-origin calls, so it proves what the page
// sends and says, not that a real code is delivered or accepted. A real run on a non-production
// identity branch is recorded separately in the work log.
function start(port: number, codeSignIn: boolean) {
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cli, 'start', '--port', String(port)], {
    cwd: resolve('apps/web'),
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      CORRIDRA_NEON_AUTH_ENABLED: 'true',
      ...(codeSignIn ? { CORRIDRA_CUSTOMER_CODE_SIGNIN: 'true' } : {}),
      NEON_AUTH_BASE_URL:
        'https://ep-v3-code-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
      NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
      APP_ORIGIN: origin,
    },
  });
  return { server, origin };
}

async function ready(page: Page, origin: string) {
  await expect(async () => {
    expect((await page.request.get(origin + '/signin')).status()).toBe(200);
  }).toPass({ timeout: 20000 });
}

test('with the switch off the sign-in form has no code option at all', async ({ page }) => {
  test.setTimeout(90000);
  const { server, origin } = start(3414, false);
  try {
    await ready(page, origin);
    await page.goto(origin + '/signin');
    const form = page.getByRole('form', { name: 'Account access' });
    await expect(form.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(form.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(form.getByRole('button')).toHaveCount(1);
    await expect(form.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByText(/code/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign in with a code/i })).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
  }
});

test('with the switch on a person can sign in with an emailed code and keep the password route', async ({
  page,
}) => {
  test.setTimeout(150000);
  const { server, origin } = start(3413, true);
  try {
    await ready(page, origin);
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    let sendStatus = 200;
    let signInReply: { status: number; body: Record<string, unknown> } = {
      status: 400,
      body: { code: 'INVALID_OTP', message: 'Invalid OTP' },
    };
    await page.route('**/api/auth/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST')
        calls.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith('/email-otp/send-verification-otp'))
        return route.fulfill({
          status: sendStatus,
          contentType: 'application/json',
          body: JSON.stringify(sendStatus === 200 ? { success: true } : { message: 'Refused' }),
        });
      if (path.endsWith('/sign-in/email-otp'))
        return route.fulfill({
          status: signInReply.status,
          contentType: 'application/json',
          body: JSON.stringify(signInReply.body),
        });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(origin + '/signin?returnTo=/plan');
    const form = page.getByRole('form', { name: 'Account access' });
    const email = form.getByLabel('Email', { exact: true });

    // Password stays the default. The code route is one quiet extra button.
    await expect(form.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const toggle = form.getByRole('button', { name: 'Sign in with a code', exact: true });
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(form.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Send code', exact: true })).toBeVisible();
    await expect(form.getByLabel('Six-digit code')).toHaveCount(0);

    // The same words for an address that can sign in and one that cannot.
    await email.fill('known@example.invalid');
    await form.getByRole('button', { name: 'Send code', exact: true }).click();
    const status = form.getByRole('status');
    await expect(status).toHaveText('If this address can sign in, a code is on its way.');
    expect(calls[0]).toEqual({
      path: '/api/auth/email-otp/send-verification-otp',
      body: { email: 'known@example.invalid', type: 'sign-in' },
    });
    const code = form.getByLabel('Six-digit code');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');

    // A new code can be asked for only after a short wait.
    const resend = form.getByRole('button', { name: 'Send a new code', exact: true });
    await expect(resend).toBeDisabled();
    await expect(form).toContainText('You can ask for a new code in');

    // Changing the address starts again. A provider refusal reads the same as success.
    await email.fill('unknown@example.invalid');
    await expect(code).toHaveCount(0);
    sendStatus = 400;
    await form.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(status).toHaveText('If this address can sign in, a code is on its way.');
    expect(calls[1].body).toEqual({ email: 'unknown@example.invalid', type: 'sign-in' });

    // Only a rate limit is said out loud.
    await email.fill('busy@example.invalid');
    sendStatus = 429;
    await form.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'Too many requests. Wait a minute, then try again.',
    );
    sendStatus = 200;
    await form.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(status).toHaveText('If this address can sign in, a code is on its way.');

    // Wrong, expired and over-tried codes get calm, plain messages and keep what was typed.
    await code.fill('123456');
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'That code is wrong or has expired. Check it or ask for a new code.',
    );
    await expect(form.getByRole('alert')).toBeFocused();
    await expect(code).toHaveValue('123456');
    signInReply = {
      status: 429,
      body: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' },
    };
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText('Too many tries. Ask for a new code.');
    const attempts = calls.filter((c) => c.path === '/api/auth/sign-in/email-otp');
    expect(attempts[0].body).toEqual({ email: 'busy@example.invalid', otp: '123456' });

    // A correct code asks the provider to sign in and then leaves the page.
    signInReply = {
      status: 200,
      body: { token: 'x', user: { id: 'u', email: 'busy@example.invalid' } },
    };
    const done = page.waitForRequest(
      (r) => new URL(r.url()).pathname === '/api/auth/sign-in/email-otp',
    );
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    await done;
    await expect(page).toHaveURL(origin + '/plan');

    // The password route is still there.
    await page.goto(origin + '/signin');
    await form.getByRole('button', { name: 'Sign in with a code', exact: true }).click();
    await form.getByRole('button', { name: 'Use my password instead', exact: true }).click();
    await expect(form.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(
      form.getByRole('button', { name: 'Sign in with a code', exact: true }),
    ).toBeVisible();

    // Both stages pass the accessibility check at phone, tablet and desktop widths.
    await mkdir('docs/design-system/evidence/code-signin/after', { recursive: true });
    await form.getByRole('button', { name: 'Sign in with a code', exact: true }).click();
    await email.fill('known@example.invalid');
    for (const stage of ['email', 'code'] as const) {
      if (stage === 'code') {
        await form.getByRole('button', { name: 'Send code', exact: true }).click();
        await expect(form.getByLabel('Six-digit code')).toBeVisible();
      }
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect((await new AxeBuilder({ page }).analyze()).violations, `${stage} ${width}`).toEqual(
          [],
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({
          path: `docs/design-system/evidence/code-signin/after/${stage}-${width}.png`,
          fullPage: true,
        });
      }
    }
  } finally {
    server.kill('SIGTERM');
  }
});
