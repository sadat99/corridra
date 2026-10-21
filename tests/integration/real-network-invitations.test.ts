import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { realNetworkFixture, newInvitation } from './real-network-fixture';
import { withTenant, sessionHash } from '../../packages/db/src/index';

let f: Awaited<ReturnType<typeof realNetworkFixture>>;
beforeAll(async () => {
  f = await realNetworkFixture();
});
afterAll(async () => {
  await f?.close();
});

test('reviewed real invitation creates disabled identity, verified setup and no membership', async () => {
  const input = newInvitation();
  const result = await f.invitations.command(f.ctx(), input);
  expect(result.setupRequired).toBe(true);
  const principal = (
    await f.owner.query('SELECT identity_id,disabled_at FROM identity.principal WHERE id=$1', [
      result.principalId,
    ])
  ).rows[0];
  expect(principal.disabled_at).not.toBeNull();
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.membership WHERE user_id=$1', [
        result.principalId,
      ])
    ).rows[0].n,
  ).toBe(0);
  await expect(f.setup.status({ email: input.email, emailVerified: false })).rejects.toThrow();
  await expect(
    f.setup.status({ email: 'somebody-else@business.test', emailVerified: true }),
  ).resolves.toEqual({ available: false });
  await expect(f.setup.status({ email: input.email, emailVerified: true })).resolves.toMatchObject({
    available: true,
    role: 'contributor',
    workspaceId: f.realTenant,
  });
  await expect(
    f.setup.complete(
      { email: input.email, emailVerified: true },
      { password: 'Reviewed-contributor-password-42!' },
    ),
  ).resolves.toMatchObject({
    completed: true,
    role: 'contributor',
    requiresAuthenticator: true,
    workspaceId: f.realTenant,
  });
  const user = (
    await f.owner.query(
      'SELECT "emailVerified","twoFactorEnabled" FROM identity."user" WHERE id=$1',
      [principal.identity_id],
    )
  ).rows[0];
  expect(user).toEqual({ emailVerified: true, twoFactorEnabled: false });
  expect(
    (
      await f.owner.query('SELECT disabled_at FROM identity.principal WHERE id=$1', [
        result.principalId,
      ])
    ).rows[0].disabled_at,
  ).toBeNull();
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.membership WHERE user_id=$1', [
        result.principalId,
      ])
    ).rows[0].n,
  ).toBe(0);
  await expect(
    f.setup.complete(
      { email: input.email, emailVerified: true },
      { password: 'Cannot-reset-an-accepted-identity-42!' },
    ),
  ).rejects.toThrow();
});

test('exact retry preserves one identity and changed invitation command is denied', async () => {
  const input = newInvitation();
  const first = await f.invitations.command(f.ctx(), input);
  const second = await f.invitations.command(f.ctx(), input);
  expect(second).toMatchObject({ principalId: first.principalId, duplicate: true });
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM identity."user" WHERE email=$1', [
        input.email,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(
    f.invitations.command(f.ctx(), { ...input, name: 'Changed person' }),
  ).rejects.toThrow();
});

test('operator, viewer, wrong workspace and out-of-country invitation attempts are denied', async () => {
  for (const role of ['operator', 'reviewer', 'viewer', 'other'])
    await expect(f.invitations.command(f.ctx(role), newInvitation())).rejects.toThrow();
  await expect(
    f.invitations.command(f.ctx(), { ...newInvitation(), operatingCountry: 'AF' }),
  ).rejects.toThrow();
  await expect(
    f.invitations.command(f.ctx(), { ...newInvitation(), email: 'synthetic@example.invalid' }),
  ).rejects.toThrow();
});

test('runtime role cannot invoke privileged invitation creation or insert invitation records', async () => {
  await expect(
    f.runtime.query('SELECT identity.network_invitation_command($1,$2,$3::jsonb,$4)', [
      '0'.repeat(64),
      f.realTenant,
      JSON.stringify(newInvitation()),
      'x'.repeat(128),
    ]),
  ).rejects.toThrow();
  await expect(
    withTenant(f.runtime, f.ctx(), 'missions.read', (t) =>
      t.db.query(
        "INSERT INTO app.network_invitation(id,tenant_id,principal_id,setup_required,input_hash,expires_at,created_by) VALUES($1,$2,$3,false,$4,now()+interval '1 day',$3)",
        [randomUUID(), f.realTenant, f.users.owner.id, 'forged'],
      ),
    ),
  ).rejects.toThrow();
});

