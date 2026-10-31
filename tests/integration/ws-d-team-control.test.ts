import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture } from './support';
import { TeamControl } from '../../packages/auth/src/team-control';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { OperatorSetup } from '../../packages/auth/src/operator-setup';
import { EvidenceService } from '../../packages/evidence/src/index';
import { NetworkService } from '../../packages/network/src/index';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import {
  DEFERRED_LABEL,
  deferredControls,
  SCANNER_LINE,
} from '../../packages/auth/src/deferred-controls';

// WS-D server rules (commercial readiness program 6.D): team invitations, authenticator reset,
// Today counts, reviewer separation and tenant-scoped source links.
let f: Awaited<ReturnType<typeof fixture>>;
let team: TeamControl;
let evidence: EvidenceService;
beforeAll(async () => {
  f = await fixture();
  await migrateCommercialReadiness(f.owner);
  team = new TeamControl(f.runtime, f.auth);
  evidence = new EvidenceService(
    f.runtime,
    {
      async put() {},
      async get() {
        return new Uint8Array();
      },
    },
    {
      async scan() {
        return { verdict: 'ERROR', engine: 'not-used' };
      },
    },
  );
}, 120000);
afterAll(async () => {
  await f?.close();
});
const refresh = (session: string) =>
  f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [session]);
const stale = (session: string) =>
  f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [session],
  );
const invite = (email: string, role = 'operator') => ({
  commandId: randomUUID(),
  email,
  name: 'Invited team member (madeup)',
  role,
});
const events = async (identityId: string) =>
  (
    await f.owner.query(
      'SELECT action FROM identity.security_event WHERE identity_id=$1 ORDER BY recorded_at',
      [identityId],
    )
  ).rows.map((r) => r.action as string);

test('only the workspace owner with a fresh authenticator check can invite, and other workspaces cannot', async () => {
  for (const actor of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      team.invite(f.users[actor].ctx, invite(`${actor}-denied@example.invalid`)),
    ).rejects.toThrow();
  await expect(
    team.invite({ ...f.users.other.ctx, tenantId: f.tenantA }, invite('cross@example.invalid')),
  ).rejects.toThrow();
  await stale(f.users.owner.sessionId);
  await expect(
    team.invite(f.users.owner.ctx, invite('stale@example.invalid')),
  ).rejects.toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
  await refresh(f.users.owner.sessionId);
  const denied = await f.owner.query(
    "SELECT count(*)::int n FROM identity.\"user\" WHERE email LIKE '%denied@example.invalid' OR email IN ('cross@example.invalid','stale@example.invalid')",
  );
  expect(denied.rows[0].n).toBe(0);
});

test('an invitation creates a pending member, a 7-day setup row and audit events; resend and cancel keep history', async () => {
  const created = await team.invite(f.users.owner.ctx, invite('new.member@example.invalid'));
  expect(created).toMatchObject({ role: 'operator', expiresInDays: 7 });
  const row = (
    await f.owner.query(
      `SELECT "expiresAt"-"createdAt" AS window,value FROM identity.verification WHERE id=$1`,
      [created.id],
    )
  ).rows[0];
  expect(row.window).toMatchObject({ days: 7 });
  const value = JSON.parse(row.value);
  expect(value).toMatchObject({
    tenantId: f.tenantA,
    role: 'operator',
    principalId: created.principalId,
  });
  const membership = (
    await f.owner.query(
      'SELECT role,revoked_at FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
      [f.tenantA, created.principalId],
    )
  ).rows[0];
  expect(membership).toMatchObject({ role: 'operator', revoked_at: null });
  // The membership insert reaches the workspace audit log with the owner as actor.
  const audit = async () =>
    (
      await f.owner.query(
        'SELECT actor_id FROM app.domain_event WHERE tenant_id=$1 AND payload::text LIKE $2',
        [f.tenantA, '%' + created.principalId + '%'],
      )
    ).rows.map((r) => r.actor_id as string);
  expect(await audit()).toContain(f.users.owner.id);
  const auditedBeforeCancel = (await audit()).length;

  // The existing setup flow accepts it unchanged.
  const setup = new OperatorSetup(f.auth);
  await expect(
    setup.status({ email: 'new.member@example.invalid', emailVerified: true }),
  ).resolves.toMatchObject({ available: true, role: 'operator' });

  // Owners and admins list it; another workspace never sees it.
  expect((await team.list(f.users.owner.ctx)).map((i) => i.email)).toContain(
    'new.member@example.invalid',
  );
  expect(await team.list(f.users.other.ctx)).toEqual([]);
  await expect(team.list(f.users.operator.ctx)).rejects.toThrow();

  // Exact email only: an existing sign-in is refused, never merged.
  await expect(team.invite(f.users.owner.ctx, invite('reviewer@example.invalid'))).rejects.toThrow(
    'already has a Corridra team sign-in',
  );

  // Expired invitations show as expired and cannot be set up; resend gives a new 7-day window.
  await f.owner.query(
    `UPDATE identity.verification SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`,
    [created.id],
  );
  expect((await team.list(f.users.owner.ctx)).find((i) => i.id === created.id)?.state).toBe(
    'EXPIRED',
  );
  await expect(
    setup.status({ email: 'new.member@example.invalid', emailVerified: true }),
  ).resolves.toEqual({ available: false });
  await expect(team.resend(f.users.other.ctx, { invitationId: created.id })).rejects.toThrow(
    'Invitation not found',
  );
  const resent = await team.resend(f.users.owner.ctx, { invitationId: created.id });
  expect(resent.id).not.toBe(created.id);
  await expect(
    setup.status({ email: 'new.member@example.invalid', emailVerified: true }),
  ).resolves.toMatchObject({ available: true });

  await team.cancel(f.users.owner.ctx, { invitationId: resent.id });
  expect(
    (
      await f.owner.query(
        'SELECT revoked_at FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
        [f.tenantA, created.principalId],
      )
    ).rows[0].revoked_at,
  ).not.toBeNull();
  await expect(
    setup.status({ email: 'new.member@example.invalid', emailVerified: true }),
  ).resolves.toEqual({ available: false });
  expect((await audit()).length).toBeGreaterThan(auditedBeforeCancel);
});

