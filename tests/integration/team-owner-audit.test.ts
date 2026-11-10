import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture, rawContext } from './support';
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
