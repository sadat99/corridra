import { prepareRealNetworkTask } from './real-network-scenario';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { realNetworkFixture, newInvitation } from './real-network-fixture';
import { NetworkService } from '../../packages/network/src/index';
import { withTenant, type RequestContext } from '../../packages/db/src/index';
let f: Awaited<ReturnType<typeof realNetworkFixture>>;
const reason = 'Reviewed real-work fixture; no external legal approval or payment asserted';
beforeAll(async () => {
  f = await realNetworkFixture();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.close();
});
async function contributor() {
  const input = newInvitation();
  const invited = await f.invitations.command(f.ctx(), input);
  await f.setup.complete(
    { email: input.email, emailVerified: true },
    { password: 'Network-real-work-local-fixture-42!' },
  );
  const identity = (
    await f.owner.query('SELECT identity_id FROM identity.principal WHERE id=$1', [
      invited.principalId,
    ])
  ).rows[0].identity_id;
  const token = randomBytes(32).toString('hex'),
    id = randomUUID();
  // Local RLS assurance fixture only. Browser acceptance exercises actual password/TOTP enrollment.
  await f.owner.query('UPDATE identity."user" SET "twoFactorEnabled"=true WHERE id=$1', [identity]);
  await f.owner.query(
    'INSERT INTO identity.session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 hour\')',
    [id, identity, token],
  );
  await f.owner.query("INSERT INTO identity.assurance VALUES($1,now(),'totp')", [id]);
  return {
    principalId: invited.principalId,
    ctx: {
      token,
      tenantId: f.realTenant,
      purpose: 'commercial_qualification',
    } satisfies RequestContext,
  };
}
test('real invited non-member completes scoped work with independent review and exact reward/reversal', async () => {
  const t = await prepareRealNetworkTask(f, contributor);
  const assigned = await f.network.mine(t.worker.ctx);
  expect(assigned).toHaveLength(1);
  expect(assigned[0].id).toBe(t.id);
  expect(JSON.stringify(assigned)).not.toContain('network-request-owner@business.test');
  await expect(
    withTenant(f.runtime, t.worker.ctx, 'missions.read', (tx) =>
      tx.db.query('SELECT id FROM app.mission WHERE tenant_id=$1', [f.realTenant]),
    ),
  ).rejects.toThrow();
  await expect(
    f.network.event(
      { ...t.worker.ctx, token: f.users.outsider.token },
      {
        commandId: randomUUID(),
        taskId: t.id,
        version: 1,
        action: 'ACCEPT',
        reason,
        details: { kind: 'decision' },
      },
    ),
  ).rejects.toThrow();
  const accept = {
    commandId: randomUUID(),
    taskId: t.id,
    version: 1,
    action: 'ACCEPT',
    reason,
    details: { kind: 'decision' },
  };
  await f.network.event(t.worker.ctx, accept);
  await expect(f.network.event(t.worker.ctx, accept)).resolves.toMatchObject({ duplicate: true });
  await f.network.event(t.worker.ctx, {
    commandId: randomUUID(),
    taskId: t.id,
    version: 2,
    action: 'SUBMIT',
    reason,
    details: {
      kind: 'submission',
      body: 'The disclosed source reports a supply capability; independent capacity remains unverified.',
    },
  });
  await expect(
    f.network.reviewSubmission(f.ctx(), {
      commandId: randomUUID(),
      taskId: t.id,
      version: 3,
      evidenceQuality: 3,
      timeliness: 4,
      rationale: reason,
      reason,
    }),
  ).rejects.toThrow();
  await f.network.reviewSubmission(f.ctx('reviewer'), {
    commandId: randomUUID(),
    taskId: t.id,
    version: 3,
    evidenceQuality: 3,
    timeliness: 4,
    rationale: reason,
    reason,
  });
  await f.network.event(f.ctx('reviewer'), {
    commandId: randomUUID(),
    taskId: t.id,
    version: 4,
    action: 'COMPLETE',
    reason,
    details: { kind: 'decision' },
  });
  const contribution = await f.network.assess(f.ctx('operator'), { taskId: t.id, reason });
  expect(await f.network.assess(f.ctx('operator'), { taskId: t.id, reason })).toEqual(contribution);
  await expect(
    f.network.reward(f.ctx('operator'), {
      commandId: randomUUID(),
      contributionId: contribution.id,
      sourceId: t.sourceId,
      reason,
    }),
  ).rejects.toThrow();
  const reward = await f.network.reward(f.ctx(), {
    commandId: randomUUID(),
    contributionId: contribution.id,
    sourceId: t.sourceId,
    reason,
  });
  expect(
    await f.network.reward(f.ctx(), {
      commandId: randomUUID(),
      contributionId: contribution.id,
      sourceId: t.sourceId,
      reason,
    }),
  ).toMatchObject({ id: reward.id, duplicate: true });
  expect(
    (
      await f.owner.query(
        'SELECT amount_minor::text,currency FROM app.service_ledger WHERE id=$1',
        [reward.id],
      )
    ).rows[0],
  ).toEqual({ amount_minor: '1001', currency: 'EUR' });
  await f.network.profile(f.ctx(), {
    ...t.profile,
    id: randomUUID(),
    version: 2,
    status: 'SUSPENDED',
    reason: 'Suspend reviewed eligibility without removing work history',
  });
  expect(await f.network.mine(t.worker.ctx)).toEqual([]);
  await expect(
    f.network.event(t.worker.ctx, {
      commandId: randomUUID(),
      taskId: t.id,
      version: 5,
      action: 'DISPUTE',
      reason,
      details: { kind: 'decision' },
    }),
  ).rejects.toThrow();
  await new NetworkService(f.runtime, false).reverse(f.ctx(), {
    commandId: randomUUID(),
    ledgerId: reward.id,
    sourceId: t.sourceId,
    reason: 'Exact unreconciled reversal while new Network work is paused',
  });
  expect(
    (
      await f.owner.query(
        'SELECT amount_minor::text,currency FROM app.service_ledger WHERE tenant_id=$1 ORDER BY amount_minor',
        [f.realTenant],
      )
    ).rows,
  ).toEqual([
    { amount_minor: '-1001', currency: 'EUR' },
    { amount_minor: '1001', currency: 'EUR' },
  ]);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.network_event WHERE tenant_id=$1 AND task_id=$2',
        [f.realTenant, t.id],
      )
    ).rows[0].n,
  ).toBe(5);
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.membership WHERE user_id=$1', [
        t.worker.principalId,
      ])
    ).rows[0].n,
  ).toBe(0);
});
