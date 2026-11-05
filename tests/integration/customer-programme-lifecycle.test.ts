import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';

// CRUD gap G7: rename, archive and restore a programme as an append-only overlay. The base rows are never rewritten.
const issuer =
  'https://ep-programme-lifecycle-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>;
let workspaceId: string;
let otherWorkspace: string;
let programmeId: string;
let baseDigest: string;
const digest = async () =>
  (
    await f.owner.query(
      "SELECT md5(coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id)::text FROM app.delivery_programme d),'')||coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.programme_id)::text FROM customer_private.programme_creation c),'')) AS d",
    )
  ).rows[0].d as string;
const originalName = 'Synthetic Dhaka buyers programme';
const originalPurpose = 'Synthetic planning of a buyer visit for the lifecycle tests';
const session = (person = 'alice') => ({
  subject: 'synthetic-lifecycle-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const participants = (person = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
class Probe extends CustomerSessionBoundary {
  run<T>(fn: (db: import('pg').PoolClient) => Promise<T>) {
    return this.transaction(async (db) => fn(db));
  }
}
const probe = (person = 'alice') =>
  new Probe(f.runtime, f.auth, options, async () => session(person));
const change = (
  operation: 'rename' | 'archive' | 'restore',
  expectedVersion: number,
  extra: Record<string, unknown> = {},
  programme = programmeId,
  target = workspaceId,
) => ({
  operation,
  commandId: randomUUID(),
  workspaceId: target,
  programmeId: programme,
  expectedVersion,
  ...extra,
});
const rename = (expected: number, name: string, purpose = originalPurpose) =>
  change('rename', expected, { name, reportingPurpose: purpose });
const create = (name: string, target = workspaceId, person = 'alice') =>
  programmes(person).create({
    commandId: randomUUID(),
    workspaceId: target,
    name,
    reportingPurpose: 'Synthetic programme created to fill the workspace cap',
    acknowledged: true,
  });
async function listed(target = workspaceId, person = 'alice') {
  const all: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  do {
    const page = await programmes(person).list({ workspaceId: target, after, pageSize: 25 });
    all.push(...page.programmes);
    after = page.nextAfter ?? undefined;
  } while (after);
  return all;
}
const one = async (id = programmeId) => (await listed()).find((p) => p.id === id)!;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  for (const person of ['alice', 'bob', 'member', 'admin'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional lifecycle authority fixture,no real customer account',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic lifecycle workspace' })
  ).id;
  otherWorkspace = (
    await workspaces('bob').provision({
      commandId: randomUUID(),
      name: 'Synthetic other workspace',
    })
  ).id;
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic existing colleague',
  });
  await workspaces('member').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: originalName,
      reportingPurpose: originalPurpose,
      acknowledged: true,
    })
  ).id;
  baseDigest = await digest();
  await migrateCustomerProgrammeLifecycle(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('installs once, repeats safely, refuses a changed history, and refuses to run without real-use', async () => {
  await migrateCustomerProgrammeLifecycle(f.owner);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_programme_lifecycle_migrations.applied',
      )
    ).rows[0].n,
  ).toBe(1);
  await f.owner.query("UPDATE customer_programme_lifecycle_migrations.applied SET sha256='0'");
  await expect(migrateCustomerProgrammeLifecycle(f.owner)).rejects.toThrow('history mismatch');
});

test('installing the module leaves every existing programme row exactly as it was', async () => {
  expect(await digest()).toBe(baseDigest);
});

test('before any change every reader shows the original name and purpose, with version 0 and not archived', async () => {
  expect(await one()).toMatchObject({
    name: originalName,
    reportingPurpose: originalPurpose,
    archived: false,
    version: 0,
  });
});

