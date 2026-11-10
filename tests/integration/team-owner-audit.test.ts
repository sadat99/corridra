import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture, rawContext } from './support';
import { changeMemberNow } from './change-member';
import { AccessService } from '../../packages/auth/src/access';
import { OperatorSetup } from '../../packages/auth/src/operator-setup';
import { TeamControl } from '../../packages/auth/src/team-control';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';

let f: Awaited<ReturnType<typeof fixture>>;
let team: TeamControl;
beforeAll(async () => {
  f = await fixture();
  await migrateCommercialReadiness(f.owner);
  team = new TeamControl(f.runtime, f.auth);
}, 120000);
afterAll(async () => {
  await f?.close();
});
const invite = () =>
  team.invite(f.users.owner.ctx, {
    commandId: randomUUID(),
    name: 'Owner audit fixture',
    email: `audit-${randomUUID()}@example.invalid`,
    role: 'operator',
  });
const audit = async (target: string) =>
  (
    await f.owner.query(
      'SELECT identity_id,action,actor_id,tenant_id,target_principal_id,reference_id FROM identity.security_event WHERE target_principal_id=$1 ORDER BY recorded_at',
      [target],
    )
  ).rows;

test('resend records its initiating owner and rotated reference exactly once under replay', async () => {
  const original = await invite();
  const results = await Promise.allSettled([
    team.resend(f.users.owner.ctx, { invitationId: original.id }),
    team.resend(f.users.owner.ctx, { invitationId: original.id }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const result = results.find((r) => r.status === 'fulfilled');
  if (result?.status !== 'fulfilled') throw new Error('Resend did not complete');
  expect(result.value.audit).toBe('recorded');
  const rows = await audit(original.principalId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'team.invitation.resent',
    actor_id: f.users.owner.id,
    tenant_id: f.tenantA,
    target_principal_id: original.principalId,
    reference_id: result.value.id,
  });
  const publicText = JSON.stringify(rows);
  expect(publicText).not.toContain('example.invalid');
  expect(publicText).not.toContain(f.users.owner.token);
});

test('reset records the owner alongside retained target MFA/session events', async () => {
  const target = f.users.reviewer;
  await f.owner.query(
    'INSERT INTO identity."twoFactor"(id,"userId",secret,"backupCodes") VALUES($1,$2,$3,$4)',
    [randomUUID(), target.identityId, 'madeup-secret', 'madeup-codes'],
  );
  await expect(
    team.resetAuthenticator(f.users.owner.ctx, { userId: target.id }),
  ).resolves.toMatchObject({ audit: 'recorded', sessionsEnded: 1, reEnrolAtNextSignIn: true });
  expect(await audit(target.id)).toEqual([
    {
      identity_id: target.identityId,
      action: 'team.authenticator.reset',
      actor_id: f.users.owner.id,
      tenant_id: f.tenantA,
      target_principal_id: target.id,
      reference_id: null,
    },
  ]);
  const events = (
    await f.owner.query('SELECT action FROM identity.security_event WHERE identity_id=$1', [
      target.identityId,
    ])
  ).rows.map((r) => r.action);
  expect(events).toEqual(
    expect.arrayContaining(['mfa.disabled', 'session.delete', 'team.authenticator.reset']),
  );
});

test('the narrow writer denies missing, non-owner, cross-workspace and stale authority', async () => {
  const sql = 'SELECT identity.record_team_control($1,$2,$3)';
  const args = ['team.authenticator.reset', f.users.reviewer.id, null];
  await expect(f.auth.query(sql, args)).rejects.toMatchObject({ code: '42501' });
  for (const ctx of [
    f.users.operator.ctx,
    f.users.other.ctx,
    { ...f.users.owner.ctx, tenantId: f.tenantB },
  ])
    await expect(rawContext(f.auth, ctx, sql, args)).rejects.toMatchObject({ code: '42501' });
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  try {
    await expect(rawContext(f.auth, f.users.owner.ctx, sql, args)).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
  }
  expect(await audit(f.users.reviewer.id)).toHaveLength(1);
});

test('the writer rejects self-reset, unsupported operations, active resets and unrelated invitation references', async () => {
  const sql = 'SELECT identity.record_team_control($1,$2,$3)';
  for (const args of [
    ['team.authenticator.reset', f.users.owner.id, null],
    ['team.authenticator.reset', f.users.viewer.id, null],
    ['team.invitation.resent', f.users.reviewer.id, randomUUID()],
    ['anything.else', f.users.reviewer.id, null],
  ])
    await expect(rawContext(f.auth, f.users.owner.ctx, sql, args)).rejects.toMatchObject({
      code: '42501',
    });
});

test('neither runtime nor auth receives a direct security-log write grant, and audit rows remain immutable', async () => {
  const sql = 'SELECT identity.record_team_control($1,$2,$3)';
  await expect(
    rawContext(f.runtime, f.users.owner.ctx, sql, [
      'team.authenticator.reset',
      f.users.reviewer.id,
      null,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.auth.query("INSERT INTO identity.security_event(identity_id,action) VALUES($1,'forged')", [
      f.users.owner.identityId,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.owner.query('UPDATE identity.security_event SET actor_id=$1 WHERE target_principal_id=$2', [
      f.users.other.id,
      f.users.reviewer.id,
    ]),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM identity.security_event WHERE target_principal_id=$1', [
      f.users.reviewer.id,
    ]),
  ).rejects.toThrow();
});

test('an audit failure rolls back invitation rotation and authenticator/session deletion together', async () => {
  const original = await invite();
  const target = f.users.viewer;
  await f.owner
    .query(`CREATE FUNCTION identity.reject_team_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$;
    CREATE TRIGGER reject_team_audit_test BEFORE INSERT ON identity.security_event FOR EACH ROW WHEN (NEW.action LIKE 'team.%') EXECUTE FUNCTION identity.reject_team_audit_test()`);
  try {
    await expect(team.resend(f.users.owner.ctx, { invitationId: original.id })).rejects.toThrow(
      'Injected audit failure',
    );
    expect(
      (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [original.id]))
        .rowCount,
    ).toBe(1);
    await expect(team.resetAuthenticator(f.users.owner.ctx, { userId: target.id })).rejects.toThrow(
      'Injected audit failure',
    );
    expect(
      (
        await f.owner.query('SELECT "twoFactorEnabled" FROM identity."user" WHERE id=$1', [
          target.identityId,
        ])
      ).rows[0].twoFactorEnabled,
    ).toBe(true);
    expect(
      (
        await f.owner.query('SELECT id FROM identity.session WHERE "userId"=$1', [
          target.identityId,
        ])
      ).rowCount,
    ).toBe(1);
    expect(await audit(original.principalId)).toHaveLength(0);
    expect(await audit(target.id)).toHaveLength(0);
  } finally {
    await f.owner.query(
      'DROP TRIGGER reject_team_audit_test ON identity.security_event; DROP FUNCTION identity.reject_team_audit_test()',
    );
  }
});

test('old-schema controls still work and explicitly report unavailable owner attribution', async () => {
  const original = await invite();
  await f.owner.query(
    'ALTER FUNCTION identity.record_team_control(text,uuid,uuid) RENAME TO record_team_control_install_pending',
  );
  try {
    await expect(
      team.resend(f.users.owner.ctx, { invitationId: original.id }),
    ).resolves.toMatchObject({ audit: 'unavailable' });
    await expect(
      team.resetAuthenticator(f.users.owner.ctx, { userId: f.users.viewer.id }),
    ).resolves.toMatchObject({ audit: 'unavailable', reEnrolAtNextSignIn: true });
    expect(await audit(original.principalId)).toHaveLength(0);
  } finally {
    await f.owner.query(
      'ALTER FUNCTION identity.record_team_control_install_pending(text,uuid,uuid) RENAME TO record_team_control',
    );
  }
});

// CRUD G10: migration 0010 replaces the shipped 0006 writer to add the cancel branch. The 0006 text is read from its
// file, so these tests prove the guard against exactly what production installed.
const migrations = new URL('../../packages/db/commercial-readiness-migrations/', import.meta.url);
const file0006 = readFileSync(new URL('0006_team_control_owner_audit.sql', migrations), 'utf8');
const file0010 = readFileSync(new URL('0010_team_invitation_cancel_audit.sql', migrations), 'utf8');
const shipped0006 = file0006
  .slice(file0006.indexOf('CREATE FUNCTION'), file0006.indexOf('END $$;') + 'END $$;'.length)
  .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
const lines0006 = (from: number, to: number) =>
  file0006
    .split('\n')
    .slice(from - 1, to)
    .join('\n');
const fingerprint = /<>'([0-9a-f]{64})'/.exec(file0010)?.[1];
const writer = "to_regprocedure('identity.record_team_control(text,uuid,uuid)')";
const writerHash = `SELECT encode(sha256(convert_to(pg_get_functiondef(${writer}),'UTF8')),'hex') AS hash`;
const writerState = `SELECT p.prosrc,p.proacl::text AS acl,p.prosecdef,
  has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,
  has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth
  FROM pg_proc p WHERE p.oid=${writer}`;

test('migration 0010 is skipped without the writer, replaces only the shipped 0006 text and refuses any other', async () => {
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  const db = await f.owner.connect();
  try {
    // Absent: nothing is created and nothing fails.
    await db.query('BEGIN');
    await db.query(
      'ALTER FUNCTION identity.record_team_control(text,uuid,uuid) RENAME TO record_team_control_install_pending',
    );
    await db.query(file0010);
    expect((await db.query(`SELECT ${writer} AS writer`)).rows[0].writer).toBeNull();
    await db.query('ROLLBACK');

    // The shipped 0006 text: its fingerprint is the one in 0010, and the replacement keeps owner checks, resend and
    // reset checks byte for byte, security definer and grants.
    await db.query('BEGIN');
    await db.query(shipped0006);
    expect((await db.query(writerHash)).rows[0].hash).toBe(fingerprint);
    const before = (await db.query(writerState)).rows[0];
    expect(before.prosrc).not.toContain("'team.invitation.cancelled'");
    await db.query(file0010);
    const after = (await db.query(writerState)).rows[0];
    expect(after.prosrc).toContain("operation='team.invitation.cancelled'");
    expect(after.prosrc).toContain(lines0006(11, 18));
    expect(after.prosrc).toContain(lines0006(19, 35));
    expect(after.prosrc).toContain(lines0006(36, 37));
    expect({
      acl: after.acl,
      prosecdef: after.prosecdef,
      runtime: after.runtime,
      auth: after.auth,
    }).toEqual({
      acl: before.acl,
      prosecdef: true,
      runtime: false,
      auth: true,
    });
    await db.query('ROLLBACK');

    // Any other text, including the already replaced one, is refused and nothing changes.
    for (const changed of [
      null,
      shipped0006.replace("'Renewed team invitation required'", "'Renewed invitation required'"),
    ]) {
      await db.query('BEGIN');
      if (changed) await db.query(changed);
      await expect(db.query(file0010)).rejects.toThrow(
        'Commercial readiness prerequisite differs: identity.record_team_control',
      );
      await db.query('ROLLBACK');
    }
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

test('the installed writer keeps the 0006 resend and reset checks and grants unchanged', async () => {
  const live = (await f.owner.query(writerState)).rows[0];
  expect(live.prosrc).toContain(lines0006(19, 35));
  // Only the owner and corridra_auth may execute it, as 0006 granted.
  expect(live.acl).toMatch(/^\{(\w+)=X\/\1,corridra_auth=X\/\1\}$/);
  expect({ prosecdef: live.prosecdef, runtime: live.runtime, auth: live.auth }).toEqual({
    prosecdef: true,
    runtime: false,
    auth: true,
  });
});

// CRUD G10: cancelling a team invitation (crud-standard D-02 hard delete of the one-use setup row, A-01 and CRUD-6
// history row). The cancel revokes the pending membership, records the cancelling owner and removes the setup row
// together, or changes nothing.
const invitedEmail = () => `cancel-${randomUUID()}@example.invalid`;
const inviteAs = (email: string) =>
  team.invite(f.users.owner.ctx, {
    commandId: randomUUID(),
    name: 'Cancel audit fixture',
    email,
    role: 'operator',
  });
const pendingMember = async (principalId: string) =>
  (
    await f.owner.query(
      'SELECT revoked_at,version FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
      [f.tenantA, principalId],
    )
  ).rows[0];
const membershipEvents = async (principalId: string) =>
  (
    await f.owner.query(
      "SELECT count(*)::int AS n FROM app.domain_event WHERE tenant_id=$1 AND aggregate_type='membership' AND aggregate_id=$2",
      [f.tenantA, principalId],
    )
  ).rows[0].n as number;
const invitationRows = async (id: string) =>
  (await f.owner.query('SELECT id FROM identity.verification WHERE id=$1', [id])).rowCount;
const identityOf = async (principalId: string) =>
  (await f.owner.query('SELECT identity_id FROM identity.principal WHERE id=$1', [principalId]))
    .rows[0].identity_id as string;
const setupProof = (email: string) => ({ email, emailVerified: true as const });

test('cancel records the cancelling owner, pending member, workspace and invitation once in the append-only log (A-01, CRUD-6)', async () => {
  const email = invitedEmail();
  const original = await inviteAs(email);
  const before = await pendingMember(original.principalId);
  const eventsBefore = await membershipEvents(original.principalId);
  await expect(team.cancel(f.users.owner.ctx, { invitationId: original.id })).resolves.toEqual({
    cancelled: true,
    audit: 'recorded',
  });
  const rows = await audit(original.principalId);
  expect(rows).toEqual([
    {
      identity_id: await identityOf(original.principalId),
      action: 'team.invitation.cancelled',
      actor_id: f.users.owner.id,
      tenant_id: f.tenantA,
      target_principal_id: original.principalId,
      reference_id: original.id,
    },
  ]);
  const stored = JSON.stringify(
    (
      await f.owner.query('SELECT * FROM identity.security_event WHERE reference_id=$1', [
        original.id,
      ])
    ).rows,
  );
  expect(stored).not.toContain('example.invalid');
  expect(stored).not.toContain(email);
  expect(stored).not.toContain(f.users.owner.token);
  // The workspace audit log keeps its membership row, and the membership moved on by one version.
  expect(await membershipEvents(original.principalId)).toBe(eventsBefore + 1);
  const after = await pendingMember(original.principalId);
  expect(after.revoked_at).not.toBeNull();
  expect(after.version).toBe(before.version + 1);
  // The history row cannot be rewritten or removed.
  await expect(
    f.owner.query('UPDATE identity.security_event SET actor_id=$1 WHERE reference_id=$2', [
      f.users.other.id,
      original.id,
    ]),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM identity.security_event WHERE reference_id=$1', [original.id]),
  ).rejects.toThrow();
  expect(await audit(original.principalId)).toEqual(rows);
});

test('an expired invitation can be cancelled and is recorded the same way', async () => {
  const original = await invite();
  await f.owner.query(
    `UPDATE identity.verification SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`,
    [original.id],
  );
  await expect(team.cancel(f.users.owner.ctx, { invitationId: original.id })).resolves.toEqual({
    cancelled: true,
    audit: 'recorded',
  });
  expect(await audit(original.principalId)).toMatchObject([
    { action: 'team.invitation.cancelled', actor_id: f.users.owner.id, reference_id: original.id },
  ]);
  expect(await invitationRows(original.id)).toBe(0);
});

test('the writer refuses a cancel record for any reference that is not this member team invitation here', async () => {
  const sql = 'SELECT identity.record_team_control($1,$2,$3)';
  const target = await invite();
  const another = await invite();
  const elsewhere = await team.invite(f.users.other.ctx, {
    commandId: randomUUID(),
    name: 'Other workspace fixture',
    email: invitedEmail(),
    role: 'operator',
  });
  const forged = async (tenantId: string, role: string) => {
    const id = randomUUID();
    await f.owner.query(
      `INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES($1,$2,$3,now()+interval '1 day')`,
      [
        id,
        'corridra-operator-setup:' + randomUUID(),
        JSON.stringify({
          userId: await identityOf(target.principalId),
          principalId: target.principalId,
          tenantId,
          role,
          commandId: randomUUID(),
          approvedBy: f.users.owner.id,
        }),
      ],
    );
    return id;
  };
  const contributorRow = await forged(f.tenantA, 'contributor');
  const otherWorkspaceRow = await forged(f.tenantB, 'operator');
  try {
    for (const args of [
      ['team.invitation.cancelled', target.principalId, randomUUID()],
      ['team.invitation.cancelled', target.principalId, another.id],
      ['team.invitation.cancelled', target.principalId, contributorRow],
      ['team.invitation.cancelled', target.principalId, otherWorkspaceRow],
      ['team.invitation.cancelled', target.principalId, null],
      ['team.invitation.cancelled', elsewhere.principalId, elsewhere.id],
    ])
      await expect(rawContext(f.auth, f.users.owner.ctx, sql, args)).rejects.toMatchObject({
        code: '42501',
      });
  } finally {
    await f.owner.query('DELETE FROM identity.verification WHERE id=ANY($1)', [
      [contributorRow, otherWorkspaceRow],
    ]);
  }
  expect(await audit(target.principalId)).toEqual([]);
  expect(await audit(elsewhere.principalId)).toEqual([]);
});

test('an authenticator check that lapses before the audit write rolls the whole cancel back', async () => {
  const original = await invite();
  const before = await pendingMember(original.principalId);
  // The auth connection ages the owner check just before the writer runs, after the membership was revoked.
  const agingAuth = new Proxy(f.auth, {
    get(target, prop) {
      if (prop === 'connect')
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(inner, key) {
              if (key === 'query')
                return async (text: string, values?: unknown[]) => {
                  if (text.startsWith('SELECT identity.record_team_control'))
                    await f.owner.query(
                      "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
                      [f.users.owner.sessionId],
                    );
                  return inner.query(text, values);
                };
              const value = Reflect.get(inner, key);
              return typeof value === 'function' ? value.bind(inner) : value;
            },
          });
        };
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    await expect(
      new TeamControl(f.runtime, agingAuth).cancel(f.users.owner.ctx, {
        invitationId: original.id,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
  }
  expect(await pendingMember(original.principalId)).toEqual(before);
  expect(await invitationRows(original.id)).toBe(1);
  expect(await audit(original.principalId)).toEqual([]);
});

test('an audit failure leaves the cancel undone and a plain retry completes cancel and audit together', async () => {
  const email = invitedEmail();
  const original = await inviteAs(email);
  const before = await pendingMember(original.principalId);
  const eventsBefore = await membershipEvents(original.principalId);
  const setup = new OperatorSetup(f.auth);
  await f.owner
    .query(`CREATE FUNCTION identity.reject_team_cancel_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$;
    CREATE TRIGGER reject_team_cancel_test BEFORE INSERT ON identity.security_event FOR EACH ROW WHEN (NEW.action='team.invitation.cancelled') EXECUTE FUNCTION identity.reject_team_cancel_test()`);
  try {
    await expect(team.cancel(f.users.owner.ctx, { invitationId: original.id })).rejects.toThrow(
      'Injected audit failure',
    );
    expect(await pendingMember(original.principalId)).toEqual(before);
    expect(await membershipEvents(original.principalId)).toBe(eventsBefore);
    expect(await invitationRows(original.id)).toBe(1);
    await expect(setup.status(setupProof(email))).resolves.toMatchObject({ available: true });
    expect(await audit(original.principalId)).toEqual([]);
  } finally {
    await f.owner.query(
      'DROP TRIGGER reject_team_cancel_test ON identity.security_event; DROP FUNCTION identity.reject_team_cancel_test()',
    );
  }
  await expect(team.cancel(f.users.owner.ctx, { invitationId: original.id })).resolves.toEqual({
    cancelled: true,
    audit: 'recorded',
  });
  expect(await audit(original.principalId)).toHaveLength(1);
  expect((await pendingMember(original.principalId)).revoked_at).not.toBeNull();
  await expect(setup.status(setupProof(email))).resolves.toEqual({ available: false });
});

test('if the workspace commit fails after the audit committed, the link is dead and audited and the owner revokes from the member list', async () => {
  const email = invitedEmail();
  const original = await inviteAs(email);
  const setup = new OperatorSetup(f.auth);
  // A deferred check fails only at the workspace transaction commit, after the auth transaction committed.
  await f.owner
    .query(`CREATE FUNCTION app.fail_membership_commit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected commit failure'; END $$;
    CREATE CONSTRAINT TRIGGER fail_membership_commit_test AFTER UPDATE ON app.membership DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION app.fail_membership_commit_test()`);
  try {
    await expect(team.cancel(f.users.owner.ctx, { invitationId: original.id })).rejects.toThrow(
      'Injected commit failure',
    );
    // The safe direction: the setup link no longer works and the cancel is in the security log. Never a revoked
    // member with a usable link and no record.
    expect(await invitationRows(original.id)).toBe(0);
    await expect(setup.status(setupProof(email))).resolves.toEqual({ available: false });
    expect(await audit(original.principalId)).toMatchObject([
      { action: 'team.invitation.cancelled', reference_id: original.id },
    ]);
    expect((await pendingMember(original.principalId)).revoked_at).toBeNull();
    // A retry finds no invitation.
    await expect(
      team.cancel(f.users.owner.ctx, { invitationId: original.id }),
    ).rejects.toMatchObject({ status: 404, message: 'Invitation not found' });
  } finally {
    await f.owner.query(
      'DROP TRIGGER fail_membership_commit_test ON app.membership; DROP FUNCTION app.fail_membership_commit_test()',
    );
  }
  // Recovery: the owner revokes the pending member from the member list.
  await changeMemberNow(new AccessService(f.runtime), f.users.owner.ctx, {
    userId: original.principalId,
    role: 'operator',
    revoked: true,
  });
  expect((await pendingMember(original.principalId)).revoked_at).not.toBeNull();
  expect(await audit(original.principalId)).toHaveLength(1);
});

test('a repeated cancel, one after another or at the same time, changes and records once', async () => {
  const first = await invite();
  const firstEvents = await membershipEvents(first.principalId);
  await team.cancel(f.users.owner.ctx, { invitationId: first.id });
  await expect(team.cancel(f.users.owner.ctx, { invitationId: first.id })).rejects.toMatchObject({
    status: 404,
    message: 'Invitation not found',
  });
  expect(await audit(first.principalId)).toHaveLength(1);
  expect(await membershipEvents(first.principalId)).toBe(firstEvents + 1);

  const second = await invite();
  const secondEvents = await membershipEvents(second.principalId);
  const results = await Promise.allSettled([
    team.cancel(f.users.owner.ctx, { invitationId: second.id }),
    team.cancel(f.users.owner.ctx, { invitationId: second.id }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find((r) => r.status === 'rejected');
  expect(refused?.status === 'rejected' && refused.reason).toMatchObject({
    status: 404,
    message: 'Invitation not found',
  });
  expect(await audit(second.principalId)).toHaveLength(1);
  expect(await membershipEvents(second.principalId)).toBe(secondEvents + 1);
});

test('before 0010 is installed cancel works as before and reports owner attribution unavailable', async () => {
  const installed = (await f.owner.query(`SELECT pg_get_functiondef(${writer}) AS definition`))
    .rows[0].definition as string;
  const absent = await invite();
  await f.owner.query(
    'ALTER FUNCTION identity.record_team_control(text,uuid,uuid) RENAME TO record_team_control_install_pending',
  );
  try {
    await expect(team.cancel(f.users.owner.ctx, { invitationId: absent.id })).resolves.toEqual({
      cancelled: true,
      audit: 'unavailable',
    });
  } finally {
    await f.owner.query(
      'ALTER FUNCTION identity.record_team_control_install_pending(text,uuid,uuid) RENAME TO record_team_control',
    );
  }
  // 0006 installed without the cancel branch: never "Unsupported team audit operation".
  const only0006 = await invite();
  const resent = await invite();
  await f.owner.query(shipped0006);
  try {
    await expect(team.cancel(f.users.owner.ctx, { invitationId: only0006.id })).resolves.toEqual({
      cancelled: true,
      audit: 'unavailable',
    });
    await expect(
      team.resend(f.users.owner.ctx, { invitationId: resent.id }),
    ).resolves.toMatchObject({ audit: 'recorded' });
  } finally {
    await f.owner.query(installed);
  }
  for (const pending of [absent, only0006]) {
    expect((await pendingMember(pending.principalId)).revoked_at).not.toBeNull();
    expect(await invitationRows(pending.id)).toBe(0);
    expect(await audit(pending.principalId)).toEqual([]);
  }
  const installedNow = await invite();
  await expect(team.cancel(f.users.owner.ctx, { invitationId: installedNow.id })).resolves.toEqual({
    cancelled: true,
    audit: 'recorded',
  });
});
