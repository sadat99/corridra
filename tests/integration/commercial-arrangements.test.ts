import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { withTenant } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerCommercialArrangements } from '../../packages/db/src/customer-commercial-arrangement-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerServiceRequestService } from '../../packages/auth/src/customer-service-requests';
import { CustomerServiceStaffService } from '../../packages/delivery/src/customer-service-staff';
import {
  commercialArrangement,
  commissionEstimate,
  markedUpSupplyPrice,
  type CommercialArrangement,
} from '../../packages/domain/src/commercial-arrangements';

const issuer =
  'https://ep-arrangement-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const session = async () => ({
  subject: 'synthetic-arrangement-owner',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
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
  acquisitionCostMinor: '10000',
  currency: 'USD' as const,
  markupBasisPoints: 2000,
  relationshipNote: 'Synthetic confidential supplier relationship cost',
};
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
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: (await session()).subject,
    executorId: f.serviceId,
    reason: 'Synthetic commercial arrangement acceptance tests only',
  });
  workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, session).provision({
      commandId: randomUUID(),
      name: 'Synthetic arrangement workspace',
    })
  ).id;
  staff = new CustomerServiceStaffService(f.runtime);
  customer = new CustomerServiceRequestService(f.runtime, f.auth, options, session);
});
afterAll(async () => {
  if (f) await Promise.all([f.owner.end(), f.runtime.end(), f.auth.end()]);
});

test('exact markup is not a commission, and commission stays a conditional estimate', () => {
  expect(markedUpSupplyPrice(privateEconomics)).toBe('12000');
  expect(commissionEstimate(terms('SUCCESS_COMMISSION').commission!)).toBe('2000');
  expect(
    commissionEstimate({
      ...terms('SUCCESS_COMMISSION').commission!,
      baseMinor: '3',
      rateBasisPoints: 5000,
    }),
  ).toBe('2');
  expect(
    commercialArrangement.safeParse({ ...terms('BUNDLED_SUPPLY'), fixedFeePositions: [1] }).success,
  ).toBe(false);
  expect(
    commercialArrangement.safeParse({
      ...terms('HYBRID'),
      commission: { ...terms('HYBRID').commission!, fixedFeeTreatment: 'NO_FIXED_FEE' },
    }).success,
  ).toBe(false);
});

test('additive installation preserves every legacy quote and digest, and repeat installation is unchanged', async () => {
  const r = await newRequest();
  await staff.command(f.users.owner.ctx, await body(r.id));
  const before = (await customer.view({ workspaceId, requestId: r.id })).quote;
  await migrateCustomerCommercialArrangements(f.owner);
  expect((await customer.view({ workspaceId, requestId: r.id })).quote).toEqual(before);
  const installed = (
    await f.owner.query('SELECT * FROM customer_commercial_arrangement_migrations.applied')
  ).rows;
  await migrateCustomerCommercialArrangements(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_commercial_arrangement_migrations.applied')).rows,
  ).toEqual(installed);
});

for (const mode of ['BUNDLED_SUPPLY', 'SEPARATE_FEE', 'SUCCESS_COMMISSION', 'HYBRID'] as const)
  test(
    mode +
      ' persists exact public terms, isolates procurement costs and accepts only the displayed digest',
    async () => {
      const r = await newRequest(),
        t = terms(mode),
        input = await body(r.id, t);
      await staff.command(f.users.owner.ctx, input);
      const page = await customer.view({ workspaceId, requestId: r.id });
      expect(page.quote!.commercialArrangement).toEqual(t);
      expect(JSON.stringify(page)).not.toContain(privateEconomics.relationshipNote);
      expect(JSON.stringify(page)).not.toContain('acquisitionCostMinor');
      expect(page.quote!.fixedTotalMinor).toBe(t.fixedFeePositions.length ? '2500' : '0');
      const staffPage = await staff.view(f.users.owner.ctx, r.id);
      expect(staffPage.internalSupplyEconomics['1']).toEqual(privateEconomics);
      await expect(
        staff.command(f.users.owner.ctx, {
          ...input,
          commercialArrangement: { ...t, sourceTerms: 'Synthetic changed after send' },
        }),
      ).rejects.toThrow(/conflict/i);
      await expect(staff.view(f.users.other.ctx, r.id)).rejects.toThrow();
      await expect(
        customer.command({
          action: 'accept',
          commandId: randomUUID(),
          workspaceId,
          requestId: r.id,
          quoteVersion: 1,
          quoteDigest: '0'.repeat(64),
          acknowledged: true,
        }),
      ).rejects.toThrow(/changed/i);
      await customer.command({
        action: 'accept',
        commandId: randomUUID(),
        workspaceId,
        requestId: r.id,
        quoteVersion: 1,
        quoteDigest: page.quote!.digest,
        acknowledged: true,
      });
      const accepted = await customer.view({ workspaceId, requestId: r.id });
      expect(accepted.orderIntent!.paymentTaken).toBe(false);
      expect(accepted.orderIntent!.billing).toBe('billing_not_enabled');
      expect(accepted.orderIntent!.fixedTotalMinor).toBe(page.quote!.fixedTotalMinor);
    },
  );

