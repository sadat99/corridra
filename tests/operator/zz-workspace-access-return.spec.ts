import { test, expect, type Locator, type Page } from '@playwright/test';
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

// Sign-in opens as a new document, so nothing from the workspace page survives into it. The same
// holds for the page sign-in returns to: `ready` is what that page shows once it is open.
async function markPage(page: Page) {
  await page.evaluate(() => Object.assign(window, { beforeSignIn: true }));
}
async function expectNewDocument(
  page: Page,
  ready: Locator = page.getByLabel('Email', { exact: true }),
) {
  await expect(ready).toBeVisible();
  expect
    .soft(await page.evaluate(() => 'beforeSignIn' in window), 'opened as a new page')
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
        // Back to a section first, so each bad # is a real change the link has to follow.
        await page.evaluate(() => {
          window.location.hash = 'workspace-evidence';
        });
        await expect(link).toHaveAttribute(
          'href',
          signIn('/operator?workspace=' + tenant + '#workspace-evidence'),
        );
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
      // Recovered in place: the section the address names opens, and the access state is gone.
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await expect(select).toHaveValue(tenant);
      await expect(page.getByText('Workspace could not be loaded.', { exact: true })).toHaveCount(
        0,
      );
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
      await markPage(page);
      await page.getByRole('button', { name: 'Verify and open workspace' }).click();
      await expect(page).toHaveURL(origin + workspaceUrl + '#workspace-sources');
      await expectNewDocument(page, select);
      expect(new URL(page.url()).hash).toBe('#workspace-sources');
      await expect(select).toHaveValue(tenant);
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await expect(page.locator('#workspace-sources')).toBeInViewport();
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

test('a soft entry into sign-in returns once, with a new document, to the address asked for', async ({
  page,
  context,
}) => {
  test.setTimeout(420000);
  page.setDefaultTimeout(15000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const tenant = seed.tenantId as string;
  const viewer = await viewerWorkspace(local.ownerPassword, seed.principalId);
  const select = page.locator('#operator-workspace-select');
  const code = page.getByLabel('Six-digit code', { exact: true });
  const verify = page.getByRole('button', { name: 'Verify and open workspace' });
  const verifyRoute = '**/api/operator-auth/two-factor/verify-totp';
  const wrongCode = 'That code could not be verified. Try a current code.';
  let usedCounter = 0;
  async function open(path: string) {
    await page.goto('about:blank');
    await page.goto(path);
  }
  async function enterPassword() {
    await clearSignInLimits(local.ownerPassword);
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(code).toBeVisible();
  }
  // A code is used once per window: wait past the window used last, then fill a current code.
  async function fillCurrentCode() {
    await expect
      .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [500] })
      .toBeGreaterThan(usedCounter);
    await code.fill(totp(secret));
    usedCounter = Math.floor(Date.now() / 30000);
  }
  // Clears the session cookies and switches to `next` with the workspace select: an in-app
  // router.replace, so the server redirect into sign-in is reached by a soft navigation.
  async function softEntry(next: string) {
    await context.clearCookies();
    await markPage(page);
    await select.selectOption(next);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => 'beforeSignIn' in window), 'sign-in reached softly').toBe(
      true,
    );
    expect(new URL(page.url()).pathname).toBe('/operator/signin');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/operator?workspace=' + next);
  }
  // Every request from Verify on: verify calls, document loads and soft (RSC) requests.
  const seen: { url: URL; document: boolean; soft: boolean }[] = [];
  let watching = false;
  page.on('request', (request) => {
    if (!watching) return;
    const url = new URL(request.url());
    seen.push({
      url,
      document: request.resourceType() === 'document',
      soft: request.headers()['rsc'] === '1' || url.searchParams.has('_rsc'),
    });
  });
  function watch() {
    seen.length = 0;
    watching = true;
  }
  function expectOneLoad(destination: string) {
    watching = false;
    const verifies = seen.filter((r) => r.url.pathname.endsWith('/two-factor/verify-totp'));
    const documents = seen.filter(
      (r) => r.document && r.url.pathname + r.url.search === destination,
    );
    const firstDocument = seen.findIndex((r) => r.document);
    const softBefore = seen
      .slice(0, firstDocument < 0 ? seen.length : firstDocument)
      .filter((r) => r.soft && r.url.pathname.startsWith('/operator'));
    expect.soft(verifies, 'one verify request').toHaveLength(1);
    expect.soft(documents, 'one document request to the destination').toHaveLength(1);
    expect.soft(softBefore, 'no soft navigation into the destination').toHaveLength(0);
  }
  async function expectSignInLeftHistory() {
    await page.goBack().catch(() => null);
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(code).toHaveCount(0);
  }

  await clearSignInLimits(local.ownerPassword);
  try {
    await test.step('a tampered return address and an unknown # part land on the overview', async () => {
      await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
      await open('/operator/signin?next=' + encodeURIComponent('//evil.test') + '#unknown');
      await enterPassword();
      await fillCurrentCode();
      await verify.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/operator');
      expect(new URL(page.url()).origin).toBe(origin);
      expect(new URL(page.url()).search).toBe('');
      expect(new URL(page.url()).hash).toBe('');
      await expect(
        page.getByRole('heading', { name: 'Your workspace.', exact: true }),
      ).toBeVisible();
    });

    await test.step('a soft entry from a section returns once to that workspace, never to the old section', async () => {
      await open('/operator?workspace=' + tenant + '#workspace-sources');
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await select.selectOption(viewer);
      await expect(page).toHaveURL(new RegExp('workspace=' + viewer));
      await softEntry(tenant);
      // The server redirect builds its return from the request, which has no # part, and the
      // soft redirect drops the one the page had (seen at d073641). The route cached for this
      // workspace still holds #workspace-sources, which a soft return used to bring back.
      expect(new URL(page.url()).hash).toBe('');
      const destination = '/operator?workspace=' + tenant;
      await enterPassword();

      // A wrong code: the exact message, focus on it, the same page and the button back.
      await code.fill(String((Number(totp(secret)) + 500000) % 1000000).padStart(6, '0'));
      await verify.click();
      const alert = page.getByRole('alert').filter({ hasText: wrongCode });
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      await expect(verify).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe('/operator/signin');
      expect(await page.evaluate(() => 'beforeSignIn' in window)).toBe(true);

      // A verify request that fails on the network says so and can be sent again.
      await page.route(verifyRoute, (route) => route.abort('failed'));
      await code.fill('000000');
      await verify.click();
      await expect(page.getByRole('alert').filter({ hasText: 'Failed to fetch' })).toBeVisible();
      await expect(verify).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe('/operator/signin');
      await page.unroute(verifyRoute);
      // A refused (rate limited) verify gives the wrong-code message.
      await page.route(verifyRoute, (route) =>
        route.fulfill({ status: 429, json: { message: 'Too many requests' } }),
      );
      await verify.click();
      await expect(page.getByRole('alert').filter({ hasText: wrongCode })).toBeVisible();
      await expect(verify).toBeEnabled();
      await page.unroute(verifyRoute);

      // A double click sends one request and loads the page once; the button stays busy until the
      // new document (held for 2 s) replaces the form.
      await page.route(
        (url) => url.pathname === '/operator' && url.searchParams.get('workspace') === tenant,
        async (route) => {
          if (route.request().resourceType() === 'document')
            await new Promise((resolve) => setTimeout(resolve, 2000));
          await route.continue();
        },
      );
      await fillCurrentCode();
      // The button as the sign-in page is replaced, kept in this tab's session storage.
      await page.evaluate(() =>
        window.addEventListener('pagehide', () => {
          const button = document.querySelector<HTMLButtonElement>('form.operator-form button');
          sessionStorage.setItem(
            'signInButtonWhenLeaving',
            button ? `${button.textContent} ${button.disabled ? 'disabled' : 'enabled'}` : '',
          );
        }),
      );
      watch();
      const verified = page.waitForResponse(verifyRoute);
      await verify.dblclick();
      expect((await verified).ok()).toBe(true);
      await expect(page).toHaveURL(origin + destination);
      expect(
        await page.evaluate(() => sessionStorage.getItem('signInButtonWhenLeaving')),
        'still busy when the destination replaced the form',
      ).toBe('Checking… disabled');
      await expectNewDocument(page, select);
      expectOneLoad(destination);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      expect(new URL(page.url()).hash).toBe('');
      await expect(select).toHaveValue(tenant);
      // The old section is not brought back: it is neither in the address nor holding focus.
      await expect(page.locator('#workspace-sources:focus')).toHaveCount(0);
      await expectSignInLeftHistory();
    });

    await test.step('a soft entry with no section returns to the workspace with no # part', async () => {
      await open('/operator?workspace=' + viewer);
      await expect(select).toHaveValue(viewer);
      await softEntry(tenant);
      expect(new URL(page.url()).hash).toBe('');
      await enterPassword();
      await fillCurrentCode();
      watch();
      await markPage(page);
      // Enter twice on the code sends one request.
      await code.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(origin + '/operator?workspace=' + tenant);
      await expectNewDocument(page, select);
      expectOneLoad('/operator?workspace=' + tenant);
      expect(new URL(page.url()).hash).toBe('');
      await expect(select).toHaveValue(tenant);
    });

    await test.step('a soft entry from the owner page link returns to the overview', async () => {
      // Loaded with a section first, so the route the router keeps for this page holds the # part;
      // the owner page link is on the overview, so the # part is then cleared in place.
      await open('/operator?workspace=' + tenant + '#workspace-sources');
      await expect(page.locator('#workspace-sources')).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = '';
      });
      await expect(page.getByText('Manage this workspace', { exact: true })).toBeVisible();
      await context.clearCookies();
      await markPage(page);
      await page.getByText('Manage this workspace', { exact: true }).click();
      await page.getByRole('link', { name: 'What is on and off', exact: true }).click();
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => 'beforeSignIn' in window), 'sign-in reached softly').toBe(
        true,
      );
      expect(new URL(page.url()).searchParams.get('next')).toBe('/operator');
      await enterPassword();
      await fillCurrentCode();
      await verify.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/operator');
      await expectNewDocument(page, page.getByRole('heading', { name: 'Start with a mission.' }));
      expect(new URL(page.url()).hash).toBe('');
    });

    await test.step('a viewer returning to a section their role does not allow sees the existing denial', async () => {
      // The return address a Verify link builds for that workspace and section.
      await context.clearCookies();
      await open(signIn('/operator?workspace=' + viewer + '#workspace-settings'));
      await enterPassword();
      await fillCurrentCode();
      await markPage(page);
      await verify.click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
      ).toBeVisible();
      expect(await page.evaluate(() => 'beforeSignIn' in window), 'opened as a new page').toBe(
        false,
      );
      expect(new URL(page.url()).searchParams.get('workspace')).toBe(viewer);
      await expect(page.locator('#workspace-settings')).not.toBeVisible();
    });
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await clearSignInLimits(local.ownerPassword);
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