test('the owner resets another member authenticator with a fresh check; never their own or another workspace', async () => {
  const target = f.users.reviewer;
  await f.owner.query(
    `INSERT INTO identity."twoFactor"(id,"userId",secret,"backupCodes") VALUES($1,$2,'madeup-secret','madeup-codes')`,
    [randomUUID(), target.identityId],
  );
  await expect(
    team.resetAuthenticator(f.users.operator.ctx, { userId: target.id }),
  ).rejects.toThrow();
  await expect(
    team.resetAuthenticator(f.users.owner.ctx, { userId: f.users.owner.id }),
  ).rejects.toThrow('cannot reset your own');
  await expect(
    team.resetAuthenticator(f.users.owner.ctx, { userId: f.users.other.id }),
  ).rejects.toThrow('Member not found');
  await stale(f.users.owner.sessionId);
  await expect(
    team.resetAuthenticator(f.users.owner.ctx, { userId: target.id }),
  ).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  await refresh(f.users.owner.sessionId);
  const result = await team.resetAuthenticator(f.users.owner.ctx, { userId: target.id });
  expect(result).toMatchObject({ reset: true, reEnrolAtNextSignIn: true });
  const user = (
    await f.owner.query(
      `SELECT u."twoFactorEnabled",(SELECT count(*)::int FROM identity."twoFactor" t WHERE t."userId"=u.id) secrets,
        (SELECT count(*)::int FROM identity.session s WHERE s."userId"=u.id) sessions
       FROM identity."user" u WHERE u.id=$1`,
      [target.identityId],
    )
  ).rows[0];
  expect(user).toEqual({ twoFactorEnabled: false, secrets: 0, sessions: 0 });
  // The database triggers record the change in the security log.
  expect(await events(target.identityId)).toEqual(
    expect.arrayContaining(['mfa.disabled', 'session.delete']),
  );
});

test('Today counts only submitted requests and reads with the person own access', async () => {
  const counts = await getTeamToday(f.runtime, f.users.viewer.ctx);
  expect(counts).toMatchObject({ newSubmittedRequests: 0, overdueSubmittedRequests: 0 });
  expect(Array.isArray(counts.unavailable)).toBe(true);
  await expect(
    getTeamToday(f.runtime, { ...f.users.outsider.ctx, tenantId: f.tenantA }),
  ).rejects.toThrow();
  await expect(
    getTeamToday(f.runtime, { ...f.users.other.ctx, tenantId: f.tenantA }),
  ).rejects.toThrow();
});

test('a task creator cannot be its reviewer', async () => {
  const network = new NetworkService(f.runtime, true);
  const now = Date.now();
  await expect(
    network.task(f.users.operator.ctx, {
      id: randomUUID(),
      missionId: randomUUID(),
      kind: 'supplier_research',
      market: 'ES',
      workCountry: 'ES',
      location: 'Madrid office (madeup)',
      language: 'es',
      sector: 'textiles',
      capabilities: ['sourcing'],
      instructions: 'Check three knitwear suppliers (madeup).',
      deadline: new Date(now + 86400000).toISOString(),
      expiresAt: new Date(now + 2 * 86400000).toISOString(),
      evidenceRequired: 'Supplier list',
      effort: 'Two hours',
      dataHandling: 'Internal only',
      cancellationTerms: 'Cancel any time',
      disputeTerms: 'Owner decides',
      reviewerId: f.users.operator.id,
      rewardRuleId: null,
      reason: 'Synthetic reviewer separation check',
    }),
  ).rejects.toThrow('cannot review it');
});

test('a source links only to a mission of the same workspace', async () => {
  const base = {
    kind: 'public_record',
    locator: 'WS-D linked source (madeup)',
    observedAt: new Date().toISOString(),
    classification: 'PUBLIC',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
    aiPolicy: 'DENY',
  };
  await expect(
    evidence.createSource(f.users.operator.ctx, { ...base, missionId: randomUUID() }),
  ).rejects.toThrow('Mission unavailable');
  await expect(
    evidence.createSource(f.users.operator.ctx, { ...base, missionId: 'not-a-reference' }),
  ).rejects.toThrow('Choose the mission or company');
  const plain = await evidence.createSource(f.users.operator.ctx, base);
  const own = await evidence.workspace(f.users.operator.ctx);
  expect(own.sources.some((s: { id: string }) => s.id === plain.id)).toBe(true);
  const other = await evidence.workspace(f.users.other.ctx);
  expect(other.sources.some((s: { id: string }) => s.id === plain.id)).toBe(false);
});

test('the deferred register never calls a control passed or approved', () => {
  expect(DEFERRED_LABEL).toMatch(/^Deferred by owner decision on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  for (const control of deferredControls) {
    expect(control.risk.length).toBeGreaterThan(10);
    expect(`${control.name} ${control.risk}`).not.toMatch(/\b(passed|approved|closed)\b|—/i);
  }
  expect(SCANNER_LINE).toBe('Files are checked for type and size. Virus scanning is deferred.');
});
