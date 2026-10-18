import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { accessFixture, future } from './access-fixture';
import { sessionHash } from '../../packages/db/src/index';
import { rawContext } from './support';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import {
  CustomerAssignedMissionService,
  customerDeliveryEnabled,
} from '../../packages/auth/src/customer-assigned-missions';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
const issuer =
    'https://ep-account-delivery-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
  options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof accessFixture>>,
  delivery: DeliveryService,
  staff: CustomerDeliveryService;
let workspaceId: string,
  ownedRequest: string,
  missionId: string,
  publicationId: string,
  link: { id: string; token: string },
  assignmentId: string,
  savedId: string,
  preserved = false;
const principals: Record<string, string> = {};
const session = (person = 'alice') => ({
  subject: 'synthetic-assigned-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const assigned = (person = 'alice') =>
  new CustomerAssignedMissionService(f.runtime, f.auth, options, async () => session(person));
const saved = (person = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(person));
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Fictional towels ' + randomUUID(),
  website: 'https://example.invalid/private-catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic private input;not approved commercial evidence',
  name: 'Fictional Test Person',
  company: 'Fictional Customer',
  email: 'private-customer@example.invalid',
  acknowledged: true,
});
const input = () => ({
  commandId: randomUUID(),
  requestId: ownedRequest,
  linkId: link.id,
  reason: 'Explicit synthetic account report delivery review',
  approved: true,
});
async function publication(mid = missionId, ctx = f.users.owner.ctx) {
  return delivery.publication(ctx, {
    commandId: randomUUID(),
    missionId: mid,
    title: 'Approved fictional commercial mission',
    company: 'Fictional Customer',
    objective: 'Review permitted supplier/buyer progress',
    brief: 'Approved report without original private contact details',
    nextAction: 'Review qualified evidence with the operator',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
}
async function share(pid = publicationId, ctx = f.users.owner.ctx, expiresAt = future()) {
  return delivery.share(ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [pid],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Explicit private fictional customer report',
    expiresAt,
    allowExport: false,
    approved: true,
  });
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
    )
  ).rows;
  const policies = (
    await f.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid",
    )
  ).rows;
  const data = [];
  for (const t of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    data.push(
      (
        await f.owner.query(
          "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
            q(t.nspname) +
            '.' +
            q(t.relname) +
            ' v',
        )
      ).rows[0].digest,
    );
  }
  return {
    functions,
    policies,
    tables,
    data,
    core: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    base: (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
    commercial: (
      await f.owner.query('SELECT * FROM customer_commercial_migrations.applied ORDER BY name')
    ).rows,
  };
}

