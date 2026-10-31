import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';
import { operatorReturnTo } from '../../apps/web/lib/workspace-navigation';
import { clearSignInLimits, totp } from './operator-signin';

const origin = 'http://127.0.0.1:3200';
const workspaceRead = '**/api/workspace/workspace?*';
const signIn = (next: string) => '/operator/signin?next=' + encodeURIComponent(next);

// The `next` a sign-in link carries, checked against the closed return list it must survive.
async function returnOf(page: Page) {
  const href = await page
    .getByRole('link', { name: 'Verify workspace access' })
    .getAttribute('href');
  const url = new URL(href ?? '', origin);
  expect(url.pathname).toBe('/operator/signin');
  expect([...url.searchParams.keys()]).toEqual(['next']);
  const next = url.searchParams.get('next')!;
  expect(operatorReturnTo(next)).toBe(next);
  return next;
}

// Sign-in opens as a new document, so nothing from the workspace page survives into it.
async function markPage(page: Page) {
  await page.evaluate(() => Object.assign(window, { beforeSignIn: true }));
}
async function expectNewDocument(page: Page) {
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect
    .soft(await page.evaluate(() => 'beforeSignIn' in window), 'sign-in opened as a new page')
    .toBe(false);
}

// A viewer membership for the signed-in operator. One made by an earlier suite is reused.
async function viewerWorkspace(ownerPassword: string, principalId: string) {
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: ownerPassword,
  });
  try {
    const found = await db.query(
      "SELECT tenant_id FROM app.membership WHERE user_id=$1 AND role='viewer' AND revoked_at IS NULL ORDER BY tenant_id LIMIT 1",
      [principalId],
    );
    if (found.rows[0]) return found.rows[0].tenant_id as string;
    const tenant = randomUUID(),
      actor = randomUUID();
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [actor],
    );
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [actor, randomUUID(), randomUUID()],
    );
    await db.query(
      "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Synthetic access return viewer workspace',true)",
      [tenant],
    );
    await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [
      tenant,
      principalId,
    ]);
    await db.query('COMMIT');
    return tenant;
  } finally {
    await db.end();
  }
}