test('every reader of the name reads the current view, none reads the base table', async () => {
  const defs = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ 'programme_current'",
    )
  ).rows;
  const sigs = defs.map((d) => d.sig).sort();
  expect(sigs).toEqual(
    [
      'app.delivery_report_v1(text,text)',
      'customer.my_programme_reminders(date)',
      'customer.own_programme_place(uuid)',
      'customer.own_programme_registrations(uuid,integer)',
      'customer.programme_export(uuid,uuid,text,uuid)',
      'customer.programme_lifecycle(uuid,uuid,uuid,text,integer,jsonb)',
      'customer.programme_participant_preview(text)',
      'customer.programme_series_revenue(uuid,uuid)',
      'customer.programme_template_capture(uuid,uuid)',
      'customer.programmes(uuid,uuid,integer)',
      'customer_private.programme_active_count(uuid)',
      'customer_private.series_json(uuid)',
      'customer_private.service_request_context(uuid,uuid,text,text)',
    ].sort(),
  );
  const unreplaced = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' AND p.proname<>'create_programme' AND pg_get_functiondef(p.oid) ~ '(FROM|JOIN) app\\.delivery_programme([^_a-z]|$)'",
    )
  ).rows.map((r) => r.sig);
  expect(unreplaced).toEqual([]);
});

test('rename shows the new name everywhere and leaves the base row exactly as created', async () => {
  const renamed = await programmes().change(
    rename(
      0,
      'Synthetic Dhaka buyers programme 2027',
      'Synthetic planning of a larger buyer visit',
    ),
  );
  expect(renamed).toMatchObject({
    operation: 'rename',
    version: 1,
    archived: false,
    name: 'Synthetic Dhaka buyers programme 2027',
  });
  expect(await one()).toMatchObject({
    name: 'Synthetic Dhaka buyers programme 2027',
    reportingPurpose: 'Synthetic planning of a larger buyer visit',
    version: 1,
  });
  const base = (
    await f.owner.query('SELECT name,reporting_purpose FROM app.delivery_programme WHERE id=$1', [
      programmeId,
    ])
  ).rows[0];
  expect(base).toEqual({ name: originalName, reporting_purpose: originalPurpose });
  const shown = await probe().run(async (db) => ({
    capture: (
      await db.query('SELECT customer.programme_template_capture($1,$2) r', [
        workspaceId,
        programmeId,
      ])
    ).rows[0].r,
  }));
  expect(JSON.stringify(shown.capture)).toContain('Synthetic planning of a larger buyer visit');
  expect(JSON.stringify(shown.capture)).not.toContain(originalPurpose);
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    label: 'Synthetic participant invitation',
    acknowledged: true,
  });
  const preview = await participants('bob').preview({ token: invitation.token });
  expect(preview.name).toBe('Synthetic Dhaka buyers programme 2027');
});

test('a stale version is refused with the newer state, and nothing is written', async () => {
  await expect(
    programmes().change(rename(0, 'Synthetic stale rename of the programme')),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(programmes().change(change('archive', 0))).rejects.toMatchObject({ code: '23514' });
  expect((await one()).version).toBe(1);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_lifecycle_revision WHERE programme_id=$1',
        [programmeId],
      )
    ).rows[0].n,
  ).toBe(1);
});

test('a retry with the same command id returns the first answer once; a different payload under it conflicts', async () => {
  const input = rename(
    1,
    'Synthetic Dhaka buyers programme 2028',
    'Synthetic planning of the next buyer visit',
  );
  const [a, b] = await Promise.all([programmes().change(input), programmes().change(input)]);
  expect(a.version).toBe(2);
  expect(b.version).toBe(2);
  expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  await expect(
    programmes().change({ ...input, name: 'Synthetic a different name under the same command' }),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_lifecycle_revision WHERE programme_id=$1',
        [programmeId],
      )
    ).rows[0].n,
  ).toBe(2);
});

