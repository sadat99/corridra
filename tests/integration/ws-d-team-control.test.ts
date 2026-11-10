import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture } from './support';
import { changeMemberNow } from './change-member';
import { AccessService } from '../../packages/auth/src/access';
import { TeamControl } from '../../packages/auth/src/team-control';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { OperatorSetup, setupIdentifier } from '../../packages/auth/src/operator-setup';
import { EvidenceService } from '../../packages/evidence/src/index';
import { NetworkService } from '../../packages/network/src/index';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import * as label from '../../scripts/qa/label-synthetic';
import * as cleanup from '../../scripts/qa/cleanup-qa-records';
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

// CRUD G10: cancelling a team invitation. Owner only with a fresh check, under the workspace lock, never across
// workspaces, and the setup link stops working at once.
const pendingOf = async (principalId: string) =>
  (
    await f.owner.query(
      'SELECT role,revoked_at,version FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
      [f.tenantA, principalId],
    )
  ).rows[0];
const setupRow = async (id: string) =>
  (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [id])).rowCount;
const cancelAudit = async (principalId: string) =>
  (
    await f.owner.query(
      "SELECT reference_id FROM identity.security_event WHERE action='team.invitation.cancelled' AND target_principal_id=$1",
      [principalId],
    )
  ).rows;
