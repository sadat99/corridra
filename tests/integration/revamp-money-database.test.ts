import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { findLeaks } from './money-leaks';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerCommercialArrangements } from '../../packages/db/src/customer-commercial-arrangement-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerServiceRequestService } from '../../packages/auth/src/customer-service-requests';
import { CustomerServiceStaffService } from '../../packages/delivery/src/customer-service-staff';
import type { CommercialArrangement } from '../../packages/domain/src/commercial-arrangements';

const issuer = 'https://ep-money-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const sessionB = async () => ({
  subject: 'synthetic-money-other-owner',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const session = async () => ({
  subject: 'synthetic-money-owner',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  workspaceB: string,
  customerB: CustomerServiceRequestService,
  staff: CustomerServiceStaffService,
  customer: CustomerServiceRequestService;
const terms = (mode: CommercialArrangement['mode'] = 'SEPARATE_FEE'): CommercialArrangement => ({
  version: 1,
  mode,
  parties: {
    buyer: 'Synthetic Buyer',
    seller: 'Synthetic Actual Seller',
    supplier: 'Synthetic Factory',
    serviceProvider: 'Synthetic Corridra service team',
    serviceFeePayer: 'Synthetic Buyer',
    serviceInvoiceIssuer: 'Synthetic Corridra invoice issuer',
    servicePaymentRecipient: 'Synthetic Corridra fee recipient',
    operatingPartner: 'Synthetic Optional Operator',
    invoiceIssuer: 'Synthetic Actual Seller',
    paymentRecipient: 'Synthetic Actual Seller',
    deliveryResponsible: 'Synthetic Seller',
    warrantyResponsible: 'Synthetic Factory',
    importerOfRecord: null,
  },
  supplyPrice: ['BUNDLED_SUPPLY', 'HYBRID'].includes(mode)
    ? {
        currency: 'USD',
        amountMinor: '12000',
        includedServices: 'Synthetic sourcing and coordination included',
        exclusions: 'Synthetic international freight not included',
      }
    : null,
  fixedFeePositions: ['SEPARATE_FEE', 'HYBRID'].includes(mode) ? [1] : [],
  commission: ['SUCCESS_COMMISSION', 'HYBRID'].includes(mode)
    ? {
        payer: 'Synthetic Seller',
        recipient: 'Synthetic Corridra service team',
        trigger: 'Synthetic executed sale and independently evidenced collection',
        baseDescription: 'Synthetic net product value',
        baseMinor: '10000',
        currency: 'USD',
        rateBasisPoints: 2000,
        evidenceRequired: 'Synthetic signed contract and collection evidence',
        rounding: 'HALF_UP',
        fixedFeeTreatment: mode === 'HYBRID' ? 'CREDIT_FIXED_FEE' : 'NO_FIXED_FEE',
      }
    : null,
  sourceTerms: 'Synthetic original agreed scope and responsibilities',
  principalStatus: 'CORRIDRA_SERVICE_PROVIDER',
});
const privateEconomics = {
  acquisitionCostMinor: '987654321',
  currency: 'USD' as const,
  markupBasisPoints: 4321,
  relationshipNote: 'Synthetic PRIVATE-NOTE-XYZ',
};
const secrets = [
  '987654321',
  '4321',
  'PRIVATE-NOTE-XYZ',
  'acquisitionCost',
  'markupBasisPoints',
  'relationshipNote',
];
const newRequest = async () => {
  const programme = await new CustomerProgrammeService(f.runtime, f.auth, options, session).create({
    commandId: randomUUID(),
    workspaceId,
    name: 'Synthetic assignment ' + randomUUID(),
    reportingPurpose: 'Synthetic commercial arrangement test',
    acknowledged: true,
  });
  return customer.command({
    action: 'create',
    commandId: randomUUID(),
    workspaceId,
    contextKind: 'programme',
    contextRef: programme.id,
    serviceKey: 'interpreter-day',
    need: 'Synthetic support on an existing commercial assignment',
    preferredFrom: null,
    preferredTo: null,
    region: 'Dhaka',
  });
};
const body = async (id: string, t?: CommercialArrangement) => ({
  action: 'quote',
  commandId: randomUUID(),
  requestId: id,
  expectedSeq: (await staff.view(f.users.owner.ctx, id)).lastSeq,
  currency: 'USD',
  components: [
    {
      kind: 'service_fee',
      label: 'Synthetic coordination fee',
      treatment: 'included',
      amountMinor: t && !t.fixedFeePositions.length ? '0' : '2500',
    },
    { kind: 'tax', label: 'Synthetic tax excluded', treatment: 'not_included', amountMinor: null },
  ],
  scope: 'Synthetic sourcing support',
  exclusions: ['Synthetic no freight or payment handling'],
  assumptions: ['Synthetic customer reviews supplier terms separately'],
  deliveryTerms: 'Synthetic agreed scoped work',
  paymentTerms: 'Synthetic no payment taken here',
  validUntil: new Date(Date.now() + 86400000).toISOString(),
  ...(t ? { commercialArrangement: t, internalEconomics: privateEconomics } : {}),
});
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerCommercialArrangements(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: (await session()).subject,
    executorId: f.serviceId,
    reason: 'Synthetic money confidentiality tests only',
  });
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: (await sessionB()).subject,
    executorId: f.serviceId,
    reason: 'Synthetic money confidentiality tests only',
  });
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, session).provision({
      commandId: randomUUID(),
      name: 'Synthetic money workspace A',
    })
  ).id;
  workspaceB = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, sessionB).provision({
      commandId: randomUUID(),
      name: 'Synthetic money workspace B',
    })
  ).id;
  staff = new CustomerServiceStaffService(f.runtime);
  customer = new CustomerServiceRequestService(f.runtime, f.auth, options, session);
  customerB = new CustomerServiceRequestService(f.runtime, f.auth, options, sessionB);
});
afterAll(async () => {
  if (f) await Promise.all([f.owner.end(), f.runtime.end(), f.auth.end()]);
});

