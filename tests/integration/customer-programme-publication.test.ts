import { beforeAll, afterAll, afterEach, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  CustomerProgrammePublicationService,
  ProgrammePageReader,
  customerProgrammePagesEnabled,
  programmePublicationRefusal,
  proposeProgrammeAddress,
} from '../../packages/auth/src/customer-programme-publication';

// The signed-in route is called for real against the real database functions with the restricted runtime role.
// Only the identity provider is replaced: the session is a fixed synthetic one.
const account = vi.hoisted(() => ({ services: null as unknown }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import * as pagesRoute from '../../apps/web/app/api/customer-programme-pages/route';

const issuer =
  'https://ep-publication-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, programmeId: string;
let preserved = false;
const session = (person = 'alice') => ({
  subject: 'synthetic-publication-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const pages = (person = 'alice') =>
  new CustomerProgrammePublicationService(f.runtime, f.auth, options, async () => session(person));
const participants = (person = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const reader = () => new ProgrammePageReader(f.runtime);
const soon = (hours = 240) => new Date(Date.now() + hours * 3600000).toISOString();
const copy = (extra: Record<string, unknown> = {}) => ({
  title: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  summary:
    'A ten company buying delegation to compare rice transplanters and combine harvesters before the next season.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery for small and medium farms',
  audience: 'Owners and buyers of importers and dealers who plan to place an order within a year.',
  eligibility:
    'A registered business that imports or sells farm machinery. One or two people each.',
  activities: [
    { label: 'Factory visits in Foshan', status: 'PLANNED' },
    { label: 'Opening briefing with the organiser', status: 'CONFIRMED' },
  ],
  included: ['Programme coordination', 'Shared ground transport on visit days'],
  excluded: ['Flights', 'Visa fees', 'Hotel'],
  fee: 'BDT 45,000 per company, paid to the organiser',
  capacity: 10,
  ...extra,
});
const publish = (expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  action: 'publish',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  expectedVersion,
  copy: copy(),
  closesAt: soon(),
  acknowledged: true,
  ...extra,
});
const apply = (address: string, version: number, person: string) => ({
  action: 'apply',
  commandId: randomUUID(),
  address,
  version,
  displayLabel: 'Synthetic applicant ' + person,
  statement: 'Synthetic buyer of two combine harvesters this year, wants factory visits.',
  consented: true,
});
const decide = (
  applicationId: string,
  expectedVersion: number,
  decision: string,
  note?: string,
) => ({
  action: 'decide',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  applicationId,
  expectedVersion,
  decision,
  ...(note ? { note } : {}),
  acknowledged: true,
});
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return programmePublicationRefusal(error) ?? (error as { code?: string }).code ?? 'error';
  }
  return 'no refusal';
};
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') AND p.prokind='f' ORDER BY 1",
    )
  ).rows;
  const policies = (
    await f.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY 2,3",
    )
  ).rows;
  const constraints = (
    await f.owner.query(
      "SELECT conrelid::regclass::text t,conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('app','identity','customer','customer_private')) ORDER BY 1,2",
    )
  ).rows;
  const rows: Record<string, string> = {};
  for (const t of tables)
    rows[t.oid] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM "${t.nspname}"."${t.relname}" v`,
      )
    ).rows[0].digest;
  return { functions, policies, tables, constraints, rows };
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerParticipants(f.owner);
  for (const person of ['alice', 'bob', 'charlie', 'dana', 'erin', 'member', 'admin'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional programme page fixture,no real customer account',
    });
  workspaceId = (
    await workspace().provision({ commandId: randomUUID(), name: 'Synthetic organiser workspace' })
  ).id;
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic public programme page and application acceptance',
      acknowledged: true,
    })
  ).id;
  const wi = await workspace().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic existing colleague',
  });
  await workspace('member').access({ action: 'accept', commandId: randomUUID(), token: wi.token });
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
  const before = await snapshot();
  await migrateCustomerProgrammePublication(f.owner);
  const after = await snapshot();
  for (const fn of before.functions)
    expect(after.functions.find((p) => p.name === fn.name)).toEqual(fn);
  expect(after.policies).toEqual(before.policies);
  expect(after.tables.filter((t) => before.tables.some((b) => b.oid === t.oid))).toEqual(
    before.tables,
  );
  for (const c of before.constraints) expect(after.constraints).toContainEqual(c);
  for (const t of before.tables) expect(after.rows[t.oid]).toBe(before.rows[t.oid]);
  preserved = true;
});
afterAll(async () => {
  await f?.close();
});

test('the switch is off unless exactly true and only where participants are on', () => {
  const on = {
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
  } as unknown as NodeJS.ProcessEnv;
  expect(customerProgrammePagesEnabled(on)).toBe(false);
  expect(customerProgrammePagesEnabled({ ...on, CORRIDRA_PROGRAMME_PAGES: 'TRUE' })).toBe(false);
  expect(customerProgrammePagesEnabled({ ...on, CORRIDRA_PROGRAMME_PAGES: 'true' })).toBe(true);
  expect(customerProgrammePagesEnabled({ CORRIDRA_PROGRAMME_PAGES: 'true' } as never)).toBe(false);
});
test('a proposed address is readable, well formed and different every time', () => {
  const a = proposeProgrammeAddress('China Agri — Machinery 2027!');
  expect(a).toMatch(/^china-agri-machinery-2027-[a-z0-9]{10}$/);
  expect(proposeProgrammeAddress('China Agri — Machinery 2027!')).not.toBe(a);
  expect(proposeProgrammeAddress('中国')).toMatch(/^programme-[a-z0-9]{10}$/);
  expect(proposeProgrammeAddress('x'.repeat(300)).length).toBeLessThanOrEqual(80);
});
test('installing the module changes no existing function, policy, table, constraint or row, and is repeatable', async () => {
  expect(preserved).toBe(true);
  await migrateCustomerProgrammePublication(f.owner);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_programme_publication_migrations.applied',
      )
    ).rows[0].n,
  ).toBe(1);
  // The runtime role reads none of the new tables directly and may call only the seven granted functions.
  for (const t of [
    'programme_public_address',
    'programme_publication',
    'programme_publication_withdrawal',
    'programme_application',
    'programme_application_decision',
    'programme_application_withdrawal',
  ])
    await expect(f.runtime.query(`SELECT * FROM customer_private.${t}`)).rejects.toMatchObject({
      code: '42501',
    });
  await expect(
    f.runtime.query('SELECT customer_private.programme_publication_latest($1)', [programmeId]),
  ).rejects.toMatchObject({ code: '42501' });
});

test('the install refuses, and creates nothing, when a table it writes to has a shape it was not proven against', async () => {
  // A second isolated database, so the fixture of this file stays as it is.
  const g = await fixture('corridra_upgrade');
  try {
    await migrateCustomerParticipants(g.owner);
    const refused = async (change: string, undo: string, table: string) => {
      await g.owner.query(change);
      await expect(migrateCustomerProgrammePublication(g.owner)).rejects.toThrow(
        'Programme publication prerequisite differs: customer_private.' + table,
      );
      expect(
        (
          await g.owner.query(
            "SELECT to_regclass('customer_private.programme_publication') AS made,to_regprocedure('app.read_programme_publication(text)') AS read",
          )
        ).rows[0],
      ).toEqual({ made: null, read: null });
      await g.owner.query(undo);
    };
    // A new column, a dropped NOT NULL and a changed CHECK: one for each table the module inserts into.
    await refused(
      "ALTER TABLE customer_private.programme_registration ADD COLUMN note text NOT NULL DEFAULT 'x'",
      'ALTER TABLE customer_private.programme_registration DROP COLUMN note',
      'programme_registration',
    );
    await refused(
      'ALTER TABLE customer_private.programme_invitation ALTER COLUMN label DROP NOT NULL',
      'ALTER TABLE customer_private.programme_invitation ALTER COLUMN label SET NOT NULL',
      'programme_invitation',
    );
    await refused(
      'ALTER TABLE customer_private.programme_participant_revocation ADD CONSTRAINT shorter_reason CHECK(length(reason)<=400)',
      'ALTER TABLE customer_private.programme_participant_revocation DROP CONSTRAINT shorter_reason',
      'programme_participant_revocation',
    );
    // With the proven shapes back, the same install succeeds.
    await migrateCustomerProgrammePublication(g.owner);
    expect(
      (
        await g.owner.query(
          'SELECT count(*)::int n FROM customer_programme_publication_migrations.applied',
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await g.close();
  }
}, 240000);

let address = '';
test('only a current owner or admin publishes; the first version makes the address; an exact retry answers the same', async () => {
  expect((await pages().view({ workspaceId, programmeId })).state).toBe('NONE');
  expect(await refusal(pages('member').publication(publish(0)))).toBe('42501');
  expect(await refusal(pages('bob').publication(publish(0)))).toBe('42501');
  expect(await refusal(pages('member').view({ workspaceId, programmeId }))).toBe('42501');
  // A sample workspace keeps the sample mark on the title and the organiser name.
  expect(
    await refusal(pages().publication(publish(0, { copy: copy({ title: 'China delegation' }) }))),
  ).toBe('23514');
  // Nothing outside the reviewed fields can be published.
  await expect(
    pages().publication(publish(0, { copy: { ...copy(), contact: 'someone@example.test' } })),
  ).rejects.toThrow();
  expect(await refusal(pages().publication(publish(0, { closesAt: soon(24 * 200) })))).toBe(
    '23514',
  );
  const input = publish(0);
  const [first, second] = await Promise.all([
    pages().publication(input),
    pages().publication(input),
  ]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ version: 1, state: 'OPEN' });
  address = first.address;
  expect(address).toMatch(/^synthetic-china-agricultural-machinery-delegation-[a-z0-9]{10}$/);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.programme_publication'))
      .rows[0].n,
  ).toBe(1);
  // A second writer who read version 0 is told the page changed; the admin revises on version 1 and keeps the address.
  expect(await refusal(pages('admin').publication(publish(0)))).toBe(
    'PROGRAMME_PUBLICATION_CHANGED',
  );
  const revised = await pages('admin').publication(
    publish(1, { copy: copy({ dates: '14 to 20 April 2027, confirmed' }) }),
  );
  expect(revised).toMatchObject({ version: 2, address, state: 'OPEN' });
  const view = await pages().view({ workspaceId, programmeId });
  expect(view).toMatchObject({ version: 2, state: 'OPEN', address, applications: 0, sample: true });
  expect(view.copy.dates).toBe('14 to 20 April 2027, confirmed');
});

test('anyone reads the latest version without an account; unknown answers are one value', async () => {
  const page = await reader().read(address);
  expect(page).toMatchObject({ state: 'OPEN', address, version: 2, sample: true });
  if (page.state === 'unknown') throw new Error('expected a page');
  expect(Object.keys(page).sort()).toEqual(
    ['address', 'closesAt', 'programme', 'publishedAt', 'sample', 'state', 'version'].sort(),
  );
  expect(page.programme).toEqual(copy({ dates: '14 to 20 April 2027, confirmed' }));
  // Nothing private rides along: no workspace, programme or person identifier anywhere in the answer.
  const text = JSON.stringify(page);
  expect(text).not.toContain(workspaceId);
  expect(text).not.toContain(programmeId);
  for (const bad of [
    null,
    '',
    'x',
    address.toUpperCase(),
    address + 'a',
    address.slice(0, -1),
    "a'; DROP TABLE x;--aaaaaaaaaa",
    proposeProgrammeAddress('Synthetic unknown page'),
  ])
    expect(await reader().read(bad)).toEqual({ state: 'unknown' });
});

let bobApplication = '';
test('a signed-in person applies once; a repeat answers with the live application; a stale page is refused', async () => {
  expect(await refusal(pages('bob').application(apply(address, 1, 'Bob')))).toBe(
    'PROGRAMME_PUBLICATION_CHANGED',
  );
  // The sample mark is required on the name and the statement in a sample workspace.
  expect(
    await refusal(
      pages('bob').application({ ...apply(address, 2, 'Bob'), displayLabel: 'Bob Traders' }),
    ),
  ).toBe('23514');
  expect(
    await refusal(pages('bob').application({ ...apply(address, 2, 'Bob'), consented: false })),
  ).toBe('error');
  const input = apply(address, 2, 'Bob');
  const [one, two] = await Promise.all([
    pages('bob').application(input),
    pages('bob').application(input),
  ]);
  expect(one).toEqual(two);
  expect(one).toMatchObject({ status: 'SUBMITTED', decisionVersion: 0, address });
  bobApplication = one.id;
  const again = await pages('bob').application(apply(address, 2, 'Bob'));
  expect(again).toMatchObject({ id: bobApplication, existing: true, status: 'SUBMITTED' });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.programme_application'))
      .rows[0].n,
  ).toBe(1);
  const own = await pages('bob').own();
  expect(own.applications).toHaveLength(1);
  expect(own.applications[0]).toMatchObject({
    id: bobApplication,
    status: 'SUBMITTED',
    address,
    title: 'Synthetic China agricultural machinery delegation',
  });
  expect((await pages('charlie').own()).applications).toEqual([]);
  // Another person can neither withdraw nor join it.
  for (const action of ['withdraw', 'join'])
    expect(
      await refusal(
        pages('charlie').application({
          action,
          commandId: randomUUID(),
          applicationId: bobApplication,
          ...(action === 'join' ? { consented: true } : { acknowledged: true }),
        }),
      ),
    ).toBe('42501');
  // The stored events name ids only: no name and no statement.
  const events = (
    await f.owner.query(
      "SELECT payload::text p FROM app.domain_event WHERE type LIKE 'customer.programme_application.%' OR type LIKE 'customer.programme_publication.%'",
    )
  ).rows.map((r) => r.p as string);
  expect(events.length).toBeGreaterThanOrEqual(3);
  for (const p of events) {
    expect(p).not.toContain('Synthetic applicant');
    expect(p).not.toContain('combine harvesters');
    expect(p).not.toContain('agricultural machinery');
  }
});

test('the organiser lists applications and decides; a member cannot; a stale decision is refused', async () => {
  expect(await refusal(pages('member').applications({ workspaceId, programmeId }))).toBe('42501');
  expect(await refusal(pages('bob').applications({ workspaceId, programmeId }))).toBe('42501');
  expect(await refusal(pages('member').application(decide(bobApplication, 0, 'INVITED')))).toBe(
    '42501',
  );
  const list = await pages().applications({ workspaceId, programmeId });
  expect(list.applications).toHaveLength(1);
  expect(list.applications[0]).toMatchObject({
    id: bobApplication,
    status: 'SUBMITTED',
    displayLabel: 'Synthetic applicant Bob',
  });
  expect((await pages().view({ workspaceId, programmeId })).awaiting).toBe(1);
  // A decline always carries words for the applicant.
  expect(await refusal(pages().application(decide(bobApplication, 0, 'DECLINED')))).toBe('23514');
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_application_decision',
      )
    ).rows[0].n,
  ).toBe(0);
  const waiting = await pages('admin').application(decide(bobApplication, 0, 'WAITLISTED'));
  expect(waiting).toMatchObject({ status: 'WAITLISTED', decisionVersion: 1 });
  expect(await refusal(pages().application(decide(bobApplication, 0, 'INVITED')))).toBe(
    'PROGRAMME_APPLICATION_CHANGED',
  );
  expect(
    await refusal(
      pages('bob').application({
        action: 'join',
        commandId: randomUUID(),
        applicationId: bobApplication,
        consented: true,
      }),
    ),
  ).toBe('PROGRAMME_APPLICATION_NOT_INVITED');
  const input = decide(bobApplication, 1, 'INVITED');
  const [a, b] = await Promise.all([pages().application(input), pages().application(input)]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ status: 'INVITED', decisionVersion: 2 });
  expect(a.invitationExpiresAt).toMatch(/Z$/);
  expect(await refusal(pages().application(decide(bobApplication, 2, 'INVITED')))).toBe(
    'PROGRAMME_APPLICATION_ALREADY_INVITED',
  );
  // Exactly one invitation exists, in the existing table, carrying the applicant's name.
  const invitations = (
    await f.owner.query(
      'SELECT label FROM customer_private.programme_invitation WHERE programme_id=$1',
      [programmeId],
    )
  ).rows;
  expect(invitations).toEqual([{ label: 'Synthetic applicant Bob' }]);
});

test('an invited applicant joins with consent and becomes an ordinary registration, exactly once', async () => {
  const join = {
    action: 'join',
    commandId: randomUUID(),
    applicationId: bobApplication,
    consented: true,
  };
  const [one, two] = await Promise.all([
    pages('bob').application(join),
    pages('bob').application({ ...join, commandId: randomUUID() }),
  ]);
  expect(one).toMatchObject({ status: 'JOINED' });
  expect(two).toMatchObject({ status: 'JOINED', registrationId: one.registrationId });
  // The existing participant screens see it exactly as a registration made with an invitation code.
  const own = await participants('bob').own();
  expect(own.registrations).toHaveLength(1);
  expect(own.registrations[0]).toMatchObject({
    id: one.registrationId,
    programmeId,
    status: 'REGISTERED',
    displayLabel: 'Synthetic applicant Bob',
  });
  const organiser = await participants().list({ workspaceId, programmeId });
  expect(organiser.registrations).toHaveLength(1);
  expect(organiser.invitations[0].status).toBe('USED');
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event WHERE type='customer.programme.accept' AND payload->>'application_id'=$1",
        [bobApplication],
      )
    ).rows[0].n,
  ).toBe(1);
  // After joining, the application is settled: no new decision, no withdrawal, no second application.
  expect(
    await refusal(
      pages().application(decide(bobApplication, 2, 'DECLINED', 'Synthetic late change of mind')),
    ),
  ).toBe('PROGRAMME_APPLICATION_JOINED');
  expect(
    await refusal(
      pages('bob').application({
        action: 'withdraw',
        commandId: randomUUID(),
        applicationId: bobApplication,
        acknowledged: true,
      }),
    ),
  ).toBe('PROGRAMME_APPLICATION_JOINED');
  expect(await refusal(pages('bob').application(apply(address, 2, 'Bob')))).toBe(
    'PROGRAMME_ALREADY_REGISTERED',
  );
});

test('a decline after an invitation revokes it; the applicant reads the reason and can no longer join', async () => {
  const applied = await pages('charlie').application(apply(address, 2, 'Charlie'));
  await pages().application(decide(applied.id, 0, 'INVITED'));
  const declined = await pages().application(
    decide(applied.id, 1, 'DECLINED', 'Synthetic reason: the delegation is for importers only.'),
  );
  expect(declined).toMatchObject({ status: 'DECLINED', decisionVersion: 2 });
  expect(
    await refusal(
      pages('charlie').application({
        action: 'join',
        commandId: randomUUID(),
        applicationId: applied.id,
        consented: true,
      }),
    ),
  ).toBe('PROGRAMME_APPLICATION_NOT_INVITED');
  const own = await pages('charlie').own();
  expect(own.applications[0]).toMatchObject({
    status: 'DECLINED',
    note: 'Synthetic reason: the delegation is for importers only.',
  });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_participant_revocation WHERE programme_id=$1 AND invitation_id IS NOT NULL',
        [programmeId],
      )
    ).rows[0].n,
  ).toBe(1);
  // A declined applicant may apply again; the organiser may invite on the new application.
  const second = await pages('charlie').application(apply(address, 2, 'Charlie'));
  expect(second.id).not.toBe(applied.id);
  expect(second).toMatchObject({ status: 'SUBMITTED' });
});

test('an applicant withdraws; a live invitation is revoked with it and the organiser can no longer decide', async () => {
  const applied = await pages('dana').application(apply(address, 2, 'Dana'));
  await pages().application(decide(applied.id, 0, 'INVITED'));
  const withdraw = {
    action: 'withdraw',
    commandId: randomUUID(),
    applicationId: applied.id,
    acknowledged: true,
  };
  const [one, two] = await Promise.all([
    pages('dana').application(withdraw),
    pages('dana').application(withdraw),
  ]);
  expect(one).toMatchObject({ status: 'WITHDRAWN' });
  expect(two).toMatchObject({ status: 'WITHDRAWN' });
  expect(await refusal(pages().application(decide(applied.id, 1, 'INVITED')))).toBe(
    'PROGRAMME_APPLICATION_WITHDRAWN',
  );
  expect(
    await refusal(
      pages('dana').application({
        action: 'join',
        commandId: randomUUID(),
        applicationId: applied.id,
        consented: true,
      }),
    ),
  ).toBe('PROGRAMME_APPLICATION_WITHDRAWN');
  const list = await pages().applications({ workspaceId, programmeId });
  expect(list.applications.find((a: { id: string }) => a.id === applied.id)).toMatchObject({
    status: 'WITHDRAWN',
  });
});

test('an expired invitation cannot be joined and the organiser can invite again', async () => {
  const applied = await pages('erin').application(apply(address, 2, 'Erin'));
  await pages().application(decide(applied.id, 0, 'INVITED'));
  // The clock cannot be moved, so the stored invitation is aged by the database owner inside one transaction that
  // lifts the immutability trigger for this row only; nothing else in the fixture is touched.
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query('ALTER TABLE customer_private.programme_invitation DISABLE TRIGGER immutable');
    await db.query(
      "UPDATE customer_private.programme_invitation SET created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days' WHERE label='Synthetic applicant Erin'",
    );
    await db.query('ALTER TABLE customer_private.programme_invitation ENABLE TRIGGER immutable');
    await db.query('COMMIT');
  } finally {
    db.release();
  }
  expect((await pages('erin').own()).applications[0].status).toBe('INVITATION_EXPIRED');
  const join = () => ({
    action: 'join',
    commandId: randomUUID(),
    applicationId: applied.id,
    consented: true,
  });
  expect(await refusal(pages('erin').application(join()))).toBe('PROGRAMME_INVITATION_EXPIRED');
  const again = await pages().application(decide(applied.id, 1, 'INVITED'));
  expect(again).toMatchObject({ status: 'INVITED', decisionVersion: 2 });
  expect(await pages('erin').application(join())).toMatchObject({ status: 'JOINED' });
});

test('taking the page down hides it and stops applications; publishing again reopens the same address', async () => {
  expect(
    await refusal(
      pages('member').publication({
        action: 'withdraw',
        commandId: randomUUID(),
        workspaceId,
        programmeId,
        acknowledged: true,
      }),
    ),
  ).toBe('42501');
  const down = {
    action: 'withdraw',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    acknowledged: true,
  };
  const [one, two] = await Promise.all([
    pages('admin').publication(down),
    pages('admin').publication(down),
  ]);
  expect(one).toEqual(two);
  expect(one).toMatchObject({ state: 'WITHDRAWN', version: 2 });
  expect(await reader().read(address)).toEqual({ state: 'unknown' });
  expect(await refusal(pages('dana').application(apply(address, 2, 'Dana')))).toBe(
    'PROGRAMME_APPLICATIONS_CLOSED',
  );
  // An application made earlier stays listed for its applicant, without a link to a page that is gone.
  const own = (await pages('charlie').own()).applications;
  expect(own.every((a: { address?: string }) => a.address === undefined)).toBe(true);
  expect(own.every((a: { title?: string }) => a.title)).toBe(true);
  const back = await pages().publication(publish(2));
  expect(back).toMatchObject({ version: 3, address, state: 'OPEN' });
  expect(await reader().read(address)).toMatchObject({ state: 'OPEN', version: 3 });
});

test('a page past its closing time is readable as closed and takes no applications', async () => {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query('ALTER TABLE customer_private.programme_publication DISABLE TRIGGER immutable');
    await db.query(
      "UPDATE customer_private.programme_publication SET created_at=clock_timestamp()-interval '2 hours',closes_at=clock_timestamp()-interval '1 minute' WHERE programme_id=$1 AND version=3",
      [programmeId],
    );
    await db.query('ALTER TABLE customer_private.programme_publication ENABLE TRIGGER immutable');
    await db.query('COMMIT');
  } finally {
    db.release();
  }
  expect(await reader().read(address)).toMatchObject({ state: 'CLOSED', version: 3 });
  expect((await pages().view({ workspaceId, programmeId })).state).toBe('CLOSED');
  expect(await refusal(pages('dana').application(apply(address, 3, 'Dana')))).toBe(
    'PROGRAMME_APPLICATIONS_CLOSED',
  );
  // The organiser reopens by publishing a new version with a later closing time.
  expect(await pages().publication(publish(3))).toMatchObject({ version: 4, state: 'OPEN' });
});

test('an archived workspace pauses the page: unknown to readers, no publishing, inviting or joining', async () => {
  // The lifecycle module owns the archived fact. Its presence is stood in for by a function of the same name that
  // answers true for this workspace only, made and removed by the database owner around this test.
  await f.owner.query(
    `CREATE FUNCTION customer_private.workspace_archived(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT target='${workspaceId}'::uuid $$`,
  );
  try {
    expect(await reader().read(address)).toEqual({ state: 'unknown' });
    expect((await pages().view({ workspaceId, programmeId })).state).toBe('PAUSED');
    expect(await refusal(pages().publication(publish(4)))).toBe('PROGRAMME_PUBLICATION_PAUSED');
    expect(await refusal(pages('dana').application(apply(address, 4, 'Dana')))).toBe(
      'PROGRAMME_APPLICATIONS_CLOSED',
    );
    const waiting = (await pages().applications({ workspaceId, programmeId })).applications.find(
      (a: { status: string }) => a.status === 'SUBMITTED',
    );
    expect(await refusal(pages().application(decide(waiting.id, 0, 'INVITED')))).toBe(
      'PROGRAMME_PUBLICATION_PAUSED',
    );
  } finally {
    await f.owner.query('DROP FUNCTION customer_private.workspace_archived(uuid)');
  }
  expect(await reader().read(address)).toMatchObject({ state: 'OPEN', version: 4 });
});

test('a person is capped at three applications to one programme', async () => {
  // Charlie has two (one declined, one waiting). Decline the second, apply a third, decline it, then the cap answers.
  const list = async () =>
    (await pages().applications({ workspaceId, programmeId })).applications.filter(
      (a: { displayLabel: string }) => a.displayLabel === 'Synthetic applicant Charlie',
    );
  const waiting = (await list()).find((a: { status: string }) => a.status === 'SUBMITTED');
  await pages().application(
    decide(waiting.id, 0, 'DECLINED', 'Synthetic reason: still importers only.'),
  );
  const third = await pages('charlie').application(apply(address, 4, 'Charlie'));
  await pages().application(
    decide(third.id, 0, 'DECLINED', 'Synthetic reason: still importers only.'),
  );
  expect(await refusal(pages('charlie').application(apply(address, 4, 'Charlie')))).toBe(
    'PROGRAMME_APPLICATION_LIMIT',
  );
  expect(await list()).toHaveLength(3);
});

const origin = 'https://corridra.example.invalid';
const switchesOn = () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_PROGRAMME_PAGES', 'true');
};
const serve = (person: string) => {
  account.services = {
    missions: { budget: async () => {} },
    customerProgrammePages: pages(person),
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
  };
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  pagesRoute.POST(
    new Request(origin + '/api/customer-programme-pages', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
const get = (query: string) =>
  pagesRoute.GET(new Request(origin + '/api/customer-programme-pages?' + query));
afterEach(() => {
  vi.unstubAllEnvs();
});

test('the route answers unavailable while the switch is off, whatever is asked', async () => {
  serve('alice');
  expect(
    (await get(`view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`)).status,
  ).toBe(503);
  expect((await get('view=own')).status).toBe(503);
  expect((await post({ kind: 'page', ...publish(4) })).status).toBe(503);
  vi.stubEnv('CORRIDRA_PROGRAMME_PAGES', 'true');
  // The switch alone is not enough: participants must be on too.
  expect((await get('view=own')).status).toBe(503);
});

test('the route checks origin and content type, names refusals by code and never caches', async () => {
  switchesOn();
  serve('alice');
  expect(
    (await post({ kind: 'page', ...publish(4) }, { Origin: 'https://evil.example' })).status,
  ).toBe(403);
  expect(
    (await post({ kind: 'page', ...publish(4) }, { 'Content-Type': 'text/plain' })).status,
  ).toBe(415);
  expect((await post({ kind: 'other' })).status).toBe(400);
  expect((await get('view=other')).status).toBe(400);
  const stale = await post({ kind: 'page', ...publish(0) });
  expect(stale.status).toBe(409);
  expect(stale.headers.get('cache-control')).toBe('no-store');
  expect(await stale.json()).toMatchObject({ code: 'PROGRAMME_PUBLICATION_CHANGED' });
  const view = await get(`view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`);
  expect(view.status).toBe(200);
  expect(view.headers.get('cache-control')).toBe('no-store');
  const current = await view.json();
  expect(current).toMatchObject({ state: 'OPEN', address });
  const revised = await post({ kind: 'page', ...publish(current.version) });
  expect(revised.status).toBe(200);
  expect(await revised.json()).toMatchObject({ version: current.version + 1, address });
  const list = await get(`view=applications&workspaceId=${workspaceId}&programmeId=${programmeId}`);
  expect(list.status).toBe(200);
  expect((await list.json()).applications.length).toBeGreaterThan(0);
  // A member who is not an owner or admin is refused with 403, not told what exists.
  serve('member');
  expect(
    (await get(`view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`)).status,
  ).toBe(403);
  expect((await post({ kind: 'page', ...publish(current.version + 1) })).status).toBe(403);
  // An applicant reads their own list and is told by code when a programme takes no more of their applications.
  serve('charlie');
  const own = await get('view=own');
  expect(own.status).toBe(200);
  expect((await own.json()).applications).toHaveLength(3);
  const capped = await post({
    kind: 'application',
    ...apply(address, current.version + 1, 'Charlie'),
  });
  expect(capped.status).toBe(409);
  expect(await capped.json()).toMatchObject({ code: 'PROGRAMME_APPLICATION_LIMIT' });
});
