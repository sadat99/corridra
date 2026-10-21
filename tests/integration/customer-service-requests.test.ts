import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { accessFixture, future } from './access-fixture';
import { rawContext } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerCompanyService } from '../../packages/auth/src/customer-companies';
import {
  CustomerServiceRequestService,
  customerServiceCommandInput,
  customerServiceRequestsEnabled,
} from '../../packages/auth/src/customer-service-requests';
import {
  CustomerServiceStaffService,
  staffServiceCommandInput,
} from '../../packages/delivery/src/customer-service-staff';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';

// Invented provider-session fixtures exercise the real restricted SQL logins and the real staff session rows.
const issuer = 'https://ep-service-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
let f: Awaited<ReturnType<typeof accessFixture>>;
let workspaceId: string,
  otherWorkspace: string,
  programmeId: string,
  requestRef: string,
  companyRef: string;
let staff: CustomerServiceStaffService;
const members: Record<string, string> = {};
let before: Awaited<ReturnType<typeof snapshot>>;
const session = (person: string): CustomerSession => ({
  subject: 'synthetic-service-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const svc = (person = 'alice') =>
  new CustomerServiceRequestService(f.runtime, f.auth, options, async () => session(person));
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const roles = (person = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const submitted = (person = 'alice') =>
  new CustomerRequestService(f.runtime, f.auth, options, async () => session(person));
const saved = (person = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(person));
const portfolio = (person = 'alice') =>
  new CustomerCompanyService(f.runtime, f.auth, options, async () => session(person));
const staffCtx = () => f.users.owner.ctx;
const otherStaffCtx = () => f.users.other.ctx;
const need = 'Synthetic need: an interpreter for two supplier meetings in one city';
const freshProgramme = async () =>
  (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic programme ' + randomUUID().slice(0, 8),
      reportingPurpose: 'Fictional programme used to test paid-service requests only',
      acknowledged: true,
    })
  ).id as string;
// Each request gets its own programme unless the test names the place, so open requests never collide.
const create = async (over: Record<string, unknown> = {}, person = 'alice') =>
  svc(person).command({
    action: 'create',
    commandId: randomUUID(),
    workspaceId,
    contextKind: 'programme',
    contextRef:
      (over.contextKind ?? 'programme') === 'programme' && !over.contextRef
        ? await freshProgramme()
        : over.contextRef,
    serviceKey: 'interpreter-day',
    need,
    preferredFrom: '2026-12-01',
    preferredTo: '2026-12-03',
    region: 'Dhaka',
    ...over,
  });
type Seen = Omit<Awaited<ReturnType<CustomerServiceRequestService['view']>>, 'quote'> & {
  quote: NonNullable<Awaited<ReturnType<CustomerServiceRequestService['view']>>['quote']>;
};
const view = async (id: string, person = 'alice', target = workspaceId) =>
  (await svc(person).view({ workspaceId: target, requestId: id })) as Seen;
const act = (action: string, id: string, extra: Record<string, unknown> = {}, person = 'alice') =>
  svc(person).command({
    action,
    commandId: randomUUID(),
    workspaceId,
    requestId: id,
    ...extra,
  });
const seq = async (id: string) => (await staff.view(staffCtx(), id)).lastSeq as number;
const quoteBody = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  components: [
    {
      kind: 'service_fee',
      label: 'Synthetic interpreter day fee',
      treatment: 'included',
      amountMinor: '45000',
    },
    {
      kind: 'local_cost',
      label: 'Synthetic local transport estimate',
      treatment: 'estimate',
      amountMinor: '6000',
    },
    {
      kind: 'pass_through',
      label: 'Synthetic meeting room passed through at cost',
      treatment: 'included',
      amountMinor: '12000',
    },
    {
      kind: 'tax',
      label: 'Synthetic local sales tax, not included in this price',
      treatment: 'not_included',
      amountMinor: null,
    },
  ],
  scope: 'Synthetic scope: one interpreter for one day of two meetings in Dhaka',
  exclusions: [
    'Synthetic exclusion: interpreter travel outside Dhaka',
    'Synthetic exclusion: written translation',
  ],
  assumptions: ['Synthetic assumption: both meetings are in the same building'],
  deliveryTerms: 'Synthetic delivery terms: on the agreed day, eight hours',
  paymentTerms: 'Synthetic payment terms are settled later; nothing is charged now',
  validUntil: future(7),
  ...over,
});
const quote = async (id: string, over: Record<string, unknown> = {}, ctx = staffCtx()) =>
  staff.command(ctx, {
    action: 'quote',
    commandId: randomUUID(),
    requestId: id,
    expectedSeq: await seq(id),
    ...quoteBody(over),
  });