const leaks = (value: unknown) => findLeaks(value, secrets);
const sentQuote = async () => {
  const r = await newRequest();
  const input = await body(r.id, terms('SEPARATE_FEE'));
  await staff.command(f.users.owner.ctx, input);
  return r;
};

test('M-01 acquisition cost, markup and relationship note never reach a customer response', async () => {
  const r = await sentQuote();
  // The staff side does hold them, so the fixture really is private data.
  expect((await staff.view(f.users.owner.ctx, r.id)).internalSupplyEconomics['1']).toEqual(
    privateEconomics,
  );
  // The detector is not vacuous: it finds every secret on the staff side.
  expect(leaks(await staff.view(f.users.owner.ctx, r.id)).length).toBeGreaterThanOrEqual(5);
  const view = await customer.view({ workspaceId, requestId: r.id });
  const list = await customer.list({ workspaceId });
  expect(view.quote).not.toBeNull();
  expect(leaks(view)).toEqual([]);
  expect(leaks(list)).toEqual([]);
  // Deep key search as well as substring search.
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (value && typeof value === 'object')
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key);
        walk(inner);
      }
  };
  walk(view);
  walk(list);
  for (const key of [
    'internalEconomics',
    'internalSupplyEconomics',
    'acquisitionCostMinor',
    'markupBasisPoints',
    'relationshipNote',
  ])
    expect(keys.has(key)).toBe(false);
  // After acceptance the order intent and the timeline are customer views too.
  await customer.command({
    action: 'accept',
    commandId: randomUUID(),
    workspaceId,
    requestId: r.id,
    quoteVersion: 1,
    quoteDigest: view.quote!.digest,
    acknowledged: true,
  });
  const accepted = await customer.view({ workspaceId, requestId: r.id });
  expect(accepted.orderIntent).toBeTruthy();
  expect(leaks(accepted)).toEqual([]);
  // Domain events and the outbox carry ids and versions only.
  const events = await f.owner.query(
    "SELECT e.payload::text p, to_jsonb(o)::text o FROM app.domain_event e LEFT JOIN app.outbox o ON o.event_id=e.id WHERE e.aggregate_type='customer_service_request' AND e.aggregate_id=$1",
    [r.id],
  );
  expect(events.rows.length).toBeGreaterThan(1);
  expect(leaks(events.rows)).toEqual([]);
});