test('rename needs a real change and valid text', async () => {
  await expect(
    programmes().change(
      rename(
        2,
        'Synthetic Dhaka buyers programme 2028',
        'Synthetic planning of the next buyer visit',
      ),
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(programmes().change(rename(2, 'ab'))).rejects.toThrow();
  await expect(
    probe().run((db) =>
      db.query('SELECT customer.programme_lifecycle($1,$2,$3,$4,$5,$6::jsonb)', [
        randomUUID(),
        workspaceId,
        programmeId,
        'rename',
        2,
        JSON.stringify({
          name: '  padded name for the programme  ',
          reportingPurpose: originalPurpose,
        }),
      ]),
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(programmes().change(change('rename', 2))).rejects.toThrow();
  await expect(
    programmes().change({ ...change('archive', 2), name: 'extra field not allowed' }),
  ).rejects.toThrow();
});

test('archive hides it from the active count, keeps it readable, and blocks rename until restored', async () => {
  const archived = await programmes().change(change('archive', 2));
  expect(archived).toMatchObject({ operation: 'archive', archived: true, version: 3 });
  expect(await one()).toMatchObject({
    archived: true,
    version: 3,
    name: 'Synthetic Dhaka buyers programme 2028',
  });
  await expect(programmes().change(change('archive', 3))).rejects.toMatchObject({ code: '23514' });
  await expect(
    programmes().change(rename(3, 'Synthetic renamed while archived')),
  ).rejects.toMatchObject({ code: '23514' });
  const restored = await programmes().change(change('restore', 3));
  expect(restored).toMatchObject({ operation: 'restore', archived: false, version: 4 });
  await expect(programmes().change(change('restore', 4))).rejects.toMatchObject({ code: '23514' });
});

test('only an owner or admin may change a programme; members, outsiders and other workspaces are refused', async () => {
  for (const person of ['member', 'bob'])
    await expect(programmes(person).change(change('archive', 4))).rejects.toThrow();
  await expect(
    programmes('bob').change(change('archive', 0, {}, programmeId, otherWorkspace)),
  ).rejects.toThrow();
  const adminDone = await programmes('admin').change(
    rename(
      4,
      'Synthetic renamed by an administrator',
      'Synthetic planning managed by an administrator',
    ),
  );
  expect(adminDone.version).toBe(5);
  expect((await one()).name).toBe('Synthetic renamed by an administrator');
});

test('the audit event keeps the old and new values and nothing about participants', async () => {
  const events = (
    await f.owner.query(
      "SELECT e.type,e.payload FROM app.domain_event e WHERE e.tenant_id=$1 AND e.aggregate_type='customer_programme_lifecycle' AND e.aggregate_id=$2 ORDER BY e.aggregate_version",
      [workspaceId, programmeId],
    )
  ).rows;
  expect(events.map((e) => e.type)).toEqual([
    'customer.programme.rename',
    'customer.programme.rename',
    'customer.programme.archive',
    'customer.programme.restore',
    'customer.programme.rename',
  ]);
  expect(events[0].payload.before).toEqual({
    name: originalName,
    reportingPurpose: originalPurpose,
    archived: false,
  });
  expect(events[0].payload.after).toMatchObject({
    name: 'Synthetic Dhaka buyers programme 2027',
    archived: false,
  });
  expect(events[2].payload.after.archived).toBe(true);
  for (const e of events)
    expect(JSON.stringify(e.payload)).not.toMatch(/participant|token|label|email/i);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.audit_event WHERE tenant_id=$1 AND action LIKE 'customer.programme.%'",
        [workspaceId],
      )
    ).rows[0].n,
  ).toBeGreaterThanOrEqual(5);
});

test('revisions and commands cannot be rewritten or deleted, even by the owner role', async () => {
  await expect(
    f.owner.query('UPDATE customer_private.programme_lifecycle_revision SET name=name'),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_lifecycle_revision'),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_lifecycle_command'),
  ).rejects.toThrow();
  await expect(
    f.runtime.query('SELECT * FROM customer_private.programme_current'),
  ).rejects.toMatchObject({ code: '42501' });
});

test('the cap counts only active programmes and restore is refused, never forced, at 100 active', async () => {
  const before = (await listed()).length;
  for (let i = before; i < 100; i++) await create(`Synthetic cap programme ${i}`);
  expect((await listed()).length).toBe(100);
  await expect(create('Synthetic programme number 101')).rejects.toMatchObject({ code: '23514' });
  const first = (await one(programmeId)) as { version: number };
  await programmes().change(change('archive', first.version));
  const added = await create('Synthetic programme after archiving one');
  expect(added.id).toBeTruthy();
  expect((await listed()).length).toBe(101);
  await expect(programmes().change(change('restore', first.version + 1))).rejects.toThrow(
    '100 active',
  );
  const other = (await listed()).find(
    (p) => p.id !== programmeId && p.id !== added.id && p.archived === false,
  )!;
  await programmes().change(change('archive', other.version as number, {}, other.id as string));
  const restored = await programmes().change(change('restore', first.version + 1));
  expect(restored.archived).toBe(false);
});
