import { test, expect } from '@playwright/test';
import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

test('UX-01 startup outage stays denied and a fresh document retry rechecks real database readiness', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
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
  } finally {
    server.kill('SIGTERM');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (server.exitCode === null)
      await new Promise<void>((resolve) => server.once('exit', () => resolve()));
  }
});
