import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// WS-C server rules (commercial readiness program 6.C and section 8 sensitive paths):
//  - D3: a real invoice or credit note is refused while any supplier detail is made up, before the command runs;
//  - the mission page read is tenant scoped (cross-tenant and outsider reads fail) and needs no new authority;
//  - a repeated submit of the same reply records one reply;
//  - listDeliveredPublications reads nothing without a customer proof.

import {
  madeupSupplierFields,
  madeupSupplierGuardOn,
  madeupSupplierMessage,
  realInvoicingStaffCommandInput,
  refuseMadeupIssue,
} from '../../packages/delivery/src/customer-invoicing-real-staff';
import { listDeliveredPublications } from '../../packages/delivery/src/delivered-publications';
import { fixture } from './support';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// The guard runs inside the command's own staff transaction. A recording stand-in for that transaction shows
// which reads happen; the service calls the guard before app.real_invoicing_staff_command and nothing else.
const calls: string[] = [];
let supplier: Record<string, unknown> = {};
const db = {
  query: async (sql: string) => {
    calls.push(sql);
    return { rows: [{ result: { supplier } }] };
  },
} as never;
async function guard(input: Record<string, unknown>) {
  const { action, commandId: _commandId, ...payload } = realInvoicingStaffCommandInput.parse(input);
  void _commandId;
  return refuseMadeupIssue(db, action, payload);
}
const madeupSupplier = {
  legalName: 'Corridra Pte Ltd',
  address: '101 Robinson Road, Singapore 180239',
  uen: '202600000A (madeup)',
  gstRegistrationNo: 'M9-0000000-0 (madeup)',
  madeupFields: ['uen', 'gst_registration_no'],
};
const realSupplier = {
  legalName: 'Corridra Pte Ltd',
  address: '101 Robinson Road, Singapore 180239',
  uen: '202612345K',
  gstRegistrationNo: 'M9-1234567-8',
  madeupFields: [],
};
const ctx = { token: 'staff', tenantId: randomUUID(), purpose: 'commercial_qualification' };
const prepare = () => ({
  action: 'prepare_invoice',
  commandId: randomUUID(),
  subscriptionId: randomUUID(),
  periodStart: '2026-11-01',
  dueOn: '2026-12-01',
  billToName: 'QA test (madeup) buyer',
  billToAddress: '1 Test Road, Dhaka',
});

describe('D3: real invoices stay blocked while supplier details are made up', () => {
  test('made-up details are found by list or by the (madeup) marker', () => {
    expect(madeupSupplierFields(madeupSupplier)).toEqual(
      expect.arrayContaining(['uen', 'gst_registration_no', 'gstRegistrationNo']),
    );
    expect(madeupSupplierFields({ ...realSupplier, financeLabel: 'Finance (Madeup)' })).toEqual([
      'financeLabel',
    ]);
    expect(madeupSupplierFields(realSupplier)).toEqual([]);
    expect(madeupSupplierFields(null)).toEqual([]);
  });
  test('the guard is on in the live environment only', () => {
    expect(madeupSupplierGuardOn({ VERCEL_ENV: 'production', DATA_ENVIRONMENT: 'real' })).toBe(
      true,
    );
    expect(madeupSupplierGuardOn({ DATA_ENVIRONMENT: 'real' })).toBe(false);
    expect(madeupSupplierGuardOn({ VERCEL_ENV: 'preview', DATA_ENVIRONMENT: 'real' })).toBe(false);
    expect(madeupSupplierGuardOn({ DATA_ENVIRONMENT: 'synthetic' })).toBe(false);
    expect(madeupSupplierGuardOn({})).toBe(false);
  });
  test('preparing, crediting and approving are refused while details are made up', async () => {
    supplier = madeupSupplier;
    for (const input of [
      prepare(),
      {
        action: 'prepare_credit',
        commandId: randomUUID(),
        invoiceId: randomUUID(),
        expectedPosition: 0,
        amountMinor: '100',
        reason: 'QA test (madeup) credit reason',
      },
      { action: 'decide', commandId: randomUUID(), proposalId: randomUUID(), decision: 'approve' },
    ])
      await expect(guard(input)).rejects.toMatchObject({
        message: madeupSupplierMessage,
        status: 409,
        code: 'MADEUP_SUPPLIER_DETAILS',
      });
  });
  test('payments and rejections never read the supplier; real details pass', async () => {
    supplier = madeupSupplier;
    calls.length = 0;
    await guard({
      action: 'decide',
      commandId: randomUUID(),
      proposalId: randomUUID(),
      decision: 'reject',
      reason: 'Wrong period',
    });
    await guard({
      action: 'payment',
      commandId: randomUUID(),
      invoiceId: randomUUID(),
      expectedPosition: 0,
      amountMinor: '100',
      receivedOn: '2026-11-02',
      method: 'bank_transfer',
      reference: 'QA test madeup ref',
    });
    expect(calls).toEqual([]);
    supplier = realSupplier;
    await expect(guard(prepare())).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });
  test('the service runs the guard before the command, in the same transaction', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('packages/delivery/src/customer-invoicing-real-staff.ts', 'utf8');
    const command = source.slice(source.indexOf('async command('));
    expect(command.indexOf('refuseMadeupIssue(db')).toBeGreaterThan(0);
    expect(command.indexOf('refuseMadeupIssue(db')).toBeLessThan(
      command.indexOf('real_invoicing_staff_command'),
    );
  });
  test('a repeated submit of a refused command is refused again', async () => {
    supplier = madeupSupplier;
    const input = prepare();
    await expect(guard(input)).rejects.toMatchObject({ status: 409 });
    await expect(guard(input)).rejects.toMatchObject({ status: 409 });
  });
});

