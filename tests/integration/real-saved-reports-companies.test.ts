import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerCompanyService } from '../../packages/auth/src/customer-companies';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { importColumns } from '../../packages/delivery/src/import';
import { MissionService } from '../../packages/missions/src/index';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';

// Saved commercial reports and company continuity, run with a real session against real delivery.
// The sample suites (customer-saved-missions, customer-companies) prove the same rules for sample workspaces.
let f: Awaited<ReturnType<typeof fixture>>;
let intakeTenantId: string;
let delivery: DeliveryService;
let link: { id: string; token: string };
let resourceId: string;
const issuer =
  'https://ep-real-reports-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const saved = (who = 'reports-alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, sessionFor(who));
const companies = (who = 'reports-alice') =>
  new CustomerCompanyService(f.runtime, f.auth, options, sessionFor(who));
const workspaces = (who: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(who));
const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
const save = (token: string, commandId = randomUUID()) => ({
  action: 'save' as const,
  commandId,
  token,
  acknowledged: true as const,
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
  const ctx = {
    ...f.users.owner.ctx,
    tenantId: intakeTenantId,
    purpose: 'commercial_qualification',
  };
  const missions = new MissionService(f.runtime, 'real-reports-fixture-secret', 'real');
  delivery = new DeliveryService(f.runtime, missions, 'real-reports-fixture-secret');
  const unexpected = async () => {
    throw new Error('This test performs no file or scan operation');
  };
  const evidence = new EvidenceService(
    f.runtime,
    { put: unexpected, get: unexpected },
    { scan: unexpected },
  );
  const research = new CounterpartyService(f.runtime);
  // A real mission arrives through a staff programme import, as in production.
  const programme = await delivery.programme(ctx, {
    commandId: randomUUID(),
    name: 'Supplier visits',
    reportingPurpose: 'Prepare the participating company for supplier discussions',
  });
  const values: Record<string, string> = {
    participant_reference: 'company-1',
    company: 'Machinery participant',
    name: 'Participant contact',
    email: 'participant@business.test',
    objective: 'Source suppliers',
    market: 'China',
    offer: 'Find machinery suppliers for the planned factory expansion',
    attendance: 'No',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Dhaka',
    website: 'https://business.test/catalogue',
    outcomes: 'Relevant meetings',
    notes: '',
    companyCountry: 'BD',
    marketCode: 'CN',
    missionJob: 'sourcing',
  };
  const csv = Buffer.from(
    importColumns.join(',') + '\n' + importColumns.map((key) => values[key]).join(',') + '\n',
  );
  const preview = await delivery.preview(ctx, programme.id, randomUUID(), csv, 'CSV');
  const confirmed = await delivery.confirm(ctx, {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.owner.id,
    counts: preview.counts,
    acknowledged: true,
  });
  const missionId = confirmed.rows[0].missionId as string;
  for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
    await missions.command(ctx, {
      id: missionId,
      version: i + 1,
      commandId: randomUUID(),
      action,
      ownerId: f.users.owner.id,
      reason: 'Qualified from the supplied company details',
      nextAction: 'Review relevant supplier introductions',
      dueAt: future(),
      marketCode: 'CN',
      targetProfile: 'Machinery manufacturers with export experience',
    });
  const source = await evidence.createSource(ctx, {
    kind: 'public_record',
    classification: 'PUBLIC',
    locator: 'https://business.test/registry',
    observedAt: new Date().toISOString(),
    purpose: 'commercial_qualification',
    retentionUntil: future(7),
    aiPolicy: 'DENY',
  });
  const org = await research.command(ctx, {
    action: 'ingest',
    commandId: randomUUID(),
    sourceId: source.id,
    name: 'Machinery Supplier Company',
    country: 'CN',
    domain: 'supplier.business.test',
    address: 'Company business address',
    identifierType: 'registry',
    identifier: randomUUID(),
  });
  const relationship = await research.command(ctx, {
    action: 'relationship',
    commandId: randomUUID(),
    organisationId: org.id,
    ownerId: f.users.owner.id,
    visibility: 'OWNER',
    note: 'Private negotiation details never shown to the customer',
  });
  const contact = await research.command(ctx, {
    action: 'contact',
    commandId: randomUUID(),
    relationshipId: relationship.id,
    sourceId: source.id,
    name: 'Supplier contact',
    jobTitle: 'Sales manager',
    email: 'sales@supplier.business.test',
    validUntil: future(6),
  });
  const claim = await evidence.createClaim(ctx, {
    sourceId: source.id,
    statement: 'The company states it exports machinery',
  });
  await research.command(ctx, {
    action: 'attribute',
    commandId: randomUUID(),
    organisationId: org.id,
    kind: 'requirement',
    claimId: claim.id,
    validUntil: future(6),
  });
  const target = await research.command(ctx, {
    action: 'target',
    commandId: randomUUID(),
    missionId,
    relationshipId: relationship.id,
    contactId: contact.id,
    claimIds: [claim.id],
    fit: 'POSSIBLE',
    rationale: 'Declared exports fit the requested machinery',
    uncertainty: 'No buyer interest verified',
    gaps: 'Need an actual supplier response',
    nextAction: 'Review an introduction',
    dueAt: future(),
  });
  const publication = await delivery.publication(ctx, {
    commandId: randomUUID(),
    missionId,
    title: 'Approved machinery sourcing scope',
    company: 'Machinery participant',
    objective: 'Source suppliers',
    brief: 'Approved requirements without private contacts or negotiation notes.',
    nextAction: 'Review the approved supplier',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  await new DeliveryExperienceService(f.runtime).publication(ctx, {
    commandId: randomUUID(),
    publicationId: publication.id,
    requirementId: null,
    targetIds: [target.id],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason: 'Explicitly approve this original target and qualification only',
  });
  link = await delivery.share(ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Real commercial report for the participating company',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  for (const who of ['reports-alice', 'reports-bob'])
    await workspaces(who).provision({ commandId: randomUUID(), name: 'Workspace of ' + who });
}, 240000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});

test('a real session saves a real report link and stores only the hash of the bearer', async () => {
  const cmd = save(link.token);
  const first = await saved().command(cmd);
  resourceId = first.id;
  expect(await saved().command(cmd)).toEqual(first);
  const row = (
    await f.owner.query('SELECT * FROM customer_private.saved_mission WHERE id=$1', [resourceId])
  ).rows[0];
  expect(row.token_hash).toBe(createHash('sha256').update(link.token).digest('hex'));
  expect(JSON.stringify(row)).not.toContain(link.token);
  expect(row.link_tenant_id).toBe(intakeTenantId);
  const owners = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.saved_mission WHERE link_id=$1',
      [link.id],
    )
  ).rows[0].n;
  expect(owners).toBe(1);
});