test('Verify workspace access returns to the same workspace and section', async ({ page }) => {
  test.setTimeout(300000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const tenant = seed.tenantId as string;
  const workspaceUrl = '/operator?workspace=' + tenant;
  const viewer = await viewerWorkspace(local.ownerPassword, seed.principalId);
  const link = page.getByRole('link', { name: 'Verify workspace access' });
  const retry = page.getByRole('button', { name: 'Retry workspace' });
  const select = page.locator('#operator-workspace-select');
  const hydrationErrors: string[] = [];
  page.on('pageerror', (error) => hydrationErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|#418|#423|#425/i.test(message.text()))
      hydrationErrors.push(message.text());
  });
  const deny = (status: number, pattern = workspaceRead) =>
    page.route(pattern, (route) =>
      route.fulfill({ status, json: { error: 'Synthetic workspace read refused' } }),
    );
  // A fresh document for each address, so a change of `#` part alone is never a same-page jump.
  async function open(path: string) {
    await page.goto('about:blank');
    await page.goto(path);
  }

  await clearSignInLimits(local.ownerPassword);
  try {
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    const signInCounter = Math.floor(Date.now() / 30000);
    await page.goto('/operator/signin');
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();

    await test.step('the denied workspace links to sign-in with its workspace and section, with no hydration warning', async () => {
      await open(workspaceUrl + '#workspace-sources');
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await deny(403);
      await page.reload();
      await expect(page.getByText('Access required', { exact: true })).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        signIn('/operator?workspace=' + tenant + '#workspace-sources'),
      );
      expect(hydrationErrors).toEqual([]);
    });

    await test.step('the link follows the current # part and drops one that is not a section', async () => {
      await page.evaluate(() => {
        window.location.hash = 'workspace-evidence';
      });
      await expect(link).toHaveAttribute(
        'href',
        signIn('/operator?workspace=' + tenant + '#workspace-evidence'),
      );
      for (const hash of [
        'nonexistent',
        'main',
        'workspace-sources?token=x',
        '//example.invalid',
      ]) {
        await page.evaluate((value) => {
          window.location.hash = value;
        }, hash);
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#' + hash);
        await expect(link).toHaveAttribute('href', signIn(workspaceUrl));
        expect(await returnOf(page)).toBe(workspaceUrl);
      }
      await open(workspaceUrl);
      await expect(page.getByText('Access required', { exact: true })).toBeVisible();
      expect(await returnOf(page)).toBe(workspaceUrl);
      expect(hydrationErrors).toEqual([]);
    });

    await test.step('an unavailable workspace follows the same rule', async () => {
      await page.unroute(workspaceRead);
      await deny(500);
      await open(workspaceUrl + '#workspace-sources');
      await expect(page.getByText('Temporarily unavailable', { exact: true })).toBeVisible();
      expect(await returnOf(page)).toBe(workspaceUrl + '#workspace-sources');
      expect(hydrationErrors).toEqual([]);
    });

    await test.step('the link is reached by Tab after Retry, axe is clean and Retry recovers in place', async () => {
      await retry.focus();
      await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      expect((await new AxeBuilder({ page }).include('.ux-state').analyze()).violations).toEqual(
        [],
      );
      await page.unroute(workspaceRead);
      await retry.click();
      await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();
      await expect(link).toHaveCount(0);
    });

    await test.step('after signing in again the same workspace and section open', async () => {
      await deny(403);
      await open(workspaceUrl + '#workspace-sources');
      await expect(page.getByText('Access required', { exact: true })).toBeVisible();
      const target = signIn(workspaceUrl + '#workspace-sources');
      await expect(link).toHaveAttribute('href', target);
      await page.unroute(workspaceRead);
      await markPage(page);
      await link.click();
      await expect(page).toHaveURL(origin + target);
      await expectNewDocument(page);
      await clearSignInLimits(local.ownerPassword);
      await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
      await page.getByLabel('Password', { exact: true }).fill(seed.password);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const code = page.getByLabel('Six-digit code', { exact: true });
      const current = totp(secret);
      await code.fill(String((Number(current) + 500000) % 1000000).padStart(6, '0'));
      await page.getByRole('button', { name: 'Verify and open workspace' }).click();
      await expect(
        page.getByText('That code could not be verified. Try a current code.'),
      ).toBeVisible();
      await expect(page).toHaveURL(origin + target);
      // A code is used once per window: wait past the window used to sign in.
      await expect
        .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
        .toBeGreaterThan(signInCounter);
      await code.fill(totp(secret));
      await page.getByRole('button', { name: 'Verify and open workspace' }).click();
      await expect(page).toHaveURL(origin + workspaceUrl + '#workspace-sources');
      expect(new URL(page.url()).hash).toBe('#workspace-sources');
      await expect(select).toHaveValue(tenant);
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await expect(page.locator('#workspace-sources')).toBeFocused();
    });

    await test.step('after a workspace switch the link carries the workspace now shown', async () => {
      await deny(403, `**/api/workspace/workspace?tenant=${viewer}`);
      await select.selectOption(viewer);
      await expect(page).toHaveURL(new RegExp('workspace=' + viewer));
      await expect(page.getByText('Access required', { exact: true })).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        signIn('/operator?workspace=' + viewer + '#workspace-sources'),
      );
    });

    await test.step('a viewer returning to a section their role does not allow sees the existing denial', async () => {
      await page.evaluate(() => {
        window.location.hash = 'ops-center';
      });
      const next = '/operator?workspace=' + viewer + '#ops-center';
      await expect(link).toHaveAttribute('href', signIn(next));
      await page.unroute(`**/api/workspace/workspace?tenant=${viewer}`);
      await open(next);
      await expect(
        page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
      ).toBeVisible();
      await expect(page.locator('#workspace-navigation details')).toHaveAttribute('open', '');
      await expect(page.locator('#ops-center')).not.toBeVisible();
    });

    await test.step('a workspace that is not a membership opens a membership, never the one asked for', async () => {
      const unknown = randomUUID();
      await open('/operator?workspace=' + unknown + '#workspace-sources');
      await expect(select).toBeVisible();
      const memberships = await select
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      expect(memberships).toEqual(expect.arrayContaining([tenant, viewer]));
      expect(memberships).not.toContain(unknown);
      expect(memberships).toContain(await select.inputValue());
      expect(hydrationErrors).toEqual([]);
    });
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await clearSignInLimits(local.ownerPassword);
  }
});