describe('listDeliveredPublications', () => {
  test('reads nothing without a valid customer proof', async () => {
    const pool = { connect: vi.fn() };
    await expect(listDeliveredPublications(pool as never, 'not-a-proof', 'x')).resolves.toEqual([]);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('mission page read (D15)', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let s: InstanceType<typeof MissionService>;
  let missionId: string;
  beforeAll(async () => {
    f = await fixture();
    s = new MissionService(f.runtime, 'unit-test-only-secret');
    await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
    missionId = (
      await s.submit(randomUUID(), {
        objective: 'Sell in a new market',
        market: 'Spain',
        attendance: 'Yes',
        startDate: '2026-11-01',
        endDate: '2026-11-07',
        timezone: 'Europe/Madrid',
        offer: 'QA test (madeup) hotel towels',
        website: 'https://example.invalid/catalogue',
        notes: 'QA test (madeup) only',
        outcomes: ['Relevant meetings'],
        name: 'QA Person',
        company: 'QA Test Co (madeup)',
        email: 'qa-mission@example.invalid',
        acknowledged: true,
      })
    ).id;
  });
  afterAll(async () => {
    await f?.close();
  });
  test('a team member of the workspace reads one mission in the queue shape', async () => {
    const page = await s.mission(f.users.operator.ctx, missionId);
    expect(page.missions).toHaveLength(1);
    expect(page.missions[0]).toMatchObject({
      id: missionId,
      status: 'DRAFT',
      route_label: null,
    });
    expect(page.missions[0].brief.company).toBe('QA Test Co (madeup)');
    expect(page.owners.length).toBeGreaterThan(0);
  });
  test('the queue rows carry the same route label column', async () => {
    const queue = await s.queue(f.users.operator.ctx);
    expect(queue.missions.find((m) => m.id === missionId)).toHaveProperty('route_label', null);
  });
  test('another workspace, an outsider and an unknown id cannot read it', async () => {
    await expect(s.mission(f.users.other.ctx, missionId)).rejects.toMatchObject({ status: 404 });
    await expect(
      s.mission({ ...f.users.other.ctx, tenantId: f.tenantA }, missionId),
    ).rejects.toThrow();
    await expect(s.mission(f.users.outsider.ctx, missionId)).rejects.toThrow();
    await expect(s.mission(f.users.operator.ctx, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    expect(() => s.mission(f.users.operator.ctx, 'not-an-id')).toThrow();
  });
  test('the same reply submitted twice is recorded once', async () => {
    const replyId = randomUUID();
    await s.reply(f.users.operator.ctx, missionId, 'QA test (madeup) reply', replyId);
    await s.reply(f.users.operator.ctx, missionId, 'QA test (madeup) reply', replyId);
    const page = await s.mission(f.users.operator.ctx, missionId);
    expect(page.replies.filter((r: { id: string }) => r.id === replyId)).toHaveLength(1);
  });
});