test('the real report opens with the approved content and lists with its title, without the bearer', async () => {
  const viewed = await saved().command({
    action: 'view',
    resourceId,
    audience: 'CLIENT_PROGRESS',
  });
  expect(viewed.resourceId).toBe(resourceId);
  expect(viewed.report.scopeId).toBe(link.id);
  expect(viewed.report.missions[0]).toMatchObject({
    title: 'Approved machinery sourcing scope',
    company: 'Machinery participant',
  });
  expect(viewed.report.missions[0].experience.shortlist).toHaveLength(1);
  const list = await saved().list();
  expect(list.missions.find((m: { id: string }) => m.id === resourceId)).toMatchObject({
    available: true,
    title: 'Approved machinery sourcing scope',
  });
  expect(JSON.stringify(list)).not.toContain(link.token);
  expect(JSON.stringify(viewed)).not.toMatch(
    /Private negotiation details|sales@supplier|Supplier contact/i,
  );
});

test('the anonymous public link path still refuses a real report, so a real report opens only inside a verified account', async () => {
  await expect(
    delivery.external({ action: 'view', token: link.token, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toThrow(/Link unavailable or expired/);
});

test('the real-use registry records the report-link migration', async () => {
  const applied = (
    await f.owner.query('SELECT name FROM customer_real_use_migrations.applied ORDER BY name')
  ).rows.map((r: { name: string }) => r.name);
  expect(applied).toContain('0009_real_report_links.sql');
});

test('another real customer cannot read the saved report, and a bad bearer saves nothing', async () => {
  await expect(
    saved('reports-bob').command({ action: 'view', resourceId, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await saved('reports-bob').list()).missions).toEqual([]);
  await expect(saved().command(save('f'.repeat(64)))).rejects.toMatchObject({ code: '42501' });
});

test('removing the saved navigation is idempotent and a stale save does not revive it', async () => {
  const bob = await saved('reports-bob').command(save(link.token));
  expect(bob.id).not.toBe(resourceId);
  const removal = { action: 'remove' as const, resourceId: bob.id, commandId: randomUUID() };
  const removed = await saved('reports-bob').command(removal);
  expect(await saved('reports-bob').command(removal)).toEqual(removed);
  expect((await saved('reports-bob').list()).missions).toEqual([]);
  // The creator's own copy is untouched.
  expect((await saved().list()).missions.some((m: { id: string }) => m.id === resourceId)).toBe(
    true,
  );
});

test('the company portfolio keeps the approved context of the real report and nothing private', async () => {
  const page = await companies().list();
  expect(page.companies).toHaveLength(1);
  const company = page.companies[0];
  expect(company.contexts).toHaveLength(1);
  const report = await saved().command({
    action: 'view',
    audience: 'CLIENT_PROGRESS',
    resourceId: company.contexts[0].resourceId,
  });
  const original = report.report.missions[0].experience.shortlist.find(
    (t: { id: string }) => t.id === company.contexts[0].targetId,
  );
  expect(company.contexts[0]).toMatchObject({
    company: 'Machinery Supplier Company',
    country: original.country,
    fit: original.fit,
    rationale: original.rationale,
  });
  const text = JSON.stringify(page);
  expect(text).not.toMatch(/Private negotiation details|sales@supplier|Supplier contact/i);
  expect(text).not.toContain('organisationId');
});

test('another real customer who removed the report has no company portfolio', async () => {
  expect((await companies('reports-bob').list()).companies).toEqual([]);
});
