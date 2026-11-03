import { randomUUID } from 'node:crypto';
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
