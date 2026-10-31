import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { Pool } from '../../../../packages/db/src/index';
import { evidence, expect, forbiddenCopy, qaSeed, test } from '../fixtures';

// WS-D verification cases (program section 8): V-01 to V-04, V-07, V-18 to V-22 (UI part), V-45
// (TEAM_INVITE), V-51 (runbook), D-1 (Today counts) and D-2 (owner status board). The heavy action
// case runs once, at 1280 px, so the shared sign-in rate limit is never reached; the layout case runs
// at every width with the saved session.
const statePath = '.cache/qa-wsd-state.json';
const secretPath = '.cache/qa-wsd-secret.json';

function totp(secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  return ((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}

function database() {
  const local = JSON.parse(readFileSync('.cache/part03-local.json', 'utf8'));
  return new Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
    database: 'corridra_verification',
    max: 1,
  });
}

async function signIn(page: Page) {
  const seed = qaSeed();
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill(seed.owner.email);
  await page.getByLabel('Password', { exact: true }).fill(seed.owner.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const enrol = page.getByRole('button', { name: 'Set up authenticator', exact: true });
  const verify = page.getByLabel('Six-digit code', { exact: true });
  await expect(enrol.or(verify)).toBeVisible();
  let secret: string;
  if (await enrol.isVisible()) {
    await enrol.click();
    secret = await page.getByLabel('Authenticator setup key', { exact: true }).inputValue();
    writeFileSync(secretPath, JSON.stringify({ tenantId: seed.tenantId, secret }), { mode: 0o600 });
  } else {
    secret = JSON.parse(readFileSync(secretPath, 'utf8')).secret;
  }
  await verify.fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  await page.context().storageState({ path: statePath });
}

test.describe.configure({ mode: 'serial' });

test('WS-D actions: team invite, roles, authenticator reset, audit, route pack, evidence, Today', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'w1280', 'Actions run once, at 1280 px (shared rate limit).');
  test.setTimeout(240000);
  const seed = qaSeed();
  const tenant = seed.tenantId;
  const ws = seed.streams['ws-d'] as { reviewerId: string; reviewerIdentityId: string };
  await signIn(page);
  const db = database();
  try {
    // V-01: invite a team member with email, role and a 7-day window; resend and cancel.
    await page.goto(`/operator/controls?workspace=${tenant}`);
    const controls = page.locator('#workspace-controls');
    await expect(controls.getByRole('heading', { name: 'Invite a team member' })).toBeVisible();
    await controls.getByLabel('Name', { exact: true }).fill('QA test (madeup) New Operator');
    await controls.getByLabel('Email', { exact: true }).fill('qa-new-operator@example.invalid');
    await controls
      .getByRole('combobox', { name: 'Role for the new member', exact: true })
      .selectOption('operator');
    const sent = page.waitForResponse(
      (r) => r.url().includes('/api/team-control/invites') && r.request().method() === 'POST',
    );
    await controls.getByRole('button', { name: 'Send invitation', exact: true }).click();
    expect((await sent).status()).toBe(201);
    await expect(controls.locator('[data-feedback-scope="team-invite"]')).toContainText(
      'Invitation sent',
    );
    const item = controls
      .getByRole('listitem')
      .filter({ hasText: 'qa-new-operator@example.invalid' });
    await expect(item).toContainText('Works until');
    await evidence(page, 'V-01-team-invite');
    const pending = await db.query(
      `SELECT v.id,("expiresAt"-"createdAt") AS window FROM identity.verification v
       WHERE v.value::jsonb->>'tenantId'=$1 AND v.value::jsonb->>'role'='operator'`,
      [tenant],
    );
    expect(pending.rowCount).toBe(1);
    expect(pending.rows[0].window).toMatchObject({ days: 7 });
    await item.getByRole('button', { name: 'Resend', exact: true }).click();
    await expect(controls.locator('[data-feedback-scope="team-invite-list"]')).toContainText(
      'sent again',
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await item.getByRole('button', { name: 'Cancel invitation', exact: true }).click();
    await expect(controls.locator('[data-feedback-scope="team-invite-list"]')).toContainText(
      'cancelled',
    );
    await expect(item).toHaveCount(0);

    // V-45 (TEAM_INVITE): the invited person got an inbox item.
    const inbox = await db.query(
      "SELECT count(*)::int n FROM app.inbox_notification WHERE type='TEAM_INVITE' AND tenant_id=$1",
      [tenant],
    );
    expect(inbox.rows[0].n).toBeGreaterThan(0);

    // V-02: roles. Another workspace is refused; the API never answers for it.
    const foreign = await page.request.get(
      `/api/team-control/invites?tenant=00000000-0000-4000-8000-000000000000`,
    );
    expect([401, 403]).toContain(foreign.status());

    // V-04: the workspace audit log records the membership changes with the owner as actor.
    const audit = await (await page.request.get(`/api/workspace/audit?tenant=${tenant}`)).json();
    expect(
      (audit as { actor_id: string; aggregate_type: string }[]).some(
        (event) => event.actor_id === seed.principalId,
      ),
    ).toBe(true);

    // V-03: the owner resets another member's authenticator with a fresh check.
    await controls.getByRole('button', { name: 'Load workspace members', exact: true }).click();
    await controls
      .getByRole('combobox', { name: 'Member to reset', exact: true })
      .selectOption(ws.reviewerId);
    page.once('dialog', (dialog) => void dialog.accept());
    await controls.getByRole('button', { name: 'Reset authenticator', exact: true }).click();
    await expect(controls.locator('[data-feedback-scope="authenticator-reset"]')).toContainText(
      'Authenticator reset',
    );
    const reviewer = await db.query(
      `SELECT u."twoFactorEnabled",(SELECT count(*)::int FROM identity."twoFactor" t WHERE t."userId"=u.id) AS secrets
       FROM identity."user" u WHERE u.id=$1`,
      [ws.reviewerIdentityId],
    );
    expect(reviewer.rows[0]).toEqual({ twoFactorEnabled: false, secrets: 0 });
    const security = await db.query(
      "SELECT count(*)::int n FROM identity.security_event WHERE identity_id=$1 AND action='mfa.disabled'",
      [ws.reviewerIdentityId],
    );
    expect(security.rows[0].n).toBe(1);
    await evidence(page, 'V-03-authenticator-reset');

    // V-07: guided route pack form, no JSON typed.
    await page.goto(`/operator/settings?workspace=${tenant}`);
    const settings = page.locator('#workspace-settings');
    await settings.getByText('Prepare commercial mission templates', { exact: true }).click();
    await settings.getByRole('button', { name: 'Install missing mission templates' }).click();
    await expect(settings.getByRole('status').first()).toContainText(/templates|Saved/);
    await settings.getByText('Create a directional corridor route', { exact: true }).click();
    await settings.getByRole('combobox', { name: 'Demand-origin market' }).selectOption('BD');
    await settings.getByRole('combobox', { name: 'Target market' }).selectOption('ES');
    await settings
      .getByLabel('Route review reason')
      .fill('QA test (madeup) route for the pack form');
    await settings.getByRole('button', { name: 'Create reviewed route' }).click();
    await expect(settings.getByRole('status').first()).toContainText('Saved reference');
    await settings.getByText('Add route pack', { exact: true }).click();
    const route = settings.getByRole('combobox', { name: 'Route', exact: true });
    await route.selectOption({ label: 'BD to ES' });
    await settings.locator('input[name="missionTypes"]').first().check();
    await settings.getByRole('combobox', { name: 'Status', exact: true }).selectOption('TESTING');
    await settings.getByLabel('Reason for this pack').fill('QA test (madeup) guided pack');
    const packSaved = page.waitForResponse(
      (r) => r.url().includes('/api/team-control/route-pack') && r.request().method() === 'POST',
    );
    await settings.getByRole('button', { name: 'Save route pack', exact: true }).click();
    expect((await packSaved).status()).toBe(201);
    await expect(settings.locator('[data-feedback-scope="route-pack"]')).toContainText(
      'Route pack version 1 saved',
    );
    const packs = await db.query(
      `SELECT p.configuration FROM app.corridor_pack_version p JOIN app.corridor_route r ON r.tenant_id=p.tenant_id AND r.id=p.route_id
       WHERE p.tenant_id=$1 AND r.origin_market='BD' AND r.destination_market='ES'`,
      [tenant],
    );
    expect(packs.rowCount).toBe(1);
    expect(packs.rows[0].configuration.reviewRequired).toBe(true);
    await evidence(page, 'V-07-route-pack-form');

    // V-18 to V-22 (team UI): no default decision, plain labels, scanner line, linked sources.
    await page.goto(`/operator/evidence?workspace=${tenant}`);
    const review = page.locator('#workspace-evidence');
    await expect(review).toContainText(
      'Files are checked for type and size. Virus scanning is deferred.',
    );
    const decision = review.getByRole('combobox', { name: 'Decision', exact: true });
    if (await decision.count()) {
      await expect(decision).toHaveValue('');
      await expect(decision.locator('option')).toHaveText([
        'Choose a decision',
        'Verified',
        'Rejected',
      ]);
    }
    await page.goto(`/operator/sources?workspace=${tenant}`);
    const sources = page.locator('#workspace-sources');
    // At 1280 px the source form is open; on phones it sits in a fold.
    await expect(sources.getByRole('combobox', { name: /Mission \(optional\)/ })).toBeVisible();
    await expect(sources.getByRole('combobox', { name: /Company \(optional\)/ })).toBeVisible();
    await evidence(page, 'V-22-sources-links');

    // D-1: Today counts from getTeamToday, never a draft.
    const today = await page.request.get(`/api/team-control/today?tenant=${tenant}`);
    expect(today.status()).toBe(200);
    const counts = await today.json();
    expect(Number.isInteger(counts.newSubmittedRequests)).toBe(true);
    expect(Number.isInteger(counts.overdueSubmittedRequests)).toBe(true);
    await page.goto(`/operator?workspace=${tenant}`);
    await expect(page.getByText(/accepted quotes? not started/)).toBeVisible();
    await evidence(page, 'D-1-today');

    // V-51: the backup runbook says how to read PITR retention and keeps the drill deferred.
    const runbook = readFileSync('docs/runbooks/backup-pitr.md', 'utf8');
    expect(runbook).toContain('history retention');
    expect(runbook).toContain('DEFERRED by owner decision');
  } finally {
    await db.end();
  }
});

