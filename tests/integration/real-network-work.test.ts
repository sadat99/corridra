import { prepareRealNetworkTask } from './real-network-scenario';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { InboxService } from '../../packages/communications/src/inbox';
import { rawContext } from './support';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { realNetworkFixture, newInvitation } from './real-network-fixture';
import { NetworkService } from '../../packages/network/src/index';
import { withTenant, type RequestContext } from '../../packages/db/src/index';
let f: Awaited<ReturnType<typeof realNetworkFixture>>;
const reason = 'Reviewed real-work fixture; no external legal approval or payment asserted';
beforeEach(async () => {
  f = await realNetworkFixture();
  await migrateCommercialReadiness(f.owner);
  const inbox = new InboxService(f.runtime);
  f.network = new NetworkService(f.runtime, true, async (db, commandId) => {
    const receipt = await inbox.recordTaskAssigned(db, commandId);
    return async () => {
      expect(
        (await f.owner.query('SELECT id FROM app.inbox_notification WHERE id=$1', [receipt.id]))
          .rowCount,
      ).toBe(1);
    };
  });
});
afterEach(async () => {
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

test('GAP-017 actual assignment produces only its non-member contributor inbox and replay keeps one row', async () => {
  const t = await prepareRealNetworkTask(f, contributor);
  const e = (
    await f.owner.query(
      "SELECT id,reason,details FROM app.network_event WHERE task_id=$1 AND action='ASSIGN'",
      [t.id],
    )
  ).rows[0];
  const receipt = (
    await rawContext(f.runtime, f.ctx(), 'SELECT app.record_task_assigned($1) receipt', [e.id])
  ).rows[0].receipt;
  expect(receipt.recipientAccountId).toBe(t.worker.principalId);
  expect(receipt.payload).toEqual({
    title: 'A task was assigned to you',
    href: '/contributor?workspace=' + f.realTenant,
  });
  await expect(
    f.network.event(f.ctx(), {
      commandId: e.id,
      taskId: t.id,
      version: 0,
      action: 'ASSIGN',
      reason: e.reason,
      details: e.details,
    }),
  ).resolves.toMatchObject({ duplicate: true });
  const rows = (
    await f.owner.query(
      "SELECT id,recipient_account_id,payload FROM app.inbox_notification WHERE event_key=$1 AND type='TASK_ASSIGNED'",
      ['assignment:' + e.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(receipt.id);
  expect(rows[0].recipient_account_id).toBe(t.worker.principalId);
  expect(JSON.stringify(rows)).not.toContain(t.profile.id);
  const inbox = new InboxService(f.runtime);
  expect(
    (await inbox.list({ kind: 'staff', ctx: t.worker.ctx })).some((item) => item.id === receipt.id),
  ).toBe(true);
  expect(
    (await inbox.list({ kind: 'staff', ctx: f.users.other.ctx })).some(
      (item) => item.id === receipt.id,
    ),
  ).toBe(false);
  for (const ctx of [f.users.other.ctx, f.ctx('operator'), t.worker.ctx])
    await expect(
      rawContext(f.runtime, ctx, 'SELECT app.record_task_assigned($1)', [e.id]),
    ).rejects.toMatchObject({ code: '42501' });
});

test('GAP-017 notification failures keep the authorized assignment and do not dispatch a missing receipt', async () => {
  const original = f.network;
  const dispatch = vi.fn();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  f.network = new NetworkService(f.runtime, true, async (db) => {
    await db.query('SELECT gap017_missing_notification_function()');
    return dispatch;
  });
  try {
    const t = await prepareRealNetworkTask(f, contributor);
    expect(
      (await f.network.mine(t.worker.ctx)).some((task: { id: string }) => task.id === t.id),
    ).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: 'task_assigned_notification_failed' }),
    );
  } finally {
    f.network = original;
    log.mockRestore();
  }
});

test('GAP-017 transport failure does not roll back the assignment or its inbox receipt', async () => {
  const original = f.network;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const inbox = new InboxService(f.runtime);
  f.network = new NetworkService(f.runtime, true, async (db, commandId) => {
    await inbox.recordTaskAssigned(db, commandId);
    return async () => {
      throw new Error('Local transport failure');
    };
  });
  try {
    const t = await prepareRealNetworkTask(f, contributor);
    expect(
      (await inbox.list({ kind: 'staff', ctx: t.worker.ctx })).some(
        (item) => item.type === 'TASK_ASSIGNED',
      ),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'task_assigned_email_failed' }));
  } finally {
    f.network = original;
    log.mockRestore();
  }
});
