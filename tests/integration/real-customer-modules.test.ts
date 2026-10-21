import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { CustomerServiceStaffService } from '../../packages/delivery/src/customer-service-staff';
import { AccessService } from '../../packages/auth/src/access';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerProgrammeTermsService } from '../../packages/auth/src/customer-programme-terms';
import { CustomerProgrammePricingService } from '../../packages/auth/src/customer-programme-pricing';
import { CustomerServiceRequestService } from '../../packages/auth/src/customer-service-requests';
let f: Awaited<ReturnType<typeof fixture>>;
let workspaceId: string;
let intakeTenantId: string;
let programmeId: string;
const issuer =
  'https://ep-real-modules-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const session = async () => ({
  subject: 'real-modules-owner',
  email: 'owner@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 60000),
});
beforeAll(async () => {
  vi.stubEnv('DATA_ENVIRONMENT', 'real');
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'local-bootstrap-fixture',
    executorId: f.serviceId,
    reason: 'Local fixture authority only; never a production customer',
  });
  await f.owner.query(
    "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Local functional fixture with owner-approved real use and deferred scanning',
  });
  intakeTenantId = (
    await f.owner.query('SELECT intake_tenant_id FROM customer_private.real_use_configuration')
  ).rows[0].intake_tenant_id;
  const workspace = await new CustomerWorkspaceService(
    f.runtime,
    f.auth,
    options,
    session,
  ).provision({ commandId: randomUUID(), name: 'Dhaka Imports' });
  workspaceId = workspace.id;
  expect(workspace.synthetic).toBe(false);
});
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
test('real staff discover their authorized scope and preserve exact quote and acceptance amounts', async () => {
  // This test creates its own request so no ordering against the other cases is required.
  const staff = new CustomerServiceStaffService(f.runtime);
  const ctx = { ...f.users.owner.ctx, tenantId: intakeTenantId };
  const tenants = await new AccessService(f.runtime).tenants(f.users.owner.token);
  expect(tenants.some((row) => row.id === intakeTenantId)).toBe(true);
  expect(tenants[0].id).toBe(intakeTenantId);
  expect(tenants.some((row) => row.id === f.tenantA)).toBe(true);
  const services = new CustomerServiceRequestService(f.runtime, f.auth, options, session);
  const workspaceId = (
    await new CustomerWorkspaceService(f.runtime, f.auth, options, session).provision({
      commandId: randomUUID(),
      name: 'Supplier quote workspace',
    })
  ).id;
  const programme = await new CustomerProgrammeService(f.runtime, f.auth, options, session).create({
    commandId: randomUUID(),
    workspaceId,
    name: 'Supplier preparation',
    reportingPurpose: 'Prepare supplier meetings and agree delivery scope',
    acknowledged: true,
  });
  const request = await services.command({
    action: 'create',
    commandId: randomUUID(),
    workspaceId,
    contextKind: 'programme',
    contextRef: programme.id,
    serviceKey: 'managed-sourcing',
    need: 'Prepare supplier discussions',
    preferredFrom: null,
    preferredTo: null,
    region: 'Scope agreed per request',
  });
  const queue = await staff.list(ctx);
  expect(queue.requests.some((row: { id: string }) => row.id === request.id)).toBe(true);
  const detail = await staff.view(ctx, request.id);
  await staff.command(ctx, {
    action: 'quote',
    commandId: randomUUID(),
    requestId: request.id,
    expectedSeq: detail.lastSeq,
    currency: 'EUR',
    components: [
      {
        kind: 'service_fee',
        label: 'Supplier meeting preparation',
        treatment: 'included',
        amountMinor: '12345',
      },
      {
        kind: 'local_cost',
        label: 'Local travel estimate',
        treatment: 'estimate',
        amountMinor: '300',
      },
      {
        kind: 'tax',
        label: 'Tax confirmed separately',
        treatment: 'not_included',
        amountMinor: null,
      },
    ],
    scope: 'Prepare supplier discussions for the agreed requirements',
    exclusions: ['Participant travel costs'],
    assumptions: ['Dates and supplier availability need agreement'],
    deliveryTerms: 'Deliver the agreed preparation before the meetings',
    paymentTerms: 'Payment arrangements require separate agreement',
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  const shown = await services.view({ workspaceId, requestId: request.id });
  expect(shown.quote).toMatchObject({
    currency: 'EUR',
    fixedTotalMinor: '12345',
    estimatedTotalMinor: '300',
  });
  const accepted = await services.command({
    action: 'accept',
    commandId: randomUUID(),
    workspaceId,
    requestId: request.id,
    quoteVersion: shown.quote!.version,
    quoteDigest: shown.quote!.digest,
    acknowledged: true,
  });
  expect(accepted.status).toBe('accepted');
  expect((await services.view({ workspaceId, requestId: request.id })).orderIntent).toMatchObject({
    currency: 'EUR',
    fixedTotalMinor: '12345',
    estimatedTotalMinor: '300',
    paymentTaken: false,
    billing: 'billing_not_enabled',
  });
  await expect(staff.list({ ...f.users.viewer.ctx, tenantId: intakeTenantId })).rejects.toThrow();
});
test('real company profiles and programmes accept normal business details with real provenance', async () => {
  const profiles = new CustomerOrganisationProfileService(f.runtime, f.auth, options, session);
  const profile = await profiles.command({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    reason: 'Create the company profile',
    acknowledged: true,
    legalName: 'Dhaka Imports Ltd',
    countryCode: 'BD',
    website: 'https://business.test/catalogue',
    commercialRoles: ['BUYER'],
    sectors: ['Machinery'],
    sizeBand: '1-10',
    summary: 'Imports machinery for the local market',
  });
  expect(profile.profile?.legalName).toBe('Dhaka Imports Ltd');
  const programme = await new CustomerProgrammeService(f.runtime, f.auth, options, session).create({
    commandId: randomUUID(),
    workspaceId,
    name: 'China machinery visits',
    reportingPurpose: 'Prepare supplier meetings for participating companies',
    acknowledged: true,
  });
  programmeId = programme.id;
  expect(programmeId).toMatch(/^[a-f0-9-]{36}$/);
  const listed = await new CustomerProgrammeService(f.runtime, f.auth, options, session).list({
    workspaceId,
  });
  expect(listed.programmes[0].synthetic).toBe(false);
});
test('real terms and pricing keep versioned content and exact original minor amounts', async () => {
  const terms = new CustomerProgrammeTermsService(f.runtime, f.auth, options, session);
  const result = await terms.publishTerms({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    included: 'Supplier meeting preparation',
    excluded: 'Participant travel costs',
    cancellationTerms: 'Contact the organiser before cancelling',
    changeTerms: 'Changes require organiser agreement',
    feesApply: true,
    feeNote: 'Fees are agreed before participation',
    reason: 'Publish the first programme terms',
  });
  expect(result.terms.included).toBe('Supplier meeting preparation');
  const pricing = new CustomerProgrammePricingService(f.runtime, f.auth, options, session);
  const saved = await pricing.saveTemplate({
    commandId: randomUUID(),
    workspaceId,
    expectedVersion: 0,
    templateId: null,
    name: 'Standard participation',
    description: 'Participation fee schedule',
    content: {
      currency: 'EUR',
      tiers: [{ label: 'Standard', amountMinor: '12345' }],
      earlyBird: [],
      groupDiscounts: [],
    },
    retired: false,
  });
  expect(saved.template.name).toBe('Standard participation');
  const templates = await pricing.templates({ workspaceId });
  expect(JSON.stringify(templates.templates)).toContain('12345');
  expect(JSON.stringify(templates.templates)).toContain('EUR');
});
test('real service requests expose source-backed request types and exclude invented services', async () => {
  const services = new CustomerServiceRequestService(f.runtime, f.auth, options, session);
  const catalogue = await services.catalogue();
  expect(catalogue.services).toHaveLength(3);
  expect(catalogue.services.every((s) => s.synthetic === false)).toBe(true);
  await services.command({
    action: 'create',
    commandId: randomUUID(),
    workspaceId,
    contextKind: 'programme',
    contextRef: programmeId,
    serviceKey: 'managed-sourcing',
    need: 'Prepare machinery supplier visits',
    preferredFrom: null,
    preferredTo: null,
    region: 'Scope agreed per request',
  });
  const listed = await services.list({ workspaceId });
  expect(listed.requests).toHaveLength(1);
  expect(listed).toMatchObject({ synthetic: false });
  const other = new CustomerServiceRequestService(f.runtime, f.auth, options, async () => ({
    subject: 'different-real-customer',
    email: 'other@business.test',
    emailVerified: true,
    expiresAt: new Date(Date.now() + 60000),
  }));
  await expect(other.list({ workspaceId })).rejects.toThrow();
});

test('real organisation links accept supporting website evidence without declaring the company verified', async () => {
  const { CustomerOrganisationLinkService } =
    await import('../../packages/auth/src/customer-organisation-links');
  const links = new CustomerOrganisationLinkService(f.runtime, f.auth, options, session);
  await links.command({
    action: 'file',
    commandId: randomUUID(),
    workspaceId,
    expectedProfileVersion: 1,
    kind: 'PROPOSED_NEW',
    organisationId: null,
    note: 'Review our company information',
  });
  const claim = (
    await f.owner.query(
      'SELECT id,note FROM customer_private.organisation_link_claim WHERE tenant_id=$1',
      [workspaceId],
    )
  ).rows[0];
  expect(claim.note).toBe('Review our company information');
  await links.command({
    action: 'add_evidence',
    commandId: randomUUID(),
    workspaceId,
    claimId: claim.id,
    expectedVersion: 1,
    evidenceKind: 'WEBSITE_STATEMENT',
    statement: 'The company website describes our products',
    url: 'https://business.test/catalogue',
  });
  const evidence = (
    await f.owner.query(
      'SELECT url FROM customer_private.organisation_link_evidence WHERE claim_id=$1',
      [claim.id],
    )
  ).rows;
  expect(evidence).toEqual([{ url: 'https://business.test/catalogue' }]);
  const { StaffOrganisationLinkService } =
    await import('../../packages/auth/src/customer-organisation-links');
  const staff = new StaffOrganisationLinkService(f.runtime);
  const ctx = { ...f.users.owner.ctx, tenantId: intakeTenantId };
  expect(
    (await staff.queue(ctx, { scope: 'open' })).items.some((row) => row.claimId === claim.id),
  ).toBe(true);
  const review = await staff.review(ctx, claim.id);
  expect(review.claimId).toBe(claim.id);
  await staff.decide(ctx, {
    commandId: randomUUID(),
    claimId: claim.id,
    expectedVersion: review.version,
    decision: 'request_evidence',
    reason: 'Please provide current registration information',
    internalNote: null,
    organisationId: null,
    shareConfirmed: false,
  });
  expect((await staff.review(ctx, claim.id)).state).toBe('needs_evidence');
  const profile = await new CustomerOrganisationProfileService(
    f.runtime,
    f.auth,
    options,
    session,
  ).view({ workspaceId });
  expect(profile.verified).toBe(false);
});