beforeAll(async () => {
  f = await accessFixture();
  await migrateCustomerSavedMissions(f.owner);
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-account-delivery');
  staff = new CustomerDeliveryService(f.runtime);
  for (const person of ['alice', 'bob']) {
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Fictional account delivery fixture;not managed-provider acceptance',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[person],
      reason: 'Explicit fictional private request admission',
    });
  }
  workspaceId = (
    await workspace().provision({
      commandId: randomUUID(),
      name: 'Synthetic request creator workspace',
    })
  ).id;
  const invite = await workspace().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic colleague without inherited mission scope',
  });
  await workspace('bob').access({ action: 'accept', commandId: randomUUID(), token: invite.token });
  const result = await new CustomerRequestService(f.runtime, f.auth, options, async () =>
    session(),
  ).submit({ commandId: randomUUID(), workspaceId, brief: brief() }, (ctx, b) =>
    f.mission.prepareCustomerIntake(ctx, b),
  );
  ownedRequest = result.id;
  missionId = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      ownedRequest,
    ])
  ).rows[0].mission_id;
  publicationId = (await publication()).id;
  link = await share();
  const before = await snapshot();
  await migrateCustomerDelivery(f.owner);
  const after = await snapshot();
  expect(after.functions.filter((v) => before.functions.some((b) => b.oid === v.oid))).toEqual(
    before.functions,
  );
  expect(after.tables.filter((v) => before.tables.some((b) => b.oid === v.oid))).toEqual(
    before.tables,
  );
  expect(after.policies.filter((v) => v.tablename !== 'customer_delivery_assignment')).toEqual(
    before.policies,
  );
  for (const [i, t] of before.tables.entries())
    expect(after.data[after.tables.findIndex((v) => v.oid === t.oid)]).toBe(before.data[i]);
  expect(after.core).toEqual(before.core);
  expect(after.base).toEqual(before.base);
  expect(after.commercial).toEqual(before.commercial);
  const installed = await snapshot();
  await migrateCustomerDelivery(f.owner);
  expect(await snapshot()).toEqual(installed);
  preserved = true;
});
afterAll(async () => {
  await f?.close();
});
test('populated optional upgrade preserves existing functions,ACLs,RLS,rows and receipts', () => {
  expect(preserved).toBe(true);
});
test('request alone does not grant a commercial report;staff options expose no customer identity or capability', async () => {
  expect((await assigned().list()).assignments).toEqual([]);
  const view = await staff.options(f.users.owner.ctx, missionId);
  expect(view.request.id).toBe(ownedRequest);
  expect(view.links[0].id).toBe(link.id);
  const json = JSON.stringify(view);
  for (const value of [
    session().subject,
    issuer,
    principals.alice,
    link.token,
    'private-customer@example.invalid',
    'token_hash',
  ])
    expect(json).not.toContain(value);
});
test('owner explicitly assigns their own reviewed canonical report;exact retry creates one atomic event', async () => {
  const value = input();
  assignmentId = (await staff.assign(f.users.owner.ctx, value)).id;
  expect(await staff.assign(f.users.owner.ctx, value)).toEqual({ id: assignmentId });
  const events = (
    await f.owner.query(
      "SELECT id,actor_id FROM app.domain_event WHERE aggregate_type='customer_delivery_assignment' AND aggregate_id=$1",
      [assignmentId],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.users.owner.id);
  for (const [table, column] of [
    ['app.audit_event', 'domain_event_id'],
    ['app.outbox', 'event_id'],
  ])
    expect(
      (await f.owner.query('SELECT id FROM ' + table + ' WHERE ' + column + '=$1', [events[0].id]))
        .rowCount,
    ).toBe(1);
  await expect(
    staff.assign(f.users.owner.ctx, { ...value, reason: 'Different assignment review' }),
  ).rejects.toMatchObject({ status: 409 });
  const page = await assigned().list();
  expect(page.assignments).toHaveLength(1);
  expect(page.assignments[0]).toMatchObject({
    id: assignmentId,
    requestId: ownedRequest,
    available: true,
    title: 'Approved fictional commercial mission',
    savedResourceId: null,
  });
  for (const value of [
    link.token,
    session().subject,
    issuer,
    principals.alice,
    'private-customer@example.invalid',
    'token_hash',
  ])
    expect(JSON.stringify(page)).not.toContain(value);
});
test('colleagues and other customers do not inherit account delivery;unknown requests cannot be bound', async () => {
  expect((await assigned('bob').list()).assignments).toEqual([]);
  await expect(
    assigned('bob').accept({ commandId: randomUUID(), assignmentId, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
  for (const role of ['operator', 'reviewer', 'viewer', 'other', 'outsider']) {
    await expect(staff.assign(f.users[role].ctx, input())).rejects.toThrow();
    await expect(staff.options(f.users[role].ctx, missionId)).rejects.toThrow();
  }
  await expect(
    staff.assign(f.users.owner.ctx, { ...input(), requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      'INSERT INTO app.customer_delivery_assignment(id,tenant_id,request_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [
        randomUUID(),
        f.tenantA,
        ownedRequest,
        link.id,
        'Unapproved operator direct insert',
        f.users.operator.id,
      ],
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
test('acknowledged account delivery saves through the unchanged invitation engine and opens original private report', async () => {
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId, acknowledged: false }),
  ).rejects.toThrow();
  const command = { commandId: randomUUID(), assignmentId, acknowledged: true };
  const a = await assigned().accept(command);
  expect(await assigned().accept(command)).toEqual(a);
  savedId = a.id;
  expect(a.available).toBe(true);
  const original = await saved().command({
    action: 'view',
    resourceId: savedId,
    audience: 'CLIENT_PROGRESS',
  });
  expect(original.report.missions[0].publicationId).toBe(publicationId);
  expect(JSON.stringify(original)).not.toContain('private-customer@example.invalid');
  expect((await assigned().list()).assignments[0].savedResourceId).toBe(savedId);
  expect((await saved().list()).missions.map((m: { id: string }) => m.id)).toContain(savedId);
  const request = await delivery.request(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    ownerId: f.users.operator.id,
    title: 'Synthetic supporting evidence request',
    instructions: 'Submit only a fictional declaration,not verified evidence',
    dueAt: future(),
  });
  await saved().command({
    action: 'respond',
    resourceId: savedId,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: request.id,
    body: 'Fictional customer response remains self-declared',
    acknowledged: true,
  });
  expect(
    JSON.stringify(
      await saved().command({ action: 'view', resourceId: savedId, audience: 'CLIENT_PROGRESS' }),
    ),
  ).toContain('Fictional customer response remains self-declared');
});
test('a genuine other-mission report cannot be delivered to the original requester', async () => {
  const other = await f.target();
  const p = await publication(other.missionId),
    foreign = await share(p.id);
  const v = { ...input(), linkId: foreign.id };
  await expect(staff.assign(f.users.owner.ctx, v)).rejects.toMatchObject({ code: '42501' });
  expect(
    (await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [v.commandId]))
      .rowCount,
  ).toBe(0);
});
test('assignments are immutable and customer/runtime SQL cannot access private resolution or receipts', async () => {
  await expect(
    f.owner.query('UPDATE app.customer_delivery_assignment SET reason=$2 WHERE id=$1', [
      assignmentId,
      'Attempted rewrite',
    ]),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM app.customer_delivery_assignment WHERE id=$1', [assignmentId]),
  ).rejects.toThrow();
  for (const sql of [
    'SELECT * FROM customer_delivery_migrations.applied',
    'SELECT customer_private.assignment_summary($1,$2)',
  ])
    await expect(
      f.runtime.query(sql, sql.includes('$1') ? [assignmentId, principals.alice] : undefined),
    ).rejects.toMatchObject({ code: '42501' });
  await expect(f.runtime.query('SELECT customer.assigned_missions()')).rejects.toMatchObject({
    code: '42501',
  });
});
test('independent flag requires existing request,saved,workspace,delivery,synthetic and nonproduction gates', () => {
  const env = {
    CORRIDRA_CUSTOMER_DELIVERY_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
  };
  expect(customerDeliveryEnabled(env)).toBe(true);
  for (const key of Object.keys(env))
    expect(
      customerDeliveryEnabled({ ...env, [key]: key === 'VERCEL_ENV' ? 'production' : 'false' }),
    ).toBe(false);
});

test('a real administrator can deliver their own report but cannot inherit another publisher link', async () => {
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [f.tenantA, f.users.other.id],
  );
  const ctx = { ...f.users.other.ctx, tenantId: f.tenantA };
  await expect(staff.assign(ctx, input())).rejects.toMatchObject({ code: '42501' });
  const p = await publication(missionId, ctx),
    l = await share(p.id, ctx),
    value = { ...input(), linkId: l.id };
  const a = await staff.assign(ctx, value);
  expect(
    (
      await f.owner.query('SELECT created_by FROM app.customer_delivery_assignment WHERE id=$1', [
        a.id,
      ])
    ).rows[0].created_by,
  ).toBe(f.users.other.id);
});
test('workspace owner does not inherit a colleague original request or delivered commercial report', async () => {
  const result = await new CustomerRequestService(f.runtime, f.auth, options, async () =>
    session('bob'),
  ).submit({ commandId: randomUUID(), workspaceId, brief: brief() }, (ctx, b) =>
    f.mission.prepareCustomerIntake(ctx, b),
  );
  const mid = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      result.id,
    ])
  ).rows[0].mission_id;
  const p = await publication(mid),
    l = await share(p.id),
    a = await staff.assign(f.users.owner.ctx, { ...input(), requestId: result.id, linkId: l.id });
  expect((await assigned('bob').list()).assignments.map((v: { id: string }) => v.id)).toContain(
    a.id,
  );
  expect((await assigned().list()).assignments.map((v: { id: string }) => v.id)).not.toContain(
    a.id,
  );
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId: a.id, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
});
test('concurrent exact staff retries create one assignment and preserve the original publisher event', async () => {
  const l = await share(),
    value = { ...input(), linkId: l.id };
  const [a, b] = await Promise.all([
    staff.assign(f.users.owner.ctx, value),
    staff.assign(f.users.owner.ctx, value),
  ]);
  expect(a).toEqual(b);
  expect(
    (await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [a.id])).rowCount,
  ).toBe(1);
});
for (const wait of ['link', 'event'])
  test(
    'MFA expiry after ' + wait + ' lock denies delivery and rolls back all records',
    async () => {
      const l = await share(),
        value = { ...input(), linkId: l.id };
      const old = (
        await f.owner.query(
          'SELECT verified_at::text FROM identity.assurance WHERE session_id=$1',
          [f.users.owner.sessionId],
        )
      ).rows[0].verified_at;
      const lock = await f.owner.connect();
      try {
        await f.owner.query(
          "UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '298 seconds' WHERE session_id=$1",
          [f.users.owner.sessionId],
        );
        await lock.query('BEGIN');
        if (wait === 'event') await lock.query('LOCK TABLE app.domain_event IN SHARE MODE');
        else
          await lock.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('customer.delivery.link:'||$1::text||':'||$2::text,0))",
            [f.tenantA, l.id],
          );
        const denial = expect(staff.assign(f.users.owner.ctx, value)).rejects.toMatchObject({
          code: '42501',
        });
        await lock.query('SELECT pg_sleep(2.3)');
        await lock.query('COMMIT');
        await denial;
        expect(
          (
            await f.owner.query('SELECT id FROM app.customer_delivery_assignment WHERE id=$1', [
              value.commandId,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
              value.commandId,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await f.owner.query('UPDATE identity.assurance SET verified_at=$2 WHERE session_id=$1', [
          f.users.owner.sessionId,
          old,
        ]);
      }
    },
  );
test('expired customer proof during original save lock wait creates no bookmark command', async () => {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '0.4 seconds')",
    [hash, issuer, session().subject],
  );
  const lock = await f.owner.connect(),
    db = await f.runtime.connect();
  const before = (
    await f.owner.query('SELECT count(*)::int n FROM customer_private.saved_mission_command')
  ).rows[0].n;
  try {
    await lock.query('BEGIN');
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('customer.saved_mission:'||$1::text,0))",
      [principals.alice],
    );
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const denial = expect(
      db.query('SELECT customer.accept_assigned_mission($1,$2,true)', [randomUUID(), assignmentId]),
    ).rejects.toMatchObject({ code: '42501' });
    await lock.query('SELECT pg_sleep(0.7)');
    await lock.query('COMMIT');
    await denial;
  } finally {
    await lock.query('ROLLBACK');
    await db.query('ROLLBACK');
    lock.release();
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.saved_mission_command'))
      .rows[0].n,
  ).toBe(before);
});
test('actual report expiry removes title and prevents acknowledgement without deleting the assignment', async () => {
  const l = await share(
      publicationId,
      f.users.owner.ctx,
      new Date(Date.now() + 4000).toISOString(),
    ),
    a = await staff.assign(f.users.owner.ctx, { ...input(), linkId: l.id });
  expect(
    (await assigned().list()).assignments.find((v: { id: string }) => v.id === a.id).available,
  ).toBe(true);
  await f.owner.query('SELECT pg_sleep(4.2)');
  const entry = (await assigned().list()).assignments.find((v: { id: string }) => v.id === a.id);
  expect(entry.available).toBe(false);
  expect(entry).not.toHaveProperty('title');
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId: a.id, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (await f.owner.query('SELECT id FROM app.customer_delivery_assignment WHERE id=$1', [a.id]))
      .rowCount,
  ).toBe(1);
});
test('original link revocation closes both account delivery and existing saved report with no stale title', async () => {
  const original = (
    await f.owner.query('SELECT * FROM app.customer_delivery_assignment WHERE id=$1', [
      assignmentId,
    ])
  ).rows;
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    publicationId: null,
    reason: 'Synthetic original approved-report revocation',
  });
  const entry = (await assigned().list()).assignments.find(
    (v: { id: string }) => v.id === assignmentId,
  );
  expect(entry.available).toBe(false);
  expect(entry).not.toHaveProperty('title');
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    saved().command({ action: 'view', resourceId: savedId, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await f.owner.query('SELECT * FROM app.customer_delivery_assignment WHERE id=$1', [
        assignmentId,
      ])
    ).rows,
  ).toEqual(original);
});

