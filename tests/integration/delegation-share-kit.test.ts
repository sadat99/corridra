import { beforeAll, afterAll, test, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import {
  CustomerProgrammePublicationService,
  ProgrammePageReader,
  programmePublicationRefusal,
} from '../../packages/auth/src/customer-programme-publication';

// ADR-084 slice S1: the optional structured days of a page version (publication migration 0003), against the real database
// functions with the restricted runtime role. Invented people only. The migration is additive: the first test compares every
// existing function, policy, table, constraint and row before and after it is applied.
const issuer = 'https://ep-share-kit-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const directory = new URL(
  '../../packages/db/customer-programme-publication-migrations/',
  import.meta.url,
);
const file = (name: string) => readFile(new URL(name, directory), 'utf8');
const files = [
  '0001_public_programme_page_and_applications.sql',
  '0002_staff_programme_applications.sql',
  '0003_programme_page_schedule.sql',
];
let f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, programmeId: string;
let preserved = false;
let before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>;
const session = (person = 'alice') => ({
  subject: 'synthetic-share-kit-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const pages = (person = 'alice') =>
  new CustomerProgrammePublicationService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const reader = () => new ProgrammePageReader(f.runtime);
const soon = (hours = 240) => new Date(Date.now() + hours * 3600000).toISOString();
const copy = () => ({
  title: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  summary: 'A ten company buying delegation to compare rice transplanters before the next season.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery for small and medium farms',
  audience: 'Owners and buyers of importers and dealers who plan to place an order within a year.',
  eligibility: 'A registered business that imports or sells farm machinery.',
  activities: [{ label: 'Factory visits in Foshan', status: 'PLANNED' }],
  included: ['Programme coordination'],
  excluded: ['Flights'],
});
const publish = (expectedVersion: number) => ({
  action: 'publish',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  expectedVersion,
  copy: copy(),
  closesAt: soon(),
  acknowledged: true,
});
const schedule = (
  version: number,
  startsOn = '2027-04-12',
  endsOn = '2027-04-18',
  commandId = randomUUID(),
) => ({
  action: 'schedule',
  commandId,
  workspaceId,
  programmeId,
  version,
  startsOn,
  endsOn,
});
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return programmePublicationRefusal(error) ?? (error as { code?: string }).code ?? 'error';
  }
  return 'no refusal';
};
// The shape of the ADR-080 test: every function with its definition, grants and owner, every policy, table (grants, row
// security flags), constraint and a digest of every row.
async function snapshot(db = f.owner) {
  const functions = (
    await db.query(
      "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') AND p.prokind='f' ORDER BY 1",
    )
  ).rows;
  const policies = (
    await db.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await db.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 2,3",
    )
  ).rows;
  const constraints = (
    await db.query(
      "SELECT conrelid::regclass::text t,conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('app','identity','customer','customer_private')) ORDER BY 1,2",
    )
  ).rows;
  const triggers = (
    await db.query(
      'SELECT tgrelid::regclass::text t,tgname,pg_get_triggerdef(oid) d FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1,2',
    )
  ).rows;
  const rows: Record<string, string> = {};
  for (const t of tables)
    rows[t.oid] = (
      await db.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM "${t.nspname}"."${t.relname}" v`,
      )
    ).rows[0].digest;
  return { functions, policies, tables, constraints, triggers, rows };
}
async function provision() {
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerParticipants(f.owner);
  for (const person of ['alice', 'bob', 'member', 'admin'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional share kit fixture,no real customer account',
    });
  workspaceId = (
    await workspace().provision({ commandId: randomUUID(), name: 'Synthetic organiser workspace' })
  ).id;
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic share kit acceptance',
      acknowledged: true,
    })
  ).id;
  const invite = await workspace().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic existing colleague',
  });
  await workspace('member').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invite.token,
  });
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
}

beforeAll(async () => {
  f = await fixture();
  await provision();
  // Files 0001 and 0002 as they are today, then the snapshot, then 0003 alone.
  await f.owner.query(await file(files[0]!));
  await f.owner.query(await file(files[1]!));
  before = await snapshot();
  await f.owner.query(await file(files[2]!));
  after = await snapshot();
  preserved = true;
}, 240000);
afterAll(async () => {
  await f?.close();
});

test('applying 0003 changes no existing function, policy, table, constraint, trigger or row, and adds exactly the sidecar and two functions', () => {
  expect(preserved).toBe(true);
  for (const fn of before.functions)
    expect(
      after.functions.find((p) => p.name === fn.name),
      fn.name,
    ).toEqual(fn);
  expect(after.policies).toEqual(before.policies);
  expect(after.tables.filter((t) => before.tables.some((b) => b.oid === t.oid))).toEqual(
    before.tables,
  );
  for (const c of before.constraints) expect(after.constraints).toContainEqual(c);
  for (const t of before.triggers) expect(after.triggers).toContainEqual(t);
  for (const t of before.tables) expect(after.rows[t.oid], t.relname).toBe(before.rows[t.oid]);
  // Exactly what is new.
  expect(
    after.functions
      .filter((fn) => !before.functions.some((b) => b.name === fn.name))
      .map((fn) => fn.name)
      .sort(),
  ).toEqual([
    'app.read_programme_schedule(text)',
    'customer.set_programme_schedule(uuid,uuid,uuid,integer,date,date)',
  ]);
  expect(
    after.tables
      .filter((t) => !before.tables.some((b) => b.oid === t.oid))
      .map((t) => `${t.nspname}.${t.relname}`),
  ).toEqual(['customer_private.programme_publication_schedule']);
  const sidecar = after.tables.find((t) => t.relname === 'programme_publication_schedule')!;
  expect(sidecar.relrowsecurity).toBe(true);
  // Only the owner holds any privilege on it: no runtime role, no auth role, no PUBLIC.
  expect(String(sidecar.relacl)).toMatch(/^\{postgres=[a-zA-Z]+\/postgres\}$/);
  expect(after.policies.length).toBe(before.policies.length);
});

test('the sidecar is private and immutable, and the runtime role may call only the two new functions', async () => {
  await expect(
    f.runtime.query('SELECT * FROM customer_private.programme_publication_schedule'),
  ).rejects.toMatchObject({ code: '42501' });
  const grants = async (signature: string) =>
    (
      await f.owner.query(
        `SELECT coalesce(string_agg(r.rolname,',' ORDER BY r.rolname),'') g FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=$1::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner`,
        [signature],
      )
    ).rows[0].g as string;
  for (const signature of [
    'app.read_programme_schedule(text)',
    'customer.set_programme_schedule(uuid,uuid,uuid,integer,date,date)',
  ]) {
    expect(await grants(signature)).toContain('corridra_runtime');
    expect(await grants(signature)).not.toContain('corridra_auth');
  }
  // PUBLIC has no execute either (an aclexplode grantee of 0 is PUBLIC and would show an empty role name).
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.proname IN ('set_programme_schedule','read_programme_schedule') AND a.grantee=0",
      )
    ).rows[0].n,
  ).toBe(0);
});

let address = '';
test('only a current owner or admin states the days of the latest version; an exact retry answers the same', async () => {
  address = (await pages().publication(publish(0))).address;
  // No days yet: the one answer for "nothing to show".
  expect(await reader().schedule(address)).toBeNull();
  expect(await refusal(pages('member').publication(schedule(1)))).toBe('42501');
  expect(await refusal(pages('bob').publication(schedule(1)))).toBe('42501');
  const command = randomUUID();
  const made = await pages().publication(schedule(1, '2027-04-12', '2027-04-18', command));
  expect(made).toEqual({ programmeId, version: 1, startsOn: '2027-04-12', endsOn: '2027-04-18' });
  expect(await reader().schedule(address)).toEqual({
    version: 1,
    startsOn: '2027-04-12',
    endsOn: '2027-04-18',
  });
  // The same command again, and the same days under another command, answer the same and write nothing more.
  expect(await pages().publication(schedule(1, '2027-04-12', '2027-04-18', command))).toEqual(made);
  expect(await pages('admin').publication(schedule(1))).toEqual(made);
  const count = async () =>
    (
      await f.owner.query(
        'SELECT (SELECT count(*)::int FROM customer_private.programme_publication_schedule) rows,(SELECT count(*)::int FROM app.domain_event WHERE type=$1) events',
        ['customer.programme_publication.schedule_set'],
      )
    ).rows[0];
  expect(await count()).toEqual({ rows: 1, events: 1 });
  // Other days for a version that has some are refused: a correction is a new version.
  expect(await refusal(pages().publication(schedule(1, '2027-05-01', '2027-05-02')))).toBe(
    'PROGRAMME_SCHEDULE_ALREADY_SET',
  );
  // Not the latest version.
  expect(await refusal(pages().publication(schedule(2)))).toBe('PROGRAMME_PUBLICATION_CHANGED');
  // Days the database refuses: last before first, more than a year, outside the allowed years.
  expect(await refusal(pages().publication(schedule(1, '2027-04-18', '2027-04-12')))).toBe('23514');
  expect(await refusal(pages().publication(schedule(1, '2027-01-01', '2028-02-01')))).toBe('23514');
  expect(await refusal(pages().publication(schedule(1, '1999-12-31', '2000-01-02')))).toBe('23514');
  // Days that are not real calendar days never reach the database.
  await expect(pages().publication(schedule(1, '2027-02-31', '2027-03-02'))).rejects.toThrow();
  await expect(pages().publication(schedule(1, 'soon', '2027-03-02'))).rejects.toThrow();
  expect(await count()).toEqual({ rows: 1, events: 1 });
});

test('a new version starts without days, and a taken down page has none to show', async () => {
  expect((await pages('admin').publication(publish(1))).version).toBe(2);
  expect(await reader().schedule(address)).toBeNull();
  expect((await pages('admin').publication(schedule(2, '2027-06-01', '2027-06-05'))).version).toBe(
    2,
  );
  expect(await reader().schedule(address)).toEqual({
    version: 2,
    startsOn: '2027-06-01',
    endsOn: '2027-06-05',
  });
  await pages().publication({
    action: 'withdraw',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    acknowledged: true,
  });
  expect(await reader().schedule(address)).toBeNull();
  expect((await reader().read(address)).state).toBe('unknown');
  expect(await refusal(pages().publication(schedule(2, '2027-06-01', '2027-06-05')))).toBe(
    'PROGRAMME_PUBLICATION_CHANGED',
  );
  // Publishing again makes version 3 with no days of its own.
  expect((await pages().publication(publish(2))).version).toBe(3);
  expect(await reader().schedule(address)).toBeNull();
});

test('the read gives one value for every address that has no days to show, in the database itself', async () => {
  const ask = async (value: string | null) =>
    (await f.runtime.query('SELECT app.read_programme_schedule($1) AS result', [value])).rows[0]
      .result;
  // A readable page without days (version 3), a malformed address, an unknown well formed address and no address at all.
  const answers = [
    await ask(address),
    await ask('x'),
    await ask('not-a-page-0123456789'),
    await ask(null),
    await ask("synthetic'; drop table x; --"),
  ];
  expect(answers).toEqual([null, null, null, null, null]);
  // The wrapper the pages call adds nothing: the same single value.
  expect(await reader().schedule('not-a-page-0123456789')).toBeNull();
  expect(await reader().schedule(null)).toBeNull();
  // A readable page with days still answers them, so the null above is about the days and not about the function.
  await pages().publication(schedule(3, '2027-09-01', '2027-09-03'));
  expect(await ask(address)).toEqual({ version: 3, startsOn: '2027-09-01', endsOn: '2027-09-03' });
});

test('the rows cannot be changed, and the event names ids only, never a day or a word', async () => {
  await expect(
    f.owner.query('UPDATE customer_private.programme_publication_schedule SET ends_on=ends_on+1'),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_publication_schedule'),
  ).rejects.toThrow();
  const events = (
    await f.owner.query('SELECT payload FROM app.domain_event WHERE type=$1', [
      'customer.programme_publication.schedule_set',
    ])
  ).rows;
  expect(events.length).toBe(3);
  for (const event of events) {
    const text = JSON.stringify(event.payload);
    expect(Object.keys(event.payload).sort()).toEqual(
      [
        'initiator_id',
        'initiator_kind',
        'programme_id',
        'publication_id',
        'synthetic',
        'version',
      ].sort(),
    );
    expect(text).not.toMatch(/2027|Guangzhou|Synthetic China|startsOn|endsOn/);
  }
});

test('the install is recorded as a third hash-guarded file, repeatable, and refuses a changed history', async () => {
  const g = await fixture('corridra_upgrade');
  try {
    await migrateCustomerParticipants(g.owner);
    await migrateCustomerProgrammePublication(g.owner);
    await migrateCustomerProgrammePublication(g.owner);
    const rows = (
      await g.owner.query(
        'SELECT name,sha256 FROM customer_programme_publication_migrations.applied ORDER BY name',
      )
    ).rows;
    expect(rows.map((row) => row.name)).toEqual(files);
    for (const row of rows)
      expect(row.sha256).toBe(
        createHash('sha256')
          .update(await file(row.name))
          .digest('hex'),
      );
    expect(
      (await g.owner.query("SELECT to_regprocedure('app.read_programme_schedule(text)') AS made"))
        .rows[0].made,
    ).not.toBeNull();
    // A file whose recorded hash no longer matches stops the whole install.
    await g.owner.query(
      "UPDATE customer_programme_publication_migrations.applied SET sha256=repeat('0',64) WHERE name=$1",
      [files[2]],
    );
    await expect(migrateCustomerProgrammePublication(g.owner)).rejects.toThrow(
      'Customer programme publication migration history mismatch',
    );
  } finally {
    await g.close();
  }
}, 240000);

test('the file refuses, and creates nothing, when a page table or a page function is not the one it was proven against', async () => {
  const g = await fixture('corridra_upgrade');
  try {
    await migrateCustomerParticipants(g.owner);
    await g.owner.query(await file(files[0]!));
    await g.owner.query(await file(files[1]!));
    const nothingMade = async () =>
      (
        await g.owner.query(
          "SELECT to_regclass('customer_private.programme_publication_schedule') AS t,to_regprocedure('app.read_programme_schedule(text)') AS r,to_regprocedure('customer.set_programme_schedule(uuid,uuid,uuid,integer,date,date)') AS w",
        )
      ).rows[0];
    const refused = async (change: string, undo: string, named: string) => {
      await g.owner.query(change);
      await expect(g.owner.query(await file(files[2]!))).rejects.toThrow(
        'Programme page schedule prerequisite differs: ' + named,
      );
      expect(await nothingMade()).toEqual({ t: null, r: null, w: null });
      await g.owner.query(undo);
    };
    await refused(
      'ALTER TABLE customer_private.programme_publication ADD CONSTRAINT shorter_copy CHECK(version<100000)',
      'ALTER TABLE customer_private.programme_publication DROP CONSTRAINT shorter_copy',
      'customer_private.programme_publication',
    );
    await refused(
      'ALTER TABLE customer_private.programme_publication_withdrawal ADD COLUMN note text',
      'ALTER TABLE customer_private.programme_publication_withdrawal DROP COLUMN note',
      'customer_private.programme_publication_withdrawal',
    );
    // A replaced page function (a body that differs by one clause) is refused too, and says which one.
    const latest =
      'CREATE OR REPLACE FUNCTION customer_private.programme_publication_latest(programme uuid) RETURNS customer_private.programme_publication LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT p FROM customer_private.programme_publication p WHERE p.programme_id=programme ORDER BY p.version ASC LIMIT 1 $$';
    const original = (
      await g.owner.query(
        "SELECT pg_get_functiondef('customer_private.programme_publication_latest(uuid)'::regprocedure) d",
      )
    ).rows[0].d as string;
    await refused(latest, original, 'customer_private.programme_publication_latest(uuid)');
    // With the proven objects back, the same file applies.
    await g.owner.query(await file(files[2]!));
    expect((await nothingMade()).t).not.toBeNull();
  } finally {
    await g.close();
  }
}, 240000);
