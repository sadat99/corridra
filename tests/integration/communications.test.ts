import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';
import { rawContext } from './support';
import { hash } from '../../packages/communications/src/index';
import { SyntheticChannel, EmailChannel } from '../../packages/communications/src/adapters';
import { OutboxDispatcher } from '../../packages/workflows/src/index';
test('Part 05 populated upgrade preserves missions, shortlist, contacts, permissions and immutable history', async () => {
  const upgraded = await accessFixture(true);
  try {
    expect(upgraded.afterUpgrade).toEqual(upgraded.beforeUpgrade);
    expect(
      (await upgraded.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
    ).toBe(18);
    const i = await upgraded.introduction(upgraded.preUpgradeTarget);
    expect(await upgraded.communications.buyer({ action: 'read', token: i.token })).toMatchObject({
      introduction: upgraded.presentation,
    });
    expect((await upgraded.communications.workspace(upgraded.users.other.ctx)).messages).toEqual(
      [],
    );
  } finally {
    await upgraded.close();
  }
});
let f: Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async () => {
  f = await accessFixture();
});
afterAll(async () => {
  await f?.close();
});
test('approved introduction is least-data, hashed, repeatable and GET-equivalent reads make no decisions', async () => {
  const i = await f.introduction();
  const same = await f.communications.command(f.ctx, i.input);
  expect(same).toMatchObject({ id: i.id, buyerPath: `/buyer#${i.token}` });
  const before = (await f.owner.query('SELECT count(*) n FROM app.domain_event')).rows[0].n;
  for (let n = 0; n < 3; n++)
    expect(await f.communications.buyer({ action: 'read', token: i.token })).toMatchObject({
      introduction: f.presentation,
      decision: null,
      synthetic: true,
    });
  expect((await f.owner.query('SELECT count(*) n FROM app.domain_event')).rows[0].n).toBe(before);
  expect(
    (await f.owner.query('SELECT token_hash FROM app.buyer_link WHERE id=$1', [i.id])).rows[0]
      .token_hash,
  ).toBe(hash(i.token));
  const view = JSON.stringify(await f.communications.buyer({ action: 'read', token: i.token }));
  for (const privateValue of [
    i.missionId,
    i.targetId,
    i.contactId,
    i.relationshipId,
    'Private negotiation',
    'Private mission',
    '@example.invalid',
    i.token,
  ])
    expect(view).not.toContain(privateValue);
  const events = JSON.stringify((await f.owner.query('SELECT payload FROM app.domain_event')).rows);
  expect(events).not.toContain(i.token);
  await expect(
    f.communications.command(f.ctx, { ...i.input, expiresAt: future(2) }),
  ).rejects.toThrow('Command key reused');
});
test('parallel duplicate buyer responses produce one immutable event; changed replay fails', async () => {
  const i = await f.introduction();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      f.communications.buyer({
        action: 'respond',
        token: i.token,
        responseId: randomUUID(),
        decision: 'INTERESTED',
        optOut: false,
      }),
    ),
  );
  expect(responses).toEqual(
    Array.from({ length: 8 }, () => ({ decision: 'INTERESTED', recorded: true })),
  );
  const r = await f.owner.query(
    'SELECT br.id,p.kind FROM app.buyer_response br JOIN identity.principal p ON p.id=br.created_by WHERE br.link_id=$1',
    [i.id],
  );
  expect(r.rowCount).toBe(1);
  expect(r.rows[0].kind).toBe('service');
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='buyer_response' AND aggregate_id=$1",
        [r.rows[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    f.communications.buyer({
      action: 'respond',
      token: i.token,
      responseId: randomUUID(),
      decision: 'NEED_INFO',
      optOut: false,
    }),
  ).rejects.toThrow('Decision already recorded');
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "UPDATE app.buyer_response SET status='NOT_RELEVANT' WHERE link_id=$1",
      [i.id],
    ),
  ).rejects.toThrow();
});
test('expiry, revocation, rollback flag and unknown capabilities deny reads and decisions', async () => {
  const i = await f.introduction();
  await f.communications.command(
    f.ctx,
    command('revoke', { linkId: i.id, reason: 'Stop this synthetic introduction' }),
  );
  await expect(f.communications.buyer({ action: 'read', token: i.token })).rejects.toThrow(
    'unavailable',
  );
  await expect(
    f.communications.buyer({
      action: 'respond',
      token: i.token,
      responseId: randomUUID(),
      decision: 'INTERESTED',
      optOut: false,
    }),
  ).rejects.toThrow('unavailable');
  await expect(f.communications.buyer({ action: 'read', token: 'a'.repeat(64) })).rejects.toThrow(
    'unavailable',
  );
  const t = await f.target(),
    expiresAt = new Date(Date.now() + 400).toISOString(),
    expiring = await f.introduction(t, expiresAt);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await expect(f.communications.buyer({ action: 'read', token: expiring.token })).rejects.toThrow(
    'unavailable',
  );
  const active = await f.introduction();
  await f.a.appendConfig(f.users.owner.ctx, {
    key: 'communications.introductions',
    enabled: false,
  });
  await expect(f.communications.buyer({ action: 'read', token: active.token })).rejects.toThrow(
    'unavailable',
  );
  await expect(f.introduction()).rejects.toThrow('disabled');
  await f.a.appendConfig(f.users.owner.ctx, { key: 'communications.introductions', enabled: true });
});
test('recipient opt-outs are idempotent and suppress queued delivery and later introductions', async () => {
  const i = await f.introduction();
  const r = {
    action: 'respond',
    token: i.token,
    responseId: randomUUID(),
    decision: 'NOT_RELEVANT',
    optOut: true,
  };
  expect(await f.communications.buyer(r)).toEqual({ decision: 'NOT_RELEVANT', recorded: true });
  expect(await f.communications.buyer(r)).toEqual({ decision: 'NOT_RELEVANT', recorded: true });
  const worker = new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime));
  expect(await worker.attempt(i.id, f.communications.dispatchCapability(i.id))).toBe('SUPPRESSED');
  await expect(f.introduction(i)).rejects.toThrow();
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.communication_optout WHERE contact_id=$1',
        [i.contactId],
      )
    ).rows[0].n,
  ).toBe(1);
});
test('policy approval needs fresh authorized MFA, jurisdiction matches and real email fails closed', async () => {
  const policy = command('policy', {
    jurisdiction: 'ES',
    channel: 'SYNTHETIC',
    contactPurpose: 'referral',
    basis: 'Synthetic referral permission',
    validUntil: future(),
    enabled: true,
  });
  await expect(f.communications.command(f.users.operator.ctx, policy)).rejects.toThrow(
    'Access denied',
  );
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(f.communications.command(f.users.owner.ctx, policy)).rejects.toThrow(
    'authenticator',
  );
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.owner.sessionId,
  ]);
  await expect(
    f.communications.command(f.users.owner.ctx, { ...policy, channel: 'EMAIL' }),
  ).rejects.toThrow('real email');
  await expect(
    new EmailChannel(null).deliver({
      id: randomUUID(),
      capabilityHash: '0'.repeat(64),
      leaseId: randomUUID(),
    }),
  ).rejects.toThrow('readiness');
  const otherPolicy = await f.communications.command(
    f.users.owner.ctx,
    command('policy', {
      ...policy,
      commandId: randomUUID(),
      jurisdiction: 'BD',
      contactPurpose: 'institutional_introduction',
    }),
  );
  const t = await f.target();
  await expect(
    f.communications.command(
      f.ctx,
      command('introduce', {
        targetId: t.targetId,
        contactId: t.contactId,
        policyId: otherPolicy.id,
        templateId: f.tpl.id,
        introduction: f.presentation,
        expiresAt: future(),
      }),
    ),
  ).rejects.toThrow('policy');
});
test('restricted roles and relationship visibility deny unrelated records and worker capability guessing', async () => {
  const i = await f.introduction();
  const other = await f.communications.workspace(f.users.other.ctx);
  expect(other.messages).toEqual([]);
  const viewer = await f.communications.workspace(f.users.viewer.ctx);
  expect(viewer.messages).toEqual([]);
  await expect(
    f.communications.command(
      f.users.other.ctx,
      command('revoke', { linkId: i.id, reason: 'Wrong tenant' }),
    ),
  ).rejects.toThrow('unavailable');
  await expect(
    f.communications.command(
      f.users.viewer.ctx,
      command('optout', { contactId: i.contactId, reason: 'Wrong role' }),
    ),
  ).rejects.toThrow('Access denied');
  expect(
    await new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime)).attempt(i.id, 'guessed'),
  ).toBe('UNAVAILABLE');
  await expect(
    f.runtime.query("UPDATE app.communication_dispatch SET status='DELIVERED' WHERE id=$1", [i.id]),
  ).rejects.toThrow();
  expect((await f.runtime.query('SELECT * FROM app.buyer_link')).rowCount).toBe(0);
  await f.a.changeMember(f.users.owner.ctx, {
    userId: f.users.operator.id,
    role: 'operator',
    revoked: true,
  });
  await expect(f.communications.buyer({ action: 'read', token: i.token })).rejects.toThrow(
    'unavailable',
  );
  await f.a.changeMember(f.users.owner.ctx, {
    userId: f.users.operator.id,
    role: 'operator',
    revoked: false,
  });
});
test('outbox and effect retry survive concurrent starts and a lost delivery acknowledgement', async () => {
  const i = await f.introduction(),
    channel = new SyntheticChannel(f.runtime);
  const worker = new OutboxDispatcher(f.runtime, {
    async deliver(e) {
      await channel.deliver(e);
      throw new Error('lost acknowledgement');
    },
  });
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      worker.attempt(i.id, f.communications.dispatchCapability(i.id)),
    ),
  );
  expect(results).toContain('DELIVERED');
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.communication_receipt WHERE id=$1', [
        i.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect(await worker.attempt(i.id, f.communications.dispatchCapability(i.id))).toBe('DELIVERED');
  const checkpoint = (
    await f.owner.query(
      'SELECT j.status,d.delivered_at FROM app.communication_dispatch j JOIN app.outbox_delivery d ON d.event_id=j.event_id WHERE j.id=$1',
      [i.id],
    )
  ).rows[0];
  expect(checkpoint.status).toBe('DELIVERED');
  expect(checkpoint.delivered_at).not.toBeNull();
});
test('committed delivery survives a worker crash before checkpoint and later link revocation', async () => {
  const i = await f.introduction(),
    cap = f.communications.dispatchCapability(i.id),
    capabilityHash = hash(cap),
    leaseId = randomUUID();
  expect(
    (
      await f.runtime.query('SELECT app.claim_communication($1,$2,$3) AS job', [
        i.id,
        capabilityHash,
        leaseId,
      ])
    ).rows[0].job.status,
  ).toBe('CLAIMED');
  await new SyntheticChannel(f.runtime).deliver({ id: i.id, capabilityHash, leaseId });
  // No finish call: simulate process death after the durable effect was committed.
  await f.communications.command(
    f.ctx,
    command('revoke', { linkId: i.id, reason: 'Revoke after acknowledged delivery' }),
  );
  expect(
    await new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime)).attempt(i.id, cap),
  ).toBe('DELIVERED');
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.communication_receipt WHERE id=$1', [
        i.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await f.owner.query(
        'SELECT delivered_at FROM app.outbox_delivery WHERE event_id=(SELECT event_id FROM app.communication_dispatch WHERE id=$1)',
        [i.id],
      )
    ).rows[0].delivered_at,
  ).not.toBeNull();
});
test('bounded failures enter dead-letter triage; explicit retry retains history and stable identity', async () => {
  const i = await f.introduction(),
    cap = f.communications.dispatchCapability(i.id),
    worker = new OutboxDispatcher(f.runtime, {
      async deliver() {
        throw new Error('provider unavailable');
      },
    });
  for (let n = 0; n < 3; n++) {
    expect(await worker.attempt(i.id, cap)).toBe(n === 2 ? 'DEAD' : 'PENDING');
    await f.owner.query('UPDATE app.communication_dispatch SET available_at=now() WHERE id=$1', [
      i.id,
    ]);
  }
  await f.communications.command(
    f.ctx,
    command('retry', { messageId: i.id, reason: 'Provider recovered after triage' }),
  );
  expect(
    await new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime)).attempt(i.id, cap),
  ).toBe('DELIVERED');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.communication_attempt WHERE message_id=$1',
        [i.id],
      )
    ).rows[0].n,
  ).toBeGreaterThan(6);
});
test('rollback, policy replacement and paused mission are rechecked before the side effect', async () => {
  const inFlight = await f.introduction(),
    capabilityHash = hash(f.communications.dispatchCapability(inFlight.id)),
    leaseId = randomUUID();
  expect(
    (
      await f.runtime.query('SELECT app.claim_communication($1,$2,$3) AS job', [
        inFlight.id,
        capabilityHash,
        leaseId,
      ])
    ).rows[0].job.status,
  ).toBe('CLAIMED');
  await f.a.appendConfig(f.users.owner.ctx, {
    key: 'communications.introductions',
    enabled: false,
  });
  await expect(
    new SyntheticChannel(f.runtime).deliver({ id: inFlight.id, capabilityHash, leaseId }),
  ).rejects.toThrow('Delivery unavailable');
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.communication_receipt WHERE id=$1', [
        inFlight.id,
      ])
    ).rows[0].n,
  ).toBe(0);
  await f.runtime.query("SELECT app.finish_communication($1,$2,$3,'TRANSIENT')", [
    inFlight.id,
    capabilityHash,
    leaseId,
  ]);
  await f.a.appendConfig(f.users.owner.ctx, { key: 'communications.introductions', enabled: true });
  const i = await f.introduction(),
    worker = new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime));
  await f.a.appendConfig(f.users.owner.ctx, { key: 'communications.dispatch', enabled: false });
  expect(await worker.attempt(i.id, f.communications.dispatchCapability(i.id))).toBe('SUPPRESSED');
  await f.a.appendConfig(f.users.owner.ctx, { key: 'communications.dispatch', enabled: true });
  const j = await f.introduction();
  await f.mission.command(f.ctx, {
    id: j.missionId,
    version: 4,
    commandId: randomUUID(),
    action: 'pause',
    ownerId: f.users.operator.id,
    reason: 'Pause pending access',
    nextAction: 'Resolve readiness issue',
    dueAt: future(),
    marketCode: 'ES',
    targetProfile: 'Synthetic distributor target',
  });
  await expect(f.communications.buyer({ action: 'read', token: j.token })).rejects.toThrow(
    'unavailable',
  );
  expect(await worker.attempt(j.id, f.communications.dispatchCapability(j.id))).toBe('SUPPRESSED');
  const k = await f.introduction();
  await f.communications.command(
    f.users.owner.ctx,
    command('policy', {
      jurisdiction: 'ES',
      channel: 'SYNTHETIC',
      contactPurpose: 'institutional_introduction',
      basis: 'Pause this test policy',
      validUntil: future(5),
      enabled: false,
    }),
  );
  expect(await worker.attempt(k.id, f.communications.dispatchCapability(k.id))).toBe('SUPPRESSED');
});
test('shared buyer budgets retain no client address and stop repeated anonymous attempts', async () => {
  for (let n = 0; n < 60; n++) await f.communications.budget('test-client-address', 'test-token');
  await expect(f.communications.budget('test-client-address', 'test-token')).rejects.toThrow(
    'Too many',
  );
  expect(
    JSON.stringify((await f.owner.query('SELECT key FROM app.intake_rate_limit')).rows),
  ).not.toContain('test-client-address');
});