test('assignment metadata and canonical audit events are hidden from operator/reviewer/viewer SQL contexts', async () => {
  for (const role of ['operator', 'reviewer', 'viewer'])
    for (const table of ['app.customer_delivery_assignment', 'app.domain_event'])
      expect(
        (await rawContext(f.runtime, f.users[role].ctx, 'SELECT id FROM ' + table)).rows,
      ).toEqual([]);
});
test('creator paging retains only owned assignments and reads leave all business rows unchanged', async () => {
  const before = await snapshot(),
    ids: string[] = [];
  let after: string | undefined;
  do {
    const page = await assigned().list({ pageSize: 1, ...(after ? { after } : {}) });
    expect(page.assignments.length).toBeLessThanOrEqual(1);
    ids.push(...page.assignments.map((v: { id: string }) => v.id));
    after = page.nextAfter ?? undefined;
  } while (after);
  expect(ids.length).toBeGreaterThan(1);
  expect(new Set(ids).size).toBe(ids.length);
  expect(await snapshot()).toEqual(before);
});

test('provider failure is unavailable and anonymous/unverified customers cannot discover account deliveries', async () => {
  for (const identity of [null, { ...session(), emailVerified: false }])
    await expect(
      new CustomerAssignedMissionService(f.runtime, f.auth, options, async () => identity).list(),
    ).rejects.toThrow();
  await expect(
    new CustomerAssignedMissionService(f.runtime, f.auth, options, async () => {
      throw Error('Synthetic provider outage');
    }).list(),
  ).rejects.toMatchObject({ status: 503 });
});
test('private request revocation closes new discovery/acceptance without merging independently approved report rights', async () => {
  const l = await share(),
    a = await staff.assign(f.users.owner.ctx, { ...input(), linkId: l.id });
  const accepted = await assigned().accept({
    commandId: randomUUID(),
    assignmentId: a.id,
    acknowledged: true,
  });
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: ownedRequest,
    reason:
      'Synthetic original private request revocation;client report grant remains independently controlled',
  });
  const entry = (await assigned().list()).assignments.find((v: { id: string }) => v.id === a.id);
  expect(entry.available).toBe(false);
  expect(entry).not.toHaveProperty('title');
  await expect(
    assigned().accept({ commandId: randomUUID(), assignmentId: a.id, acknowledged: true }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await saved().command({
        action: 'view',
        resourceId: accepted.id,
        audience: 'CLIENT_PROGRESS',
      })
    ).report.missions[0].publicationId,
  ).toBe(publicationId);
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: l.id,
    publicationId: null,
    reason: 'Synthetic withdrawal of independent approved client report grant',
  });
  await expect(
    saved().command({ action: 'view', resourceId: accepted.id, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
});
