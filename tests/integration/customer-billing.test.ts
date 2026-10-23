import { beforeAll, afterAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { accessFixture } from './access-fixture';
import { rawContext } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import {
  CustomerBillingService,
  customerBillingCommandInput,
  customerBillingEnabled,
  type BillingOverview,
  type BillingPlan,
} from '../../packages/auth/src/customer-billing';
import {
  CustomerBillingStaffService,
  staffBillingCommandInput,
  staffPlanInput,
} from '../../packages/delivery/src/customer-billing-staff';

// Invented provider-session fixtures exercise the real restricted SQL logins and the real staff session rows.
const issuer = 'https://ep-billing-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina'];
let f: Awaited<ReturnType<typeof accessFixture>>;
let workspaceId: string, otherWorkspace: string;
let staff: CustomerBillingStaffService;
const members: Record<string, string> = {};
let before: Awaited<ReturnType<typeof snapshot>>;
const session = (person: string): CustomerSession => ({
  subject: 'synthetic-billing-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const svc = (person = 'alice') =>
  new CustomerBillingService(f.runtime, f.auth, options, async () => session(person));
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const roles = (person = 'alice') =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(person));
const staffCtx = () => f.users.owner.ctx;
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const note = 'Synthetic note for the customer to read';
let freshCount = 0;
// A workspace of its own for tests that need a clean subscription history.
const freshWorkspace = async (person = 'alice') =>
  (
    await workspaces(person).provision({
      commandId: randomUUID(),
      name: 'Synthetic billing workspace ' + ++freshCount,
    })
  ).id as string;
const plans = async (target = workspaceId, person = 'alice') =>
  svc(person).plans({ workspaceId: target });
const planByKey = async (key: string, target = workspaceId, person = 'alice') =>
  (await plans(target, person)).plans.find((p: BillingPlan) => p.key === key)!;
const overview = async (target = workspaceId, person = 'alice') =>
  (await svc(person).overview({ workspaceId: target })) as BillingOverview;
// Shows the plan (which records the showing) and asks for it.
const request = async (
  key = 'example-organiser',
  target = workspaceId,
  person = 'alice',
  over: Record<string, unknown> = {},
) => {
  const plan = await planByKey(key, target, person);
  return svc(person).command({
    action: 'request',
    commandId: randomUUID(),
    workspaceId: target,
    planKey: plan.key,
    planVersion: plan.version,
    planDigest: plan.digest,
    acknowledged: true,
    ...over,
  });
};
const act = (
  action: string,
  subscriptionId: string,
  target = workspaceId,
  person = 'alice',
  extra: Record<string, unknown> = {},
) =>
  svc(person).command({
    action,
    commandId: randomUUID(),
    workspaceId: target,
    subscriptionId,
    ...extra,
  });
const seq = async (id: string) => (await staff.view(staffCtx(), id)).lastSeq as number;
const staffAct = async (
  action: string,
  id: string,
  extra: Record<string, unknown> = {},
  ctx = staffCtx(),
) =>
  staff.command(ctx, {
    action,
    commandId: randomUUID(),
    subscriptionId: id,
    expectedSeq: await seq(id),
    ...extra,
  });
const activate = (id: string, start = day(), customerNote: string | null = null) =>
  staffAct('activate', id, { periodStart: start, customerNote });
// Requests a plan and activates it for the current month: the common starting point.
const hold = async (key = 'example-organiser', target = workspaceId, person = 'alice') => {
  const sub = await request(key, target, person);
  await activate(sub.id);
  return sub.id as string;
};
// Time travel for period tests: owner-only surgery that moves every period of a subscription into the past. The
// triggers that forbid exactly this are switched off for the one statement and switched on again.
async function backdate(subscriptionId: string, days: number) {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'ALTER TABLE customer_private.billing_subscription_event DISABLE TRIGGER billing_subscription_event_immutable',
    );
    await db.query(
      'ALTER TABLE customer_private.billing_subscription_event DISABLE TRIGGER billing_event_guard',
    );
    await db.query(
      `UPDATE customer_private.billing_subscription_event SET period_start=period_start-$2::int,period_end=period_end-$2::int
 WHERE subscription_id=$1 AND period_start IS NOT NULL`,
      [subscriptionId, days],
    );
    await db.query(
      'ALTER TABLE customer_private.billing_subscription_event ENABLE TRIGGER billing_subscription_event_immutable',
    );
    await db.query(
      'ALTER TABLE customer_private.billing_subscription_event ENABLE TRIGGER billing_event_guard',
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
const planBody = (over: Record<string, unknown> = {}) => ({
  planKey: 'example-yearly-team',
  expectedVersion: 0,
  title: 'Yearly team plan (sample plan)',
  summary: 'An example yearly plan used to test plan maintenance. The price is invented.',
  interval: 'year',
  priceMinor: '99000',
  currency: 'USD',
  taxTreatment: 'tax_to_be_confirmed',
  included: ['A shared workspace for a team'],
  excluded: ['Any support commitment'],
  active: true,
  entitlements: [
    { key: 'workspace_members', mode: 'limit', limit: 8 },
    { key: 'active_programmes', mode: 'limit', limit: 4 },
    { key: 'programme_participants', mode: 'unlimited', limit: null },
    { key: 'open_service_requests', mode: 'limit', limit: 2 },
    { key: 'report_exports', mode: 'included', limit: null },
  ],
  ...over,
});
const revise = (over: Record<string, unknown> = {}) =>
  staff.revisePlan(staffCtx(), { commandId: randomUUID(), ...planBody(over) });
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.billing_subscription) subscriptions,
 (SELECT count(*)::int FROM customer_private.billing_subscription_event) timeline,
 (SELECT count(*)::int FROM customer_private.billing_plan_version) plans,
 (SELECT count(*)::int FROM customer_private.billing_plan_view) views,
 (SELECT count(*)::int FROM customer_private.billing_command) commands,
 (SELECT count(*)::int FROM customer_private.billing_staff_command) staff_commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type IN ('customer_billing_subscription','customer_billing_plan')) events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type IN ('customer_billing_subscription','customer_billing_plan')) audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type IN ('customer_billing_subscription','customer_billing_plan')) outbox`)
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

beforeAll(async () => {
  f = await accessFixture();
  staff = new CustomerBillingStaffService(f.runtime);
  // Stage everything this module reads, populated, before the module exists.
  await migrateCustomerMemberRoles(f.owner);
  const principals: Record<string, string> = {};
  for (const person of people)
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit invented billing test identity; no real account or email',
      })
    ).id;
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic billing workspace' })
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
  before = await snapshot();
  await migrateCustomerBilling(f.owner);
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
  expect(added.filter((n) => !/^(customer|customer_private|app)\.billing_/.test(n))).toEqual([]);
  expect(added).toContain('customer.billing_command(uuid,text,jsonb)');
  const oldTables = new Set(before.tables.map((t) => t.nspname + '.' + t.relname));
  expect(
    after.tables
      .map((t) => t.nspname + '.' + t.relname)
      .filter((t) => !oldTables.has(t))
      .sort(),
  ).toEqual(
    [
      'command',
      'entitlement_key',
      'plan_entitlement',
      'plan_version',
      'plan_view',
      'staff_command',
      'subscription',
      'subscription_event',
    ]
      .map((n) => 'customer_private.billing_' + n)
      .sort(),
  );
  for (const [name, digest] of Object.entries(before.records))
    expect(after.records[name]).toBe(digest);
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
  expect(triggers.every((t) => /^billing_/.test(t.relname))).toBe(true);
  // The module stands alone: it does not need the paid-service module and nothing else reads its tables.
  expect(
    (await f.owner.query("SELECT to_regclass('customer_private.service_request') r")).rows[0].r,
  ).toBeNull();
  const applied = (
    await f.owner.query('SELECT name,sha256 FROM customer_billing_migrations.applied')
  ).rows;
  expect(applied).toHaveLength(1);
  const sql = await readFile('packages/db/customer-billing-migrations/' + applied[0].name, 'utf8');
  expect(applied[0].sha256).toBe(createHash('sha256').update(sql).digest('hex'));
});

test('the runtime and auth logins can reach only the eight intended functions and none of the tables', async () => {
  const tables = [
    'entitlement_key',
    'plan_version',
    'plan_entitlement',
    'plan_view',
    'subscription',
    'subscription_event',
    'command',
    'staff_command',
  ];
  for (const pool of [f.runtime, f.auth])
    for (const t of tables) {
      await expect(pool.query('SELECT * FROM customer_private.billing_' + t)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(pool.query('DELETE FROM customer_private.billing_' + t)).rejects.toThrow(
        /permission denied/i,
      );
    }
  await expect(
    f.runtime.query(
      "INSERT INTO customer_private.billing_subscription(tenant_id,created_by,plan_id,billing_interval,plan_digest) VALUES($1,$1,$1,'month',$2)",
      [randomUUID(), 'a'.repeat(64)],
    ),
  ).rejects.toThrow(/permission denied/i);
  const exec = async (role: string) =>
    (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.proname LIKE 'billing\\_%' AND n.nspname IN ('app','customer','customer_private') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.name);
  expect(await exec('corridra_runtime')).toEqual(
    [
      'app.billing_plan_staff_command(uuid,jsonb)',
      'app.billing_plan_staff_list()',
      'app.billing_staff_command(uuid,text,jsonb)',
      'app.billing_staff_list(uuid,integer)',
      'app.billing_staff_view(uuid)',
      'customer.billing_command(uuid,text,jsonb)',
      'customer.billing_overview(uuid)',
      'customer.billing_plans(uuid)',
    ].sort(),
  );
  expect(await exec('corridra_auth')).toEqual([]);
  // Called without a customer session the customer functions are denied.
  await expect(f.runtime.query('SELECT customer.billing_plans($1)', [workspaceId])).rejects.toThrow(
    /denied/i,
  );
  await expect(
    f.runtime.query('SELECT customer.billing_overview($1)', [workspaceId]),
  ).rejects.toThrow(/denied/i);
  await expect(
    f.runtime.query("SELECT customer.billing_command($1,'cancel',$2)", [
      randomUUID(),
      JSON.stringify({ workspaceId, subscriptionId: randomUUID() }),
    ]),
  ).rejects.toThrow(/denied/i);
  // Staff functions need the protected staff authority; the customer function route gives none.
  await expect(f.runtime.query('SELECT app.billing_staff_list(NULL,10)')).rejects.toThrow();
  await expect(f.runtime.query('SELECT app.billing_plan_staff_list()')).rejects.toThrow();
  // The internal helpers are not callable at all.
  for (const call of [
    'SELECT customer_private.billing_plan_digest($1)',
    'SELECT customer_private.billing_settle($1)',
    'SELECT customer_private.billing_summary($1)',
  ])
    await expect(f.runtime.query(call, [randomUUID()])).rejects.toThrow(/permission denied/i);
});

test('three sample plans exist, each states every entitlement, and every customer role reads them', async () => {
  const keys = (
    await f.owner.query(
      'SELECT key,unit FROM customer_private.billing_entitlement_key ORDER BY key',
    )
  ).rows;
  expect(keys).toEqual([
    { key: 'active_programmes', unit: 'count' },
    { key: 'open_service_requests', unit: 'count' },
    { key: 'programme_participants', unit: 'count' },
    { key: 'report_exports', unit: 'flag' },
    { key: 'workspace_members', unit: 'count' },
  ]);
  const seeded = (
    await f.owner.query(
      "SELECT plan_key,version,source,synthetic,active,title,price_minor::text,currency,tax_treatment FROM customer_private.billing_plan_version WHERE source='SEED' ORDER BY plan_key",
    )
  ).rows;
  expect(seeded.map((r) => r.plan_key)).toEqual([
    'example-organiser',
    'example-organiser-bdt',
    'example-starter',
  ]);
  for (const row of seeded) {
    expect(row.synthetic).toBe(true);
    expect(row.title).toMatch(/\(sample plan\)$/);
  }
  expect(seeded.find((r) => r.plan_key === 'example-organiser-bdt')).toMatchObject({
    price_minor: '480000',
    currency: 'BDT',
  });
  const perPlan = (
    await f.owner.query(
      'SELECT plan_id,count(*)::int n FROM customer_private.billing_plan_entitlement GROUP BY plan_id',
    )
  ).rows;
  expect(perPlan.every((r) => r.n === 5)).toBe(true);
  for (const person of ['alice', 'bob', 'carol']) {
    const read = await plans(workspaceId, person);
    expect(read.plans.map((p: BillingPlan) => p.key)).toEqual([
      'example-organiser',
      'example-organiser-bdt',
      'example-starter',
    ]);
    expect(read).toMatchObject({
      canRequest: person !== 'carol',
      entitlementsEnforced: false,
      invoicing: 'not_enabled',
      paymentTaken: false,
      synthetic: true,
    });
    for (const p of read.plans) {
      expect(p.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(p.entitlements).toHaveLength(5);
      expect(p.included.length).toBeGreaterThan(0);
      expect(p.excluded.length).toBeGreaterThan(0);
      expect(p.priceMinor).toMatch(/^\d+$/);
    }
  }
  const organiser = await planByKey('example-organiser');
  expect(organiser).toMatchObject({
    interval: 'month',
    priceMinor: '4900',
    currency: 'USD',
    taxTreatment: 'price_excludes_tax',
  });
  expect(organiser.entitlements.find((e) => e.key === 'workspace_members')).toMatchObject({
    mode: 'limit',
    limit: 10,
  });
  expect(organiser.entitlements.find((e) => e.key === 'report_exports')).toMatchObject({
    mode: 'included',
    limit: null,
  });
  expect(
    (await planByKey('example-starter')).entitlements.find((e) => e.key === 'report_exports'),
  ).toMatchObject({ mode: 'excluded' });
  // The digest is stable between reads.
  expect((await planByKey('example-organiser')).digest).toBe(organiser.digest);
  // Outsiders and forged workspace ids see nothing; the unknown and the other private workspace look the same.
  await expect(plans(workspaceId, 'dave')).rejects.toThrow(/unavailable/i);
  await expect(plans(otherWorkspace, 'alice')).rejects.toThrow(/unavailable/i);
  await expect(plans(randomUUID(), 'alice')).rejects.toThrow(/unavailable/i);
  await expect(plans(workspaceId, 'erin')).rejects.toThrow(/unavailable/i);
});

test('only an owner or admin who has been shown a plan is recorded as having seen it; a member only reads', async () => {
  // A showing belongs to a person and a plan version, not to a workspace: erin has never seen any plan.
  const target = await freshWorkspace('erin');
  const start = await counts();
  await plans(target, 'erin');
  expect((await counts()).views).toBe(start.views + 3);
  // Reading again, here or in another workspace, records nothing new.
  await plans(target, 'erin');
  expect((await counts()).views).toBe(start.views + 3);
  // A member reads but is never recorded as having been shown a plan for asking.
  const views = (await counts()).views;
  const readerView = await plans(workspaceId, 'carol');
  expect(readerView.canRequest).toBe(false);
  expect((await counts()).views).toBe(views);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM customer_private.billing_plan_view v JOIN customer_private.principal p ON p.id=v.principal_id WHERE p.subject='synthetic-billing-carol'",
      )
    ).rows[0].n,
  ).toBe(0);
});

test('asking for a plan needs the shown plan, the exact version and fingerprint and an acknowledgement', async () => {
  const target = await freshWorkspace();
  const plan = await planByKey('example-organiser', target);
  const base = {
    action: 'request',
    commandId: randomUUID(),
    workspaceId: target,
    planKey: plan.key,
    planVersion: plan.version,
    planDigest: plan.digest,
    acknowledged: true,
  };
  // The schema refuses a request without the acknowledgement, with extra fields or with a bad fingerprint.
  for (const bad of [
    { ...base, acknowledged: false },
    { ...base, acknowledged: undefined },
    { ...base, planDigest: 'abc' },
    { ...base, note: 'extra' },
    { ...base, planVersion: 0 },
  ])
    expect(customerBillingCommandInput.safeParse(bad).success).toBe(false);
  const start = await counts();
  // The database repeats every rule: a wrong fingerprint, version or plan, and a plan never shown to this person.
  await expect(svc().command({ ...base, planDigest: 'a'.repeat(64) })).rejects.toThrow(
    /plan changed/i,
  );
  await expect(svc().command({ ...base, planVersion: 7 })).rejects.toThrow(/not on offer/i);
  await expect(svc().command({ ...base, planKey: 'no-such-plan' })).rejects.toThrow(
    /not on offer/i,
  );
  const direct = (over: Record<string, unknown>) =>
    rawProof((db) =>
      db.query('SELECT customer.billing_command($1,$2,$3)', [
        randomUUID(),
        'request',
        JSON.stringify({
          workspaceId: target,
          planKey: plan.key,
          planVersion: plan.version,
          planDigest: plan.digest,
          acknowledged: true,
          ...over,
        }),
      ]),
    );
  expect(String(await direct({ acknowledged: false }))).toMatch(/reviewed and acknowledged/i);
  expect(String(await direct({ extra: 1 }))).toMatch(/reviewed and acknowledged/i);
  expect(String(await direct({ planVersion: '1' }))).toMatch(/reviewed and acknowledged/i);
  // Erin was never shown the plan in any workspace: she has no role there at all.
  await expect(svc('erin').command({ ...base, commandId: randomUUID() })).rejects.toThrow(
    /unavailable|owner or admin/i,
  );
  expect((await counts()).subscriptions).toBe(start.subscriptions);
  // A person who was shown the plan only as a reader cannot ask: carol is a member of the main workspace.
  const mainPlan = await planByKey('example-organiser', workspaceId, 'carol');
  await expect(
    svc('carol').command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId,
      planKey: mainPlan.key,
      planVersion: mainPlan.version,
      planDigest: mainPlan.digest,
      acknowledged: true,
    }),
  ).rejects.toThrow(/owner or admin required/i);
  // Bob, an admin, was not shown this plan in the other workspace: he is not a member of it.
  await expect(request('example-organiser', target, 'bob')).rejects.toThrow(/unavailable/i);
  // The real request works and records one subscription, one timeline row and one event chain.
  const ok = await request('example-organiser', target);
  expect(ok).toMatchObject({
    workspaceId: target,
    planKey: 'example-organiser',
    planVersion: 1,
    status: 'requested',
    periodStart: null,
    periodEnd: null,
    operation: 'request',
    synthetic: true,
  });
  const end = await counts();
  expect(end.subscriptions).toBe(start.subscriptions + 1);
  expect(end.timeline).toBe(start.timeline + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.audits).toBe(start.audits + 1);
  expect(end.outbox).toBe(start.outbox + 1);
  const row = (
    await f.owner.query(
      'SELECT plan_digest,billing_interval FROM customer_private.billing_subscription WHERE id=$1',
      [ok.id],
    )
  ).rows[0];
  expect(row).toEqual({ plan_digest: plan.digest, billing_interval: 'month' });
  // Gina owns a workspace of her own and has the fingerprint of the plan, but was never shown it herself.
  const gina = await freshWorkspace('gina');
  const ginaBody = { ...base, workspaceId: gina, commandId: randomUUID() };
  await expect(svc('gina').command(ginaBody)).rejects.toThrow(/review the whole plan/i);
  await plans(gina, 'gina');
  await expect(
    svc('gina').command({ ...ginaBody, commandId: randomUUID() }),
  ).resolves.toMatchObject({
    status: 'requested',
  });
});

test('a workspace has one open request at a time, even when several are sent at the same moment', async () => {
  const target = await freshWorkspace();
  const plan = await planByKey('example-organiser', target);
  const send = () =>
    svc().command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId: target,
      planKey: plan.key,
      planVersion: plan.version,
      planDigest: plan.digest,
      acknowledged: true,
    });
  const race = await Promise.allSettled([send(), send(), send()]);
  expect(race.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  for (const x of race.filter((y) => y.status === 'rejected'))
    expect(String((x as PromiseRejectedResult).reason)).toMatch(/already an open plan request/i);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.billing_subscription WHERE tenant_id=$1',
        [target],
      )
    ).rows[0].n,
  ).toBe(1);
  // Another plan cannot be requested while one request is open, either.
  await expect(request('example-starter', target)).rejects.toThrow(/already an open plan request/i);
});

test('a repeated command returns the first answer once, and the same id with other content conflicts', async () => {
  const target = await freshWorkspace();
  const plan = await planByKey('example-starter', target);
  const commandId = randomUUID();
  const body = {
    action: 'request',
    commandId,
    workspaceId: target,
    planKey: plan.key,
    planVersion: plan.version,
    planDigest: plan.digest,
    acknowledged: true,
  };
  const start = await counts();
  const first = await svc().command(body);
  const again = await svc().command(body);
  expect(again).toEqual(first);
  expect((await counts()).subscriptions).toBe(start.subscriptions + 1);
  expect((await counts()).events).toBe(start.events + 1);
  const other = await planByKey('example-organiser', target);
  await expect(
    svc().command({ ...body, planKey: other.key, planDigest: other.digest }),
  ).rejects.toThrow(/conflicts with original/i);
  await expect(
    svc().command({
      action: 'withdraw',
      commandId,
      workspaceId: target,
      subscriptionId: first.id,
    }),
  ).rejects.toThrow(/conflicts with original/i);
  // The same retry from another person is a different command and gets its own answer.
  const sub = first.id;
  const withdrawn = await act('withdraw', sub, target);
  expect(withdrawn.status).toBe('withdrawn');
});

test('staff see the queue and the request with its plan, and nobody else can', async () => {
  const target = await freshWorkspace();
  const sub = await request('example-organiser', target);
  const queue = await staff.list(staffCtx());
  expect(queue.subscriptions.some((x: { id: string }) => x.id === sub.id)).toBe(true);
  const detail = await staff.view(staffCtx(), sub.id);
  expect(detail.subscription).toMatchObject({
    status: 'requested',
    workspaceName: expect.stringMatching(/^Synthetic billing workspace/),
    planKey: 'example-organiser',
  });
  expect(detail.plan.digest).toBe(detail.planDigestAtRequest);
  expect(detail.actions).toEqual(['activate', 'decline', 'note']);
  expect(detail.replacesHeldPlan).toBe(false);
  expect(detail.plan.entitlements).toHaveLength(5);
  // Other staff roles, other people and the customer route have no way in.
  await expect(staff.list(f.users.operator.ctx)).rejects.toThrow(/denied/i);
  await expect(staff.list(f.users.viewer.ctx)).rejects.toThrow(/denied/i);
  await expect(staff.list(f.users.reviewer.ctx)).rejects.toThrow(/denied/i);
  await expect(staff.view(f.users.operator.ctx, sub.id)).rejects.toThrow(/denied/i);
  await expect(staff.plans(f.users.viewer.ctx)).rejects.toThrow(/denied/i);
  await expect(
    staff.command(f.users.viewer.ctx, {
      action: 'decline',
      commandId: randomUUID(),
      subscriptionId: sub.id,
      expectedSeq: 1,
      customerNote: note,
    }),
  ).rejects.toThrow(/denied/i);
  await expect(staff.view(staffCtx(), randomUUID())).rejects.toThrow(/unavailable/i);
  // Lists page newest first.
  const page = await staff.list(staffCtx(), { pageSize: 2 });
  expect(page.subscriptions).toHaveLength(2);
  expect(page.nextAfter).toBeTruthy();
  const next = await staff.list(staffCtx(), { pageSize: 2, after: page.nextAfter });
  expect(
    next.subscriptions.every(
      (x: { id: string }) => !page.subscriptions.some((y: { id: string }) => y.id === x.id),
    ),
  ).toBe(true);
});

test('activation sets an explicit period; the period rules, notes and positions are enforced', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-organiser', target)).id as string;
  const start = await counts();
  // Zod and the database both refuse a bad start date or note.
  for (const bad of [
    { periodStart: '30-11-2026', customerNote: null },
    { periodStart: day(), customerNote: 'no marker here' },
    { periodStart: day(), customerNote: null, extra: 1 },
  ])
    expect(
      staffBillingCommandInput.safeParse({
        action: 'activate',
        commandId: randomUUID(),
        subscriptionId: sub,
        expectedSeq: 1,
        ...bad,
      }).success,
    ).toBe(false);
  // The database refuses a start more than a month ahead or more than a day back.
  await expect(activate(sub, day(40))).rejects.toThrow(/within a month of today/i);
  await expect(activate(sub, day(-5))).rejects.toThrow(/within a month of today/i);
  // A stale position is refused.
  await expect(
    staff.command(staffCtx(), {
      action: 'activate',
      commandId: randomUUID(),
      subscriptionId: sub,
      expectedSeq: 7,
      periodStart: day(),
      customerNote: null,
    }),
  ).rejects.toThrow(/changed; reload/i);
  expect(await counts()).toMatchObject({ timeline: start.timeline });
  const done = await activate(sub, day(), 'Synthetic note: your plan starts today');
  expect(done).toMatchObject({ status: 'active', periodStart: day(), operation: 'activate' });
  const end = (
    await f.owner.query(
      "SELECT period_end::text e FROM customer_private.billing_subscription_event WHERE subscription_id=$1 AND kind='activated'",
      [sub],
    )
  ).rows[0].e;
  expect(end).toBe(
    (await f.owner.query("SELECT ($1::date + interval '1 month')::date::text e", [day()])).rows[0]
      .e,
  );
  expect(done.periodEnd).toBe(end);
  expect(done.periodElapsed).toBe(false);
  // A second activation, a decline and a withdrawal no longer apply.
  await expect(activate(sub)).rejects.toThrow(/not available for this subscription now/i);
  await expect(staffAct('decline', sub, { customerNote: note })).rejects.toThrow(
    /not available for this subscription now/i,
  );
  await expect(act('withdraw', sub, target)).rejects.toThrow(
    /not available for this subscription now/i,
  );
  // The customer reads the note and the period; internal notes never reach the customer.
  await staffAct('note', sub, {
    internalNote: 'Synthetic internal note the customer must never see',
  });
  const seen = await overview(target);
  expect(seen.current).toMatchObject({ id: sub, status: 'active', periodStart: day() });
  const lines = seen.subscriptions[0].timeline;
  expect(lines.map((l) => l.kind)).toEqual(['requested', 'activated']);
  expect(lines[1]).toMatchObject({
    by: 'Corridra team',
    note: 'Synthetic note: your plan starts today',
  });
  expect(JSON.stringify(seen)).not.toMatch(/internal note/i);
  const detail = await staff.view(staffCtx(), sub);
  expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual([
    'requested',
    'activated',
    'internal_note',
  ]);
  expect(detail.events[2].internalNote).toMatch(/internal note/i);
  expect(detail.actions).toEqual(['renew', 'end', 'note']);
});

test('declining needs a reason the customer reads, and a declined request can be asked for again', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-starter', target)).id as string;
  await expect(
    staff.command(staffCtx(), {
      action: 'decline',
      commandId: randomUUID(),
      subscriptionId: sub,
      expectedSeq: 1,
      customerNote: 'No marker in this reason',
    }),
  ).rejects.toThrow();
  const declined = await staffAct('decline', sub, {
    customerNote: 'Synthetic reason: not available for this team yet',
  });
  expect(declined.status).toBe('declined');
  const seen = await overview(target);
  expect(seen.current).toBeNull();
  expect(seen.pending).toBeNull();
  expect(seen.subscriptions[0].timeline.at(-1)).toMatchObject({
    kind: 'declined',
    note: 'Synthetic reason: not available for this team yet',
  });
  expect(seen.actions).toEqual(['request']);
  await expect(
    staffAct('activate', sub, { periodStart: day(), customerNote: null }),
  ).rejects.toThrow(/not available for this subscription now/i);
  const again = await request('example-starter', target);
  expect(again.status).toBe('requested');
});

test('a customer can withdraw a request before staff act, and cannot after', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-organiser', target)).id as string;
  await expect(act('withdraw', sub, target, 'carol')).rejects.toThrow(
    /unavailable|owner or admin/i,
  );
  const out = await act('withdraw', sub, target, 'alice');
  expect(out.status).toBe('withdrawn');
  expect((await overview(target)).actions).toEqual(['request']);
  await expect(
    staffAct('activate', sub, { periodStart: day(), customerNote: null }),
  ).rejects.toThrow(/not available for this subscription now/i);
  await expect(act('cancel', sub, target)).rejects.toThrow(
    /not available for this subscription now/i,
  );
  await expect(act('withdraw', randomUUID(), target)).rejects.toThrow(/unavailable/i);
  await expect(act('withdraw', sub, otherWorkspace, 'dave')).rejects.toThrow(
    /unavailable|owner or admin/i,
  );
  // Another workspace's subscription cannot be touched with a forged workspace id.
  const mine = await freshWorkspace('dave');
  await expect(act('withdraw', sub, mine, 'dave')).rejects.toThrow(/unavailable/i);
});

test('entitlements are read from the held plan only while its period runs, and are never enforced', async () => {
  const target = await freshWorkspace();
  const none = await overview(target);
  expect(none).toMatchObject({
    current: null,
    pending: null,
    entitlements: [],
    entitlementsEnforced: false,
  });
  expect(none.actions).toEqual(['request']);
  const sub = (await request('example-organiser', target)).id as string;
  const asked = await overview(target);
  expect(asked.pending).toMatchObject({ id: sub, status: 'requested' });
  expect(asked.entitlements).toEqual([]);
  expect(asked.actions).toEqual(['withdraw']);
  await activate(sub);
  const held = await overview(target);
  expect(held.current).toMatchObject({ id: sub, status: 'active', periodElapsed: false });
  expect(held.entitlements).toHaveLength(5);
  expect(held.entitlements.find((e) => e.key === 'workspace_members')).toMatchObject({
    mode: 'limit',
    limit: 10,
    unit: 'count',
  });
  expect(held.actions).toEqual(['request', 'cancel']);
  expect(held.entitlementsEnforced).toBe(false);
  // The period ends: the record stays, the entitlements stop, and renewal is the way on.
  await backdate(sub, 45);
  const lapsed = await overview(target);
  expect(lapsed.current).toMatchObject({ id: sub, status: 'active', periodElapsed: true });
  expect(lapsed.entitlements).toEqual([]);
  expect(lapsed.actions).toEqual(['request']);
  // A member sees the same facts but no actions.
  const asMember = await overview(workspaceId, 'carol');
  expect(asMember.canAct).toBe(false);
  expect(asMember.actions).toEqual([]);
});

test('a customer can schedule cancellation and take it back; at the end date the subscription ends once, on its own', async () => {
  const target = await freshWorkspace();
  const sub = await hold('example-organiser', target);
  await expect(act('keep', sub, target)).rejects.toThrow(
    /not available for this subscription now/i,
  );
  const scheduled = await act('cancel', sub, target);
  expect(scheduled.status).toBe('cancel_scheduled');
  const view = await overview(target);
  expect(view.current).toMatchObject({ status: 'cancel_scheduled' });
  expect(view.entitlements).toHaveLength(5);
  expect(view.actions).toEqual(['request', 'keep']);
  await expect(act('cancel', sub, target)).rejects.toThrow(
    /not available for this subscription now/i,
  );
  const kept = await act('keep', sub, target);
  expect(kept.status).toBe('active');
  await act('cancel', sub, target);
  // The end date arrives. The next look writes the ending once, attributed to the system.
  await backdate(sub, 45);
  const start = await counts();
  const ended = await overview(target);
  expect(ended.current).toBeNull();
  const line = ended.subscriptions[0].timeline.at(-1)!;
  expect(line).toMatchObject({
    kind: 'ended',
    status: 'ended',
    by: 'Automatic',
    endReason: 'period_elapsed',
  });
  expect((await counts()).timeline).toBe(start.timeline + 1);
  expect((await counts()).events).toBe(start.events + 1);
  await overview(target);
  await staff.view(staffCtx(), sub);
  expect((await counts()).timeline).toBe(start.timeline + 1);
  expect(ended.actions).toEqual(['request']);
  expect(ended.entitlements).toEqual([]);
  // An ended subscription accepts nothing more.
  await expect(act('keep', sub, target)).rejects.toThrow(
    /not available for this subscription now/i,
  );
  await expect(staffAct('end', sub, { customerNote: note })).rejects.toThrow(
    /not available for this subscription now/i,
  );
  // The event for the automatic ending is attributed to the executor, with the customer service identity.
  const evt = (
    await f.owner.query(
      "SELECT actor_id,payload FROM app.domain_event WHERE aggregate_type='customer_billing_subscription' AND aggregate_id=$1 AND type='customer.billing.subscription.ended'",
      [sub],
    )
  ).rows;
  expect(evt).toHaveLength(1);
  expect(evt[0].actor_id).toBe(f.serviceId);
  expect(evt[0].payload).toMatchObject({ initiator_kind: 'system', status: 'ended' });
});

test('cancellation cannot be requested or withdrawn once the period has ended', async () => {
  const target = await freshWorkspace();
  const sub = await hold('example-organiser', target);
  await backdate(sub, 45);
  await expect(act('cancel', sub, target)).rejects.toThrow(/period has ended/i);
  // The same rule holds when the timeline is written directly.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor) SELECT $1,$2,3,'cancel_requested','cancel_scheduled','customer',created_by FROM customer_private.billing_subscription WHERE id=$1",
      [sub, target],
    ),
  ).rejects.toThrow(/period has ended/i);
});

test('a renewal starts when the period ends, may be booked 31 days ahead at most, and keeps the history', async () => {
  const target = await freshWorkspace();
  const sub = await hold('example-organiser', target);
  const first = (await staff.view(staffCtx(), sub)).events.find(
    (e: { kind: string }) => e.kind === 'activated',
  );
  const renewed = await staffAct('renew', sub, {
    customerNote: 'Synthetic note: renewed for the next month',
  });
  expect(renewed).toMatchObject({ status: 'active', periodStart: first.periodEnd });
  const events = (await staff.view(staffCtx(), sub)).events;
  const second = events.find((e: { kind: string }) => e.kind === 'renewed');
  expect(second.periodStart).toBe(first.periodEnd);
  const secondEnd = (
    await f.owner.query("SELECT ($1::date + interval '1 month')::date::text e", [
      second.periodStart,
    ])
  ).rows[0].e;
  expect(second.periodEnd).toBe(secondEnd);
  // The summary now shows the latest period.
  expect((await overview(target)).current).toMatchObject({
    periodStart: second.periodStart,
    periodEnd: second.periodEnd,
  });
  // The first period is kept in the history.
  expect(events.filter((e: { periodStart: string | null }) => e.periodStart)).toHaveLength(2);
  // A third renewal would start almost two months ahead: refused.
  await expect(staffAct('renew', sub, { customerNote: null })).rejects.toThrow(
    /31 days ahead at most/i,
  );
  // A renewal cannot happen while cancellation is scheduled.
  const other = await hold('example-organiser', await freshWorkspace());
  const ws = (await staff.view(staffCtx(), other)).subscription.workspaceId;
  await act('cancel', other, ws);
  await expect(staffAct('renew', other, { customerNote: null })).rejects.toThrow(
    /not available for this subscription now/i,
  );
  // Direct writes cannot skip or overlap a period either.
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,period_start,period_end) SELECT $1,$2,4,'renewed','active','staff',$3,$4,$5::date,($5::date+interval '1 month')::date",
      [
        sub,
        target,
        f.users.owner.id,
        (
          await f.owner.query('SELECT tenant_id FROM app.membership WHERE user_id=$1 LIMIT 1', [
            f.users.owner.id,
          ])
        ).rows[0].tenant_id,
        day(3),
      ],
    ),
  ).rejects.toThrow(/renewal starts when the period ends/i);
});

test('a yearly plan renews no sooner than 31 days before its year ends', async () => {
  const made = await revise();
  expect(made).toMatchObject({ planKey: 'example-yearly-team', version: 1, active: true });
  const target = await freshWorkspace();
  const sub = await hold('example-yearly-team', target);
  const events = (await staff.view(staffCtx(), sub)).events;
  const a = events.find((e: { kind: string }) => e.kind === 'activated');
  expect(
    (await f.owner.query("SELECT ($1::date + interval '1 year')::date::text e", [a.periodStart]))
      .rows[0].e,
  ).toBe(a.periodEnd);
  await expect(staffAct('renew', sub, { customerNote: null })).rejects.toThrow(
    /31 days ahead at most/i,
  );
  // Eleven months later the renewal is allowed and starts exactly where the year ended.
  await backdate(sub, 340);
  const moved = (await staff.view(staffCtx(), sub)).events.find(
    (e: { kind: string }) => e.kind === 'activated',
  );
  const renewed = await staffAct('renew', sub, { customerNote: null });
  expect(renewed.status).toBe('active');
  expect(renewed.periodStart).toBe(moved.periodEnd);
  expect(
    (await staff.view(staffCtx(), sub)).events.filter(
      (e: { kind: string }) => e.kind === 'renewed',
    ),
  ).toHaveLength(1);
});

test('asking for another plan while one is held is a change; activating it ends the held plan in the same step', async () => {
  const target = await freshWorkspace();
  const first = await hold('example-starter', target);
  // The plan already held cannot be asked for again.
  await expect(request('example-starter', target)).rejects.toThrow(/already holds this plan/i);
  const second = (await request('example-organiser', target)).id as string;
  const detail = await staff.view(staffCtx(), second);
  expect(detail.replacesHeldPlan).toBe(true);
  // While the request is open the held plan still counts.
  const mid = await overview(target);
  expect(mid.current).toMatchObject({ id: first, planKey: 'example-starter' });
  expect(mid.pending).toMatchObject({ id: second });
  expect(mid.actions).toEqual(['withdraw']);
  await activate(second);
  const after = await overview(target);
  expect(after.current).toMatchObject({
    id: second,
    planKey: 'example-organiser',
    status: 'active',
  });
  const old = after.subscriptions.find((s) => s.id === first)!;
  expect(old.status).toBe('ended');
  expect(old.timeline.at(-1)).toMatchObject({
    kind: 'ended',
    endReason: 'replaced',
    by: 'Corridra team',
  });
  // Never two held plans.
  const held = (
    await f.owner.query(
      `SELECT count(*)::int n FROM customer_private.billing_subscription s WHERE s.tenant_id=$1
 AND (SELECT status_after FROM customer_private.billing_subscription_event e WHERE e.subscription_id=s.id ORDER BY seq DESC LIMIT 1) IN ('active','cancel_scheduled')`,
      [target],
    )
  ).rows[0].n;
  expect(held).toBe(1);
  // The database refuses a second held plan and a second open request even when written directly.
  const third = (await request('example-starter', target)).id as string;
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,period_start,period_end) SELECT $1,$2,2,'activated','active','staff',$3,(SELECT id FROM app.tenant WHERE name='Synthetic North'),$4::date,($4::date+interval '1 month')::date",
      [third, target, f.users.owner.id, day()],
    ),
  ).rejects.toThrow(/already holds a plan/i);
  // Only one request is open at a time, even when a second one is written directly.
  const extra = randomUUID();
  await f.owner.query(
    'INSERT INTO customer_private.billing_subscription(id,tenant_id,created_by,plan_id,billing_interval,plan_digest) SELECT $2,tenant_id,created_by,plan_id,billing_interval,plan_digest FROM customer_private.billing_subscription WHERE id=$1',
    [third, extra],
  );
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor) SELECT s.id,s.tenant_id,1,'requested','requested','customer',s.created_by FROM customer_private.billing_subscription s WHERE s.id=$1",
      [extra],
    ),
  ).rejects.toThrow(/already an open plan request/i);
});

test('two activations of different requests sent at the same moment cannot leave two held plans', async () => {
  const target = await freshWorkspace();
  const base = await hold('example-starter', target);
  const next = (await request('example-organiser', target)).id as string;
  const race = await Promise.allSettled([
    activate(next),
    activate(next),
    staffAct('end', base, { customerNote: note }),
  ]);
  expect(race.some((x) => x.status === 'fulfilled')).toBe(true);
  const held = (
    await f.owner.query(
      `SELECT count(*)::int n FROM customer_private.billing_subscription s WHERE s.tenant_id=$1
 AND (SELECT status_after FROM customer_private.billing_subscription_event e WHERE e.subscription_id=s.id ORDER BY seq DESC LIMIT 1) IN ('active','cancel_scheduled')`,
      [target],
    )
  ).rows[0].n;
  expect(held).toBeLessThanOrEqual(1);
});

test('staff can end a subscription with a reason the customer reads', async () => {
  const target = await freshWorkspace();
  const sub = await hold('example-organiser', target);
  await expect(
    staff.command(staffCtx(), {
      action: 'end',
      commandId: randomUUID(),
      subscriptionId: sub,
      expectedSeq: await seq(sub),
      customerNote: 'No marker in this reason',
    }),
  ).rejects.toThrow();
  const ended = await staffAct('end', sub, {
    customerNote: 'Synthetic reason: the team closed this example plan',
  });
  expect(ended.status).toBe('ended');
  const seen = await overview(target);
  expect(seen.current).toBeNull();
  expect(seen.entitlements).toEqual([]);
  expect(seen.subscriptions[0].timeline.at(-1)).toMatchObject({
    kind: 'ended',
    endReason: 'ended_by_team',
    note: 'Synthetic reason: the team closed this example plan',
  });
});

test('staff commands replay once, conflict on other content, and two staff sending the same change produce one winner', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-organiser', target)).id as string;
  const commandId = randomUUID();
  const body = {
    action: 'activate',
    commandId,
    subscriptionId: sub,
    expectedSeq: 1,
    periodStart: day(),
    customerNote: null,
  };
  const start = await counts();
  const one = await staff.command(staffCtx(), body);
  const two = await staff.command(staffCtx(), body);
  expect(two).toEqual(one);
  expect((await counts()).timeline).toBe(start.timeline + 1);
  await expect(staff.command(staffCtx(), { ...body, periodStart: day(1) })).rejects.toThrow(
    /conflicts with original/i,
  );
  // Two different commands from the same position: one wins, the other is told the subscription changed.
  const racer = (await request('example-organiser', await freshWorkspace())).id as string;
  const race = await Promise.allSettled(
    [1, 2, 3].map(() =>
      staff.command(staffCtx(), {
        action: 'activate',
        commandId: randomUUID(),
        subscriptionId: racer,
        expectedSeq: 1,
        periodStart: day(),
        customerNote: null,
      }),
    ),
  );
  expect(race.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  for (const x of race.filter((y) => y.status === 'rejected'))
    expect(String((x as PromiseRejectedResult).reason)).toMatch(/changed; reload/i);
});

test('staff revise plans with a version check; customers see the new version and old requests keep theirs', async () => {
  const target = await freshWorkspace();
  const key = 'example-revise-me';
  await revise({
    planKey: key,
    expectedVersion: 0,
    title: 'Revisable monthly plan (sample plan)',
    interval: 'month',
    priceMinor: '4900',
  });
  const oldPlan = await planByKey(key, target);
  expect(oldPlan).toMatchObject({ version: 1, priceMinor: '4900' });
  const oldRequest = (await request(key, target)).id as string;
  const start = await counts();
  const revised = await revise({
    planKey: key,
    expectedVersion: 1,
    title: 'Revisable monthly plan (sample plan)',
    interval: 'month',
    priceMinor: '5900',
  });
  expect(revised).toMatchObject({ planKey: key, version: 2, active: true });
  const end = await counts();
  expect(end.plans).toBe(start.plans + 1);
  expect(end.events).toBe(start.events + 1);
  expect(end.audits).toBe(start.audits + 1);
  expect(end.outbox).toBe(start.outbox + 1);
  const fresh = await planByKey(key, target);
  expect(fresh).toMatchObject({ version: 2, priceMinor: '5900' });
  expect(fresh.digest).not.toBe(oldPlan.digest);
  // Staff see the latest version, and version 1 is kept exactly as it was.
  expect(
    (await staff.plans(staffCtx())).plans.find((p: BillingPlan) => p.key === key),
  ).toMatchObject({ version: 2 });
  const kept = await f.owner.query(
    'SELECT price_minor::text p FROM customer_private.billing_plan_version WHERE plan_key=$1 AND version=1',
    [key],
  );
  expect(kept.rows[0].p).toBe('4900');
  // The old request keeps the exact version and fingerprint it was made against.
  const row = (
    await f.owner.query(
      'SELECT p.version,s.plan_digest FROM customer_private.billing_subscription s JOIN customer_private.billing_plan_version p ON p.id=s.plan_id WHERE s.id=$1',
      [oldRequest],
    )
  ).rows[0];
  expect(row).toEqual({ version: 1, plan_digest: oldPlan.digest });
  expect((await overview(target)).pending).toMatchObject({ planVersion: 1, priceMinor: '4900' });
  // The old fingerprint and the old version can no longer be used to ask for the plan.
  await act('withdraw', oldRequest, target);
  await expect(
    svc().command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId: target,
      planKey: key,
      planVersion: 1,
      planDigest: oldPlan.digest,
      acknowledged: true,
    }),
  ).rejects.toThrow(/not on offer/i);
  // A stale version check is refused.
  await expect(revise({ planKey: key, expectedVersion: 1 })).rejects.toThrow(/changed; reload/i);
  // Retiring is another version; the plan leaves the customer list and cannot be asked for.
  const retired = await revise({
    planKey: key,
    expectedVersion: 2,
    title: 'Revisable monthly plan (sample plan)',
    interval: 'month',
    active: false,
  });
  expect(retired).toMatchObject({ version: 3, active: false });
  expect((await plans(target)).plans.map((p: BillingPlan) => p.key)).not.toContain(key);
  await expect(
    svc().command({
      action: 'request',
      commandId: randomUUID(),
      workspaceId: target,
      planKey: key,
      planVersion: 3,
      planDigest: fresh.digest,
      acknowledged: true,
    }),
  ).rejects.toThrow(/not on offer/i);
  expect(
    (await staff.plans(staffCtx())).plans.find((p: BillingPlan) => p.key === key),
  ).toMatchObject({ version: 3, active: false });
});

test('a plan must state every entitlement once with a mode that suits its unit, honest wording and an exact price', async () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      'missing entitlement',
      { entitlements: planBody().entitlements.slice(1) },
      /every entitlement/i,
    ],
    [
      'duplicate entitlement',
      { entitlements: [...planBody().entitlements.slice(1), planBody().entitlements[1]] },
      /every entitlement exactly once/i,
    ],
    [
      'unknown entitlement',
      {
        entitlements: [
          ...planBody().entitlements.slice(1),
          { key: 'free_beer_per_week', mode: 'unlimited', limit: null },
        ],
      },
      /every entitlement exactly once/i,
    ],
    [
      'flag with a limit mode',
      {
        entitlements: planBody().entitlements.map((e) =>
          e.key === 'report_exports' ? { key: e.key, mode: 'limit', limit: 3 } : e,
        ),
      },
      /check constraint/i,
    ],
    [
      'count with an included mode',
      {
        entitlements: planBody().entitlements.map((e) =>
          e.key === 'workspace_members' ? { key: e.key, mode: 'included', limit: null } : e,
        ),
      },
      /check constraint/i,
    ],
    ['unknown currency', { currency: 'XXX' }, /supported currency/i],
  ];
  for (const [label, over, message] of cases) {
    const key = 'example-bad-' + label.replaceAll(' ', '-');
    const parsed = staffPlanInput.safeParse({
      commandId: randomUUID(),
      ...planBody({ planKey: key, ...over }),
    });
    // Zod catches some of these first; the rest reach the database, which must refuse them all.
    if (parsed.success)
      await expect(revise({ planKey: key, ...over }), label).rejects.toThrow(message);
  }
  // Zod alone refuses honest-wording and price mistakes.
  for (const bad of [
    { title: 'Yearly team plan' },
    { title: 'Yearly team plan (sample plan) see https://example.invalid' },
    { priceMinor: '49.00' },
    { priceMinor: '-1' },
    { summary: 'short' },
    { included: [] },
    { excluded: [] },
    { interval: 'week' },
    { taxTreatment: 'unstated' },
    { entitlements: [{ key: 'workspace_members', mode: 'limit', limit: null }] },
    { extra: true },
  ])
    expect(staffPlanInput.safeParse({ commandId: randomUUID(), ...planBody(bad) }).success).toBe(
      false,
    );
  // None of the refused plans left anything behind.
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM customer_private.billing_plan_version WHERE plan_key LIKE 'example-bad-%'",
      )
    ).rows[0].n,
  ).toBe(0);
  // Direct inserts are held to the same rules: a plan without entitlements cannot be committed.
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source) VALUES('example-direct',1,'Direct plan (sample plan)','A direct insert used to test the guard.','month',100,'USD','tax_to_be_confirmed',ARRAY['Something included'],ARRAY['Something excluded'],true,'SEED')",
    );
    await expect(db.query('COMMIT')).rejects.toThrow(/state every entitlement/i);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    db.release();
  }
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source) VALUES('example-direct',1,'Direct plan without the word','A direct insert used to test the guard.','month',100,'USD','tax_to_be_confirmed',ARRAY['Something included'],ARRAY['Something excluded'],true,'SEED')",
    ),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source) VALUES('example-direct',1,'Direct plan (sample plan)','A direct insert used to test the guard.','month',-5,'USD','tax_to_be_confirmed',ARRAY['Something included'],ARRAY['Something excluded'],true,'SEED')",
    ),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,source) VALUES('example-direct',1,'Direct plan (sample plan)','A direct insert used to test the guard.','month',100,'USD','tax_to_be_confirmed',ARRAY['Something included'],ARRAY['Something excluded'],true,'STAFF')",
    ),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    f.owner.query(
      "INSERT INTO customer_private.billing_plan_version(plan_key,version,title,summary,billing_interval,price_minor,currency,tax_treatment,included,excluded,active,synthetic,source) VALUES('example-direct',1,'Direct plan (sample plan)','A direct insert used to test the guard.','month',100,'USD','tax_to_be_confirmed',ARRAY['Something included'],ARRAY['Something excluded'],true,false,'SEED')",
    ),
  ).rejects.toThrow(/check constraint/i);
});

test('direct SQL cannot write a move the lifecycle forbids, a note for the wrong actor or a period that does not fit', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-organiser', target)).id as string;
  const insert = (cols: string, vals: unknown[]) =>
    f.owner.query(
      `INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,${cols}) VALUES($1,$2,${vals.map((_, i) => '$' + (i + 3)).join(',')})`,
      [sub, target, ...vals],
    );
  const principal = (
    await f.owner.query(
      'SELECT created_by FROM customer_private.billing_subscription WHERE id=$1',
      [sub],
    )
  ).rows[0].created_by;
  const staffTenant = (
    await f.owner.query("SELECT id FROM app.tenant WHERE name='Synthetic North'")
  ).rows[0].id;
  // Out of order, repeated and skipped entries.
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor', [
      1,
      'requested',
      'requested',
      'customer',
      principal,
    ]),
  ).rejects.toThrow(/duplicate key|in order/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor', [
      3,
      'withdrawn',
      'withdrawn',
      'customer',
      principal,
    ]),
  ).rejects.toThrow(/in order/i);
  // A move that is not allowed from here, or that names the wrong status.
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor', [
      2,
      'cancel_requested',
      'cancel_scheduled',
      'customer',
      principal,
    ]),
  ).rejects.toThrow(/not available for this subscription now/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor', [
      2,
      'withdrawn',
      'active',
      'customer',
      principal,
    ]),
  ).rejects.toThrow(/not available for this subscription now/i);
  // The row shapes the table itself insists on.
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,period_start,period_end', [
      2,
      'activated',
      'active',
      'staff',
      f.users.owner.id,
      staffTenant,
      day(),
      day(),
    ]),
  ).rejects.toThrow(/one full interval|check constraint/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id', [
      2,
      'activated',
      'active',
      'staff',
      f.users.owner.id,
      staffTenant,
    ]),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor', [
      2,
      'activated',
      'active',
      'customer',
      principal,
    ]),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id', [
      2,
      'declined',
      'declined',
      'staff',
      f.users.owner.id,
      staffTenant,
    ]),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,customer_note', [
      2,
      'declined',
      'declined',
      'staff',
      f.users.owner.id,
      staffTenant,
      'no marker',
    ]),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,customer_actor,customer_note', [
      2,
      'withdrawn',
      'withdrawn',
      'customer',
      principal,
      'Synthetic customers write no notes here',
    ]),
  ).rejects.toThrow(/check constraint/i);
  // The period must be one full interval starting within a month of today.
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,period_start,period_end', [
      2,
      'activated',
      'active',
      'staff',
      f.users.owner.id,
      staffTenant,
      day(),
      day(10),
    ]),
  ).rejects.toThrow(/one full interval/i);
  await expect(
    insert('seq,kind,status_after,actor_kind,staff_actor,staff_tenant_id,period_start,period_end', [
      2,
      'activated',
      'active',
      'staff',
      f.users.owner.id,
      staffTenant,
      day(-30),
      day(0),
    ]),
  ).rejects.toThrow(/within a month/i);
  // An automatic ending needs a scheduled cancellation that has arrived.
  await expect(
    insert('seq,kind,status_after,actor_kind,end_reason', [
      2,
      'ended',
      'ended',
      'system',
      'period_elapsed',
    ]),
  ).rejects.toThrow(/not available for this subscription now/i);
  expect((await overview(target)).pending).toMatchObject({ id: sub, status: 'requested' });
});

test('billing records are synthetic only: a workspace that is not synthetic reads, asks and is served nothing', async () => {
  const target = await freshWorkspace();
  const sub = (await request('example-organiser', target)).id as string;
  await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [target]);
  try {
    await expect(plans(target)).rejects.toThrow(/unavailable/i);
    await expect(overview(target)).rejects.toThrow(/unavailable/i);
    await expect(act('withdraw', sub, target)).rejects.toThrow(/unavailable/i);
    // Staff cannot see it or change it either, and the table refuses a new timeline row for it.
    await expect(staff.view(staffCtx(), sub)).rejects.toThrow(/unavailable/i);
    await expect(staffAct('decline', sub, { customerNote: note })).rejects.toThrow();
    expect(
      (await staff.list(staffCtx(), { pageSize: 50 })).subscriptions.some(
        (s: { id: string }) => s.id === sub,
      ),
    ).toBe(false);
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.billing_subscription_event(subscription_id,tenant_id,seq,kind,status_after,actor_kind,customer_actor) SELECT $1,$2,2,'withdrawn','withdrawn','customer',created_by FROM customer_private.billing_subscription WHERE id=$1",
        [sub, target],
      ),
    ).rejects.toThrow(/synthetic only/i);
  } finally {
    await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [target]);
  }
  expect((await overview(target)).pending).toMatchObject({ id: sub });
});

test('the timeline cannot be rewritten and every history table is append only', async () => {
  const sub = await hold('example-organiser', await freshWorkspace());
  for (const [table, column, where] of [
    ['billing_entitlement_key', 'label', "key='workspace_members'"],
    ['billing_plan_version', 'title', "plan_key='example-starter'"],
    ['billing_plan_entitlement', 'mode', "entitlement_key='workspace_members'"],
    ['billing_plan_view', 'digest', 'true'],
    ['billing_subscription', 'plan_digest', `id='${sub}'`],
    ['billing_subscription_event', 'seq', `subscription_id='${sub}'`],
    ['billing_command', 'operation', 'true'],
    ['billing_staff_command', 'operation', 'true'],
  ]) {
    await expect(
      f.owner.query(`DELETE FROM customer_private.${table} WHERE ${where}`),
      table,
    ).rejects.toThrow(/append|immutable|rewrite|cannot/i);
    await expect(
      f.owner.query(`UPDATE customer_private.${table} SET ${column}=${column} WHERE ${where}`),
      table,
    ).rejects.toThrow(/append|immutable|rewrite|cannot/i);
  }
});

test('events carry ids and versions only, one chain per change, and reveal no text, amount or note', async () => {
  const target = await freshWorkspace();
  const start = await counts();
  const sub = (await request('example-organiser', target)).id as string;
  await activate(sub, day(), 'Synthetic note: the secret customer words');
  await staffAct('note', sub, { internalNote: 'Synthetic internal note: the secret staff words' });
  await act('cancel', sub, target);
  await act('keep', sub, target);
  await staffAct('renew', sub, { customerNote: null });
  await staffAct('end', sub, { customerNote: 'Synthetic reason: the secret ending words' });
  const end = await counts();
  // requested, activated, internal_note, cancel_requested, cancel_withdrawn, renewed, ended.
  expect(end.timeline).toBe(start.timeline + 7);
  expect(end.events).toBe(start.events + 7);
  expect(end.audits).toBe(start.audits + 7);
  expect(end.outbox).toBe(start.outbox + 7);
  const events = (
    await f.owner.query(
      "SELECT type,aggregate_version,payload::text p FROM app.domain_event WHERE aggregate_type='customer_billing_subscription' AND aggregate_id=$1 ORDER BY aggregate_version",
      [sub],
    )
  ).rows;
  expect(events.map((e) => e.type.replace('customer.billing.subscription.', ''))).toEqual([
    'requested',
    'activated',
    'internal_note',
    'cancel_requested',
    'cancel_withdrawn',
    'renewed',
    'ended',
  ]);
  expect(events.map((e) => e.aggregate_version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  for (const e of events) {
    expect(e.p).not.toMatch(/secret|words|4900|USD|price|note/i);
    expect(JSON.parse(e.p)).toMatchObject({
      subscriptionId: sub,
      planKey: 'example-organiser',
      planVersion: 1,
      synthetic: true,
    });
  }
  // The plan revision event names the key and version only.
  await revise({ planKey: 'example-events-plan' });
  const planEvent = (
    await f.owner.query(
      "SELECT payload::text p FROM app.domain_event WHERE type='customer.billing_plan.revised' AND aggregate_id='example-events-plan'",
    )
  ).rows[0].p;
  expect(JSON.parse(planEvent)).toMatchObject({
    planKey: 'example-events-plan',
    version: 1,
    active: true,
  });
  expect(planEvent).not.toMatch(/99000|USD|Yearly/i);
});

test('revoked, left and disabled members lose access at once, and the original owner keeps it', async () => {
  expect((await plans(workspaceId, 'carol')).canRequest).toBe(false);
  await roles('frank').command({ action: 'leave', commandId: randomUUID(), workspaceId });
  await expect(plans(workspaceId, 'frank')).rejects.toThrow(/unavailable/i);
  await expect(overview(workspaceId, 'frank')).rejects.toThrow(/unavailable/i);
  await workspaces('alice').access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: members.carol,
  });
  await expect(plans(workspaceId, 'carol')).rejects.toThrow(/unavailable/i);
  await expect(overview(workspaceId, 'carol')).rejects.toThrow(/unavailable/i);
  await f.owner.query(
    "UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject='synthetic-billing-bob'",
  );
  await expect(plans(workspaceId, 'bob')).rejects.toThrow(/denied/i);
  await expect(request('example-starter', workspaceId, 'bob')).rejects.toThrow(/denied/i);
  expect((await overview(workspaceId)).canAct).toBe(true);
  // Outsiders never see another workspace, with their own or a forged workspace id.
  await expect(overview(workspaceId, 'dave')).rejects.toThrow(/unavailable/i);
  await expect(overview(otherWorkspace, 'alice')).rejects.toThrow(/unavailable/i);
  expect((await overview(otherWorkspace, 'dave')).subscriptions).toEqual([]);
});

test('the flag, synthetic and production gates stay binding and the installer is repeatable', async () => {
  const on = { DATA_ENVIRONMENT: 'synthetic', CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true' };
  expect(customerBillingEnabled(on)).toBe(false);
  expect(customerBillingEnabled({ ...on, CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true' })).toBe(true);
  expect(customerBillingEnabled({ ...on, CORRIDRA_CUSTOMER_BILLING_ENABLED: 'yes' })).toBe(false);
  expect(
    customerBillingEnabled({
      ...on,
      CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true',
      DATA_ENVIRONMENT: 'real',
    }),
  ).toBe(false);
  expect(
    customerBillingEnabled({
      ...on,
      CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  expect(customerBillingEnabled({ CORRIDRA_CUSTOMER_BILLING_ENABLED: 'true' })).toBe(false);
  for (const override of [{ enabled: false }, { synthetic: false }, { production: true }])
    await expect(
      new CustomerBillingService(f.runtime, f.auth, { ...options, ...override }, async () =>
        session('alice'),
      ).plans({ workspaceId }),
    ).rejects.toThrow(/unavailable/i);
  const expired = new CustomerBillingService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  await expect(expired.plans({ workspaceId })).rejects.toThrow(/sign in/i);
  const first = (await f.owner.query('SELECT * FROM customer_billing_migrations.applied')).rows;
  await migrateCustomerBilling(f.owner);
  expect((await f.owner.query('SELECT * FROM customer_billing_migrations.applied')).rows).toEqual(
    first,
  );
  expect(first).toHaveLength(1);
  await f.owner.query('UPDATE customer_billing_migrations.applied SET sha256=$1', [
    randomBytes(32).toString('hex'),
  ]);
  await expect(migrateCustomerBilling(f.owner)).rejects.toThrow(/history mismatch/i);
  await f.owner.query('UPDATE customer_billing_migrations.applied SET sha256=$1', [
    first[0].sha256,
  ]);
});

test('a staff call made without the staff session rows is refused by the database', async () => {
  const hostile = await rawContext(
    f.runtime,
    f.users.viewer.ctx,
    'SELECT app.billing_plan_staff_list() r',
    [],
  ).catch((e) => e);
  expect(String(hostile)).toMatch(/owner or admin|denied|fresh authenticator/i);
  const good = await rawContext(
    f.runtime,
    staffCtx(),
    'SELECT app.billing_plan_staff_list() r',
    [],
  );
  expect(good.rows[0].r.plans.length).toBeGreaterThanOrEqual(3);
  expect(good.rows[0].r.entitlementKeys).toHaveLength(5);
});