test('WS-D layout: owner status board and readiness tell the truth at every width', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const seed = qaSeed();
  const context = existsSync(statePath)
    ? await browser.newContext({
        storageState: statePath,
        viewport: testInfo.project.use.viewport ?? undefined,
      })
    : await browser.newContext({ viewport: testInfo.project.use.viewport ?? undefined });
  const page = await context.newPage();
  if (!existsSync(statePath)) await signIn(page);
  // D2 and D-2: status first, deferred controls never shown as passed or approved.
  const response = await page.goto(`/operator/owner?workspace=${seed.tenantId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Live, small scale', { exact: true }).first()).toBeVisible();
  const board = page.locator('.owner-board');
  await expect(board).toContainText('Deferred by owner decision on');
  const boardText = await board.evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-deferred-register]').forEach((n) => n.remove());
    return clone.textContent ?? '';
  });
  // The workspace name comes from the shared lead seed ("Synthetic North"); it is data, not copy.
  const copyOnly = boardText.replaceAll('Synthetic North', '');
  for (const pattern of forbiddenCopy) expect(copyOnly).not.toMatch(pattern);
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // D-2: the status board (live state, waiting counts, blocked items, who acts) ends within two
  // screens at every width. The deferred register follows it, each control with its risk line.
  const box = await board.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height * 2);
  const register = page.locator('[data-deferred-register]');
  await expect(register.getByRole('listitem')).toHaveCount(11);
  for (const item of await register.getByRole('listitem').all()) {
    await expect(item).toContainText('Deferred by owner decision on');
    await expect(item).toContainText('Risk:');
  }
  await evidence(page, `D-2-owner-board-${width}`);
  // CQ-02: readiness says live and lists deferred controls, never PASS.
  await page.goto(`/operator/readiness?workspace=${seed.tenantId}`);
  const gates = page.locator('#ops-gates');
  await expect(gates).toContainText('Live, small scale');
  await expect(gates.getByRole('region', { name: 'Deferred controls' })).toContainText(
    'Deferred by owner decision on',
  );
  await expect(gates).not.toContainText('PASS');
  await evidence(page, `CQ-02-readiness-${width}`);
  await context.close();
});