test('direct SQL rejects role denial, duplicate fees and unreviewed principal sales without appending a quote', async () => {
  const r = await newRequest(),
    base = await body(r.id, terms());
  const { action, commandId, commercialArrangement: t, internalEconomics, ...payload } = base;
  expect(action).toBe('quote');
  for (const bad of [
    { ...t!, fixedFeePositions: [1, 1] },
    { ...t!, principalStatus: 'PRINCIPAL_REVIEW_REQUIRED' },
    { ...t!, parties: { ...t!.parties, seller: null } },
  ])
    await expect(
      withTenant(f.runtime, f.users.owner.ctx, 'delivery.share', async ({ db }) =>
        db.query('SELECT app.service_request_arrangement_quote($1,$2,$3,$4)', [
          commandId,
          JSON.stringify(payload),
          JSON.stringify(bad),
          JSON.stringify(internalEconomics),
        ]),
      ),
    ).rejects.toThrow();
  await expect(staff.command(f.users.viewer.ctx, base)).rejects.toThrow();
  await expect(
    f.runtime.query('SELECT * FROM customer_private.service_quote_arrangement'),
  ).rejects.toThrow();
  expect((await customer.view({ workspaceId, requestId: r.id })).quote).toBeNull();
});

test('arrangements are immutable and cannot be reattached to a previously issued quote command', async () => {
  const r = await newRequest(),
    input = await body(r.id);
  await staff.command(f.users.owner.ctx, input);
  await expect(
    staff.command(f.users.owner.ctx, { ...input, commercialArrangement: terms() }),
  ).rejects.toThrow(/conflict/i);
  await expect(
    f.owner.query(
      'UPDATE customer_private.service_quote_arrangement SET public_terms=public_terms',
    ),
  ).rejects.toThrow(/append|immutable|rewrite/i);
});

test('a delayed metadata write rechecks staff assurance and rolls back the quote and its event chain', async () => {
  const r = await newRequest(),
    input = await body(r.id, terms());
  await f.owner.query(
    `CREATE FUNCTION app.arrangement_expiry_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
  );
  await f.owner.query(
    'CREATE TRIGGER arrangement_expiry_fixture AFTER INSERT ON customer_private.service_quote_arrangement FOR EACH ROW EXECUTE FUNCTION app.arrangement_expiry_fixture()',
  );
  try {
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '299.5 seconds' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await expect(staff.command(f.users.owner.ctx, input)).rejects.toThrow(
      /assurance|authenticator|expired/i,
    );
  } finally {
    await f.owner.query(
      'DROP TRIGGER arrangement_expiry_fixture ON customer_private.service_quote_arrangement',
    );
    await f.owner.query('DROP FUNCTION app.arrangement_expiry_fixture()');
    await f.owner.query(
      'UPDATE identity.assurance SET verified_at=clock_timestamp() WHERE session_id=$1',
      [f.users.owner.sessionId],
    );
  }
  expect((await customer.view({ workspaceId, requestId: r.id })).quote).toBeNull();
  expect((await staff.view(f.users.owner.ctx, r.id)).lastSeq).toBe(1);
});

test('the same staff identity cannot replay or read a quote through another handling workspace', async () => {
  const r = await newRequest(),
    input = await body(r.id, terms());
  await staff.command(f.users.owner.ctx, input);
  await rawContext(
    f.owner,
    f.users.other.ctx,
    "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'owner')",
    [f.tenantB, f.users.owner.id],
  );
  const otherContext = { ...f.users.owner.ctx, tenantId: f.tenantB };
  await expect(staff.command(otherContext, input)).rejects.toThrow(/team|access/i);
  await expect(staff.view(otherContext, r.id)).rejects.toThrow(/team|access/i);
});
