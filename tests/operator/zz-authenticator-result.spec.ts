import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';
import { openSection } from './workspace-nav';

// A code for the current 30 second window, or for a window `offset` steps away.
function totp(secret: string, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offsetByte = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offsetByte) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

const verifyRoute = '**/api/operator-auth/two-factor/verify-totp';
const unsaved = 'Unsaved synthetic source description';

async function clearLimits(ownerPassword: string) {
  // Sign-in and two-factor requests are limited to 5 per minute and earlier suites sign in from the
  // same test address (KI-01). Start with empty counters in the local test database only.
  const limits = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: ownerPassword,
  });
  try {
    await limits.query('DELETE FROM identity."rateLimit"');
  } finally {
    await limits.end();
  }
}

function panelParts(page: Page) {
  const panel = page.locator('#workspace-authenticator');
  return {
    panel,
    field: panel.getByLabel('Current authenticator code', { exact: true }),
    verify: panel.getByRole('button', { name: 'Verify again', exact: true }),
    notice: page.locator('#workspace-authenticator-result'),
    back: panel.getByRole('link', { name: /^Back to / }),
    status: page.getByRole('status', { name: 'Workspace status' }),
    // An empty status line counts as hidden, so the emptiness checks include hidden elements.
    statusLine: page.getByRole('status', { name: 'Workspace status', includeHidden: true }),
    locator: page.locator('#workspace-sources input[name="locator"]'),
  };
}

