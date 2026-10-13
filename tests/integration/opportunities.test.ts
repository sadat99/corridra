import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { rawContext } from './support';
import { withTenant } from '../../packages/db/src/index';
import {
  commercialCommand,
  formatMoney,
  parseMoney,
  opportunityTransitions,
  assertOpportunityTransition,
} from '../../packages/domain/src/opportunities';
let f: Awaited<ReturnType<typeof commercialFixture>>;
beforeAll(async () => {
  f = await commercialFixture();
});
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
test('money stays exact beyond JavaScript safe integers and respects currency exponents', () => {
  expect(parseMoney('90071992547409.93', 'EUR')).toBe('9007199254740993');
  expect(formatMoney('9007199254740993', 'EUR')).toBe('EUR 90071992547409.93');
  expect(formatMoney('-10001', 'BDT')).toBe('BDT -100.01');
  expect(parseMoney('120', 'JPY')).toBe('120');
  for (const v of ['1e4', 'NaN', '-10', '0', '12.345', '1,000'])
    expect(() => parseMoney(v, 'EUR')).toThrow();
  expect(() => parseMoney('1.1', 'JPY')).toThrow();
  for (const [from, allowed] of Object.entries(opportunityTransitions))
    for (const to of Object.keys(opportunityTransitions)) {
      const call = () =>
        assertOpportunityTransition(
          from as keyof typeof opportunityTransitions,
          to as keyof typeof opportunityTransitions,
        );
      if (allowed.includes(to as never)) expect(call).not.toThrow();
      else expect(call).toThrow();
    }
});
test('populated Part 06 upgrade preserves meetings, followups, owners and immutable records', async () => {
  const upgraded = await commercialFixture(true);
  try {
    expect(upgraded.after).toEqual(upgraded.before);
    expect(
      (await upgraded.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
    ).toBe(28);
    expect(upgraded.previous).not.toBeNull();
  } finally {
    await upgraded.close();
  }
});
test('held meeting creates a lead with exact origin and one idempotent actor command', async () => {
  const o = await f.lead();
  const result = await f.service.command(f.ctx, o.input);
  expect(result).toEqual({ id: o.opportunityId, version: 1 });
  await expect(f.service.command(f.ctx, { ...o.input, title: 'Changed retry' })).rejects.toThrow(
    'Command key reused',
  );
  const ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.opportunities[0]).toMatchObject({
    meeting_id: o.meetingId,
    mission_id: o.missionId,
    target_id: o.targetId,
    attribution_scope: 'MISSION_ASSOCIATED',
    status: 'LEAD',
  });
  expect(ws.metrics.opportunities).toBe(1);
});
test('cross-tenant, non-member and private relationship readers cannot see commercial records', async () => {
  const o = await f.invoice();
  for (const ctx of [f.users.other.ctx, f.users.viewer.ctx]) {
    const ws = await f.service.workspace(ctx);
    expect(ws.opportunities.some((r) => r.id === o.opportunityId)).toBe(false);
    expect(ws.records.some((r) => r.opportunity_id === o.opportunityId)).toBe(false);
    expect(ws.totals).toEqual([]);
  }
  await expect(f.service.workspace(f.users.outsider.ctx)).rejects.toThrow('Access denied');
  const reviewed = await f.service.workspace(f.users.reviewer.ctx, o.missionId);
  expect(reviewed.opportunities[0].id).toBe(o.opportunityId);
  await expect(
    f.service.command(
      f.users.reviewer.ctx,
      command('followup', {
        id: o.opportunityId,
        version: reviewed.opportunities[0].version,
        ...f.next(),
      }),
    ),
  ).rejects.toThrow('Access denied');
  await rawContext(
    f.owner,
    f.users.owner.ctx,
    "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'operator')",
    [f.tenantA, f.users.outsider.id],
  );
  expect((await f.service.workspace(f.users.outsider.ctx, o.missionId)).opportunities).toEqual([]);
  await f.a.changeMember(f.users.owner.ctx, {
    userId: f.users.outsider.id,
    role: 'operator',
    revoked: true,
  });

  expect(
    (
      await rawContext(
        f.runtime,
        f.users.other.ctx,
        'SELECT * FROM app.outcome_projection WHERE tenant_id=$1',
        [f.tenantA],
      )
    ).rows,
  ).toEqual([]);
});
test('invalid stages, missing evidence, invalid loss and stale versions fail in service and SQL', async () => {
  const o = await f.lead();
  await expect(f.transition(o.opportunityId, 'CONTRACT')).rejects.toThrow();
  await f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY');
  await expect(f.transition(o.opportunityId, 'PROPOSAL')).rejects.toThrow('Commercial evidence');
  await expect(
    f.service.command(
      f.ctx,
      command('transition', {
        id: o.opportunityId,
        version: 1,
        status: 'QUALIFIED_OPPORTUNITY',
        ...f.next(),
      }),
    ),
  ).rejects.toThrow('changed');
  await expect(f.transition(o.opportunityId, 'LOST')).rejects.toThrow('loss reason');
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "UPDATE app.opportunity SET status='LOST',version=version+1 WHERE id=$1",
      [o.opportunityId],
    ),
  ).rejects.toThrow();
});
test('qualified RFQ and sample remain supporting records without inventing stages', async () => {
  const o = await f.lead();
  await expect(f.record(o.opportunityId, 'RFQ', o.sourceId)).rejects.toThrow('Progress');
  await f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY');
  await f.record(o.opportunityId, 'RFQ', o.sourceId);
  await f.record(o.opportunityId, 'SAMPLE', o.sourceId);
  const ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.activity).toMatchObject({ rfqs: 1, samples: 1 });
  expect(ws.opportunities[0].status).toBe('QUALIFIED_OPPORTUNITY');
});
test('record parents, exact currency and observed dates are validated, including tenant foreign keys', async () => {
  const o = await f.invoice();
  await expect(f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.contractId)).rejects.toThrow(
    'parent',
  );
  await expect(
    f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId, '12000', 'USD'),
  ).rejects.toThrow('currency');
  await expect(
    f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, randomUUID()),
  ).rejects.toThrow();
  await expect(
    f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId, '12000', 'EUR', future()),
  ).rejects.toThrow();
  expect(() =>
    commercialCommand.parse(
      command('record', {
        id: o.opportunityId,
        kind: 'CASH_RECEIPT',
        sourceId: o.sourceId,
        parentId: o.invoiceId,
        amountMinor: 12000,
        currency: 'EUR',
        occurredAt: new Date().toISOString(),
        summary: 'Observed cash',
        externalReference: 'Synthetic reference',
        reason: 'Observed receipt',
      }),
    ),
  ).toThrow();
});
test('a sales receipt remains unconfirmed until authorized accounting observation', async () => {
  const o = await f.invoice();
  const cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
  let ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.totals[0]).toMatchObject({
    invoice_minor: '12000',
    reported_cash_minor: '12000',
    confirmed_cash_minor: '0',
  });
  await expect(f.transition(o.opportunityId, 'CASH_COLLECTED')).rejects.toThrow('confirmed cash');
  await expect(
    f.service.command(
      f.ctx,
      command('confirm', {
        recordId: cash.id,
        sourceId: o.sourceId,
        occurredAt: new Date().toISOString(),
        basis: 'Operator assertion',
        reason: 'Attempt unauthorized confirmation',
      }),
    ),
  ).rejects.toThrow('Access denied');
  await f.confirm(cash.id, o.sourceId);
  await f.transition(o.opportunityId, 'CASH_COLLECTED');
  ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.totals[0].confirmed_cash_minor).toBe('12000');
  expect(ws.metrics).toMatchObject({ opportunities: 1, qualified: 1, contracts: 1, cash: 1 });
});
test('raw runtime cash confirmation still requires authority and fresh MFA', async () => {
  const o = await f.invoice(),
    cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
  const sql =
    "INSERT INTO app.accounting_confirmation(id,tenant_id,opportunity_id,record_id,source_id,occurred_at,basis,reason,created_by) VALUES($1,$2,$3,$4,$5,now(),'Invented accounting basis','Test SQL denial',$6)";
  await expect(
    rawContext(f.runtime, f.ctx, sql, [
      randomUUID(),
      f.tenantA,
      o.opportunityId,
      cash.id,
      o.sourceId,
      f.users.operator.id,
    ]),
  ).rejects.toThrow();
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  await expect(f.confirm(cash.id, o.sourceId)).rejects.toThrow('authenticator');
  await expect(
    rawContext(f.runtime, f.users.owner.ctx, sql, [
      randomUUID(),
      f.tenantA,
      o.opportunityId,
      cash.id,
      o.sourceId,
      f.users.owner.id,
    ]),
  ).rejects.toThrow();
});
test('self-declaration, unavailable files and expired sources cannot become accounting evidence', async () => {
  const o = await f.invoice(),
    cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId),
    declared = await f.source('self_declaration');
  await expect(f.confirm(cash.id, declared.id)).rejects.toThrow('Observed accounting source');
  await expect(
    f.record(
      o.opportunityId,
      'CASH_RECEIPT',
      o.sourceId,
      o.invoiceId,
      '100',
      'EUR',
      new Date().toISOString(),
      { evidenceId: randomUUID() },
    ),
  ).rejects.toThrow('Available matching evidence');
  const expiring = await rawContext(
    f.runtime,
    f.ctx,
    "INSERT INTO app.source_record(tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by) VALUES($1,'observation','Synthetic near-expiry source',now(),'INTERNAL','synthetic_validation',now()+interval '1 second','DENY',$2) RETURNING id",
    [f.tenantA, f.users.operator.id],
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await expect(f.confirm(cash.id, expiring.rows[0].id)).rejects.toThrow(
    'Observed accounting source',
  );
  await expect(
    f.record(o.opportunityId, 'CASH_RECEIPT', expiring.rows[0].id, o.invoiceId, '100'),
  ).rejects.toThrow('Current accessible source');
});
test('parallel duplicate commands and external references cannot double-count receipts or confirmations', async () => {
  const o = await f.invoice();
  const input = command('record', {
    id: o.opportunityId,
    kind: 'CASH_RECEIPT',
    sourceId: o.sourceId,
    parentId: o.invoiceId,
    amountMinor: '12000',
    currency: 'EUR',
    occurredAt: new Date(Date.now() - 120000).toISOString(),
    summary: 'Observed invented receipt',
    externalReference: 'parallel-' + randomUUID(),
    reason: 'Test duplicate cash command',
  });
  const results = await Promise.all([
    f.service.command(f.ctx, input),
    f.service.command(f.ctx, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  await expect(f.service.command(f.ctx, { ...input, commandId: randomUUID() })).rejects.toThrow();
  const confirmation = command('confirm', {
    recordId: results[0].id,
    sourceId: o.sourceId,
    occurredAt: new Date().toISOString(),
    basis: 'Observed invented statement',
    reason: 'Test confirmation retry',
  });
  expect(await f.service.command(f.users.owner.ctx, confirmation)).toEqual(
    await f.service.command(f.users.owner.ctx, confirmation),
  );
  expect((await f.service.workspace(f.ctx, o.missionId)).totals[0].confirmed_cash_minor).toBe(
    '12000',
  );
});
test('readable restricted sources cannot be downgraded and self-declaration cannot establish a contract', async () => {
  const o = await f.invoice(),
    declared = await f.source('self_declaration');
  const parent = (
    await f.owner.query(
      "SELECT id FROM app.commercial_record WHERE opportunity_id=$1 AND kind='COMMITMENT'",
      [o.opportunityId],
    )
  ).rows[0];
  await expect(f.record(o.opportunityId, 'CONTRACT', declared.id, parent.id)).rejects.toThrow(
    'Observed contract evidence',
  );
  const owner = f.users.owner.ctx;
  await rawContext(
    f.runtime,
    owner,
    "UPDATE app.membership SET allowed_classifications=ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL'] WHERE tenant_id=$1 AND user_id=ANY($2::uuid[])",
    [f.tenantA, [f.users.owner.id, f.users.operator.id]],
  );
  try {
    const restricted = await f.evidence.createSource(f.ctx, {
      kind: 'observation',
      locator: 'Synthetic restricted accounting source',
      observedAt: new Date().toISOString(),
      classification: 'CONFIDENTIAL',
      purpose: 'synthetic_validation',
      retentionUntil: future(),
      aiPolicy: 'DENY',
    });
    expect(
      (
        await rawContext(f.runtime, f.ctx, 'SELECT id FROM app.source_record WHERE id=$1', [
          restricted.id,
        ])
      ).rowCount,
    ).toBe(1);
    await expect(
      f.record(o.opportunityId, 'CASH_RECEIPT', restricted.id, o.invoiceId),
    ).rejects.toThrow('Current accessible source');
    const cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
    await expect(f.confirm(cash.id, restricted.id)).rejects.toThrow('Observed accounting source');
    expect(
      (await f.service.workspace(f.ctx, o.missionId)).sources.some((s) => s.id === restricted.id),
    ).toBe(false);
  } finally {
    await rawContext(
      f.runtime,
      owner,
      "UPDATE app.membership SET allowed_classifications=ARRAY['PUBLIC','INTERNAL'] WHERE tenant_id=$1 AND user_id=ANY($2::uuid[])",
      [f.tenantA, [f.users.owner.id, f.users.operator.id]],
    );
  }
});
test('SQL projection rebuild is audited exactly once and rejects operator or changed command keys', async () => {
  const id = randomUUID(),
    args = [f.tenantA, id, 'a'.repeat(64), 'Rebuild retained synthetic outcomes through SQL'];
  const sql = 'SELECT app.rebuild_outcomes($1,$2,$3,$4) n';
  await expect(rawContext(f.runtime, f.ctx, sql, args)).rejects.toThrow('Owner/admin');
  const first = await rawContext(f.runtime, f.users.owner.ctx, sql, args);
  expect((await rawContext(f.runtime, f.users.owner.ctx, sql, args)).rows).toEqual(first.rows);
  await expect(
    rawContext(f.runtime, f.users.owner.ctx, sql, [f.tenantA, id, 'b'.repeat(64), args[3]]),
  ).rejects.toThrow('key reused');
  const audit = await f.owner.query(
    "SELECT count(*)::int n FROM app.commercial_command c JOIN app.domain_event d ON d.aggregate_id=c.id::text AND d.aggregate_type='commercial_command' JOIN app.audit_event a ON a.domain_event_id=d.id JOIN app.outbox b ON b.event_id=d.id WHERE c.id=$1 AND c.action='rebuild' AND c.reason=$2",
    [id, args[3]],
  );
  expect(audit.rows[0].n).toBe(1);
});
test('confirmed partial receipts cannot exceed the invoice and retain exact totals', async () => {
  const o = await f.invoice();
  const first = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId, '8000');
  await f.confirm(first.id, o.sourceId);
  const second = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId, '5000');
  await expect(f.confirm(second.id, o.sourceId)).rejects.toThrow('exceeds invoice');
  expect((await f.service.workspace(f.ctx, o.missionId)).totals[0].confirmed_cash_minor).toBe(
    '8000',
  );
  await expect(f.record(o.opportunityId, 'INVOICE', o.sourceId, o.contractId, '1')).rejects.toThrow(
    'exceed contract',
  );
});
test('full cash compensation requires separate confirmation and preserves historical funnel attainment', async () => {
  const o = await f.invoice(),
    cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
  await f.confirm(cash.id, o.sourceId);
  await f.transition(o.opportunityId, 'CASH_COLLECTED');
  const reversal = await f.service.command(
    f.users.owner.ctx,
    command('reverse', {
      recordId: cash.id,
      sourceId: o.sourceId,
      occurredAt: new Date().toISOString(),
      reason: 'Correct an invented receipt',
    }),
  );
  let ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.totals[0].confirmed_cash_minor).toBe('12000');
  expect(ws.totals[0].reported_cash_minor).toBe('0');
  await f.confirm(reversal.id, o.sourceId);
  ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.totals[0].confirmed_cash_minor).toBe('0');
  expect(ws.metrics.cash).toBe(1);
  expect(ws.records.find((r) => r.id === cash.id)?.amount_minor).toBe('12000');
  await expect(
    f.service.command(
      f.users.owner.ctx,
      command('reverse', {
        recordId: cash.id,
        sourceId: o.sourceId,
        occurredAt: new Date().toISOString(),
        reason: 'Attempt second compensation',
      }),
    ),
  ).rejects.toThrow();
  await expect(f.transition(o.opportunityId, 'LOST')).rejects.toThrow();
});
test('financial corrections reject direct edits and compensate dependencies in order', async () => {
  const o = await f.invoice(),
    cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
  await expect(
    f.service.command(
      f.users.owner.ctx,
      command('reverse', {
        recordId: o.invoiceId,
        sourceId: o.sourceId,
        occurredAt: new Date().toISOString(),
        reason: 'Attempt invoice before receipt',
      }),
    ),
  ).rejects.toThrow('dependent');
  for (const table of ['commercial_record', 'accounting_confirmation', 'outcome_event'])
    await expect(
      f.owner.query(
        `UPDATE app.${table} SET ${table === 'outcome_event' ? 'snapshot' : 'reason'}=${table === 'outcome_event' ? "'{}'::jsonb" : "'Rewritten'"}`,
      ),
    ).rejects.toThrow();
  await f.service.command(
    f.users.owner.ctx,
    command('reverse', {
      recordId: cash.id,
      sourceId: o.sourceId,
      occurredAt: new Date().toISOString(),
      reason: 'Compensate unconfirmed assertion',
    }),
  );
  const invoice = await f.service.command(
    f.users.owner.ctx,
    command('reverse', {
      recordId: o.invoiceId,
      sourceId: o.sourceId,
      occurredAt: new Date().toISOString(),
      reason: 'Compensate invoice after reported cash',
    }),
  );
  expect(invoice.id).toBeTruthy();
  expect((await f.service.workspace(f.ctx, o.missionId)).totals[0].invoice_minor).toBe('0');
});
test('projection rebuild is deterministic, correction-aware and never duplicates event/outbox totals', async () => {
  const o = await f.invoice(),
    cash = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId);
  await f.confirm(cash.id, o.sourceId);
  const before = await f.service.workspace(f.ctx, o.missionId);
  const events = (await f.owner.query('SELECT count(*)::int n FROM app.outcome_event')).rows[0].n;
  await f.owner.query('DELETE FROM app.outcome_projection WHERE tenant_id=$1', [f.tenantA]);
  for (let n = 0; n < 2; n++)
    await f.service.command(
      f.users.owner.ctx,
      command('rebuild', { reason: 'Replay retained synthetic outcomes' }),
    );
  const after = await f.service.workspace(f.ctx, o.missionId);
  expect(after.totals).toEqual(before.totals);
  expect(after.metrics).toEqual(before.metrics);
  expect((await f.owner.query('SELECT count(*)::int n FROM app.outcome_event')).rows[0].n).toBe(
    events,
  );
  const linkage = await f.owner.query(
    'SELECT count(*)::int n FROM app.outcome_event e JOIN app.domain_event d ON d.id=e.id JOIN app.audit_event a ON a.domain_event_id=d.id JOIN app.outbox b ON b.event_id=d.id',
  );
  expect(linkage.rows[0].n).toBe(events);
  await expect(
    f.service.command(f.ctx, command('rebuild', { reason: 'Attempt operator replay' })),
  ).rejects.toThrow('Access denied');
});
test('material record, event, outbox and projection roll back together', async () => {
  const o = await f.invoice();
  const counts = async () =>
    (
      await f.owner.query(
        "SELECT jsonb_build_object('record',(SELECT count(*) FROM app.commercial_record),'event',(SELECT count(*) FROM app.domain_event),'outbox',(SELECT count(*) FROM app.outbox),'snapshot',(SELECT count(*) FROM app.outcome_event),'projection',(SELECT count(*) FROM app.outcome_projection)) data",
      )
    ).rows[0].data;
  const before = await counts();
  await expect(
    withTenant(f.runtime, f.ctx, 'opportunities.manage', async ({ db, actorId }) => {
      await db.query(
        "INSERT INTO app.commercial_record(id,tenant_id,opportunity_id,kind,parent_id,source_id,occurred_at,summary,external_reference,reason,amount_minor,currency,created_by) VALUES($1,$2,$3,'CASH_RECEIPT',$4,$5,now(),'Synthetic receipt',$6,'Transaction rollback test',100,'EUR',$7)",
        [randomUUID(), f.tenantA, o.opportunityId, o.invoiceId, o.sourceId, randomUUID(), actorId],
      );
      throw new Error('Synthetic failure after material insert');
    }),
  ).rejects.toThrow('Synthetic failure');
  expect(await counts()).toEqual(before);
});
test('mixed currency and very large amounts are shown separately without FX or duplicate joins', async () => {
  const eur = await f.invoice('EUR', '9007199254740993'),
    usd = await f.invoice('USD', '12345');
  for (const o of [eur, usd]) {
    const currency = o === eur ? 'EUR' : 'USD',
      amount = o === eur ? '9007199254740993' : '12345';
    const cash = await f.record(
      o.opportunityId,
      'CASH_RECEIPT',
      o.sourceId,
      o.invoiceId,
      amount,
      currency,
    );
    await f.confirm(cash.id, o.sourceId);
  }
  const report = await f.service.workspace(f.ctx);
  expect(report.totals.find((t) => t.currency === 'USD')?.confirmed_cash_minor).toBe('12345');
  expect((await f.service.workspace(f.ctx, eur.missionId)).totals).toHaveLength(1);
  expect((await f.service.workspace(f.ctx, eur.missionId)).totals[0].confirmed_cash_minor).toBe(
    '9007199254740993',
  );
});
test('owner-assigned overdue follow-up and lost opportunities remain traceable', async () => {
  const o = await f.lead();
  await f.service.command(
    f.ctx,
    command('followup', {
      id: o.opportunityId,
      version: 1,
      ...f.next(),
      dueAt: new Date(Date.now() - 3600000).toISOString(),
    }),
  );
  const ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.overdue[0]).toMatchObject({ id: o.opportunityId, owner_id: f.users.operator.id });
  await f.service.command(
    f.ctx,
    command('transition', {
      id: o.opportunityId,
      version: 2,
      status: 'LOST',
      lossReason: 'Invented buyer chose another supplier',
      ...f.next(),
    }),
  );
  await expect(f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY')).rejects.toThrow();
  expect((await f.service.workspace(f.ctx, o.missionId)).opportunities[0].loss_reason).toContain(
    'another supplier',
  );
});
test('turning commands off preserves reads and rejects service and raw SQL changes', async () => {
  const o = await f.lead();
  await f.a.appendConfig(f.users.owner.ctx, { key: 'opportunities.commands', enabled: false });
  try {
    await expect(f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY')).rejects.toThrow(
      'disabled',
    );
    await expect(
      rawContext(f.runtime, f.ctx, 'UPDATE app.opportunity SET version=version+1 WHERE id=$1', [
        o.opportunityId,
      ]),
    ).rejects.toThrow();
    const ws = await f.service.workspace(f.ctx, o.missionId);
    expect(ws.enabled).toBe(false);
    expect(ws.opportunities).toHaveLength(1);
  } finally {
    await f.a.appendConfig(f.users.owner.ctx, { key: 'opportunities.commands', enabled: true });
  }
});
test('recurrence requires later confirmed receipts from distinct invoices and counts cash once', async () => {
  const o = await f.invoice();
  const first = await f.record(o.opportunityId, 'CASH_RECEIPT', o.sourceId, o.invoiceId, '6000');
  await f.confirm(first.id, o.sourceId);
  await f.transition(o.opportunityId, 'CASH_COLLECTED');
  const sameInvoice = await f.record(
    o.opportunityId,
    'CASH_RECEIPT',
    o.sourceId,
    o.invoiceId,
    '6000',
    'EUR',
    new Date(Date.now() - 60000).toISOString(),
  );
  await f.confirm(sameInvoice.id, o.sourceId);
  await expect(
    f.record(
      o.opportunityId,
      'REPEAT_ORDER',
      o.sourceId,
      sameInvoice.id,
      '0',
      'EUR',
      new Date().toISOString(),
      { priorReceiptId: first.id },
    ),
  ).rejects.toThrow('Distinct later confirmed');
  const proposal = await f.record(o.opportunityId, 'PROPOSAL', o.sourceId),
    commitment = await f.record(o.opportunityId, 'COMMITMENT', o.sourceId, proposal.id),
    contract = await f.record(o.opportunityId, 'CONTRACT', o.sourceId, commitment.id),
    invoice = await f.record(o.opportunityId, 'INVOICE', o.sourceId, contract.id);
  const second = await f.record(
    o.opportunityId,
    'CASH_RECEIPT',
    o.sourceId,
    invoice.id,
    '12000',
    'EUR',
    new Date(Date.now() - 60000).toISOString(),
  );
  await expect(
    f.record(
      o.opportunityId,
      'REPEAT_ORDER',
      o.sourceId,
      second.id,
      '0',
      'EUR',
      new Date().toISOString(),
      { priorReceiptId: first.id },
    ),
  ).rejects.toThrow('Distinct later confirmed');
  await f.confirm(second.id, o.sourceId);
  await f.record(
    o.opportunityId,
    'REPEAT_ORDER',
    o.sourceId,
    second.id,
    '0',
    'EUR',
    new Date().toISOString(),
    { priorReceiptId: first.id },
  );
  await f.transition(o.opportunityId, 'RECURRING_REVENUE');
  const report = await f.service.workspace(f.ctx, o.missionId);
  expect(report.totals[0]).toMatchObject({
    confirmed_cash_minor: '24000',
    repeat_cash_minor: '12000',
  });
  expect(report.metrics.recurrence).toBe(1);
  await expect(
    f.record(
      o.opportunityId,
      'REPEAT_ORDER',
      o.sourceId,
      second.id,
      '0',
      'EUR',
      new Date().toISOString(),
      { priorReceiptId: first.id },
    ),
  ).rejects.toThrow();
});
test('revoked sessions and disallowed purpose/country cannot read or mutate financial truth', async () => {
  const o = await f.lead();
  await expect(
    f.service.workspace({ ...f.ctx, purpose: 'commercial_qualification' }, o.missionId),
  ).rejects.toThrow('Access denied');
  await f.owner.query("UPDATE identity.principal SET operating_country='BD' WHERE id=$1", [
    f.users.operator.id,
  ]);
  try {
    await expect(f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY')).rejects.toThrow(
      'Access denied',
    );
  } finally {
    await f.owner.query("UPDATE identity.principal SET operating_country='DE' WHERE id=$1", [
      f.users.operator.id,
    ]);
  }
  await f.owner.query(
    'UPDATE identity.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',
    [f.users.operator.sessionId],
  );
  try {
    await expect(f.service.workspace(f.ctx)).rejects.toThrow('Access denied');
  } finally {
    await f.owner.query(
      'UPDATE identity.session SET "expiresAt"=now()+interval \'1 hour\' WHERE id=$1',
      [f.users.operator.sessionId],
    );
  }
  await expect(
    rawContext(f.runtime, f.ctx, "UPDATE app.outcome_projection SET snapshot='{}'::jsonb"),
  ).rejects.toThrow();
});
test('commercial records paginate completely while report counts include all accessible history', async () => {
  const o = await f.lead();
  await f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY');
  await withTenant(f.runtime, f.ctx, 'opportunities.manage', async ({ db, actorId }) => {
    await db.query(
      "INSERT INTO app.commercial_record(id,tenant_id,opportunity_id,kind,source_id,occurred_at,summary,external_reference,reason,created_by) SELECT gen_random_uuid(),$1,$2,'RFQ',$3,now(),'Synthetic paged request',$4||'-'||i::text,'Synthetic bounded pagination test',$5 FROM generate_series(1,505) i",
      [f.tenantA, o.opportunityId, o.sourceId, randomUUID(), actorId],
    );
  });
  const ws = await f.service.workspace(f.ctx, o.missionId);
  expect(ws.records).toHaveLength(500);
  expect(ws.recordsTruncated).toBe(true);
  expect(ws.recordCounts[0].n).toBe(505);
  expect(ws.activity.rfqs).toBe(505);
  const ids: string[] = [];
  for (let offset = 0; offset < 505; offset += 100) {
    const page = await f.service.records(f.ctx, o.opportunityId, offset);
    expect(page.total).toBe(505);
    ids.push(...page.records.map((r) => r.id));
  }
  expect(new Set(ids).size).toBe(505);
  await expect(f.service.records(f.users.other.ctx, o.opportunityId)).rejects.toThrow(
    'unavailable',
  );
}, 120000);
test('mission pipeline and closure enforce commercial outcomes and completed meeting follow-up', async () => {
  const o = await f.lead();
  const mission = (action: string, version: number) =>
    f.mission.command(f.ctx, {
      id: o.missionId,
      version,
      commandId: randomUUID(),
      action,
      ...f.next(),
      marketCode: 'ES',
      targetProfile: 'Synthetic distributor',
    });
  await expect(mission('pipeline', 7)).rejects.toThrow('Qualified opportunity');
  await f.transition(o.opportunityId, 'QUALIFIED_OPPORTUNITY');
  await mission('pipeline', 7);
  await expect(mission('close', 8)).rejects.toThrow('before closing');
  await f.service.command(
    f.ctx,
    command('transition', {
      id: o.opportunityId,
      version: 2,
      status: 'LOST',
      lossReason: 'Observed invented buyer declined to proceed',
      ...f.next(),
    }),
  );
  await expect(mission('close', 8)).rejects.toThrow('follow-up');
  await f.meetings.command(
    f.ctx,
    command('followup', {
      id: o.meetingId,
      version: 1,
      status: 'COMPLETED',
      reason: 'Commercial follow-up resolved with observed loss',
    }),
  );
  await mission('close', 8);
  expect(
    (await f.owner.query('SELECT status FROM app.mission WHERE id=$1', [o.missionId])).rows[0]
      .status,
  ).toBe('CLOSED');
});
test('a lost unqualified lead does not count as a qualified commercial mission', async () => {
  const o = await f.lead();
  await f.service.command(
    f.ctx,
    command('transition', {
      id: o.opportunityId,
      version: 1,
      status: 'LOST',
      lossReason: 'Invented lead did not qualify',
      ...f.next(),
    }),
  );
  await expect(
    f.mission.command(f.ctx, {
      id: o.missionId,
      version: 7,
      commandId: randomUUID(),
      action: 'pipeline',
      marketCode: 'ES',
      targetProfile: 'Synthetic distributor',
      ...f.next(),
    }),
  ).rejects.toThrow('Qualified opportunity history');
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "UPDATE app.mission SET status='COMMERCIAL_PIPELINE',version=version+1 WHERE id=$1",
      [o.missionId],
    ),
  ).rejects.toThrow('Qualified opportunity history');
  const qualified = await f.lead();
  await f.transition(qualified.opportunityId, 'QUALIFIED_OPPORTUNITY');
  await f.service.command(
    f.ctx,
    command('transition', {
      id: qualified.opportunityId,
      version: 2,
      status: 'LOST',
      lossReason: 'Invented qualified opportunity was lost',
      ...f.next(),
    }),
  );
  await expect(
    f.mission.command(f.ctx, {
      id: qualified.missionId,
      version: 7,
      commandId: randomUUID(),
      action: 'pipeline',
      marketCode: 'ES',
      targetProfile: 'Synthetic distributor',
      ...f.next(),
    }),
  ).resolves.toMatchObject({ version: 8 });
});
test('mission closure cannot overlook another operator private opportunity', async () => {
  let hidden: Awaited<ReturnType<typeof f.introduction>> | undefined;
  const first = await f.held(async (origin) => {
    const original = (
      await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
        origin.relationshipId,
      ])
    ).rows[0];
    const source = (
      await f.owner.query('SELECT source_id FROM app.private_contact_data WHERE id=$1', [
        origin.contactId,
      ])
    ).rows[0];
    const rel = await f.research.command(
      f.ctx,
      command('relationship', {
        organisationId: original.organisation_id,
        ownerId: f.users.operator.id,
        visibility: 'OWNER',
        note: 'Private invented second negotiation',
      }),
    );
    const contact = await f.research.command(
      f.ctx,
      command('contact', {
        relationshipId: rel.id,
        sourceId: source.source_id,
        name: 'Invented second contact',
        jobTitle: 'Procurement',
        email: randomUUID() + '@example.invalid',
        validUntil: future(6),
      }),
    );
    const claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.source_id,
      statement: 'Invented second requirement',
    });
    await f.research.command(
      f.ctx,
      command('attribute', {
        organisationId: original.organisation_id,
        kind: 'requirement',
        claimId: claim.id,
        validUntil: future(6),
      }),
    );
    const target = await f.research.command(
      f.ctx,
      command('target', {
        missionId: origin.missionId,
        relationshipId: rel.id,
        contactId: contact.id,
        claimIds: [claim.id],
        fit: 'POSSIBLE',
        rationale: 'Invented matching requirement',
        uncertainty: 'No verified demand',
        gaps: 'Await buyer evidence',
        nextAction: 'Review invented introduction',
        dueAt: future(),
      }),
    );
    hidden = await f.introduction({
      missionId: origin.missionId,
      targetId: target.id,
      relationshipId: rel.id,
      contactId: contact.id,
    });
  });
  if (!hidden) throw new Error('Second controlled introduction required');
  const meeting = await f.meetings.command(
    f.ctx,
    command('propose', {
      messageId: hidden.id,
      title: 'Invented second commercial meeting',
      brief: 'Review invented second requirement',
      participants: ['Invented buyer', 'Invented seller'],
      ...f.next(),
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: meeting.id,
      version: 1,
      status: 'ACCEPTED',
      acceptance: 'Observed invented acceptance',
      ...f.next(),
    }),
  );
  const start = new Date(Date.now() - 3600000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 1800000);
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: meeting.id,
      version: 2,
      status: 'SCHEDULED',
      schedule: {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timezone: 'Etc/UTC',
        localStart: start.toISOString().slice(0, 16),
        localEnd: end.toISOString().slice(0, 16),
        location: 'Invented meeting room',
      },
      ...f.next(),
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: meeting.id,
      version: 3,
      status: 'HELD',
      outcome: 'Observed invented participants and requirement',
      ...f.next(),
    }),
  );
  const create = (meetingId: string) =>
    f.service.command(
      f.ctx,
      command('create', {
        meetingId,
        title: 'Invented bounded opportunity',
        attribution: 'Mission arranged meeting; closing causation not established',
        ...f.next(),
      }),
    );
  const visible = await create(first.meetingId),
    privateLead = await create(meeting.id);
  await f.transition(visible.id, 'QUALIFIED_OPPORTUNITY');
  await f.service.command(
    f.ctx,
    command('transition', {
      id: visible.id,
      version: 2,
      status: 'LOST',
      lossReason: 'Invented qualified opportunity was lost',
      ...f.next(),
    }),
  );
  for (const id of [first.meetingId, meeting.id])
    await f.meetings.command(
      f.ctx,
      command('followup', {
        id,
        version: 1,
        status: 'COMPLETED',
        reason: 'Resolve invented meeting follow-up',
      }),
    );
  const mission = (action: string, version: number) =>
    f.mission.command(f.ctx, {
      id: first.missionId,
      version,
      commandId: randomUUID(),
      action,
      marketCode: 'ES',
      targetProfile: 'Invented distributor',
      ...f.next(),
    });
  await mission('pipeline', 7);
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    'UPDATE app.relationship SET owner_id=$2 WHERE id=$1',
    [hidden.relationshipId, f.users.owner.id],
  );
  const ws = await f.service.workspace(f.ctx, first.missionId);
  expect(ws.opportunities.map((o) => o.id)).toEqual([visible.id]);
  await expect(mission('close', 8)).rejects.toThrow('Complete every mission outcome');
  await f.service.command(
    f.users.owner.ctx,
    command('transition', {
      id: privateLead.id,
      version: 1,
      status: 'LOST',
      lossReason: 'Private invented lead did not qualify',
      ...f.next(),
    }),
  );
  await expect(mission('close', 8)).resolves.toMatchObject({ version: 9 });
  expect(
    (await f.service.workspace(f.ctx, first.missionId)).opportunities.map((o) => o.id),
  ).toEqual([visible.id]);
});
