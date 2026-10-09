import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { DeliveryService } from '../../packages/delivery/src/index';
import { migrate } from '../../packages/db/src/migrate';
let f: Awaited<ReturnType<typeof commercialFixture>>;
let delivery: DeliveryService;
beforeAll(async () => {
  f = await commercialFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'isolated-delivery-commercial-secret');
});
afterAll(async () => {
  await f?.close();
});
async function publish(
  o: { missionId: string; meetingId: string; opportunityId: string },
  financials = true,
) {
  const mt = (await f.owner.query('SELECT version FROM app.meeting WHERE id=$1', [o.meetingId]))
    .rows[0];
  return delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: o.missionId,
    title: 'Approved outcome scope',
    company: 'Synthetic Outcome Company',
    objective: 'Follow up approved opportunities',
    brief: 'Human-approved external outcome summary without private negotiation.',
    nextAction: 'Review the approved outcome report',
    dueAt: future(),
    meetings: [{ id: o.meetingId, version: mt.version, label: 'Approved commercial conversation' }],
    opportunityIds: [o.opportunityId],
    includeFinancials: financials,
    approved: true,
  });
}
async function link(pub: { id: string }) {
  return delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [pub.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic client outcome review',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
}
test('client outcomes reconcile exactly with Ops across confirmed partial cash, compensation and currencies', async () => {
  for (const currency of ['EUR', 'BDT']) {
    const o = await f.invoice(currency, '9007199254740993');
    const cash = await f.record(
      o.opportunityId,
      'CASH_RECEIPT',
      o.sourceId,
      o.invoiceId,
      '25000',
      currency,
    );
    const pub = await publish(o),
      capability = await link(pub);
    const read = async () =>
      (await delivery.external({
        action: 'view',
        token: capability.token,
        audience: 'CLIENT_PROGRESS',
      })) as import('../../packages/delivery/src/report').DeliveryReport;
    expect((await read()).missions[0].totals[0].confirmedCashMinor).toBe('0');
    await f.confirm(cash.id, o.sourceId);
    let ops = await f.service.workspace(f.users.owner.ctx, o.missionId);
    let report = await read();
    expect(report.missions[0].totals).toEqual(
      ops.totals.map((t) => ({
        currency: t.currency,
        contractMinor: t.contract_minor,
        invoiceMinor: t.invoice_minor,
        confirmedCashMinor: t.confirmed_cash_minor,
        repeatCashMinor: t.repeat_cash_minor,
      })),
    );
    expect(report.missions[0].outcomes.heldMeetings).toBe(ops.activity.held_meetings);
    expect(report.missions[0].outcomes.qualified).toBe(ops.metrics.qualified);
    expect(report.missions[0].totals[0].contractMinor).toBe('9007199254740993');
    expect(report.missions[0].totals[0].confirmedCashMinor).toBe('25000');
    const reverse = await f.service.command(
      f.users.owner.ctx,
      command('reverse', {
        recordId: cash.id,
        sourceId: o.sourceId,
        occurredAt: new Date().toISOString(),
        reason: 'Synthetic confirmed compensation',
      }),
    );
    await f.confirm(reverse.id, o.sourceId);
    ops = await f.service.workspace(f.users.owner.ctx, o.missionId);
    report = await read();
    expect(report.missions[0].totals[0].confirmedCashMinor).toBe(
      ops.totals[0].confirmed_cash_minor,
    );
    expect(report.missions[0].totals[0].confirmedCashMinor).toBe('0');
    const withoutFinance = await link(await publish(o, false));
    const hidden = await delivery.external({
      action: 'view',
      token: withoutFinance.token,
      audience: 'CLIENT_PROGRESS',
    });
    expect(JSON.stringify(hidden)).not.toContain('9007199254740993');
    expect(JSON.stringify(report)).not.toContain('Human observed the invented accounting');
    expect(JSON.stringify(report)).not.toContain('external_reference');
    expect(JSON.stringify(report)).not.toContain('Private negotiation');
  }
});
test('cross-mission outcomes, changed schedules and expired source do not leak through reviewed delivery', async () => {
  const o = await f.invoice(),
    other = await f.lead();
  const pub = await publish(o),
    capability = await link(pub);
  const input = { action: 'view', token: capability.token, audience: 'CLIENT_PROGRESS' };
  const old = (
    await f.owner.query('SELECT copy FROM app.delivery_publication WHERE id=$1', [pub.id])
  ).rows[0].copy;
  await expect(
    delivery.publication(f.users.owner.ctx, {
      ...old,
      commandId: randomUUID(),
      missionId: o.missionId,
      opportunityIds: [other.opportunityId],
      approved: true,
    }),
  ).rejects.toThrow();
  await expect(
    delivery.publication(f.users.owner.ctx, {
      ...old,
      commandId: randomUUID(),
      missionId: o.missionId,
      meetings: [{ id: other.meetingId, version: 4, label: 'Unrelated meeting' }],
      approved: true,
    }),
  ).rejects.toThrow();
  // Start from an approved earlier version; HELD is a canonical later version.
  const before = await f.held(async (i) => {
    const m = await f.meetings.command(
      f.ctx,
      command('propose', {
        messageId: i.id,
        title: 'Synthetic itinerary version test',
        brief: 'Approved itinerary test',
        participants: ['Synthetic Buyer', 'Synthetic Seller'],
        ...f.next(),
      }),
    );
    const p = await delivery.publication(f.users.owner.ctx, {
      ...old,
      commandId: randomUUID(),
      missionId: i.missionId,
      opportunityIds: [],
      meetings: [{ id: m.id, version: 1, label: 'Reviewed schedule' }],
      approved: true,
    });
    const l = await link(p);
    await f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.id,
        version: 1,
        status: 'ACCEPTED',
        acceptance: 'Invented observed acceptance',
        ...f.next(),
      }),
    );
    const changed = (await delivery.external({
      action: 'view',
      token: l.token,
      audience: 'CLIENT_PROGRESS',
    })) as import('../../packages/delivery/src/report').DeliveryReport;
    expect(changed.missions[0].itinerary[0].scheduleChanged).toBe(true);
    expect(changed.missions[0].itinerary[0].location).toBeUndefined();
  });
  expect(before.missionId).toBeTruthy();
  const source = await f.evidence.createSource(f.ctx, {
    kind: 'observation',
    locator: 'Synthetic short-lived outcome source',
    observedAt: new Date(Date.now() - 1000).toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 1200).toISOString(),
    aiPolicy: 'DENY',
  });
  await f.record(o.opportunityId, 'CASH_RECEIPT', source.id, o.invoiceId, '100');
  await expect(delivery.external(input)).resolves.toHaveProperty('missions');
  await new Promise((resolve) => setTimeout(resolve, 1250));
  await expect(delivery.external(input)).rejects.toThrow();
});
test('Part 8 forward upgrade preserves populated commercial, identity and event records', async () => {
  await f.close();
  const base = await commercialFixture(false, '0013_commercial_qualification_history.sql');
  f = base;
  const o = await base.invoice();
  const snapshot = async () =>
    (
      await base.owner.query(
        "SELECT encode(sha256(convert_to(jsonb_build_object('missions',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM app.mission m),'money',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.commercial_record r),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.domain_event e),'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM identity.\"user\" u))::text,'UTF8')),'hex') hash",
      )
    ).rows[0].hash;
  const before = await snapshot();
  await migrate(base.owner);
  expect(await snapshot()).toBe(before);
  expect(
    (await base.service.workspace(base.users.owner.ctx, o.missionId)).totals[0].invoice_minor,
  ).toBe('12000');
});
