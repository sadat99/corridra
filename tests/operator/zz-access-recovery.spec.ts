import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('pending invitation guidance is conditional; operator recovery handles interruption, one submission and private token cleanup', async ({
  page,
}) => {
  test.setTimeout(90000);
  let invited = true;
  await page.route('**/api/operator-setup', (route) =>
    route.fulfill({ json: { available: invited } }),
  );
  await page.goto('/operator/signin');
  await expect(page.getByRole('form', { name: 'Operator sign-in', exact: true })).toHaveAttribute(
    'method',
    'post',
  );
  await expect(page.getByRole('link', { name: 'Finish team setup' })).toBeVisible();
  invited = false;
  await page.reload();
  await expect(page.getByRole('link', { name: 'Finish team setup' })).toHaveCount(0);
  let signinRequests = 0;
  let releaseSignin!: () => void;
  const signinHeld = new Promise<void>((resolve) => {
    releaseSignin = resolve;
  });
  await page.route('**/api/operator-auth/sign-in/email', async (route) => {
    signinRequests++;
    await signinHeld;
    await route.fulfill({ status: 503, json: { message: 'Synthetic interruption' } });
  });
  await page.getByLabel('Email', { exact: true }).fill('synthetic-recovery@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Synthetic sign-in password only');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => signinRequests).toBe(1);
  await expect(page.getByLabel('Email', { exact: true })).toBeDisabled();
  await page
    .getByRole('form', { name: 'Operator sign-in' })
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(signinRequests).toBe(1);
  releaseSignin();
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'synthetic-recovery@example.invalid',
  );
  await page.getByRole('link', { name: 'Forgot operator password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your operator password.' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Operator password recovery' })).toHaveAttribute(
    'method',
    'post',
  );
  const endpoint = '/api/operator-auth/request-password-reset';
  expect(
    (
      await page.request.post(endpoint, {
        headers: { Origin: 'https://untrusted.invalid' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(endpoint, {
        headers: { Origin: 'http://127.0.0.1:3200' },
        data: { email: 'unknown@example.invalid', padding: 'x'.repeat(9000) },
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await page.request.post(endpoint, {
        headers: { Origin: 'http://127.0.0.1:3200' },
        data: {
          email: 'unknown@example.invalid',
          redirectTo: 'http://127.0.0.1:3200/operator/reset-password',
        },
      })
    ).status(),
  ).toBe(200);
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route('**/api/operator-auth/request-password-reset', async (route) => {
    requests.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    if (fail) await held;
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail ? { message: 'Synthetic interruption' } : { status: true },
    });
  });
  await page
    .getByLabel('Operator email', { exact: true })
    .fill('synthetic-recovery@example.invalid');
  await page.getByRole('button', { name: 'Request operator reset email' }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByLabel('Operator email', { exact: true })).toBeDisabled();
  await page
    .getByRole('form', { name: 'Operator password recovery' })
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(requests).toHaveLength(1);
  release();
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Operator email', { exact: true })).toHaveValue(
    'synthetic-recovery@example.invalid',
  );
  fail = false;
  await page.getByRole('button', { name: 'Request operator reset email' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('active operator account');
  expect(requests[0]).toEqual({
    path: '/api/operator-auth/request-password-reset',
    body: {
      email: 'synthetic-recovery@example.invalid',
      redirectTo: 'http://127.0.0.1:3200/operator/reset-password',
    },
  });
  await page.goto('/operator/reset-password');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('incomplete or invalid');
  await expect(page.getByLabel('New operator password', { exact: true })).toHaveCount(0);
  let consumed = 0;
  await page.route('**/api/operator-auth/reset-password', async (route) => {
    consumed++;
    expect(route.request().postDataJSON().token).toBe('abcdefghijklmnopqrstuvwx');
    await route.fulfill({ status: 200, json: { status: true } });
  });
  const navigation = await page.goto('/operator/reset-password?token=abcdefghijklmnopqrstuvwx');
  expect(navigation?.headers()['referrer-policy']).toBe('no-referrer');
  expect(navigation?.headers()['cache-control']).toContain('no-store');
  await expect(page).toHaveURL('http://127.0.0.1:3200/operator/reset-password');
  await page
    .getByLabel('New operator password', { exact: true })
    .fill('Synthetic replacement only');
  await page
    .getByLabel('Confirm operator password', { exact: true })
    .fill('Synthetic mismatch only');
  await page.getByRole('button', { name: 'Set new operator password' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('must match');
  expect(consumed).toBe(0);
  await page
    .getByLabel('Confirm operator password', { exact: true })
    .fill('Synthetic replacement only');
  await page.getByRole('button', { name: 'Set new operator password' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('existing authenticator');
  expect(consumed).toBe(1);
  await page.goto('/operator/forgot-password');
  await mkdir('.cache/ux06/after', { recursive: true });
  for (const width of [1440, 1280, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false,
    );
    if ([1440, 390].includes(width))
      await page.screenshot({
        path: `.cache/ux06/after/operator-recovery-${width}.png`,
        fullPage: true,
      });
  }
});