test('the authenticator panel says each check result beside the field and keeps every other entry', async ({
  page,
}) => {
  test.setTimeout(300000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const workspaceUrl = '/operator?workspace=' + encodeURIComponent(seed.tenantId);
  const { panel, field, verify, notice, back, status, statusLine, locator } = panelParts(page);
  let verifyRequests = 0;
  async function answerVerify(handler: (route: Route) => Promise<void>) {
    await page.unroute(verifyRoute);
    verifyRequests = 0;
    await page.route(verifyRoute, async (route) => {
      verifyRequests++;
      await handler(route);
    });
  }
  const accept = (route: Route) =>
    route.fulfill({ json: { token: 'synthetic-session', user: { id: 'synthetic-user' } } });
  async function openFromControls() {
    await openSection(page, 'workspace-controls');
    await page.locator('#workspace-controls a[href="#workspace-authenticator"]').click();
    await expect(panel).toBeVisible();
  }
  async function submit(code: string) {
    await field.fill(code);
    await verify.click();
  }
  // A real check: wait for the server's answer so no assertion reads the previous result.
  async function submitReal(code: string) {
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/operator-auth/two-factor/verify-totp',
    );
    await submit(code);
    return (await answered).status();
  }
  await clearLimits(local.ownerPassword);
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
    await page.goto(workspaceUrl);
    await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();

    await test.step('an entry typed in another panel is the one to keep', async () => {
      await openSection(page, 'workspace-sources');
      await locator.fill(unsaved);
    });

    await test.step('a real wrong code and a real expired code are refused beside the field', async () => {
      await openFromControls();
      await expect(notice).toHaveCount(0);
      const current = totp(secret);
      const wrong = String((Number(current) + 500000) % 1000000).padStart(6, '0');
      for (const code of [wrong, totp(secret, -5)]) {
        expect(await submitReal(code)).toBe(401);
        await expect(panel.getByRole('alert')).toHaveText(
          'Code not accepted. Type the code your app shows now. Codes change every 30 seconds. If it still fails, check that the clock on your phone or computer is correct.',
        );
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(field).toHaveAttribute(
          'aria-describedby',
          'workspace-authenticator-result workspace-authenticator-help',
        );
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('');
        await expect(statusLine).toBeEmpty();
        await expect(notice).toBeInViewport();
        expect(await notice.innerText()).not.toContain(code);
      }
      await expect(locator).toHaveValue(unsaved);
    });

    await test.step('a real correct code is accepted with its time and a way back to the section', async () => {
      // A code is used once per window: wait past the window used to sign in.
      await expect
        .poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [1000] })
        .toBeGreaterThan(signInCounter);
      const code = totp(secret);
      expect(await submitReal(code)).toBe(200);
      await expect(status).toHaveText('Saved.');
      const accepted = panel.getByRole('status');
      await expect(accepted).toContainText(/^Code accepted at \d{2}:\d{2} \S+\./);
      await expect(accepted).toContainText(
        'Most protected actions accept a check from the last five minutes, so try the action again now.',
      );
      await expect(accepted.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
      await expect(notice).toHaveAttribute('data-tone', 'ok');
      await expect(notice).toBeFocused();
      await expect(notice).toBeInViewport();
      await expect(field).toHaveValue('');
      await expect(field).not.toHaveAttribute('aria-invalid');
      await expect(field).toHaveAttribute('aria-describedby', 'workspace-authenticator-help');
      const text = await notice.innerText();
      const sentence = text.replace(/Back to .*$/, '');
      expect(sentence).not.toMatch(/verified|complete|access granted|valid until|workspace|—/i);
      expect(text).not.toContain(code);
      expect(page.url()).not.toContain(code);
      expect(
        await page.evaluate(
          () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
        ),
      ).not.toContain(code);
      await expect(back).toHaveAttribute('href', '#workspace-controls');
      await expect(back).toHaveText('Back to Workspace controls');
      await back.click();
      await expect(page.locator('#workspace-controls')).toBeVisible();
      await expect(panel).toBeHidden();
      await openSection(page, 'workspace-sources');
      await expect(locator).toHaveValue(unsaved);
      // Moving between sections keeps the result; it belongs to this workspace page.
      await openSection(page, 'workspace-authenticator');
      await expect(notice).toContainText('Code accepted at');
    });

    await test.step('while checking, the form is busy and Enter or a second submit sends nothing more', async () => {
      await openFromControls();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await answerVerify(async (route) => {
        await held;
        await accept(route);
      });
      await field.fill('123456');
      await field.press('Enter');
      await expect.poll(() => verifyRequests).toBe(1);
      await field.press('Enter');
      await panel
        .locator('form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
      await expect(panel.locator('form')).toHaveAttribute('aria-busy', 'true');
      await expect(verify).toBeDisabled();
      await expect(panel.getByText('Checking the code…', { exact: true })).toBeVisible();
      await expect(notice).toHaveCount(0);
      await expect(field).toHaveValue('123456');
      expect(
        (await new AxeBuilder({ page }).include('#workspace-authenticator').analyze()).violations,
      ).toEqual([]);
      expect(verifyRequests).toBe(1);
      release();
      await expect(panel.getByRole('status')).toContainText('Code accepted at');
      expect(verifyRequests).toBe(1);
      await expect(panel.locator('form')).not.toHaveAttribute('aria-busy');
      // One result inside the panel, announced once, and focus never returns to the page top.
      await expect(panel.locator('[role="status"], [role="alert"]')).toHaveCount(1);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        'workspace-authenticator-result',
      );
    });

    await test.step('too many tries, an ended sign-in, a refused origin and no answer each say so plainly', async () => {
      await answerVerify((route) =>
        route.fulfill({
          status: 429,
          json: { message: 'Too many requests. Please try again later.' },
        }),
      );
      await submit('123456');
      const alert = panel.getByRole('alert');
      await expect(alert).toHaveText(
        'Too many tries. This code was not checked. Wait a minute, then try again with the code your app shows then.',
      );
      await expect(panel).not.toContainText('Code not accepted');
      await expect(panel).not.toContainText('Code accepted');
      await expect(field).not.toHaveAttribute('aria-invalid');
      await expect(notice).toBeFocused();
      await expect(statusLine).toBeEmpty();
      await page.waitForTimeout(3000);
      expect(verifyRequests).toBe(1);

      await answerVerify((route) =>
        route.fulfill({
          status: 401,
          json: { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'Invalid two factor cookie' },
        }),
      );
      await submit('123456');
      await expect(alert).toContainText(
        'You are signed out. The code was not checked because your sign-in has ended. Copy any unsaved entries before you leave this page.',
      );
      await expect(panel.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
        'href',
        '/operator/signin?next=' +
          encodeURIComponent('/operator?workspace=' + seed.tenantId + '#workspace-authenticator'),
      );
      await expect(panel).not.toContainText('Code not accepted');

      await answerVerify((route) =>
        route.fulfill({ status: 403, json: { error: 'Request origin is not allowed' } }),
      );
      await submit('123456');
      await expect(alert).toHaveText(
        'The check could not be confirmed from this page. The code was not checked. Copy any unsaved entries, then reload the page and try again with a new code.',
      );
      await expect(page.getByText('Request origin is not allowed')).toHaveCount(0);

      await answerVerify((route) => route.abort('failed'));
      await submit('123456');
      await expect(panel.getByRole('status')).toHaveText(
        'The check did not finish. There was no clear answer, so the code may not have been checked. Try again with the code your app shows now.',
      );
      await expect(notice).not.toHaveAttribute('data-tone');
      await expect(panel).not.toContainText('Code accepted');
      await expect(panel).not.toContainText('Code not accepted');
      await expect(statusLine).toBeEmpty();

      // A success status without the session the server records the check against is no answer.
      await answerVerify((route) => route.fulfill({ json: {} }));
      await submit('123456');
      await expect.poll(() => verifyRequests).toBe(1);
      await expect(panel.getByRole('status')).toHaveText(
        'The check did not finish. There was no clear answer, so the code may not have been checked. Try again with the code your app shows now.',
      );
      await expect(notice).not.toHaveAttribute('data-tone');
      await expect(panel).not.toContainText('Code accepted');
      await expect(statusLine).toBeEmpty();
      expect(
        (await new AxeBuilder({ page }).include('#workspace-authenticator').analyze()).violations,
      ).toEqual([]);
      await expect(locator).toHaveValue(unsaved);
    });

    await test.step('a new attempt replaces the previous result in both directions', async () => {
      await answerVerify(accept);
      await submit('123456');
      await expect(panel.getByRole('status')).toContainText('Code accepted at');
      await answerVerify((route) => route.fulfill({ status: 429, json: {} }));
      await submit('123456');
      await expect(panel.getByRole('alert')).toContainText('Too many tries.');
      await expect(panel).not.toContainText('Code accepted');
      await answerVerify(accept);
      await submit('123456');
      await expect(panel.getByRole('status')).toContainText('Code accepted at');
      await expect(panel).not.toContainText('Too many tries');
    });

    await test.step('an accepted code whose records did not refresh still says accepted', async () => {
      await answerVerify(accept);
      await page.route('**/api/workspace/workspace?*', (route) =>
        route.fulfill({ status: 500, json: { error: 'Synthetic refresh failure' } }),
      );
      await submit('123456');
      const accepted = panel.getByRole('status');
      await expect(accepted).toContainText(
        'The records on this page did not refresh, so some details may be out of date. Try the action again now.',
      );
      await expect(accepted).toContainText(/^Code accepted at /);
      await expect(panel).not.toContainText('not accepted');
      await expect(status).not.toHaveText('Saved.');
      await page.unroute('**/api/workspace/workspace?*');
    });

    await test.step('a membership removed during the check shows the denied workspace, not the panel', async () => {
      await answerVerify(accept);
      await page.route('**/api/workspace/workspace?*', (route) =>
        route.fulfill({ status: 403, json: { error: 'Synthetic membership removed' } }),
      );
      await submit('123456');
      await expect(page.getByRole('link', { name: 'Verify workspace access' })).toBeVisible();
      await expect(panel).toHaveCount(0);
      await page.unroute('**/api/workspace/workspace?*');
    });

    await test.step('with no section before it, the result has no link back', async () => {
      // A fresh load straight onto the panel: a same-address hash change would keep the old page.
      await page.goto('about:blank');
      await page.goto(workspaceUrl + '#workspace-authenticator');
      await expect(panel).toBeVisible();
      await answerVerify(accept);
      await submit('123456');
      await expect(panel.getByRole('status')).toContainText(
        'Most protected actions accept a check from the last five minutes, so go back to your form and try the action again now.',
      );
      await expect(back).toHaveCount(0);
    });

    await test.step('a forbidden address still lands on the directory and gives no link back', async () => {
      await page.goto(workspaceUrl + '#nonexistent');
      await expect(page.locator('#workspace-navigation details')).toHaveAttribute('open', '');
      await expect(
        page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
      ).toBeVisible();
      await openSection(page, 'workspace-authenticator');
      await answerVerify(accept);
      await submit('123456');
      await expect(panel.getByRole('status')).toContainText('Code accepted at');
      await expect(back).toHaveCount(0);
    });

    await test.step('switching workspace clears the result', async () => {
      await expect(notice).toHaveCount(1);
      const select = page.locator('#operator-workspace-select');
      const other = await select
        .locator('option')
        .evaluateAll(
          (options, current) =>
            options.map((option) => (option as HTMLOptionElement).value).find((v) => v !== current),
          seed.tenantId,
        );
      if (other) {
        page.once('dialog', (dialog) => dialog.accept());
        await select.selectOption(other);
        await expect(page).toHaveURL(new RegExp('workspace=' + other));
      } else {
        await page.reload();
      }
      await expect(panel).toBeAttached();
      await expect(notice).toHaveCount(0);
      await expect(field).toHaveValue('');
      await page.goto(workspaceUrl);
      await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();
    });

    await test.step('the result is in view right after pressing at every width, with axe clean', async () => {
      const out = 'work/operator-ui';
      await mkdir(out, { recursive: true });
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        // A fresh load so the idle capture has no earlier result in it.
        await page.goto(workspaceUrl);
        await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();
        await openFromControls();
        await expect(notice).toHaveCount(0);
        await expect(panel.locator('.primary-link')).toHaveCount(1);
        expect(
          (await new AxeBuilder({ page }).include('#workspace-authenticator').analyze()).violations,
        ).toEqual([]);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${out}/authenticator-result-idle-${width}.png` });

        await answerVerify(accept);
        await submit('123456');
        await expect(panel.getByRole('status')).toContainText('Code accepted at');
        await expect(notice).toBeInViewport();
        await expect(back).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        expect(
          (await new AxeBuilder({ page }).include('#workspace-authenticator').analyze()).violations,
        ).toEqual([]);
        if (width <= 768)
          for (const target of [verify, back])
            expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: `${out}/authenticator-result-accepted-${width}.png` });

        await answerVerify((route) =>
          route.fulfill({ status: 401, json: { code: 'INVALID_CODE', message: 'Invalid code' } }),
        );
        await submit('123456');
        await expect(panel.getByRole('alert')).toContainText('Code not accepted.');
        await expect(notice).toBeInViewport();
        expect(
          (await new AxeBuilder({ page }).include('#workspace-authenticator').analyze()).violations,
        ).toEqual([]);
        await page.screenshot({ path: `${out}/authenticator-result-wrong-code-${width}.png` });
      }
    });
  } finally {
    await page.unroute(verifyRoute);
    await clearLimits(local.ownerPassword);
  }
});