test('Sign in again from a fresh authenticator load returns once to the panel', async ({
  page,
}) => {
  test.setTimeout(180000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const workspaceUrl = '/operator?workspace=' + seed.tenantId;
  const verifyRoute = '**/api/operator-auth/two-factor/verify-totp';
  const panel = page.locator('#workspace-authenticator');
  await clearSignInLimits(local.ownerPassword);
  try {
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    const signInCounter = Math.floor(Date.now() / 30000);
    await page.goto('/operator/signin');
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();

    // A fresh load straight onto the panel, so the address the page started from carries the section.
    await page.goto('about:blank');
    await page.goto(workspaceUrl + '#workspace-authenticator');
    await expect(panel).toBeVisible();
    await page.route(verifyRoute, (route) =>
      route.fulfill({
        status: 401,
        json: { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'Invalid two factor cookie' },
      }),
    );
    await panel.getByLabel('Current authenticator code', { exact: true }).fill('123456');
    await panel.getByRole('button', { name: 'Verify again', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('You are signed out.');
    const again = panel.getByRole('link', { name: 'Sign in again' });
    const target = signIn(workspaceUrl + '#workspace-authenticator');
    await expect(again).toHaveAttribute('href', target);
    await page.unroute(verifyRoute);

    await markPage(page);
    await again.click();
    await expect(page).toHaveURL(origin + target);
    await expectNewDocument(page);
    await clearSignInLimits(local.ownerPassword);
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    // A code is used once per window: wait past the window used to sign in.
    await expect
      .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
      .toBeGreaterThan(signInCounter);
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(page).toHaveURL(origin + workspaceUrl + '#workspace-authenticator');
    expect(new URL(page.url()).hash).toBe('#workspace-authenticator');
    await expect(panel).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await clearSignInLimits(local.ownerPassword);
  }
});

test('every way into operator sign-in from the access pages is a full page load', async ({
  page,
}) => {
  for (const [path, name] of [
    ['/operator/forgot-password', 'Back to operator sign-in'],
    ['/operator/setup', 'Operator sign-in and authenticator'],
    ['/operator/reset-password', 'Back to operator sign-in'],
  ]) {
    await page.goto('about:blank');
    await page.goto(path);
    await markPage(page);
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(origin + '/operator/signin');
    await expectNewDocument(page);
  }
});

// Last in this file: it ends the session.
test('signing out is a full page load and the next sign-in opens the overview, not the last section', async ({
  page,
}) => {
  test.setTimeout(180000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  async function enterPassword() {
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await clearSignInLimits(local.ownerPassword);
  try {
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    const signInCounter = Math.floor(Date.now() / 30000);
    await page.goto('/operator/signin');
    await enterPassword();
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();

    // A fresh load with a section in the address, so the router has cached it with the #.
    await page.goto('about:blank');
    await page.goto('/operator#workspace-sources');
    await expect(page.locator('#workspace-sources')).toBeVisible();
    await markPage(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(origin + '/operator/signin');
    await expectNewDocument(page);
    expect(
      (await page.request.get(`/api/workspace/workspace?tenant=${seed.tenantId}`)).status(),
    ).toBe(401);

    await clearSignInLimits(local.ownerPassword);
    await enterPassword();
    // A code is used once per window: wait past the window used to sign in.
    await expect
      .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
      .toBeGreaterThan(signInCounter);
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/operator');
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.getByRole('heading', { name: 'Start with a mission.' })).toBeVisible();
  } finally {
    await clearSignInLimits(local.ownerPassword);
  }
});
