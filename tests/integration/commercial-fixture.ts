import { randomUUID } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';
import { OpportunityService } from '../../packages/opportunities/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';
import { migrate } from '../../packages/db/src/migrate';
export async function commercialFixture(upgrade = false, through?: string) {
  const f = await accessFixture(
    false,
    upgrade ? '0010_meetings_and_followup.sql' : through,
    upgrade ? 'corridra_upgrade' : undefined,
  );
  const service = new OpportunityService(f.runtime);
  const evidence = new EvidenceService(
    f.runtime,
    {
      async put() {},
      async get() {
        return new Uint8Array();
      },
    },
    {
      async scan() {
        return { verdict: 'ERROR', engine: 'not-used' };
      },
    },
  );
  const next = () => ({
    ownerId: f.users.operator.id,
    nextAction: 'Send an observed commercial follow-up',
    dueAt: future(),
    reason: 'Record invented commercial progression',
  });
  async function held(before?: (i: Awaited<ReturnType<typeof f.introduction>>) => Promise<void>) {
    const i = await f.introduction();
    await before?.(i);
    const m = await f.meetings.command(
      f.ctx,
      command('propose', {
        messageId: i.id,
        title: 'Synthetic commercial meeting',
        brief: 'Review observed requirement details',
        participants: ['Synthetic Buyer', 'Synthetic Seller'],
        ...next(),
      }),
    );
    await f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.id,
        version: 1,
        status: 'ACCEPTED',
        acceptance: 'Observed invented acceptance by both participants',
        ...next(),
      }),
    );
    for (const [j, action] of ['outreach', 'meetings'].entries())
      await f.mission.command(f.ctx, {
        id: i.missionId,
        version: 4 + j,
        commandId: randomUUID(),
        action,
        marketCode: 'ES',
        targetProfile: 'Synthetic commercial distributor',
        ...next(),
      });
    const start = new Date(Date.now() - 3600000);
    start.setUTCSeconds(0, 0);
    const end = new Date(start.getTime() + 1800000);
    await f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.id,
        version: 2,
        status: 'SCHEDULED',
        schedule: {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          timezone: 'Etc/UTC',
          localStart: start.toISOString().slice(0, 16),
          localEnd: end.toISOString().slice(0, 16),
          location: 'Synthetic meeting room',
        },
        ...next(),
      }),
    );
    await f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.id,
        version: 3,
        status: 'HELD',
        outcome: 'Both invented participants attended and requested a quotation.',
        ...next(),
      }),
    );
    await f.mission.command(f.ctx, {
      id: i.missionId,
      version: 6,
      commandId: randomUUID(),
      action: 'followup',
      marketCode: 'ES',
      targetProfile: 'Synthetic commercial distributor',
      ...next(),
    });
    return { ...i, meetingId: m.id };
  }
  const previous = upgrade ? await held() : null;
  const snapshot = async () =>
    (
      await f.owner.query(
        "SELECT jsonb_build_object('missions',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM app.mission m),'meetings',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM app.meeting m),'followups',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM app.follow_up f),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.domain_event e),'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM app.outbox o),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY tenant_id,user_id) FROM app.membership m)) data",
      )
    ).rows[0].data;
  const before = upgrade ? await snapshot() : null;
  if (upgrade) await migrate(f.owner);
  const after = upgrade ? await snapshot() : null;
  await f.a.appendConfig(f.users.owner.ctx, { key: 'opportunities.commands', enabled: true });
  async function source(kind = 'observation') {
    return evidence.createSource(f.ctx, {
      kind,
      locator: 'Synthetic commercial evidence ' + randomUUID(),
      observedAt: new Date().toISOString(),
      classification: 'INTERNAL',
      purpose: 'synthetic_validation',
      retentionUntil: future(7),
      aiPolicy: 'DENY',
    });
  }
  async function lead() {
    const origin = await held(),
      s = await source(),
      input = command('create', {
        meetingId: origin.meetingId,
        title: 'Synthetic towel opportunity',
        attribution: 'Mission arranged the meeting; closing causation is not established.',
        ...next(),
      });
    const o = await service.command(f.ctx, input);
    return { ...origin, opportunityId: o.id, sourceId: s.id, input };
  }
  async function transition(id: string, status: string) {
    const o = (await f.owner.query('SELECT version FROM app.opportunity WHERE id=$1', [id]))
      .rows[0];
    return service.command(
      f.ctx,
      command('transition', { id, version: o.version, status, ...next() }),
    );
  }
  async function record(
    id: string,
    kind: string,
    sourceId: string,
    parentId?: string,
    amountMinor = '12000',
    currency = 'EUR',
    occurredAt = new Date(Date.now() - 120000).toISOString(),
    extra: Record<string, unknown> = {},
  ) {
    return service.command(
      f.ctx,
      command('record', {
        id,
        kind,
        sourceId,
        parentId,
        occurredAt,
        summary: 'Observed invented commercial record',
        externalReference: 'synthetic-' + randomUUID(),
        ...(['PROPOSAL', 'COMMITMENT', 'CONTRACT', 'INVOICE', 'CASH_RECEIPT'].includes(kind)
          ? { amountMinor, currency }
          : {}),
        reason: 'Record observed commercial evidence',
        ...extra,
      }),
    );
  }
  async function invoice(code = 'EUR', amount = '12000') {
    const o = await lead();
    await transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY');
    const proposal = await record(o.opportunityId, 'PROPOSAL', o.sourceId, undefined, amount, code);
    await transition(o.opportunityId, 'PROPOSAL');
    const commitment = await record(
      o.opportunityId,
      'COMMITMENT',
      o.sourceId,
      proposal.id,
      amount,
      code,
    );
    await transition(o.opportunityId, 'COMMITMENT');
    const contract = await record(
      o.opportunityId,
      'CONTRACT',
      o.sourceId,
      commitment.id,
      amount,
      code,
    );
    await transition(o.opportunityId, 'CONTRACT');
    const invoice = await record(o.opportunityId, 'INVOICE', o.sourceId, contract.id, amount, code);
    await transition(o.opportunityId, 'INVOICE');
    return {
      ...o,
      proposalId: proposal.id,
      commitmentId: commitment.id,
      contractId: contract.id,
      invoiceId: invoice.id,
    };
  }
  async function confirm(
    recordId: string,
    sourceId: string,
    occurredAt = new Date().toISOString(),
  ) {
    return service.command(
      f.users.owner.ctx,
      command('confirm', {
        recordId,
        sourceId,
        occurredAt,
        basis: 'Human observed the invented accounting statement and matched invoice/reference.',
        reason: 'Separate accounting confirmation',
      }),
    );
  }
  return {
    ...f,
    service,
    evidence,
    next,
    held,
    lead,
    source,
    transition,
    record,
    invoice,
    confirm,
    previous,
    before,
    after,
  };
}
