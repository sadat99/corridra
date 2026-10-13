import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { future } from './access-fixture';
import { rawContext } from './support';
import { OperationsService, readinessDimensions } from '../../packages/missions/src/operations';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { AccessService } from '../../packages/auth/src/access';
import { OutboxDispatcher } from '../../packages/workflows/src/index';
import { SyntheticChannel } from '../../packages/communications/src/adapters';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
let f: Awaited<ReturnType<typeof commercialFixture>>, s: OperationsService, r: CorridorService;
const reason = 'Explicit synthetic operational acceptance';
beforeAll(async () => {
  f = await commercialFixture();
  s = new OperationsService(f.runtime);
  r = new CorridorService(f.runtime);
  await r.installTemplates(f.users.owner.ctx);
  await new AccessService(f.runtime).changeMember(f.users.owner.ctx, {
    userId: f.users.reviewer.id,
    role: 'owner',
    revoked: false,
  });
});
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
async function route(origin: string, destination: string) {
  const id = randomUUID();
  await r.createRoute(f.users.owner.ctx, { id, origin, destination, reason });
  const pack = {
    id: randomUUID(),
    routeId: id,
    version: 1,
    status: 'TESTING' as const,
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: initialRouteConfiguration(initialRoutes[2]),
  };
  await r.appendPack(f.users.owner.ctx, pack);
  return pack;
}
test('all directional launch routes and a third-country route remain unpublished independently', async () => {
  for (const [origin, destination] of [
    ['BD', 'CN'],
    ['CN', 'BD'],
    ['BD', 'ES'],
    ['ES', 'BD'],
    ['BD', 'EU'],
    ['JP', 'KE'],
  ])
    await route(origin!, destination!);
  const c = await s.controlCenter(f.users.owner.ctx);
  expect(c.publicActivation).toBe(false);
  expect(c.releases).toEqual([]);
  expect(c.environment).toBe('synthetic');
});
test('configuration preview preserves pinned history; self-publication fails; independent exact publication works', async () => {
  const p = await route('BR', 'MX');
  const pack = {
    ...p,
    id: randomUUID(),
    version: 2,
    effectiveFrom: new Date(Date.now() + 100).toISOString(),
    configuration: { ...p.configuration, languages: ['en'] },
  };
  const preview = await s.preview(f.users.owner.ctx, pack);
  expect(preview.basePackId).toBe(p.id);
  expect(preview.changedFields).toContain('languages');
  expect(preview.publiclyOperational).toBe(false);
  const id = randomUUID();
  await s.command(f.users.owner.ctx, { id, action: 'propose', basePackId: p.id, pack, reason });
  await expect(
    s.command(f.users.owner.ctx, {
      id: randomUUID(),
      action: 'decide',
      proposalId: id,
      decision: 'PUBLISH',
      reason,
    }),
  ).rejects.toThrow('independent');
  const decision = {
    id: randomUUID(),
    action: 'decide',
    proposalId: id,
    decision: 'PUBLISH',
    reason,
  };
  await s.command(f.users.reviewer.ctx, decision);
  await s.command(f.users.reviewer.ctx, decision);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.corridor_pack_version WHERE route_id=$1',
        [p.routeId],
      )
    ).rows[0].n,
  ).toBe(2);
  await expect(
    s.command(f.users.reviewer.ctx, { ...decision, reason: 'Changed duplicate payload' }),
  ).rejects.toThrow('different values');
});
test('readiness requires every exact current evidenced dimension and an independent approver', async () => {
  const p = await route('AU', 'NZ'),
    t = await f.target();
  const ids: string[] = [];
  const release = {
    id: randomUUID(),
    action: 'release',
    routeId: p.routeId,
    packId: p.id,
    missionType: 'sourcing',
    version: 1,
    state: 'SYNTHETIC_APPROVED',
    ownerId: f.users.operator.id,
    readinessIds: ids,
    reason,
  };
  await expect(s.command(f.users.reviewer.ctx, release)).rejects.toThrow('All readiness');
  for (const dimension of readinessDimensions) {
    const id = randomUUID();
    await s.command(f.users.owner.ctx, {
      id,
      action: 'readiness',
      routeId: p.routeId,
      packId: p.id,
      missionType: 'sourcing',
      dimension,
      version: 1,
      status: 'PASS',
      ownerId: f.users.operator.id,
      sourceId: t.sourceId,
      validUntil: future(),
      reason,
    });
    ids.push(id);
  }
  await expect(s.command(f.users.owner.ctx, { ...release, id: randomUUID() })).rejects.toThrow(
    'Independent',
  );
  await s.command(f.users.reviewer.ctx, { ...release, id: randomUUID() });
  expect((await s.controlCenter(f.users.owner.ctx)).publicActivation).toBe(false);
  await s.command(f.users.owner.ctx, {
    ...release,
    id: randomUUID(),
    version: 2,
    state: 'PAUSED',
    readinessIds: [],
  });
  const types = (await r.catalogue(f.users.owner.ctx)).types;
  await expect(
    r.assign(f.users.owner.ctx, {
      id: randomUUID(),
      missionId: t.missionId,
      packId: p.id,
      missionTypeId: types.find((x) => x.key === 'sourcing')!.id,
      version: 1,
      reason,
    }),
  ).rejects.toThrow('paused');
});
test('service invoices and receipts enforce currency, overcollection, append-only compensation and retries', async () => {
  const t = await f.target();
  const invoice = {
    id: randomUUID(),
    action: 'document',
    missionId: t.missionId,
    kind: 'INVOICE',
    parentId: null,
    reverseOf: null,
    amountMinor: '10001',
    currency: 'CNY',
    sourceId: t.sourceId,
    externalReference: randomUUID(),
    occurredAt: new Date().toISOString(),
    reason,
  };
  await s.command(f.users.owner.ctx, invoice);
  await s.command(f.users.owner.ctx, invoice);
  const receipt = {
    ...invoice,
    id: randomUUID(),
    kind: 'RECEIPT',
    parentId: invoice.id,
    amountMinor: '5000',
    externalReference: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  await s.command(f.users.owner.ctx, receipt);
  await expect(
    s.command(f.users.owner.ctx, {
      ...receipt,
      id: randomUUID(),
      currency: 'EUR',
      externalReference: randomUUID(),
    }),
  ).rejects.toThrow('same-currency');
  await expect(
    s.command(f.users.owner.ctx, {
      ...receipt,
      id: randomUUID(),
      amountMinor: '6000',
      externalReference: randomUUID(),
    }),
  ).rejects.toThrow('bounded');
  await expect(
    s.command(f.users.owner.ctx, {
      ...invoice,
      id: randomUUID(),
      amountMinor: '-10001',
      reverseOf: invoice.id,
      externalReference: randomUUID(),
      occurredAt: new Date().toISOString(),
    }),
  ).rejects.toThrow('Compensate receipts');
  await s.command(f.users.owner.ctx, {
    ...receipt,
    id: randomUUID(),
    amountMinor: '-5000',
    reverseOf: receipt.id,
    externalReference: randomUUID(),
    occurredAt: new Date().toISOString(),
  });
  const d = await s.dashboard(f.users.owner.ctx);
  expect(
    d.corridraMoney.some((x) => x.kind === 'CORRIDRA_INVOICE' && x.observed_minor === '10001'),
  ).toBe(true);
  expect(d.customerTrade).toEqual([]);
  expect(d.unknown.rejected).toBeNull();
});
test('context, effort and costs are source-backed; unknown totals do not turn into zero or customer revenue', async () => {
  const t = await f.target();
  await s.command(f.users.owner.ctx, {
    id: randomUUID(),
    action: 'context',
    missionId: t.missionId,
    version: 1,
    customerReference: 'synthetic-client-a',
    industry: 'machinery',
    acquisitionSource: 'institution referral',
    payingStatus: 'UNKNOWN',
    revenueComplete: false,
    costComplete: false,
    effortComplete: false,
    sourceId: t.sourceId,
    reason,
  });
  await s.command(f.users.owner.ctx, {
    id: randomUUID(),
    action: 'effort',
    missionId: t.missionId,
    operatorId: f.users.operator.id,
    minutes: 90,
    sourceId: t.sourceId,
    occurredAt: new Date().toISOString(),
    reverseOf: null,
    reason,
  });
  await s.command(f.users.owner.ctx, {
    id: randomUUID(),
    action: 'ledger',
    missionId: t.missionId,
    kind: 'DELIVERY_COST',
    amountMinor: '3500',
    currency: 'EUR',
    sourceId: t.sourceId,
    externalReference: randomUUID(),
    occurredAt: new Date().toISOString(),
    reverseOf: null,
    reason,
  });
  const d = await s.dashboard(f.users.owner.ctx, { industry: 'machinery' });
  expect(d.summary.submitted).toBe(1);
  expect(d.summary.payment_unknown).toBe(1);
  expect(d.summary.incomplete_economics).toBe(1);
  expect(d.missions[0].effort_minutes).toBe('90');
  expect(d.unknown.firstUsefulResult).toBeNull();
  expect(d.customerTrade).toEqual([]);
});
test('all new tables deny cross-tenant, non-member and stale-MFA writes; history cannot be rewritten', async () => {
  for (const user of ['other', 'outsider', 'viewer', 'operator'])
    await expect(s.controlCenter({ ...f.users[user]!.ctx, tenantId: f.tenantA })).rejects.toThrow();
  for (const table of [
    'route_readiness',
    'route_release',
    'configuration_proposal',
    'configuration_decision',
    'service_document',
    'mission_effort',
    'mission_operations_context',
    'operations_case',
    'operations_command',
    'ai_mission_budget',
  ]) {
    expect(
      (
        await rawContext(
          f.runtime,
          { ...f.users.other.ctx, tenantId: f.tenantA },
          `SELECT * FROM app.${table}`,
        )
      ).rows,
    ).toEqual([]);
    await expect(
      rawContext(f.runtime, f.users.owner.ctx, `UPDATE app.${table} SET id=id`),
    ).rejects.toThrow();
    await expect(
      rawContext(f.runtime, f.users.owner.ctx, `DELETE FROM app.${table}`),
    ).rejects.toThrow();
  }
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '20 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(
    s.command(f.users.owner.ctx, {
      id: randomUUID(),
      action: 'case',
      key: 'scanner-outage',
      version: 1,
      kind: 'PROVIDER',
      subjectId: null,
      state: 'BLOCKED',
      ownerId: f.users.operator.id,
      dueAt: future(),
      sourceId: null,
      reason,
    }),
  ).rejects.toThrow('authenticator');
});
test('recovery dashboard uses current queues without revealing payloads or credentials; closed cases require evidence', async () => {
  const h = await s.reliability(f.users.owner.ctx);
  expect(h.health.database_reachable).toBe(true);
  expect(h.infrastructureCost).toBeNull();
  expect(JSON.stringify(h)).not.toContain('capability_hash');
  const c = {
    id: randomUUID(),
    action: 'case',
    key: 'scanner-outage',
    version: 1,
    kind: 'PROVIDER',
    subjectId: null,
    state: 'BLOCKED',
    ownerId: f.users.operator.id,
    dueAt: future(),
    sourceId: null,
    reason,
  };
  await s.command(f.users.owner.ctx, c);
  await expect(
    s.command(f.users.owner.ctx, { ...c, id: randomUUID(), version: 2, state: 'RESOLVED' }),
  ).rejects.toThrow();
  await expect(s.reliability(f.users.viewer.ctx)).rejects.toThrow('denied');
});
test('exponential backoff, dead-letter owner and idempotent effect recovery retain every attempt', async () => {
  const i = await f.introduction(),
    cap = f.communications.dispatchCapability(i.id);
  const failed = new OutboxDispatcher(f.runtime, {
    async deliver() {
      throw new Error('synthetic outage');
    },
  });
  for (let n = 0; n < 3; n++) {
    expect(await failed.attempt(i.id, cap)).toBe(n === 2 ? 'DEAD' : 'PENDING');
    const j = (
      await f.owner.query(
        'SELECT extract(epoch FROM available_at-now())::float8 AS delay FROM app.communication_dispatch WHERE id=$1',
        [i.id],
      )
    ).rows[0];
    expect(j.delay).toBeGreaterThan(5 * 2 ** n - 1);
    await f.owner.query('UPDATE app.communication_dispatch SET available_at=now() WHERE id=$1', [
      i.id,
    ]);
  }
  const queue = await s.reliability(f.users.owner.ctx);
  expect(queue.communications.find((x) => x.id === i.id)?.owner_id).toBe(f.users.operator.id);
  await f.communications.command(f.ctx, {
    action: 'retry',
    commandId: randomUUID(),
    messageId: i.id,
    reason,
  });
  const recovered = new OutboxDispatcher(f.runtime, new SyntheticChannel(f.runtime));
  expect(await recovered.attempt(i.id, cap)).toBe('DELIVERED');
  expect(await recovered.attempt(i.id, cap)).toBe('DELIVERED');
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
        'SELECT count(*)::int n FROM app.communication_attempt WHERE message_id=$1',
        [i.id],
      )
    ).rows[0].n,
  ).toBeGreaterThanOrEqual(5);
});
test('China to Bangladesh selective partner mission keeps the declared route through contract and observed customer cash', async () => {
  const t = await f.target('BD'),
    catalogue = await r.catalogue(f.users.owner.ctx),
    route = catalogue.routes.find(
      (x) => x.origin_market === 'CN' && x.destination_market === 'BD',
    )!;
  const previous = catalogue.packs.find((p) => p.route_id === route.id)!;
  const pack = {
    id: randomUUID(),
    routeId: route.id,
    version: previous.version + 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: { ...initialRouteConfiguration(initialRoutes[3]), missionTypes: ['partners'] },
  };
  await r.appendPack(f.users.owner.ctx, pack);
  await r.assign(f.users.owner.ctx, {
    id: randomUUID(),
    missionId: t.missionId,
    packId: pack.id,
    missionTypeId: catalogue.types.find((x) => x.key === 'partners')!.id,
    version: 1,
    reason,
  });
  const source = (await f.source('self_declaration')).id,
    claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source,
      statement:
        'Invented Chinese manufacturer requests a Bangladesh distribution partner; original declaration only.',
    }),
    originId = randomUUID();
  await f.service.registerOrigin(f.ctx, {
    id: originId,
    missionId: t.missionId,
    targetId: t.targetId,
    kind: 'SUPPLIER_RESPONSE',
    sourceId: source,
    claimId: claim.id,
    summary: 'Declared selective Bangladesh partner request',
    reason,
  });
  const o = await f.service.command(f.ctx, {
    action: 'createFromOrigin',
    commandId: randomUUID(),
    originId,
    title: 'Synthetic reverse-direction distributor opportunity',
    attribution: 'Observed association only; no causal trade claim',
    ...f.next(),
  });
  await f.transition(o.id, 'QUALIFIED_OPPORTUNITY');
  const contractSource = (await f.source('observation')).id;
  let parent: string | undefined;
  for (const kind of ['PROPOSAL', 'COMMITMENT', 'CONTRACT', 'INVOICE']) {
    const record = await f.record(o.id, kind, contractSource, parent, '12000', 'USD');
    parent = record.id;
    await f.transition(o.id, kind);
  }
  const cash = await f.record(o.id, 'CASH_RECEIPT', contractSource, parent, '12000', 'USD');
  await f.confirm(cash.id, contractSource);
  await f.transition(o.id, 'CASH_COLLECTED');
  const workspace = await new CommercialMissionService(f.runtime).workspace(
    f.users.owner.ctx,
    t.missionId,
  );
  expect(workspace.assignments[0].origin_market).toBe('CN');
  expect(workspace.assignments[0].destination_market).toBe('BD');
  expect(workspace.assignments[0].type_key).toBe('partners');
  const d = await s.dashboard(f.users.owner.ctx, { route: route.id });
  expect(d.summary.submitted).toBe(1);
  expect(d.corridraMoney).toEqual([]);
  expect(d.customerTrade.find((x) => x.kind === 'CASH_RECEIPT')?.observed_minor).toBe('12000');
});
test('operational metadata never widens the classification of its backing source', async () => {
  const t = await f.target();
  await rawContext(
    f.owner,
    f.users.owner.ctx,
    "UPDATE app.membership SET allowed_classifications=ARRAY['PUBLIC','INTERNAL','HIGHLY_RESTRICTED'] WHERE tenant_id=$1 AND user_id=$2",
    [f.tenantA, f.users.owner.id],
  );
  const source = await f.evidence.createSource(f.users.owner.ctx, {
    kind: 'observation',
    locator: 'Synthetic restricted operational evidence',
    observedAt: new Date().toISOString(),
    classification: 'HIGHLY_RESTRICTED',
    purpose: 'synthetic_validation',
    retentionUntil: future(),
    aiPolicy: 'DENY',
  });
  const id = randomUUID();
  await s.command(f.users.owner.ctx, {
    id,
    action: 'context',
    missionId: t.missionId,
    version: 1,
    customerReference: 'restricted-customer-reference',
    industry: 'restricted-industry',
    acquisitionSource: null,
    payingStatus: 'UNKNOWN',
    revenueComplete: false,
    costComplete: false,
    effortComplete: false,
    sourceId: source.id,
    reason,
  });
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.operator.ctx,
        'SELECT id FROM app.mission_operations_context WHERE id=$1',
        [id],
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await s.dashboard(f.users.operator.ctx, { customer: 'restricted-customer-reference' })).summary
      .submitted,
  ).toBe(0);
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.owner.ctx,
        'SELECT id FROM app.mission_operations_context WHERE id=$1',
        [id],
      )
    ).rows,
  ).toEqual([{ id }]);
});