test('revocation and expiry prevent accepting pending setup without deleting invitation history', async () => {
  const input = newInvitation();
  const invited = await f.invitations.command(f.ctx(), input);
  const revoke = {
    action: 'revoke',
    commandId: randomUUID(),
    invitationId: invited.id,
    reason: 'Owner withdrew this pending invitation',
  };
  await expect(f.invitations.command(f.ctx(), revoke)).resolves.toMatchObject({ revoked: true });
  await expect(f.invitations.command(f.ctx(), revoke)).resolves.toMatchObject({
    revoked: true,
    duplicate: true,
  });
  await expect(f.setup.status({ email: input.email, emailVerified: true })).resolves.toEqual({
    available: false,
  });
  await expect(
    f.setup.complete(
      { email: input.email, emailVerified: true },
      { password: 'Cannot-accept-revoked-invitation-42!' },
    ),
  ).rejects.toThrow();
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.network_invitation WHERE id=$1', [
        invited.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(
    f.owner.query('DELETE FROM app.network_invitation WHERE id=$1', [invited.id]),
  ).rejects.toThrow();
  const expired = newInvitation();
  const pending = await f.invitations.command(f.ctx(), expired);
  await f.owner.query(
    'UPDATE identity.verification SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1',
    [pending.id],
  );
  await expect(f.setup.status({ email: expired.email, emailVerified: true })).resolves.toEqual({
    available: false,
  });
  await expect(
    f.setup.complete(
      { email: expired.email, emailVerified: true },
      { password: 'Cannot-accept-expired-invitation-42!' },
    ),
  ).rejects.toThrow();
});

test('stale MFA denies invitations and an existing identity is referenced without reset or membership', async () => {
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '20 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  try {
    await expect(f.invitations.command(f.ctx(), newInvitation())).rejects.toThrow();
  } finally {
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
  }
  const before = (
    await f.owner.query('SELECT count(*)::int n FROM app.membership WHERE user_id=$1', [
      f.users.operator.id,
    ])
  ).rows[0].n;
  const email = (
    await f.owner.query('SELECT email FROM identity."user" WHERE id=$1', [
      f.users.operator.identityId,
    ])
  ).rows[0].email;
  // Existing fixture identities use reserved addresses; create an active real-contact identity without replacing it.
  await f.owner.query('UPDATE identity."user" SET email=$2 WHERE id=$1', [
    f.users.operator.identityId,
    'existing-network-worker@business.test',
  ]);
  try {
    const result = await f.invitations.command(f.ctx(), {
      ...newInvitation(),
      email: 'existing-network-worker@business.test',
    });
    expect(result).toMatchObject({ principalId: f.users.operator.id, setupRequired: false });
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.membership WHERE user_id=$1', [
          f.users.operator.id,
        ])
      ).rows[0].n,
    ).toBe(before);
    await expect(
      f.setup.status({ email: 'existing-network-worker@business.test', emailVerified: true }),
    ).resolves.toEqual({ available: false });
  } finally {
    await f.owner.query('UPDATE identity."user" SET email=$2 WHERE id=$1', [
      f.users.operator.identityId,
      email,
    ]);
  }
});

test('invitation pages preserve scope and do not repeat or lose rows when a new invitation arrives', async () => {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','commercial_qualification',true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$3,true)",
      [sessionHash(f.users.owner.token), f.realTenant, randomUUID()],
    );
    await db.query(
      `INSERT INTO app.network_invitation(id,tenant_id,principal_id,setup_required,input_hash,expires_at,created_by,created_at)
      SELECT gen_random_uuid(),$1,$2,false,'pagination fixture',now()+interval '1 day',$3,clock_timestamp()-n*interval '1 second' FROM generate_series(1,105) n`,
      [f.realTenant, f.users.operator.id, f.users.owner.id],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  const expected = (
    await f.owner.query('SELECT id FROM app.network_invitation WHERE tenant_id=$1', [f.realTenant])
  ).rows.map((x) => x.id);
  const first = await f.invitations.list(f.ctx());
  expect(first.invitations).toHaveLength(100);
  expect(first.countries.some((c: { code: string }) => c.code === 'DE')).toBe(true);
  expect(first.next).not.toBeNull();
  const added = await f.invitations.command(f.ctx(), newInvitation());
  const second = await f.invitations.list(f.ctx(), JSON.stringify(first.next));
  const ids = [...first.invitations, ...second.invitations].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(ids)).toEqual(new Set(expected));
  expect(ids).not.toContain(added.id);
  expect(second.next).toBeNull();
  await expect(f.invitations.list(f.ctx('viewer'))).rejects.toThrow();
  await expect(f.invitations.list(f.ctx('other'))).rejects.toThrow();
  await expect(
    f.invitations.list(f.ctx(), JSON.stringify({ createdAt: 'not-a-date', id: randomUUID() })),
  ).rejects.toThrow();
});