test('M-02 the customer quote fingerprint does not depend on the private record', async () => {
  const r = await sentQuote();
  const quote = (await customer.view({ workspaceId, requestId: r.id })).quote!;
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    const digest = async () =>
      (
        await client.query(
          'SELECT customer_private.service_quote_digest(q.id) d FROM customer_private.service_quote q WHERE q.id=$1',
          [quote.id],
        )
      ).rows[0].d;
    const before = await digest();
    expect(before).toBe(quote.digest);
    // Remove the private record inside a transaction that is rolled back, then fingerprint again.
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const cleared = await client.query(
      'UPDATE customer_private.service_quote_arrangement SET internal_economics = NULL WHERE quote_id=$1 AND internal_economics IS NOT NULL',
      [quote.id],
    );
    expect(cleared.rowCount).toBe(1);
    expect(await digest()).toBe(before);
    // And the fingerprint is not constant: a change to a public term changes it.
    await client.query(
      'UPDATE customer_private.service_quote SET scope = scope || $2 WHERE id=$1',
      [quote.id, ' changed'],
    );
    expect(await digest()).not.toBe(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('M-08 a customer of another workspace gets the uniform denial and learns nothing', async () => {
  const r = await sentQuote();
  const probe = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return error as Error & { status?: number };
    }
    throw new Error('expected a denial');
  };
  const unknown = await probe(() =>
    customerB.view({ workspaceId: workspaceB, requestId: randomUUID() }),
  );
  const own = await probe(() => customerB.view({ workspaceId: workspaceB, requestId: r.id }));
  const crossed = await probe(() => customerB.view({ workspaceId, requestId: r.id }));
  // The same words and status as a request that does not exist: nothing says A's request is real.
  expect(own.message).toBe(unknown.message);
  expect(own.status).toBe(unknown.status);
  expect(crossed.message).toMatch(/./);
  for (const error of [own, crossed]) {
    expect(error.message).not.toContain(r.id);
    expect(error.message).not.toContain('Synthetic');
    expect(leaks(error.message)).toEqual([]);
  }
  const accept = await probe(() =>
    customerB.command({
      action: 'accept',
      commandId: randomUUID(),
      workspaceId: workspaceB,
      requestId: r.id,
      quoteVersion: 1,
      quoteDigest: '0'.repeat(64),
      acknowledged: true,
    }),
  );
  expect(accept.message).not.toContain(r.id);
  // Workspace B's own list never shows A's request.
  expect(JSON.stringify(await customerB.list({ workspaceId: workspaceB }))).not.toContain(r.id);
});

test('M-09 the accepted quote version is unchanged, earlier versions are kept and the customer cannot edit', async () => {
  const r = await newRequest();
  await staff.command(f.users.owner.ctx, await body(r.id, terms('SEPARATE_FEE')));
  const first = await customer.view({ workspaceId, requestId: r.id });
  const firstRow = (
    await f.owner.query(
      'SELECT scope,exclusions,assumptions,delivery_terms,payment_terms,currency FROM customer_private.service_quote WHERE request_id=$1 AND version=1',
      [r.id],
    )
  ).rows[0];
  // Staff replace it with version 2; the customer now sees version 2.
  await staff.command(f.users.owner.ctx, {
    ...(await body(r.id, terms('SEPARATE_FEE'))),
    scope: 'Synthetic sourcing support, revised scope',
  });
  const second = await customer.view({ workspaceId, requestId: r.id });
  expect(second.quote!.version).toBe(2);
  expect(second.quote!.digest).not.toBe(first.quote!.digest);
  // Both versions are listed on the customer timeline.
  const quoted = second.timeline.filter((e: { kind: string }) => e.kind === 'quoted');
  expect(quoted.map((e: { quoteVersion: number | null }) => e.quoteVersion)).toEqual([1, 2]);
  // No customer action edits a quote.
  expect(second.actions).not.toContain('revise');
  expect(second.actions).toEqual(expect.arrayContaining(['accept', 'decline']));
  await customer.command({
    action: 'accept',
    commandId: randomUUID(),
    workspaceId,
    requestId: r.id,
    quoteVersion: 2,
    quoteDigest: second.quote!.digest,
    acknowledged: true,
  });
  const accepted = await customer.view({ workspaceId, requestId: r.id });
  // The accepted version renders exactly as it was accepted.
  expect(accepted.quote).toEqual(second.quote);
  expect(accepted.orderIntent!.quoteVersion).toBe(2);
  expect(accepted.actions).not.toContain('revise');
  expect(accepted.actions).not.toContain('accept');
  // Version 1 is unchanged in the record.
  const after = (
    await f.owner.query(
      'SELECT scope,exclusions,assumptions,delivery_terms,payment_terms,currency FROM customer_private.service_quote WHERE request_id=$1 AND version=1',
      [r.id],
    )
  ).rows[0];
  expect(after).toEqual(firstRow);
});