const freshInvite = async () => {
  const email = `cancel-${randomUUID()}@example.invalid`;
  const created = await team.invite(f.users.owner.ctx, invite(email));
  return { ...created, email };
};
const notFound = { status: 404, message: 'Invitation not found' };
const waitingOnLocks = async (count: number) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const waiting = (
      await f.owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
      )
    ).rows[0].n as number;
    if (waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${count} sessions waiting on a lock`);
};

test('the owner cancels an invitation: the pending member is revoked, the setup row goes and setup ends', async () => {
  const pending = await freshInvite();
  const before = await pendingOf(pending.principalId);
  await expect(team.cancel(f.users.owner.ctx, { invitationId: pending.id })).resolves.toEqual({
    cancelled: true,
    audit: 'recorded',
  });
  const after = await pendingOf(pending.principalId);
  expect(after.revoked_at).not.toBeNull();
  expect(after.version).toBe(before.version + 1);
  expect(await setupRow(pending.id)).toBe(0);
  expect((await team.list(f.users.owner.ctx)).map((i) => i.id)).not.toContain(pending.id);
  const setup = new OperatorSetup(f.auth);
  const proof = { email: pending.email, emailVerified: true };
  await expect(setup.status(proof)).resolves.toEqual({ available: false });
  await expect(setup.complete(proof, { password: 'madeup-long-password-1' })).rejects.toMatchObject(
    {
      status: 404,
      message: 'No current operator invitation is available for this account.',
    },
  );
});

test('another workspace, other roles, non-members and a contributor invitation cannot cancel and change nothing', async () => {
  const pending = await freshInvite();
  const before = await pendingOf(pending.principalId);
  await expect(team.cancel(f.users.other.ctx, { invitationId: pending.id })).rejects.toMatchObject(
    notFound,
  );
  for (const actor of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      team.cancel(f.users[actor].ctx, { invitationId: pending.id }),
    ).rejects.toMatchObject({ status: 403, message: 'Access denied' });
  for (const ctx of [
    { ...f.users.outsider.ctx, tenantId: f.tenantA },
    { ...f.users.other.ctx, tenantId: f.tenantA },
  ])
    await expect(team.cancel(ctx, { invitationId: pending.id })).rejects.toMatchObject({
      status: 403,
      message: 'Access denied',
    });
  const access = new AccessService(f.runtime);
  const reviewer = { userId: f.users.reviewer.id, revoked: false };
  await changeMemberNow(access, f.users.owner.ctx, { ...reviewer, role: 'admin' });
  try {
    await expect(
      team.cancel(f.users.reviewer.ctx, { invitationId: pending.id }),
    ).rejects.toMatchObject({ status: 403, message: 'Access denied' });
  } finally {
    await changeMemberNow(access, f.users.owner.ctx, { ...reviewer, role: 'reviewer' });
  }
  // An owner whose own membership was revoked is refused like anyone else.
  await changeMemberNow(access, f.users.owner.ctx, {
    userId: f.users.reviewer.id,
    role: 'owner',
    revoked: true,
  });
  try {
    await expect(
      team.cancel(f.users.reviewer.ctx, { invitationId: pending.id }),
    ).rejects.toMatchObject({ status: 403, message: 'Access denied' });
  } finally {
    // Restore in two steps: the change away from owner needs a second active owner.
    await changeMemberNow(access, f.users.owner.ctx, { ...reviewer, role: 'owner' });
    await changeMemberNow(access, f.users.owner.ctx, { ...reviewer, role: 'reviewer' });
  }
  // A contributor invitation for the same member is not a team invitation.
  const contributorRow = randomUUID();
  await f.owner.query(
    `INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES($1,$2,$3,now()+interval '1 day')`,
    [
      contributorRow,
      'corridra-operator-setup:' + randomUUID(),
      JSON.stringify({
        ...JSON.parse(
          (await f.owner.query('SELECT value FROM identity.verification WHERE id=$1', [pending.id]))
            .rows[0].value,
        ),
        role: 'contributor',
      }),
    ],
  );
  try {
    await expect(
      team.cancel(f.users.owner.ctx, { invitationId: contributorRow }),
    ).rejects.toMatchObject(notFound);
    expect(await setupRow(contributorRow)).toBe(1);
  } finally {
    await f.owner.query('DELETE FROM identity.verification WHERE id=$1', [contributorRow]);
  }
  await expect(
    team.cancel(f.users.owner.ctx, { invitationId: randomUUID() }),
  ).rejects.toMatchObject(notFound);
  expect(await pendingOf(pending.principalId)).toEqual(before);
  expect(await setupRow(pending.id)).toBe(1);
  expect(await cancelAudit(pending.principalId)).toEqual([]);
});

test('a stale authenticator check stops cancel before anything is written', async () => {
  const pending = await freshInvite();
  const before = await pendingOf(pending.principalId);
  await stale(f.users.owner.sessionId);
  try {
    await expect(
      team.cancel(f.users.owner.ctx, { invitationId: pending.id }),
    ).rejects.toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
  } finally {
    await refresh(f.users.owner.sessionId);
  }
  expect(await pendingOf(pending.principalId)).toEqual(before);
  expect(await setupRow(pending.id)).toBe(1);
  expect(await cancelAudit(pending.principalId)).toEqual([]);
});

test('cancel and a member change wait for the same workspace lock; the change made on the older version is refused', async () => {
  const pending = await freshInvite();
  const seen = await pendingOf(pending.principalId);
  const access = new AccessService(f.runtime);
  const holder = await f.owner.connect();
  let cancelled: Promise<unknown> | undefined;
  let changed: Promise<unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [f.tenantA]);
    cancelled = team.cancel(f.users.owner.ctx, { invitationId: pending.id });
    await waitingOnLocks(1);
    changed = access.changeMember(f.users.owner.ctx, {
      commandId: randomUUID(),
      userId: pending.principalId,
      role: 'viewer',
      revoked: false,
      expectedVersion: seen.version,
    });
    await waitingOnLocks(2);
  } finally {
    await holder.query('COMMIT');
    holder.release();
  }
  const [cancel, change] = await Promise.allSettled([cancelled, changed]);
  expect(cancel).toMatchObject({ status: 'fulfilled', value: { cancelled: true } });
  expect(change).toMatchObject({
    status: 'rejected',
    reason: { status: 409, message: 'This membership changed; reload and try again' },
  });
  const after = await pendingOf(pending.principalId);
  expect(after).toMatchObject({ role: 'operator', version: seen.version + 1 });
  expect(after.revoked_at).not.toBeNull();
  expect(await cancelAudit(pending.principalId)).toHaveLength(1);
}, 15000);

test('cancel and an authenticator reset on the same pending member both settle and never wait on each other', async () => {
  const pending = await freshInvite();
  // The holder plays the reset: it locks the member principal, then reads the member's membership with a share
  // lock, as the reset writer does. The lock timeout turns a wait on the cancel into a failure, not a hang.
  const holder = await f.owner.connect();
  let cancelled: Promise<unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query("SET LOCAL lock_timeout='3s'");
    await holder.query('SELECT 1 FROM identity.principal WHERE id=$1 FOR UPDATE', [
      pending.principalId,
    ]);
    cancelled = team.cancel(f.users.owner.ctx, { invitationId: pending.id });
    await waitingOnLocks(1);
    await expect(
      holder.query(
        'SELECT 1 FROM app.membership WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE',
        [f.tenantA, pending.principalId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await holder.query('COMMIT');
  } catch (error) {
    await holder.query('ROLLBACK');
    throw error;
  } finally {
    holder.release();
    await cancelled?.catch(() => undefined);
  }
  await expect(cancelled).resolves.toEqual({ cancelled: true, audit: 'recorded' });
  expect((await pendingOf(pending.principalId)).revoked_at).not.toBeNull();
  expect(await cancelAudit(pending.principalId)).toHaveLength(1);
}, 15000);

test('cancel after setup is complete finds no invitation and leaves the member active', async () => {
  const pending = await freshInvite();
  const setup = new OperatorSetup(f.auth);
  await setup.complete(
    { email: pending.email, emailVerified: true },
    { password: 'madeup-long-password-2' },
  );
  const before = await pendingOf(pending.principalId);
  await expect(team.cancel(f.users.owner.ctx, { invitationId: pending.id })).rejects.toMatchObject(
    notFound,
  );
  expect(await pendingOf(pending.principalId)).toEqual(before);
  expect(before.revoked_at).toBeNull();
  expect(await cancelAudit(pending.principalId)).toEqual([]);
}, 15000);

test('setup and cancel racing on one invitation end with exactly one of them done', async () => {
  const pending = await freshInvite();
  const setup = new OperatorSetup(f.auth);
  const holder = await f.owner.connect();
  let completed: Promise<unknown> | undefined;
  let cancelled: Promise<unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM identity.verification WHERE id=$1 FOR UPDATE', [pending.id]);
    completed = setup.complete(
      { email: pending.email, emailVerified: true },
      { password: 'madeup-long-password-3' },
    );
    cancelled = team.cancel(f.users.owner.ctx, { invitationId: pending.id });
    await waitingOnLocks(2);
  } finally {
    await holder.query('COMMIT');
    holder.release();
  }
  const results = await Promise.allSettled([completed, cancelled]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await setupRow(pending.id)).toBe(0);
  const member = await pendingOf(pending.principalId);
  const audited = await cancelAudit(pending.principalId);
  if (results[1].status === 'fulfilled') {
    expect(member.revoked_at).not.toBeNull();
    expect(audited).toHaveLength(1);
  } else {
    expect(results[1].reason).toMatchObject(notFound);
    expect(member.revoked_at).toBeNull();
    expect(audited).toEqual([]);
  }
}, 15000);

test('cancel never waits on the setup identifier lock, and racing with resend both settle', async () => {
  const pending = await freshInvite();
  const holder = await f.owner.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      setupIdentifier(pending.email),
    ]);
    await expect(
      team.cancel(f.users.owner.ctx, { invitationId: pending.id }),
    ).resolves.toMatchObject({ cancelled: true });
  } finally {
    await holder.query('COMMIT');
    holder.release();
  }
  const raced = await freshInvite();
  const results = await Promise.allSettled([
    team.resend(f.users.owner.ctx, { invitationId: raced.id }),
    team.cancel(f.users.owner.ctx, { invitationId: raced.id }),
  ]);
  // Exactly one wins cleanly. The loser finds no invitation.
  const [resent, cancelled] = results;
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await setupRow(raced.id)).toBe(0);
  const member = await pendingOf(raced.principalId);
  if (resent.status === 'fulfilled') {
    expect(cancelled.status === 'rejected' && cancelled.reason).toMatchObject(notFound);
    expect(member.revoked_at).toBeNull();
    expect(await setupRow(resent.value.id)).toBe(1);
    expect(await cancelAudit(raced.principalId)).toEqual([]);
  } else {
    expect(resent.reason).toMatchObject(notFound);
    expect(cancelled).toMatchObject({ status: 'fulfilled', value: { cancelled: true } });
    expect(member.revoked_at).not.toBeNull();
    expect(await cancelAudit(raced.principalId)).toEqual([{ reference_id: raced.id }]);
  }
}, 15000);

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

const forbidden = new RegExp('\\b(passed|approved|closed)\\b|' + String.fromCharCode(0x2014), 'i');
test('the deferred register never calls a control passed or approved', () => {
  expect(DEFERRED_LABEL).toMatch(/^Deferred by owner decision on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  for (const control of deferredControls) {
    expect(control.risk.length).toBeGreaterThan(10);
    expect(`${control.name} ${control.risk}`).not.toMatch(forbidden);
  }
  expect(SCANNER_LINE).toBe('Files are checked for type and size. Virus scanning is deferred.');
});

test('the QA data scripts need an explicit connection, default to a dry run and never delete', async () => {
  for (const parse of [label.parseArgs, cleanup.parseArgs]) {
    expect(() => parse([])).toThrow('--connection');
    expect(() => parse(['--connection', 'x', '--apply'])).toThrow('--confirm-production');
    expect(parse(['--connection', 'x'])).toMatchObject({ apply: false });
  }
  expect(() => cleanup.parseArgs(['--connection', 'x', '--apply', '--confirm-production'])).toThrow(
    '--actor',
  );
  const before = (await f.owner.query('SELECT count(*)::int n FROM app.organisation')).rows[0].n;
  const labels = await label.plan(f.owner);
  expect(Array.isArray(labels.organisations)).toBe(true);
  const found = await cleanup.plan(f.owner);
  expect(Object.keys(found).sort()).toEqual(
    ['claims', 'evidence', 'links', 'missions', 'programmes', 'publications'].sort(),
  );
  expect((await f.owner.query('SELECT count(*)::int n FROM app.organisation')).rows[0].n).toBe(
    before,
  );
  for (const file of ['scripts/qa/label-synthetic.ts', 'scripts/qa/cleanup-qa-records.ts']) {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s/i);
    expect(text).not.toMatch(/process\.env\.(DATABASE|PG)/);
  }
});
