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
      await link.click();
      await expect(page).toHaveURL(origin + target);
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
