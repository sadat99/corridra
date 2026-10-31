import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

// Set to `before` or `after` to write the error page captures for the billing phone and error
// return evidence; unset, nothing is written.
const evidenceStage = process.env.BILLING_PHONE_EVIDENCE;
const evidenceFolder = `docs/design-system/evidence/billing-phone-and-error-return-2026-10-31/${evidenceStage}`;

test('UX-01 startup outage stays denied and a fresh document retry rechecks real database readiness', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const hydrationErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (/hydrat|#418|#423|#425/i.test(error.message)) hydrationErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|#418|#423|#425/i.test(message.text()))
      hydrationErrors.push(message.text());
  });
  let enabled = false;
  const sockets = new Set<Socket>();
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    if (!enabled) {
      socket.destroy();
      return;
    }
    const upstream = connect(54329, '127.0.0.1');
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => {
      upstream.destroy();
      socket.destroy();
    });
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => proxy.listen(54339, '127.0.0.1', resolve));
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const connection = (role: string, password: string) =>
    `postgresql://${role}:${password}@127.0.0.1:54339/corridra_browser`;
  const server = spawn(
    process.execPath,
    [cli, 'start', '--hostname', '127.0.0.1', '--port', '3300'],
    {
      cwd: resolve('apps/web'),
      stdio: 'ignore',
      // Explicit local-only bindings. No ambient cloud credentials or provider activation.
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        CORRIDRA_FOUNDATIONS_ENABLED: 'true',
        APP_ORIGIN: 'http://127.0.0.1:3300',
        DATA_ENVIRONMENT: 'synthetic',
        DATABASE_REGION: 'local',
        AUTH_SECRET: local.authSecret,
        RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
        AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
      },
    },
  );
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await request.get('http://127.0.0.1:3300/workspace')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 20000 },
      )
      .toBe(200);
    await page.goto(`http://127.0.0.1:3300/contributor?workspace=${seed.tenantId}`);
    await expect(
      page.getByRole('heading', { name: 'Assigned work is temporarily unavailable.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Retry assigned work', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Assigned work is temporarily unavailable.' }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('workspace')).toBe(seed.tenantId);
    await expect(page.getByRole('region', { name: 'Assigned tasks' })).toHaveCount(0);
    await page.goto(`http://127.0.0.1:3300/operator?workspace=${seed.tenantId}#workspace-missions`);
    const heading = page.getByRole('heading', {
      name: 'The workspace is temporarily unavailable.',
    });
    await expect(heading).toBeVisible();
    await expect(page.getByRole('link', { name: 'Retry workspace', exact: true })).toHaveAttribute(
      'href',
      '',
    );
    await page.getByRole('link', { name: 'Retry workspace', exact: true }).click();
    await expect(heading).toBeVisible();
    await expect(page.locator('.mission-card')).toHaveCount(0);

    // Verify operator access signs in again to the workspace and section shown, as a full page load.
    const workspaceUrl = '/operator?workspace=' + seed.tenantId;
    const signInTo = (next: string) => '/operator/signin?next=' + encodeURIComponent(next);
    const verify = page
      .getByRole('navigation', { name: 'Workspace recovery' })
      .getByRole('link', { name: 'Verify operator access' });
    if (evidenceStage === 'before' || evidenceStage === 'after') {
      await mkdir(evidenceFolder, { recursive: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        await expect(verify).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: `${evidenceFolder}/operator-error-${width}.png` });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await expect(verify).toHaveAttribute('href', signInTo(workspaceUrl + '#workspace-missions'));
    // The server sends the plain sign-in page; the return address arrives after hydration.
    const served = await (await request.get('http://127.0.0.1:3300' + workspaceUrl)).text();
    if (served.includes('Verify operator access'))
      expect(served).toMatch(/href="\/operator\/signin"[^>]*>\s*Verify operator access/);
    expect(hydrationErrors).toEqual([]);
    await verify.focus();
    await page.evaluate(() => {
      window.location.hash = 'workspace-sources';
    });
    await expect(verify).toHaveAttribute('href', signInTo(workspaceUrl + '#workspace-sources'));
    await expect(verify).toBeFocused();
    await page.evaluate(() => {
      window.location.hash = 'nonexistent';
    });
    await expect(verify).toHaveAttribute('href', signInTo(workspaceUrl));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        (await new AxeBuilder({ page }).include('.ux-state').analyze()).violations,
        `axe at ${width}`,
      ).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      window.location.hash = 'workspace-missions';
    });
    await expect(verify).toHaveAttribute('href', signInTo(workspaceUrl + '#workspace-missions'));
    await page.evaluate(() => Object.assign(window, { beforeSignIn: true }));
    await verify.click();
    await expect(page).toHaveURL(
      'http://127.0.0.1:3300' + signInTo(workspaceUrl + '#workspace-missions'),
    );
    expect(
      await page.evaluate(() => 'beforeSignIn' in window),
      'sign-in opened as a new page',
    ).toBe(false);
    // Back to the outage page, where Retry still rechecks readiness with a fresh document.
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:3300${workspaceUrl}#workspace-missions`);
    await expect(heading).toBeVisible();
    expect(hydrationErrors).toEqual([]);
    enabled = true;
    await page.getByRole('link', { name: 'Retry workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
    const destination = new URL(page.url());
    expect(destination.pathname).toBe('/operator/signin');
    expect(destination.searchParams.get('next')).toBe('/operator?workspace=' + seed.tenantId);
    expect(destination.hash).toBe('#workspace-missions');
    expect(
      (
        await request.get(`http://127.0.0.1:3300/api/workspace/missions?tenant=${seed.tenantId}`)
      ).status(),
    ).toBe(401);
    await page.goto(`http://127.0.0.1:3300/contributor?workspace=${seed.tenantId}`);
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('next')).toBe(
      '/contributor?workspace=' + seed.tenantId,
    );
  } finally {
    server.kill('SIGTERM');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (server.exitCode === null)
      await new Promise<void>((resolve) => server.once('exit', () => resolve()));
  }
});
