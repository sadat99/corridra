import { afterAll, beforeAll, expect, test } from 'vitest';
import { realNetworkFixture, newInvitation } from './real-network-fixture';
import { configureNetworkRealUse } from '../../packages/auth/src/network-real-use-configuration';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { NetworkInvitations } from '../../packages/auth/src/network-invitations';
import { NetworkService } from '../../packages/network/src/index';
import { AccessService } from '../../packages/auth/src/access';
import { withTenant } from '../../packages/db/src/index';
let f: Awaited<ReturnType<typeof realNetworkFixture>>;
const reason = 'Owner approved real Network control with preserved authority and exact history';
beforeAll(async () => {
  f = await realNetworkFixture();
});
afterAll(async () => {
  await f?.close();
});
test('offline activation is idempotent, restricted roles cannot configure, and pause preserves records', async () => {
  const before = (
    await f.owner.query('SELECT * FROM network_real_use_migrations.applied ORDER BY name')
  ).rows;
  await migrateNetworkRealUse(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM network_real_use_migrations.applied ORDER BY name')).rows,
  ).toEqual(before);
  await expect(configureNetworkRealUse(f.runtime, { enabled: false, reason })).rejects.toThrow();
  await expect(configureNetworkRealUse(f.auth, { enabled: false, reason })).rejects.toThrow();
  expect(await configureNetworkRealUse(f.owner, { enabled: true, reason })).toEqual({
    enabled: true,
    changed: false,
  });
  const pending = await f.invitations.command(f.ctx(), newInvitation());
  expect(await configureNetworkRealUse(f.owner, { enabled: false, reason })).toEqual({
    enabled: false,
    changed: true,
  });
  expect((await f.network.workspace(f.ctx())).enabled).toBe(false);
  await expect(f.invitations.command(f.ctx(), newInvitation())).rejects.toThrow();
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.network_invitation WHERE id=$1', [
        pending.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect(await configureNetworkRealUse(f.owner, { enabled: true, reason })).toEqual({
    enabled: true,
    changed: true,
  });
  expect(
    (
      await f.owner.query(
        "SELECT version,value->>'enabled' enabled FROM app.config_version WHERE tenant_id=$1 AND key='network.enabled' ORDER BY version",
        [f.realTenant],
      )
    ).rows.map((x) => x.enabled),
  ).toEqual(['true', 'false', 'true']);
});
test('disabled environment gate blocks new work while pending invitations can still be cancelled', async () => {
  const pending = await f.invitations.command(f.ctx(), newInvitation());
  const closed = new NetworkInvitations(f.auth, false);
  expect((await closed.list(f.ctx())).enabled).toBe(false);
  await expect(closed.command(f.ctx(), newInvitation())).rejects.toThrow('disabled');
  await expect(
    closed.command(f.ctx(), {
      action: 'revoke',
      commandId: crypto.randomUUID(),
      invitationId: pending.id,
      reason: 'Cancel pending setup while Network is paused',
    }),
  ).resolves.toMatchObject({ revoked: true });
  const network = new NetworkService(f.runtime, false);
  expect(() => network.profile(f.ctx(), {})).toThrow('disabled');
  expect(() => network.rule(f.ctx(), {})).toThrow('disabled');
  expect(() => network.task(f.ctx(), {})).toThrow('disabled');
});
test('real Network activation does not enable real AI inference or repin original authority', async () => {
  const original = (
    await f.owner.query('SELECT issuer,executor_id FROM customer_private.configuration')
  ).rows;
  await new AccessService(f.runtime).appendConfig(f.ctx(), { key: 'ai.enabled', enabled: true });
  const flags = await withTenant(f.runtime, f.ctx(), 'trust.write', (t) =>
    t.db.query(
      "SELECT app.part4_enabled($1,'network.enabled') network,app.part4_enabled($1,'ai.enabled') ai",
      [f.realTenant],
    ),
  );
  expect(flags.rows[0]).toEqual({ network: true, ai: false });
  expect(
    (await f.owner.query('SELECT issuer,executor_id FROM customer_private.configuration')).rows,
  ).toEqual(original);
  expect((await f.network.workspace(f.ctx())).purpose).toBe('commercial_qualification');
});
test('optional real migration preserves separately controlled synthetic Network scope', async () => {
  const ctx = f.users.owner.ctx;
  await new AccessService(f.runtime).appendConfig(ctx, { key: 'network.enabled', enabled: true });
  await new AccessService(f.runtime).appendConfig(ctx, { key: 'ai.enabled', enabled: true });
  expect((await f.network.workspace(ctx)).purpose).toBe('synthetic_validation');
  const flags = await withTenant(f.runtime, ctx, 'trust.write', (t) =>
    t.db.query(
      "SELECT app.part4_enabled($1,'network.enabled') network,app.part4_enabled($1,'ai.enabled') ai",
      [ctx.tenantId],
    ),
  );
  expect(flags.rows[0]).toEqual({ network: true, ai: true });
  const input = { ...newInvitation(), email: `synthetic-${crypto.randomUUID()}@example.invalid` };
  const invitation = await f.invitations.command(ctx, input);
  expect(invitation.setupRequired).toBe(true);
  expect((await f.setup.status({ email: input.email, emailVerified: true })).workspaceId).toBe(
    f.tenantA,
  );
  const realList = await f.invitations.list(f.ctx());
  expect(realList.invitations.some((i: { id: string }) => i.id === invitation.id)).toBe(false);
  await expect(
    f.network.workspace({ ...ctx, purpose: 'commercial_qualification' }),
  ).rejects.toThrow();
});