const progress = async (
  action: string,
  id: string,
  note = 'Synthetic note for the customer to read',
) =>
  staff.command(staffCtx(), {
    action,
    commandId: randomUUID(),
    requestId: id,
    expectedSeq: await seq(id),
    customerNote: note,
  });
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.service_request) requests,
 (SELECT count(*)::int FROM customer_private.service_request_event) timeline,
 (SELECT count(*)::int FROM customer_private.service_request_need) needs,
 (SELECT count(*)::int FROM customer_private.service_quote) quotes,
 (SELECT count(*)::int FROM customer_private.service_order_intent) intents,
 (SELECT count(*)::int FROM customer_private.service_request_command) commands,
 (SELECT count(*)::int FROM customer_private.service_request_staff_command) staff_commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type IN ('customer_service_request','customer_service_catalogue')) events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type IN ('customer_service_request','customer_service_catalogue')) audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type IN ('customer_service_request','customer_service_catalogue')) outbox`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT n.nspname,c.relname,c.relacl::text acl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2`,
    )
  ).rows;
  const records: Record<string, string> = {};
  for (const row of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    records[row.nspname + '.' + row.relname] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) d FROM ${q(row.nspname)}.${q(row.relname)} t`,
      )
    ).rows[0].d;
  }
  return {
    functions,
    tables,
    records,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    triggers: (
      await f.owner.query(
        "SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 1,2",
      )
    ).rows,
  };
}
async function rawProof(work: (db: DatabaseClient) => Promise<unknown>, milliseconds = 25000) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond')",
    [hash, issuer, session('alice').subject, milliseconds],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const out = await work(db).catch((e) => e);
    await db.query('ROLLBACK');
    return out;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  f = await accessFixture();
  staff = new CustomerServiceStaffService(f.runtime);
  // Stage everything this module reads, populated, before the module exists.
  await migrateCustomerMemberRoles(f.owner);
  await migrateCustomerProgrammes(f.owner);
  await migrateCustomerCompanies(f.owner);
  const principals: Record<string, string> = {};
  for (const person of people)
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit invented paid-service test identity; no real account or email',
      })
    ).id;
  for (const person of ['alice', 'dave'])
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person],
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic paid-service workspace',
    })
  ).id;
  otherWorkspace = (
    await workspaces('dave').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate private workspace',
    })
  ).id;
  for (const person of ['bob', 'carol', 'frank']) {
    const invited = await workspaces('alice').access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic invited ' + person,
    });
    members[person] = (
      await workspaces(person).access({
        action: 'accept',
        commandId: randomUUID(),
        token: invited.token!,
      })
    ).memberId!;
  }
  await roles().command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: members.bob,
    role: 'admin',
    expectedRole: 'member',
  });
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic Dhaka buyer delegation',
      reportingPurpose: 'Fictional programme used to test paid-service requests only',
      acknowledged: true,
    })
  ).id;
  // A real private request, created through the real request module.
  const submitMission = (person: string) =>
    submitted(person).submit(
      {
        commandId: randomUUID(),
        workspaceId: person === 'dave' ? otherWorkspace : workspaceId,
        brief: {
          objective: 'Sell in a new market',
          market: 'Spain',
          attendance: 'Yes',
          startDate: '2026-11-01',
          endDate: '2026-11-07',
          timezone: 'Europe/Madrid',
          offer: 'Synthetic hotel towels ' + randomUUID(),
          website: 'https://example.invalid/catalogue',
          outcomes: ['Relevant meetings'],
          notes: 'Synthetic test only',
          name: 'Test Person',
          company: 'Example Test Company',
          email: 'mission@example.invalid',
          acknowledged: true,
        },
      },
      (context, brief) => f.mission.prepareCustomerIntake(context, brief),
    );
  requestRef = (await submitMission('alice')).id;
  // One approved company in the portfolio of alice, built the way the company module's own test builds it.
  const delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-service-fixture');
  const experience = new DeliveryExperienceService(f.runtime);
  const target = await f.target();
  const p = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: target.missionId,
    title: 'Approved buyer context',
    company: 'Synthetic requesting company',
    objective: 'Develop a commercial relationship',
    brief: 'Approved fictional requirements without private contacts or negotiation notes',
    nextAction: 'Review the approved counterparty',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  await experience.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId: p.id,
    requirementId: null,
    targetIds: [target.targetId],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason: 'Explicitly approve this original target and qualification only',
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [p.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Explicit synthetic commercial report scope',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  await saved().command({
    action: 'save',
    commandId: randomUUID(),
    token: link.token,
    acknowledged: true,
  });
  companyRef = (await portfolio().list()).companies[0].id;
  before = await snapshot();
  await migrateCustomerServiceRequests(f.owner);
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('installing the module on a populated database adds only new objects and changes no existing function, table, policy or row', async () => {
  const after = await snapshot();
  const oldFunctions = new Map(before.functions.map((r) => [r.name, r]));
  for (const [name, row] of oldFunctions) {
    const now = after.functions.find((r) => r.name === name)!;
    expect(now).toEqual(row);
  }
  const added = after.functions.filter((r) => !oldFunctions.has(r.name)).map((r) => r.name);
  expect(added.filter((n) => !/^(customer|customer_private|app)\.service_/.test(n))).toEqual([]);
  expect(added).toContain('customer.service_request_command(uuid,text,jsonb)');
  const oldTables = new Set(before.tables.map((t) => t.nspname + '.' + t.relname));
  expect(
    after.tables
      .map((t) => t.nspname + '.' + t.relname)
      .filter((t) => !oldTables.has(t))
      .sort(),
  ).toEqual(
    [
      'catalogue_version',
      'order_intent',
      'quote',
      'quote_component',
      'quote_view',
      'request',
      'request_claim',
      'request_command',
      'request_event',
      'request_need',
      'request_staff_command',
    ]
      .map((n) => 'customer_private.service_' + n)
      .sort(),
  );
  for (const [name, digest] of Object.entries(before.records)) {
    // The only table that gains rows is the domain event chain of later tests, none yet here.
    expect(after.records[name]).toBe(digest);
  }
  expect(
    after.policies.filter(
      (p) =>
        !before.policies.some((q) => q.policyname === p.policyname && q.tablename === p.tablename),
    ),
  ).toEqual([]);
  for (const t of before.tables) {
    const n = after.tables.find((x) => x.nspname === t.nspname && x.relname === t.relname)!;
    expect(n.acl).toBe(t.acl);
    expect(n.relrowsecurity).toBe(t.relrowsecurity);
  }
  const triggers = after.triggers.filter(
    (t) => !before.triggers.some((o) => o.relname === t.relname && o.tgname === t.tgname),
  );
  expect(triggers.every((t) => /^service_/.test(t.relname))).toBe(true);
  // The registry holds the exact hash, once.
  const applied = (
    await f.owner.query('SELECT name,sha256 FROM customer_service_request_migrations.applied')
  ).rows;
  expect(applied).toHaveLength(1);
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(
    'packages/db/customer-service-request-migrations/' + applied[0].name,
    'utf8',
  );
  expect(applied[0].sha256).toBe(createHash('sha256').update(sql).digest('hex'));
});

test('the runtime and auth logins can reach only the nine intended functions and none of the tables', async () => {
  const tables = [
    'catalogue_version',
    'request',
    'request_need',
    'request_claim',
    'quote',
    'quote_component',
    'quote_view',
    'order_intent',
    'request_event',
    'request_command',
    'request_staff_command',
  ];
  for (const pool of [f.runtime, f.auth])
    for (const t of tables) {
      await expect(pool.query('SELECT * FROM customer_private.service_' + t)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query('DELETE FROM customer_private.service_' + t)).rejects.toThrow(
        /permission denied/i,
      );
    }
  await expect(
    f.runtime.query(
      "INSERT INTO customer_private.service_order_intent(request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by) VALUES($1,$1,1,'USD',1,1,$2,$1)",
      [randomUUID(), 'a'.repeat(64)],
    ),
  ).rejects.toThrow(/permission denied/i);
  const exec = async (role: string) =>
    (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.proname LIKE 'service\\_%' AND n.nspname IN ('app','customer','customer_private') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.name);
  expect(await exec('corridra_runtime')).toEqual(
    [
      'app.service_catalogue_staff_command(uuid,jsonb)',
      'app.service_catalogue_staff_list()',
      'app.service_request_staff_command(uuid,text,jsonb)',
      'app.service_request_staff_list(uuid,integer)',
      'app.service_request_staff_view(uuid)',
      'customer.service_catalogue()',
      'customer.service_request_command(uuid,text,jsonb)',
      'customer.service_request_list(uuid,text,text,uuid,integer)',
      'customer.service_request_view(uuid,uuid)',
    ].sort(),
  );
  expect(await exec('corridra_auth')).toEqual([]);
  // Called without a customer session the customer functions are denied.
  await expect(f.runtime.query('SELECT customer.service_catalogue()')).rejects.toThrow(/denied/i);
  await expect(
    f.runtime.query("SELECT customer.service_request_command($1,'withdraw',$2)", [
      randomUUID(),
      JSON.stringify({ workspaceId, requestId: randomUUID(), note: null }),
    ]),
  ).rejects.toThrow(/denied/i);
});

test('the catalogue holds four synthetic services that every admitted customer reads and nobody else', async () => {
  const seeded = (
    await f.owner.query(
      'SELECT service_key,synthetic,source,active FROM customer_private.service_catalogue_version ORDER BY service_key',
    )
  ).rows;
  expect(seeded.map((r) => r.service_key)).toEqual([
    'interpreter-day',
    'local-meeting-arrangement',
    'site-visit-coordination',
    'supplier-sample-check',
  ]);
  expect(seeded.every((r) => r.synthetic && r.source === 'SEED' && r.active)).toBe(true);
  for (const person of ['alice', 'carol', 'dave']) {
    const c = await svc(person).catalogue();
    expect(c.services).toHaveLength(4);
    for (const s of c.services) {
      expect(s.included.length).toBeGreaterThan(0);
      expect(s.excluded.length).toBeGreaterThan(0);
      expect(s.regions.length).toBeGreaterThan(0);
      expect(s.synthetic).toBe(true);
    }
  }
  await expect(svc('nobody').catalogue()).rejects.toThrow(/denied/i);
  // An expired proof reads nothing.
  const expired = await rawProof(async (db) => {
    await sleep(120);
    return (await db.query('SELECT customer.service_catalogue()')).rows;
  }, 60);
  expect(String(expired)).toMatch(/denied/i);
});

test('an owner or admin starts a request from each kind of place; a member, outsider or forger cannot', async () => {
  const start = await counts();
  const fromProgramme = await create({ contextRef: programmeId });
  expect(fromProgramme).toMatchObject({
    workspaceId,
    contextKind: 'programme',
    contextLabel: 'Synthetic Dhaka buyer delegation',
    serviceKey: 'interpreter-day',
    status: 'requested',
    needVersion: 1,
    region: 'Dhaka',
  });
  const fromRequest = await create({
    contextKind: 'request',
    contextRef: requestRef,
    serviceKey: 'local-meeting-arrangement',
  });
  expect(fromRequest.contextLabel).toMatch(/^Private request from \d{4}-\d{2}-\d{2}$/);
  const fromCompany = await create({
    contextKind: 'company',
    contextRef: companyRef,
    serviceKey: 'supplier-sample-check',
    region: 'Guangzhou',
  });
  expect(fromCompany.contextLabel).toMatch(/Synthetic/);
  const end = await counts();
  expect(end.requests).toBe(start.requests + 3);
  expect(end.timeline).toBe(start.timeline + 3);
  expect(end.events).toBe(start.events + 3);
  expect(end.audits).toBe(start.audits + 3);
  expect(end.outbox).toBe(start.outbox + 3);
  // Reads work for every role, writes only for owner and admin.
  await expect(create({}, 'carol')).rejects.toThrow(/owner or admin required/i);
  await expect(create({}, 'dave')).rejects.toThrow(/owner or admin required/i);
  await expect(create({ workspaceId: otherWorkspace, contextRef: programmeId })).rejects.toThrow(
    /owner or admin required/i,
  );
  await expect(
    create({ workspaceId: otherWorkspace, contextRef: programmeId }, 'dave'),
  ).rejects.toThrow(/not available for a help request/i);
  await expect(create({ contextKind: 'request', contextRef: requestRef }, 'frank')).rejects.toThrow(
    /owner or admin required/i,
  );
  // A place that is someone else's, or does not exist, cannot be asked about.
  // A private request belongs to the person who sent it: an admin teammate cannot ask about it.
  await expect(
    create(
      { contextKind: 'request', contextRef: requestRef, serviceKey: 'interpreter-day' },
      'bob',
    ),
  ).rejects.toThrow(/not available for a help request/i);
  await expect(create({}, 'bob')).resolves.toBeTruthy();
  await expect(
    create({ contextRef: randomUUID(), serviceKey: 'site-visit-coordination' }),
  ).rejects.toThrow(/not available for a help request/i);
  await expect(
    create({
      contextKind: 'company',
      contextRef: 'a'.repeat(64),
      serviceKey: 'site-visit-coordination',
    }),
  ).rejects.toThrow(/not available for a help request/i);
  expect(await counts()).toMatchObject({ requests: start.requests + 4 });
});

test('free text must be synthetic and the service, region and dates must be real', async () => {
  const start = await counts();
  await expect(create({ need: 'Need an interpreter for real talks' })).rejects.toThrow();
  const hostile = (over: Record<string, unknown>) =>
    svc().command({
      action: 'create',
      commandId: randomUUID(),
      workspaceId,
      contextKind: 'programme',
      contextRef: programmeId,
      serviceKey: 'interpreter-day',
      need,
      preferredFrom: null,
      preferredTo: null,
      region: 'Dhaka',
      ...over,
    });
  await expect(hostile({ need: 'No prefix here at all' })).rejects.toThrow();
  await expect(hostile({ serviceKey: 'unknown-service' })).rejects.toThrow(/not offered/i);
  await expect(hostile({ region: 'Chattogram' })).rejects.toThrow(/not offered in this region/i);
  await expect(hostile({ preferredFrom: null, preferredTo: '2026-12-03' })).rejects.toThrow();
  await expect(
    hostile({ preferredFrom: '2026-12-05', preferredTo: '2026-12-03' }),
  ).rejects.toThrow();
  await expect(hostile({ preferredFrom: '2020-01-01' })).rejects.toThrow();
  // The same checks hold if SQL is called directly with a hostile payload.
  const direct = (input: Record<string, unknown>) =>
    rawProof(async (db) => {
      return (
        await db.query("SELECT customer.service_request_command($1,'create',$2)", [
          randomUUID(),
          JSON.stringify(input),
        ])
      ).rows;
    });
  const base = {
    workspaceId,
    contextKind: 'programme',
    contextRef: programmeId,
    serviceKey: 'interpreter-day',
    need,
    preferredFrom: null,
    preferredTo: null,
    region: 'Dhaka',
  };
  expect(String(await direct({ ...base, need: 'Real need without the marker' }))).toMatch(
    /invented text|invalid/i,
  );
  expect(String(await direct({ ...base, extra: 1 }))).toMatch(/invalid/i);
  expect(String(await direct({ ...base, contextKind: 'organisation' }))).toMatch(/invalid/i);
  expect(await counts()).toEqual(start);
  for (const bad of [
    {
      action: 'create',
      commandId: randomUUID(),
      workspaceId,
      contextKind: 'programme',
      contextRef: programmeId,
      serviceKey: 'interpreter-day',
      need,
      preferredFrom: null,
      preferredTo: null,
    },
    {
      action: 'accept',
      commandId: randomUUID(),
      workspaceId,
      requestId: randomUUID(),
      quoteVersion: 1,
      quoteDigest: 'a'.repeat(64),
      acknowledged: false,
    },
    {
      action: 'accept',
      commandId: randomUUID(),
      workspaceId,
      requestId: randomUUID(),
      quoteVersion: 1,
      quoteDigest: 'a'.repeat(64),
    },
    { action: 'pay', commandId: randomUUID(), workspaceId, requestId: randomUUID() },
    {
      action: 'withdraw',
      commandId: randomUUID(),
      workspaceId,
      requestId: randomUUID(),
      note: 'No prefix',
    },
  ])
    expect(customerServiceCommandInput.safeParse(bad).success).toBe(false);
});

test('only one open request exists per place and service, even when two are sent at the same moment', async () => {
  const body = {
    contextKind: 'programme',
    contextRef: await freshProgramme(),
    serviceKey: 'site-visit-coordination',
    region: 'Dhaka',
  };
  const start = await counts();
  const results = await Promise.allSettled([create(body), create(body), create(body, 'bob')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results.filter((x) => x.status === 'rejected'))
    expect(String((r as PromiseRejectedResult).reason)).toMatch(/already an open request/i);
  const end = await counts();
  expect(end.requests).toBe(start.requests + 1);
  expect(end.events).toBe(start.events + 1);
  // A different service in the same place is allowed.
  await expect(create({ ...body, serviceKey: 'local-meeting-arrangement' })).resolves.toBeTruthy();
  // Once the first is withdrawn the place is free again.
  const open = (
    await svc().list({ workspaceId, contextKind: 'programme', contextRef: body.contextRef })
  ).requests.find((r) => r.serviceKey === 'site-visit-coordination')!;
  await act('withdraw', open.id, { note: null });
  await expect(create(body)).resolves.toBeTruthy();
});

test('a repeated command returns the first answer once, and the same id with other content conflicts', async () => {
  const input = {
    action: 'create' as const,
    commandId: randomUUID(),
    workspaceId,
    contextKind: 'company' as const,
    contextRef: companyRef,
    serviceKey: 'interpreter-day',
    need,
    preferredFrom: null,
    preferredTo: null,
    region: 'Istanbul',
  };
  const start = await counts();
  const first = await svc().command(input);
  const again = await svc().command(input);
  expect(again).toEqual(first);
  const end = await counts();
  expect(end.requests).toBe(start.requests + 1);
  expect(end.commands).toBe(start.commands + 1);
  expect(end.events).toBe(start.events + 1);
  await expect(svc().command({ ...input, region: 'Dhaka' })).rejects.toThrow(/conflicts/i);
  await expect(svc().command({ ...input, need: need + ' again' })).rejects.toThrow(/conflicts/i);
  await expect(
    svc().command({
      action: 'withdraw',
      commandId: input.commandId,
      workspaceId,
      requestId: first.id,
      note: null,
    }),
  ).rejects.toThrow(/conflicts/i);
  expect(await counts()).toEqual(end);
});

test('the need can be changed only while unquoted, with a version check, and each change is a new version', async () => {
  const r = await create(
    {
      contextKind: 'request',
      contextRef: requestRef,
      serviceKey: 'interpreter-day',
      region: 'Guangzhou',
    },
    'alice',
  );
  const edit = (over: Record<string, unknown> = {}, person = 'alice') =>
    act(
      'revise',
      r.id,
      {
        expectedNeedVersion: 1,
        need: need + ', now three meetings',
        preferredFrom: '2026-12-02',
        preferredTo: null,
        region: 'Guangzhou',
        ...over,
      },
      person,
    );
  await expect(edit({ expectedNeedVersion: 2 })).rejects.toThrow(/changed; reload/i);
  await expect(edit({}, 'carol')).rejects.toThrow(/owner or admin required/i);
  const changed = await edit();
  expect(changed).toMatchObject({ status: 'requested', needVersion: 2 });
  await expect(
    edit({
      expectedNeedVersion: 2,
      need: need + ', now three meetings',
      preferredFrom: '2026-12-02',
    }),
  ).rejects.toThrow(/nothing has changed/i);
  const detail = await view(r.id);
  expect(detail.need).toMatchObject({
    version: 2,
    region: 'Guangzhou',
    preferredFrom: '2026-12-02',
    preferredTo: null,
  });
  expect(
    (
      await f.owner.query(
        'SELECT version FROM customer_private.service_request_need WHERE request_id=$1 ORDER BY version',
        [r.id],
      )
    ).rows,
  ).toEqual([{ version: 1 }, { version: 2 }]);
  await quote(r.id);
  await expect(
    edit({ expectedNeedVersion: 2, need: need + ', changed after the quote' }),
  ).rejects.toThrow(/can no longer be edited/i);
});

test('a staff owner or admin sees the queue and prepares a quote with every component, exclusion and assumption', async () => {
  const r = await create({ serviceKey: 'interpreter-day', region: 'Istanbul' });
  const queue = await staff.list(staffCtx());
  expect(queue.requests.some((x: { id: string }) => x.id === r.id)).toBe(true);
  const detail = await staff.view(staffCtx(), r.id);
  expect(detail.request).toMatchObject({
    status: 'requested',
    claimedByThisTeam: false,
    workspaceName: 'Synthetic paid-service workspace',
  });
  expect(detail.need.text).toBe(need);
  // Other staff roles and customers have no way in.
  await expect(staff.list(f.users.operator.ctx)).rejects.toThrow(/denied/i);
  await expect(staff.list(f.users.viewer.ctx)).rejects.toThrow(/denied/i);
  await expect(staff.list(f.users.reviewer.ctx)).rejects.toThrow(/denied/i);
  await expect(f.runtime.query('SELECT app.service_request_staff_list(NULL,10)')).rejects.toThrow();
  const tooBare = quoteBody();
  // Zod rejects an incomplete quote before it reaches SQL.
  for (const bad of [
    { ...tooBare, exclusions: [] },
    { ...tooBare, assumptions: [] },
    { ...tooBare, components: [] },
    { ...tooBare, exclusions: ['No marker here at all'] },
    {
      ...tooBare,
      components: [
        {
          kind: 'service_fee',
          label: 'Synthetic fee label here',
          treatment: 'estimate',
          amountMinor: '1.5',
        },
      ],
    },
    {
      ...tooBare,
      components: [
        {
          kind: 'service_fee',
          label: 'Synthetic fee label here',
          treatment: 'not_included',
          amountMinor: null,
        },
      ],
    },
    { ...tooBare, validUntil: new Date(Date.now() + 60000).toISOString() },
  ])
    expect(
      staffServiceCommandInput.safeParse({
        action: 'quote',
        commandId: randomUUID(),
        requestId: r.id,
        expectedSeq: 1,
        ...bad,
      }).success,
    ).toBe(false);
  const start = await counts();
  const result = await quote(r.id);
  expect(result.status).toBe('quoted');
  const end = await counts();
  expect(end.quotes).toBe(start.quotes + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.staff_commands).toBe(start.staff_commands + 1);
  const mine = await staff.view(staffCtx(), r.id);
  expect(mine.request.claimedByThisTeam).toBe(true);
  expect(mine.quotes[0]).toMatchObject({
    version: 1,
    currency: 'USD',
    fixedTotalMinor: '57000',
    estimatedTotalMinor: '6000',
    billing: 'billing_not_enabled',
    paymentTaken: false,
  });
  // The customer sees every component and every exclusion, the tax line as not included.
  const seen = await view(r.id);
  expect(seen.request.status).toBe('quoted');
  expect(
    seen.quote.components.map(
      (c: { kind: string; treatment: string; amountMinor: string | null }) => [
        c.kind,
        c.treatment,
        c.amountMinor,
      ],
    ),
  ).toEqual([
    ['service_fee', 'included', '45000'],
    ['local_cost', 'estimate', '6000'],
    ['pass_through', 'included', '12000'],
    ['tax', 'not_included', null],
  ]);
  expect(seen.quote.exclusions).toHaveLength(2);
  expect(seen.quote.assumptions).toHaveLength(1);
  expect(seen.quote.paymentTerms).toMatch(/nothing is charged now/);
  expect(seen.actions).toEqual(['accept', 'decline', 'question']);
  // A member sees the same quote and has no actions.
  const reader = await view(r.id, 'carol');
  expect(reader.quote.digest).toBe(seen.quote.digest);
  expect(reader.actions).toEqual([]);
  expect(reader.canAct).toBe(false);
});

test('direct SQL cannot make an incomplete quote, a quote without exclusions or assumptions, or a quote that is accepted without being seen', async () => {
  const r = await create({ serviceKey: 'site-visit-coordination', region: 'Dhaka' }, 'bob');
  const claim = async () => {
    await quote(r.id);
  };
  await claim();
  const q = (
    await f.owner.query('SELECT * FROM customer_private.service_quote WHERE request_id=$1', [r.id])
  ).rows[0];
  const insertQuote = (over: Record<string, unknown>) => {
    const row = {
      id: randomUUID(),
      request_id: r.id,
      version: 9,
      currency: 'USD',
      scope: 'Synthetic scope for a hostile direct insert',
      exclusions: ['Synthetic exclusion for the hostile insert'],
      assumptions: ['Synthetic assumption for the hostile insert'],
      delivery_terms: q.delivery_terms,
      payment_terms: q.payment_terms,
      valid_until: new Date(Date.now() + 86400000),
      prepared_by: q.prepared_by,
      staff_tenant_id: q.staff_tenant_id,
      ...over,
    };
    return f.owner.query(
      'INSERT INTO customer_private.service_quote(id,request_id,version,currency,scope,exclusions,assumptions,delivery_terms,payment_terms,valid_until,prepared_by,staff_tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      Object.values(row),
    );
  };
  await expect(insertQuote({ exclusions: [] })).rejects.toThrow(/check constraint/i);
  await expect(insertQuote({ assumptions: [] })).rejects.toThrow(/check constraint/i);
  await expect(insertQuote({ assumptions: ['No synthetic marker'] })).rejects.toThrow(
    /check constraint/i,
  );
  await expect(insertQuote({ currency: 'XXX' })).rejects.toThrow(/foreign key/i);
  await expect(insertQuote({ valid_until: new Date(Date.now() + 200 * 86400000) })).rejects.toThrow(
    /check constraint/i,
  );
  // A quote with no components cannot be committed.
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO customer_private.service_quote(request_id,version,currency,scope,exclusions,assumptions,delivery_terms,payment_terms,valid_until,prepared_by,staff_tenant_id) VALUES($1,9,'USD',$2,$3,$4,$5,$6,now()+interval '1 day',$7,$8)",
      [
        r.id,
        'Synthetic scope with no components yet',
        ['Synthetic exclusion in the empty quote'],
        ['Synthetic assumption in the empty quote'],
        q.delivery_terms,
        q.payment_terms,
        q.prepared_by,
        q.staff_tenant_id,
      ],
    );
    await expect(db.query('COMMIT')).rejects.toThrow(/complete quote/i);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
  // Amounts are exact whole numbers and never negative; a fee cannot be left unpriced.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_quote_component(quote_id,position,kind,label,treatment,amount_minor) VALUES($1,9,'tax','Synthetic negative tax',  'included',-1)",
      [q.id],
    ),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_quote_component(quote_id,position,kind,label,treatment,amount_minor) VALUES($1,9,'service_fee','Synthetic unpriced fee','not_included',NULL)",
      [q.id],
    ),
  ).rejects.toThrow(/check constraint/i);
  // Acceptance without having been shown the quote is refused by the database itself.
  const intent = randomUUID();
  const alice = (
    await f.owner.query(
      "SELECT id FROM customer_private.principal WHERE subject='synthetic-service-alice'",
    )
  ).rows[0].id;
  const digest = (await f.owner.query('SELECT customer_private.service_quote_digest($1) d', [q.id]))
    .rows[0].d;
  await f.owner
    .query(
      'INSERT INTO customer_private.service_order_intent(id,request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by) VALUES($1,$2,$3,1,$4,57000,6000,$5,$6)',
      [intent, r.id, q.id, 'USD', digest, alice],
    )
    .catch(() => undefined);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_request_event(request_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor,quote_id,order_intent_id) VALUES($1,$2,3,'accepted','accepted','customer',$3,$4,$5)",
      [r.id, workspaceId, alice, q.id, intent],
    ),
  ).rejects.toThrow();
  // An order intent can never record a payment or a billing state.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_order_intent(request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by,payment_taken) VALUES($1,$2,1,'USD',1,1,$3,$4,true)",
      [randomUUID(), q.id, digest, alice],
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_order_intent(request_id,quote_id,quote_version,currency,fixed_total_minor,estimated_total_minor,quote_digest,accepted_by,billing) VALUES($1,$2,1,'USD',1,1,$3,$4,'invoiced')",
      [randomUUID(), q.id, digest, alice],
    ),
  ).rejects.toThrow(/check constraint/i);
  // A move the path does not allow cannot be written, whoever writes it.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.service_request_event(request_id,tenant_id,seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,customer_note) VALUES($1,$2,3,'delivered','delivered','staff',$3,$4,'Synthetic delivered without being started')",
      [r.id, workspaceId, q.prepared_by, q.staff_tenant_id],
    ),
  ).rejects.toThrow(/not available|in order/i);
});

test('acceptance needs the whole quote to have been shown, the exact version and fingerprint and an acknowledgement, and records an order intent only', async () => {
  const r = await create({
    serviceKey: 'local-meeting-arrangement',
    contextKind: 'company',
    contextRef: companyRef,
    region: 'Istanbul',
  });
  await quote(r.id);
  const accept = (extra: Record<string, unknown>, person = 'alice') =>
    act('accept', r.id, extra, person);
  const start = await counts();
  // Not yet shown to this person: refused.
  await expect(
    accept({ quoteVersion: 1, quoteDigest: 'a'.repeat(64), acknowledged: true }),
  ).rejects.toThrow(/review the whole quote|changed/i);
  const shown = await view(r.id);
  await expect(
    accept({ quoteVersion: 2, quoteDigest: shown.quote.digest, acknowledged: true }),
  ).rejects.toThrow(/changed/i);
  await expect(
    accept({ quoteVersion: 1, quoteDigest: 'b'.repeat(64), acknowledged: true }),
  ).rejects.toThrow(/changed/i);
  await expect(
    accept({ quoteVersion: 1, quoteDigest: shown.quote.digest, acknowledged: true }, 'carol'),
  ).rejects.toThrow(/owner or admin required/i);
  // bob is an admin but has not been shown the quote yet.
  await expect(
    accept({ quoteVersion: 1, quoteDigest: shown.quote.digest, acknowledged: true }, 'bob'),
  ).rejects.toThrow(/review the whole quote/i);
  expect(await counts()).toEqual(start);
  const accepted = await accept({
    quoteVersion: 1,
    quoteDigest: shown.quote.digest,
    acknowledged: true,
  });
  expect(accepted.status).toBe('accepted');
  const after = await view(r.id);
  expect(after.orderIntent).toMatchObject({
    quoteVersion: 1,
    currency: 'USD',
    fixedTotalMinor: '57000',
    estimatedTotalMinor: '6000',
    orderStatus: 'accepted_by_customer',
    paymentTaken: false,
    billing: 'billing_not_enabled',
    statement: 'Accepted by customer. No payment taken. Billing not enabled.',
  });
  expect(after.actions).toEqual(['question']);
  const intent = (
    await f.owner.query('SELECT * FROM customer_private.service_order_intent WHERE request_id=$1', [
      r.id,
    ])
  ).rows;
  expect(intent).toHaveLength(1);
  expect(intent[0]).toMatchObject({
    payment_taken: false,
    billing: 'billing_not_enabled',
    quote_digest: shown.quote.digest,
  });
  // Accepting again, or after the fact, is refused.
  await expect(
    accept({ quoteVersion: 1, quoteDigest: shown.quote.digest, acknowledged: true }),
  ).rejects.toThrow(/no open quote/i);
  await expect(act('decline', r.id, { note: null })).rejects.toThrow(/not available/i);
  // Nothing in the database can charge: no payment, invoice or subscription object exists in this module.
  const objects = (
    await f.owner.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_private' AND relname LIKE 'service\\_%' AND relkind='r'",
    )
  ).rows.map((x) => x.relname);
  expect(objects.some((n) => /payment|invoice|charge|subscription|refund/.test(n))).toBe(false);
});

test('staff move an accepted request to in progress, delivered and closed with notes the customer reads; internal notes stay hidden', async () => {
  const r = await create({ serviceKey: 'supplier-sample-check', region: 'Dhaka' });
  await quote(r.id);
  const shown = await view(r.id);
  await expect(progress('start', r.id)).rejects.toThrow(/not available/i);
  await act('accept', r.id, {
    quoteVersion: 1,
    quoteDigest: shown.quote.digest,
    acknowledged: true,
  });
  const secret =
    'Synthetic internal margin note: do not tell the customer about the supplier discount';
  await staff.command(staffCtx(), {
    action: 'note',
    commandId: randomUUID(),
    requestId: r.id,
    expectedSeq: await seq(r.id),
    internalNote: secret,
  });
  await expect(progress('deliver', r.id)).rejects.toThrow(/not available/i);
  await progress(
    'start',
    r.id,
    'Synthetic update: the coordinator has been briefed and travel is booked',
  );
  await progress('update', r.id, 'Synthetic update: the supplier confirmed the sample is ready');
  await progress(
    'deliver',
    r.id,
    'Synthetic update: the sample was handed over and photos are attached to the note',
  );
  await progress('close', r.id, 'Synthetic update: everything is complete and the file is closed');
  const detail = await view(r.id);
  expect(detail.request.status).toBe('closed');
  expect(detail.actions).toEqual([]);
  expect(detail.timeline.map((e: { kind: string }) => e.kind)).toEqual([
    'requested',
    'quoted',
    'accepted',
    'started',
    'update',
    'delivered',
    'closed',
  ]);
  expect(JSON.stringify(detail)).not.toContain(secret);
  expect(JSON.stringify(detail)).not.toContain('internal');
  expect(detail.timeline.find((e: { kind: string }) => e.kind === 'quoted')?.by).toBe(
    'Corridra team',
  );
  expect(detail.timeline.find((e: { kind: string }) => e.kind === 'requested')?.by).toBe('You');
  expect(
    (await view(r.id, 'bob')).timeline.find((e: { kind: string }) => e.kind === 'requested')?.by,
  ).toBe('A teammate');
  const mine = await staff.view(staffCtx(), r.id);
  expect(JSON.stringify(mine.events)).toContain(secret);
  // The summary and list never leak the existence of a hidden note.
  const listed = (await svc().list({ workspaceId })).requests.find((x) => x.id === r.id)!;
  expect(JSON.stringify(listed)).not.toContain(secret);
  // A closed request is finished.
  await expect(progress('update', r.id)).rejects.toThrow(/not available/i);
  await expect(act('question', r.id, { note: 'Synthetic question after closing' })).rejects.toThrow(
    /not available/i,
  );
  // The place is free for a new request for the same service.
  await expect(
    create({ serviceKey: 'supplier-sample-check', region: 'Dhaka' }),
  ).resolves.toBeTruthy();
});

test('the customer can ask a question, staff can answer, and the question is part of the plain timeline', async () => {
  const r = await create({
    serviceKey: 'site-visit-coordination',
    contextKind: 'company',
    contextRef: companyRef,
    region: 'Guangzhou',
  });
  await act('question', r.id, {
    note: 'Synthetic question: does the quote include a lunch for the guide?',
  });
  await progress(
    'answer',
    r.id,
    'Synthetic answer: lunch is not included and is listed among the exclusions',
  );
  const detail = await view(r.id);
  expect(
    detail.timeline.map((e: { kind: string; note: string | null }) => [e.kind, e.note !== null]),
  ).toEqual([
    ['requested', false],
    ['question', true],
    ['answer', true],
  ]);
  expect(detail.request.status).toBe('requested');
  await expect(act('question', r.id, { note: 'No marker question' })).rejects.toThrow();
  await expect(
    act('question', r.id, { note: 'Synthetic question from a member' }, 'carol'),
  ).rejects.toThrow(/owner or admin required/i);
});

test('the customer can decline a quote or withdraw a request; a staff team is told nothing it must act on', async () => {
  const a = await create({ serviceKey: 'interpreter-day', region: 'Dhaka' }, 'bob');
  await act('withdraw', a.id, { note: 'Synthetic note: plans changed for this trip' }, 'bob');
  expect((await view(a.id)).request.status).toBe('withdrawn');
  await expect(quote(a.id)).rejects.toThrow(/not be prepared/i);
  const b = await create({ serviceKey: 'interpreter-day', region: 'Dhaka' }, 'bob');
  await expect(act('decline', b.id, { note: null }, 'bob')).rejects.toThrow(/not available/i);
  await quote(b.id);
  await expect(act('withdraw', b.id, { note: null }, 'bob')).rejects.toThrow(/not available/i);
  await view(b.id, 'bob');
  await act('decline', b.id, { note: null }, 'bob');
  const detail = await view(b.id);
  expect(detail.request.status).toBe('declined');
  expect(detail.orderIntent).toBeNull();
  expect(detail.actions).toEqual([]);
});

test('a quote that passes its validity is expired, cannot be accepted, and can be replaced by a new version', async () => {
  const r = await create({ serviceKey: 'local-meeting-arrangement', region: 'Chattogram' });
  const short = await rawContext(
    f.runtime,
    staffCtx(),
    'SELECT app.service_request_staff_command($1,$2,$3) r',
    [
      randomUUID(),
      'quote',
      JSON.stringify({
        requestId: r.id,
        expectedSeq: await seq(r.id),
        ...quoteBody({ validUntil: new Date(Date.now() + 1500).toISOString() }),
      }),
    ],
  );
  expect(short.rows[0].r.status).toBe('quoted');
  const shown = await view(r.id);
  expect(shown.request.status).toBe('quoted');
  await sleep(1800);
  // The list already reads it as expired, and the next look writes the expiry once.
  expect((await svc().list({ workspaceId })).requests.find((x) => x.id === r.id)!.status).toBe(
    'expired',
  );
  const start = await counts();
  const expired = await view(r.id);
  expect(expired.request.status).toBe('expired');
  expect(expired.timeline.at(-1)).toMatchObject({ kind: 'expired', by: 'Automatic' });
  expect(expired.actions).toEqual(['decline', 'question']);
  expect(expired.quote.expired).toBe(true);
  expect((await counts()).timeline).toBe(start.timeline + 1);
  await view(r.id);
  expect((await counts()).timeline).toBe(start.timeline + 1);
  await expect(
    act('accept', r.id, { quoteVersion: 1, quoteDigest: shown.quote.digest, acknowledged: true }),
  ).rejects.toThrow(/expired/i);
  // Staff replace it; the old digest no longer works.
  await quote(r.id, {
    scope: 'Synthetic scope: the same meeting with a fresh price and a longer validity',
  });
  const fresh = await view(r.id);
  expect(fresh.request.status).toBe('quoted');
  expect(fresh.quote.version).toBe(2);
  expect(fresh.quote.digest).not.toBe(shown.quote.digest);
  await expect(
    act('accept', r.id, { quoteVersion: 1, quoteDigest: shown.quote.digest, acknowledged: true }),
  ).rejects.toThrow(/changed/i);
  await act('accept', r.id, {
    quoteVersion: 2,
    quoteDigest: fresh.quote.digest,
    acknowledged: true,
  });
  const intent = (
    await f.owner.query(
      'SELECT quote_version FROM customer_private.service_order_intent WHERE request_id=$1',
      [r.id],
    )
  ).rows;
  expect(intent).toEqual([{ quote_version: 2 }]);
  // Every earlier quote version is kept.
  expect(
    (
      await f.owner.query(
        'SELECT version FROM customer_private.service_quote WHERE request_id=$1 ORDER BY version',
        [r.id],
      )
    ).rows,
  ).toEqual([{ version: 1 }, { version: 2 }]);
});

test('two accepts or two quotes sent at the same moment produce one winner and one order intent', async () => {
  const r = await create({ serviceKey: 'site-visit-coordination', region: 'Guangzhou' });
  const position = await seq(r.id);
  const race = await Promise.allSettled([
    quote(r.id),
    staff.command(staffCtx(), {
      action: 'quote',
      commandId: randomUUID(),
      requestId: r.id,
      expectedSeq: position,
      ...quoteBody(),
    }),
    staff.command(staffCtx(), {
      action: 'quote',
      commandId: randomUUID(),
      requestId: r.id,
      expectedSeq: position,
      ...quoteBody(),
    }),
  ]);
  expect(race.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  const stale = race.filter((x) => x.status === 'rejected');
  for (const x of stale)
    expect(String((x as PromiseRejectedResult).reason)).toMatch(/changed; reload/i);
  const quotes = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.service_quote WHERE request_id=$1',
      [r.id],
    )
  ).rows[0].n;
  expect(quotes).toBe(race.filter((x) => x.status === 'fulfilled').length);
  const shown = await view(r.id);
  const accepts = await Promise.allSettled(
    [1, 2, 3].map(() =>
      act('accept', r.id, {
        quoteVersion: shown.quote.version,
        quoteDigest: shown.quote.digest,
        acknowledged: true,
      }),
    ),
  );
  expect(accepts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  for (const x of accepts.filter((y) => y.status === 'rejected'))
    expect(String((x as PromiseRejectedResult).reason)).toMatch(/no open quote/i);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.service_order_intent WHERE request_id=$1',
        [r.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

test('one team handles a request, and staff changes need the current timeline position', async () => {
  const r = await create({ serviceKey: 'interpreter-day', region: 'Guangzhou' });
  const stale = await seq(r.id);
  await staff.command(staffCtx(), {
    action: 'note',
    commandId: randomUUID(),
    requestId: r.id,
    expectedSeq: stale,
    internalNote: 'Synthetic note that takes the request',
  });
  await expect(
    staff.command(staffCtx(), {
      action: 'answer',
      commandId: randomUUID(),
      requestId: r.id,
      expectedSeq: stale,
      customerNote: 'Synthetic answer from a stale page',
    }),
  ).rejects.toThrow(/changed; reload/i);
  // Another operator workspace can neither see nor act on it.
  expect(
    (await staff.list(otherStaffCtx())).requests.some((x: { id: string }) => x.id === r.id),
  ).toBe(false);
  await expect(staff.view(otherStaffCtx(), r.id)).rejects.toThrow(/another team/i);
  await expect(
    staff.command(otherStaffCtx(), {
      action: 'note',
      commandId: randomUUID(),
      requestId: r.id,
      expectedSeq: await seq(r.id),
      internalNote: 'Synthetic note from the other team',
    }),
  ).rejects.toThrow(/another team/i);
  // Staff exact retry returns the first answer; the same id with other content conflicts.
  const body = {
    action: 'note' as const,
    commandId: randomUUID(),
    requestId: r.id,
    expectedSeq: await seq(r.id),
    internalNote: 'Synthetic note that is repeated safely',
  };
  const start = await counts();
  const first = await staff.command(staffCtx(), body);
  expect(await staff.command(staffCtx(), body)).toEqual(first);
  expect((await counts()).events).toBe(start.events + 1);
  await expect(
    staff.command(staffCtx(), { ...body, internalNote: 'Synthetic note that has been changed' }),
  ).rejects.toThrow(/conflicts/i);
  // A forged customer-side request id or a missing one is unavailable.
  await expect(staff.view(staffCtx(), randomUUID())).rejects.toThrow(/unavailable/i);
  // A customer cannot call a staff function even with a valid customer session.
  const denied = await rawProof(
    async (db) => (await db.query('SELECT app.service_request_staff_list(NULL,5)')).rows,
  );
  expect(String(denied)).toMatch(/fresh authenticator|denied|assurance/i);
});

test('the timeline cannot be rewritten and every history table is append only', async () => {
  const tables = [
    'catalogue_version',
    'request',
    'request_need',
    'request_claim',
    'quote',
    'quote_component',
    'quote_view',
    'order_intent',
    'request_event',
    'request_command',
    'request_staff_command',
  ];
  for (const t of tables) {
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.service_' + t)).rows[0].n,
    ).toBeGreaterThan(0);
    await expect(f.owner.query('DELETE FROM customer_private.service_' + t)).rejects.toThrow(
      /immutable/i,
    );
  }
  await expect(
    f.owner.query("UPDATE customer_private.service_request_event SET status_after='closed'"),
  ).rejects.toThrow(/immutable/i);
  await expect(
    f.owner.query(
      "UPDATE customer_private.service_quote SET scope='Synthetic scope rewritten later'",
    ),
  ).rejects.toThrow(/immutable/i);
  await expect(
    f.owner.query('UPDATE customer_private.service_quote_component SET amount_minor=1'),
  ).rejects.toThrow(/immutable/i);
  await expect(
    f.owner.query('UPDATE customer_private.service_order_intent SET fixed_total_minor=1'),
  ).rejects.toThrow(/immutable/i);
  await expect(
    f.owner.query('UPDATE customer_private.service_catalogue_version SET active=false'),
  ).rejects.toThrow(/immutable/i);
});

test('events carry ids and versions only, one chain per change, and reveal no text, amount or note', async () => {
  const events = (
    await f.owner.query(
      "SELECT e.type,e.payload,e.actor_id,e.aggregate_id,e.aggregate_version FROM app.domain_event e WHERE e.aggregate_type='customer_service_request'",
    )
  ).rows;
  expect(events.length).toBeGreaterThan(10);
  const allowed = new Set([
    'requestId',
    'seq',
    'status',
    'quoteVersion',
    'synthetic',
    'initiator_kind',
    'initiator_id',
  ]);
  for (const e of events) {
    expect(Object.keys(e.payload).every((k) => allowed.has(k))).toBe(true);
    expect(e.type).toMatch(
      /^customer\.service_request\.(requested|revised|quoted|question|answer|accepted|declined|withdrawn|expired|started|update|delivered|closed|internal_note)$/,
    );
  }
  const text = JSON.stringify(events);
  for (const word of ['Synthetic', 'interpreter', 'margin', '45000', 'USD'])
    expect(text).not.toContain(word);
  expect(
    events.some((e) => e.payload.initiator_kind === 'staff' && e.actor_id === f.users.owner.id),
  ).toBe(true);
  expect(
    events.some((e) => e.payload.initiator_kind === 'customer' && e.actor_id === f.serviceId),
  ).toBe(true);
  expect(events.some((e) => e.payload.initiator_kind === 'system')).toBe(true);
  const c = await counts();
  expect(c.audits).toBe(c.events);
  expect(c.outbox).toBe(c.events);
  const timeline = (
    await f.owner.query('SELECT count(*)::int n FROM customer_private.service_request_event')
  ).rows[0].n;
  expect(events.length).toBe(timeline);
});

test('staff revise the catalogue with a version check; customers see the new text and old requests keep theirs', async () => {
  const entry = (await staff.catalogue(staffCtx())).services.find(
    (s: { key: string }) => s.key === 'supplier-sample-check',
  );
  const revise = (over: Record<string, unknown> = {}, ctx = staffCtx()) =>
    staff.reviseCatalogue(ctx, {
      commandId: randomUUID(),
      serviceKey: 'supplier-sample-check',
      expectedVersion: entry.version,
      title: 'Supplier sample check and photos',
      summary: entry.summary,
      included: [...entry.included, 'A second set of photos'],
      excluded: entry.excluded,
      regions: entry.regions,
      quoteBasis: entry.quoteBasis,
      active: true,
      ...over,
    });
  const start = await counts();
  const old = await create({ serviceKey: 'supplier-sample-check', region: 'Dhaka' });
  expect(await revise()).toMatchObject({
    serviceKey: 'supplier-sample-check',
    version: 2,
    active: true,
  });
  await expect(revise()).rejects.toThrow(/changed; reload/i);
  await expect(
    revise({ expectedVersion: 2, summary: 'See https://real-vendor.example for details' }),
  ).rejects.toThrow();
  await expect(
    revise({ expectedVersion: 2, included: ['Contact someone@example.test'] }),
  ).rejects.toThrow();
  await expect(revise({ expectedVersion: 2 }, f.users.operator.ctx)).rejects.toThrow(/denied/i);
  const customer = (await svc('carol').catalogue()).services.find(
    (s) => s.key === 'supplier-sample-check',
  )!;
  expect(customer).toMatchObject({ version: 2, title: 'Supplier sample check and photos' });
  expect((await view(old.id)).service.title).toBe('Supplier sample check');
  const event = (
    await f.owner.query(
      "SELECT payload,tenant_id FROM app.domain_event WHERE type='customer.service_catalogue.revised'",
    )
  ).rows;
  expect(event).toHaveLength(1);
  expect(event[0].payload).toMatchObject({
    serviceKey: 'supplier-sample-check',
    version: 2,
    synthetic: true,
  });
  expect(event[0].tenant_id).toBe(f.tenantA);
  expect((await counts()).events).toBeGreaterThan(start.events);
  // Retiring a service hides it from customers and from new requests, never from old ones.
  await revise({ expectedVersion: 2, active: false });
  expect((await svc().catalogue()).services.map((s) => s.key)).not.toContain(
    'supplier-sample-check',
  );
  await expect(create({ serviceKey: 'supplier-sample-check', region: 'Dhaka' })).rejects.toThrow(
    /not offered/i,
  );
  expect((await view(old.id)).request.serviceTitle).toBe('Supplier sample check');
});

test('revoked, left and disabled members lose access at once, and the original owner keeps it', async () => {
  const r = await create({ serviceKey: 'interpreter-day', region: 'Dhaka' });
  expect((await view(r.id, 'carol')).canAct).toBe(false);
  await roles('frank').command({ action: 'leave', commandId: randomUUID(), workspaceId });
  await expect(view(r.id, 'frank')).rejects.toThrow(/unavailable/i);
  await expect(svc('frank').list({ workspaceId })).rejects.toThrow(/unavailable/i);
  await workspaces('alice').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: members.carol,
  });
  await expect(view(r.id, 'carol')).rejects.toThrow(/unavailable/i);
  await expect(svc('carol').list({ workspaceId })).rejects.toThrow(/unavailable/i);
  await f.owner.query(
    "UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject='synthetic-service-bob'",
  );
  await expect(view(r.id, 'bob')).rejects.toThrow(/denied/i);
  await expect(create({}, 'bob')).rejects.toThrow(/denied/i);
  await expect(svc('bob').catalogue()).rejects.toThrow(/denied/i);
  expect((await view(r.id)).canAct).toBe(true);
  // Outsiders never see the requests of another workspace, with their own or a forged workspace id.
  await expect(view(r.id, 'dave')).rejects.toThrow(/unavailable/i);
  await expect(view(r.id, 'dave', otherWorkspace)).rejects.toThrow(/unavailable/i);
  expect((await svc('dave').list({ workspaceId: otherWorkspace })).requests).toEqual([]);
});

test('lists page newest first and can be limited to one place', async () => {
  const all: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const part = await svc().list({ workspaceId, pageSize: 4, ...(after ? { after } : {}) });
    all.push(...part.requests.map((x) => x.id));
    after = part.nextAfter ?? undefined;
    if (!after) break;
  }
  expect(new Set(all).size).toBe(all.length);
  const total = (
    await f.owner.query(
      'SELECT count(*)::int n FROM customer_private.service_request WHERE tenant_id=$1',
      [workspaceId],
    )
  ).rows[0].n;
  expect(all).toHaveLength(total);
  const created = (
    await f.owner.query(
      'SELECT id FROM customer_private.service_request WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC',
      [workspaceId],
    )
  ).rows.map((x) => x.id);
  expect(all).toEqual(created);
  const place = await svc().list({ workspaceId, contextKind: 'company', contextRef: companyRef });
  expect(
    place.requests.every((x) => x.contextKind === 'company' && x.contextRef === companyRef),
  ).toBe(true);
  expect(place.canRequest).toBe(true);
  await expect(svc().list({ workspaceId, after: randomUUID() })).rejects.toThrow(/invalid page/i);
  await expect(svc().list({ workspaceId, contextKind: 'company' })).rejects.toThrow();
});

test('the flag, synthetic and production gates stay binding and the installer is repeatable', async () => {
  const on = { DATA_ENVIRONMENT: 'synthetic', CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true' };
  expect(customerServiceRequestsEnabled(on)).toBe(false);
  expect(
    customerServiceRequestsEnabled({ ...on, CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'true' }),
  ).toBe(true);
  expect(
    customerServiceRequestsEnabled({
      ...on,
      CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
  expect(
    customerServiceRequestsEnabled({
      ...on,
      CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  for (const override of [{ enabled: false }, { synthetic: false }, { production: true }])
    await expect(
      new CustomerServiceRequestService(f.runtime, f.auth, { ...options, ...override }, async () =>
        session('alice'),
      ).catalogue(),
    ).rejects.toThrow(/unavailable/i);
  const expiredSession = new CustomerServiceRequestService(
    f.runtime,
    f.auth,
    options,
    async () => ({ ...session('alice'), expiresAt: new Date(Date.now() - 1000) }),
  );
  await expect(expiredSession.catalogue()).rejects.toThrow(/sign in/i);
  const first = (await f.owner.query('SELECT * FROM customer_service_request_migrations.applied'))
    .rows;
  await migrateCustomerServiceRequests(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_service_request_migrations.applied')).rows,
  ).toEqual(first);
  expect(first).toHaveLength(1);
  await f.owner.query('UPDATE customer_service_request_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerServiceRequests(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_service_request_migrations.applied SET sha256=$1', [
    first[0].sha256,
  ]);
});
