import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture } from './support';
import {
  inviteOperator,
  prepareFirstHumanOwner,
} from '../../packages/auth/src/operator-invitation';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { OperatorSetup, setupIdentifier } from '../../packages/auth/src/operator-setup';
import { createIdentity } from '../../packages/auth/src/index';
let f: Awaited<ReturnType<typeof fixture>>, service: OperatorSetup;
beforeAll(async () => {
  f = await fixture();
  service = new OperatorSetup(f.auth);
});
afterAll(async () => {
  await f?.close();
});
const invitation = (email: string) => ({
  commandId: randomUUID(),
  email,
  name: 'Invited synthetic operator',
  role: 'owner',
  operatingCountry: 'BD',
});
test('only a fresh active owner can prepare staff access; existing identities cannot be reset', async () => {
  for (const actor of ['operator', 'reviewer', 'viewer', 'other'] as const)
    await expect(
      inviteOperator(
        f.owner,
        { ...f.users[actor].ctx, tenantId: f.tenantA },
        invitation('denied@example.invalid'),
      ),
    ).rejects.toThrow('owner');
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(
    inviteOperator(f.owner, f.users.owner.ctx, invitation('stale@example.invalid')),
  ).rejects.toThrow('fresh MFA');
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.owner.sessionId,
  ]);
  const input = invitation('prepared@example.invalid');
  await expect(inviteOperator(f.owner, f.users.owner.ctx, input)).resolves.toMatchObject({
    prepared: true,
    requiresAuthenticator: true,
  });
  await expect(inviteOperator(f.owner, f.users.owner.ctx, input)).rejects.toThrow('already exists');
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.audit_event WHERE tenant_id=$1 AND action='membership.insert'",
        [f.tenantA],
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
});
test('email equality without an invitation or verified provider session never grants access', async () => {
  await expect(
    service.status({ email: 'unknown@example.invalid', emailVerified: true }),
  ).resolves.toEqual({ available: false });
  await expect(
    service.complete(
      { email: 'unknown@example.invalid', emailVerified: true },
      { password: 'A separate test password 2026!' },
    ),
  ).rejects.toThrow('No current');
  await expect(
    service.complete(
      { email: 'prepared@example.invalid', emailVerified: false },
      { password: 'A separate test password 2026!' },
    ),
  ).rejects.toThrow();
});
test('one-time setup consumes the exact invitation and still requires separate authenticator verification', async () => {
  const email = 'first-setup@example.invalid',
    password = 'A private operator test password 2026!';
  await inviteOperator(f.owner, f.users.owner.ctx, invitation(email));
  expect(await service.status({ email, emailVerified: true })).toMatchObject({
    available: true,
    role: 'owner',
  });
  const user = (
    await f.owner.query(
      'SELECT u.id,p.id principal,p.disabled_at FROM identity."user" u JOIN identity.principal p ON p.identity_id=u.id WHERE u.email=$1',
      [email],
    )
  ).rows[0];
  expect(user.disabled_at).not.toBeNull();
  await service.complete({ email, emailVerified: true }, { password });
  await expect(
    service.complete(
      { email, emailVerified: true },
      { password: 'Different operator password 2026!' },
    ),
  ).rejects.toThrow('No current');
  expect(await service.status({ email, emailVerified: true })).toEqual({ available: false });
  const identity = createIdentity({
    pool: f.auth as never,
    secret: 'operator-setup-integration-secret-2026-strong',
    baseURL: 'http://localhost:3700',
  });
  const response = await identity.auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  const session = await response.json();
  expect(session.token).toBeTruthy();
  const { AccessService } = await import('../../packages/auth/src/access');
  expect(await new AccessService(f.runtime).tenants(session.token)).toEqual([]);
  expect(
    (
      await f.owner.query('SELECT "twoFactorEnabled" enabled FROM identity."user" WHERE id=$1', [
        user.id,
      ])
    ).rows[0].enabled,
  ).toBe(false);
  const membership = (
    await f.owner.query(
      'SELECT role,allowed_countries FROM app.membership WHERE user_id=$1 AND tenant_id=$2',
      [user.principal, f.tenantA],
    )
  ).rows[0];
  expect(membership).toMatchObject({ role: 'owner', allowed_countries: ['BD'] });
});
test('expired invitations and weak passwords do not activate a principal', async () => {
  const email = 'expired-setup@example.invalid';
  await inviteOperator(f.owner, f.users.owner.ctx, invitation(email));
  await expect(
    service.complete({ email, emailVerified: true }, { password: 'short' }),
  ).rejects.toThrow();
  await f.owner.query(
    'UPDATE identity.verification SET "expiresAt"=now()-interval \'1 minute\' WHERE identifier=$1',
    [setupIdentifier(email)],
  );
  expect(await service.status({ email, emailVerified: true })).toEqual({ available: false });
  await expect(
    service.complete(
      { email, emailVerified: true },
      { password: 'A separate long password 2026!' },
    ),
  ).rejects.toThrow('No current');
  const suspended = 'suspended-setup@example.invalid';
  await inviteOperator(f.owner, f.users.owner.ctx, invitation(suspended));
  await f.owner.query(
    `UPDATE identity.principal SET disabled_at=now()+interval '1 second' WHERE identity_id=(SELECT id FROM identity."user" WHERE email=$1)`,
    [suspended],
  );
  await expect(
    service.complete(
      { email: suspended, emailVerified: true },
      { password: 'A separate long operator password 2026!' },
    ),
  ).rejects.toThrow('cannot reset');
});
test('first-human-owner bootstrap is offline, exact-workspace, independently verified and once only', async () => {
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await f.owner.query('CREATE SCHEMA neon_auth');
  await f.owner.query(
    'CREATE TABLE neon_auth."user"(email text PRIMARY KEY,"emailVerified" boolean NOT NULL)',
  );
  await f.owner.query(
    "INSERT INTO neon_auth.\"user\" VALUES('founder@staff.example',true),('unverified@staff.example',false),('second@staff.example',true)",
  );
  const input = {
    commandId: randomUUID(),
    email: 'founder@staff.example',
    name: 'Synthetic founder',
    operatingCountry: 'BD',
    tenantId: f.tenantA,
    approvalReference: 'owner-request-test-2026',
  };
  await expect(prepareFirstHumanOwner(f.auth, input)).rejects.toThrow('schema-owner');
  await expect(prepareFirstHumanOwner(f.owner, { ...input, tenantId: f.tenantB })).rejects.toThrow(
    'Exact live',
  );
  await expect(
    prepareFirstHumanOwner(f.owner, { ...input, email: 'unverified@staff.example' }),
  ).rejects.toThrow('independently verified');
  const before = (
    await f.owner.query(
      "SELECT user_id FROM app.membership WHERE tenant_id=$1 AND role='owner' ORDER BY user_id",
      [f.tenantA],
    )
  ).rows.map((r) => r.user_id);
  await expect(prepareFirstHumanOwner(f.owner, input)).resolves.toMatchObject({
    prepared: true,
    role: 'owner',
    existingOwnersPreserved: true,
  });
  const after = (
    await f.owner.query(
      "SELECT user_id FROM app.membership WHERE tenant_id=$1 AND role='owner' ORDER BY user_id",
      [f.tenantA],
    )
  ).rows.map((r) => r.user_id);
  expect(after.length).toBe(before.length + 1);
  expect(before.every((id) => after.includes(id))).toBe(true);
  await expect(
    prepareFirstHumanOwner(f.owner, {
      ...input,
      commandId: randomUUID(),
      email: 'second@staff.example',
    }),
  ).rejects.toThrow('already existed');
  expect(await service.status({ email: input.email, emailVerified: true })).toMatchObject({
    available: true,
    role: 'owner',
  });
});
