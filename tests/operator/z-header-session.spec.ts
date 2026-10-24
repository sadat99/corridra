import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

test('the header shows Your account and Sign out for a signed-in visitor and Sign in after signing out', async ({
  page,
}) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3402'],
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
        APP_ORIGIN: 'http://127.0.0.1:3402',
      },
    },
  );
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3402/signin')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    let signedIn = true;
    const signOuts: string[] = [];
    await page.route('**/api/auth/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/get-session')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            signedIn
              ? {
                  session: { id: 'synthetic-session' },
                  user: { id: 'synthetic-user', email: 'synthetic-header@example.invalid' },
                }
              : null,
          ),
        });
      } else if (url.pathname.endsWith('/sign-out')) {
        signOuts.push(route.request().method());
        signedIn = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
    });
    await page.goto('http://127.0.0.1:3402/forgot-password');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const account = nav.getByRole('link', { name: 'Your account', exact: true });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute('href', '/account');
    await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await nav.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3402/signin');
    await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Your account', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
    expect(signOuts).toEqual(['POST']);
  } finally {
    server.kill('SIGTERM');
  }
});

test('the header treats a failed or malformed session answer as signed out', async ({ page }) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3403'],
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
        APP_ORIGIN: 'http://127.0.0.1:3403',
      },
    },
  );
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3403/signin')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    await page.route('**/api/auth/get-session', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('http://127.0.0.1:3403/forgot-password');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await page.unroute('**/api/auth/get-session');
    await page.route('**/api/auth/get-session', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'not json' }),
    );
    await page.reload();
    await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Your account', exact: true })).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
  }
});

test('the header shows the team workspace link, not Sign in, for a signed-in team member; sign-out stays on the workspace page', async ({
  page,
}) => {
  test.setTimeout(90000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3404'],
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
        APP_ORIGIN: 'http://127.0.0.1:3404',
      },
    },
  );
  try {
    await expect(async () => {
      expect((await page.request.get('http://127.0.0.1:3404/signin')).status()).toBe(200);
    }).toPass({ timeout: 15000 });
    let signedIn = true;
    const signOuts: string[] = [];
    // No customer account is signed in; the team sign-in is a separate service.
    await page.route('**/api/auth/get-session', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.route('**/api/operator-auth/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/get-session'))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            signedIn
              ? {
                  session: { id: 'synthetic-staff-session' },
                  user: { id: 'synthetic-staff', email: 'synthetic-staff@example.invalid' },
                }
              : null,
          ),
        });
      else if (url.pathname.endsWith('/sign-out')) {
        signOuts.push(route.request().method());
        signedIn = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.goto('http://127.0.0.1:3404/forgot-password');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const workspace = nav.getByRole('link', { name: 'Team workspace', exact: true });
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveAttribute('href', '/operator');
    await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Your account', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
    expect(signOuts).toEqual([]);
  } finally {
    server.kill('SIGTERM');
  }
});
