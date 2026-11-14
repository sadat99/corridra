import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, options, type Fixture, type Row } from './revamp-g4-support';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateCustomerProgrammeErasure } from '../../packages/db/src/customer-programme-erasure-migrate';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import {
  CustomerProgrammePublicationService,
  StaffProgrammeApplications,
  type StaffApplicationRow,
} from '../../packages/auth/src/customer-programme-publication';

// ADR-080, owner decision of 12 November 2026: Corridra staff may READ applications to public programme pages. Real database,
// real restricted roles, invented people only. Reading is the only thing staff can do: no decision, no edit, no write of any
// kind, and the words are shown exactly as stored (a redacted application shows its placeholder).
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let workspaceId = '';
let programmeId = '';
let address = '';
let staff: StaffProgrammeApplications;
const applicationIds: Record<string, string> = {};
const session = (person: string) => ({
  subject: `synthetic-spa-${person}`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
  signedInAt: new Date(),
});
const pages = (person: string) =>
  new CustomerProgrammePublicationService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person: string) =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const ctxOf = (who: string): RequestContext => f.users[who]!.ctx;
const as = (ctx: RequestContext, text: string, params: unknown[] = []) =>
  rawContext(f.runtime, ctx, text, params).then((result) => result.rows[0]);
const staleAuthenticator = (who: string, stale: boolean) =>
  f.owner.query(
    `UPDATE identity.assurance SET verified_at=${stale ? "now()-interval '1 hour'" : 'now()'} WHERE session_id=$1`,
    [f.users[who]!.sessionId],
  );
const soon = () => new Date(Date.now() + 240 * 3600000).toISOString();
const copy = () => ({
  title: 'Synthetic China agricultural machinery delegation',
  organiser: 'Synthetic Dhaka Agro Traders Association',
  summary: 'A ten company buying delegation to compare rice transplanters and combine harvesters.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery for small and medium farms',
  audience: 'Owners and buyers of importers and dealers who plan to place an order within a year.',
  eligibility: 'A registered business that imports or sells farm machinery.',
  activities: [{ label: 'Factory visits in Foshan', status: 'PLANNED' }],
  included: ['Programme coordination'],
  excluded: ['Flights'],
});
const apply = (person: string) => ({
  action: 'apply',
  commandId: randomUUID(),
  address,
  version: 1,
  displayLabel: `Synthetic ${person} traders`,
  statement: `Synthetic buyer ${person} wrote about two combine harvesters.`,
  consented: true,
});
const decide = (applicationId: string, decision: string, note?: string) => ({
  action: 'decide',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  applicationId,
  expectedVersion: 0,
  decision,
  ...(note ? { note } : {}),
  acknowledged: true,
});
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event) events,(SELECT count(*)::int FROM app.outbox) outbox,
 (SELECT count(*)::int FROM app.audit_event) audit,
 (SELECT count(*)::int FROM customer_private.programme_application) applications,
 (SELECT count(*)::int FROM customer_private.programme_application_decision) decisions,
 (SELECT count(*)::int FROM customer_private.programme_invitation) invitations`)
  ).rows[0];

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerParticipants(f.owner);
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerProgrammeLifecycle(f.owner);
  await migrateCustomerProgrammePublication(f.owner);
  staff = new StaffProgrammeApplications(f.runtime);
  h = harness(f, 'spa');
  ids = await h.admit(['alice', 'bob', 'carol', 'dana', 'erin', 'frank']);
  workspaceId = await h.provision('alice', 'Synthetic organiser workspace');
  for (const person of ['bob', 'carol', 'dana', 'erin', 'frank'])
    await h.provision(person, `Synthetic ${person} workspace`);
  programmeId = (
    await programmes('alice').create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic staff application reading acceptance',
      acknowledged: true,
    })
  ).id;
  address = (
    await pages('alice').publication({
      action: 'publish',
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      expectedVersion: 0,
      copy: copy(),
      closesAt: soon(),
      acknowledged: true,
    })
  ).address;
  for (const person of ['bob', 'carol', 'dana', 'erin'])
    applicationIds[person] = (await pages(person).application(apply(person))).id;
  // frank applied before staff could read applications: his application is moved to before the stored moment, as an
  // application made under the old consent wording would be. The organiser still reads it; staff must not.
  applicationIds.frank = (await pages('frank').application(apply('frank'))).id;
  await f.owner.query('ALTER TABLE customer_private.programme_application DISABLE TRIGGER USER');
  await f.owner.query(
    `UPDATE customer_private.programme_application SET created_at=(SELECT effective_from FROM customer_private.programme_application_staff_reading)-interval '1 day' WHERE id=$1`,
    [applicationIds.frank],
  );
  await f.owner.query('ALTER TABLE customer_private.programme_application ENABLE TRIGGER USER');
  await pages('alice').application(
    decide(applicationIds.carol!, 'DECLINED', 'Synthetic note: places are full this round.'),
  );
  await pages('alice').application(decide(applicationIds.dana!, 'WAITLISTED'));
}, 240000);
afterAll(async () => {
  await f?.close();
});

describe('the install', () => {
  test('is recorded as a second file, repeatable, and gives the runtime role only the one read', async () => {
    await migrateCustomerProgrammePublication(f.owner);
    expect(
      (
        await f.owner.query(
          'SELECT name FROM customer_programme_publication_migrations.applied ORDER BY name',
        )
      ).rows.map((row) => row.name),
    ).toEqual([
      '0001_public_programme_page_and_applications.sql',
      '0002_staff_programme_applications.sql',
      '0003_programme_page_schedule.sql',
    ]);
    const grants = async (signature: string) =>
      (
        await f.owner.query(
          `SELECT coalesce(string_agg(r.rolname,',' ORDER BY r.rolname),'') g FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=$1::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner`,
          [signature],
        )
      ).rows[0].g as string;
    expect(await grants('customer.staff_programme_applications(uuid,integer)')).toContain(
      'corridra_runtime',
    );
    expect(await grants('customer.staff_programme_applications(uuid,integer)')).not.toContain(
      'corridra_auth',
    );
    expect(await grants('customer_private.staff_application_actor()')).toBe('');
    await expect(
      f.runtime.query('SELECT customer_private.staff_application_actor()'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('the switch and the install are what offer the list', async () => {
    const chain = {
      VERCEL_ENV: 'preview',
      DATA_ENVIRONMENT: 'synthetic',
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
      CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    };
    expect(await staff.offered({})).toBe(false);
    expect(await staff.offered(chain)).toBe(false);
    expect(await staff.offered({ ...chain, CORRIDRA_PROGRAMME_PAGES: 'true' })).toBe(true);
  });
});

describe('who may read', () => {
  test('an owner reads every application with the words as stored and nothing about the person', async () => {
    const page = await staff.list(ctxOf('owner'), {});
    expect(page.total).toBe(4);
    expect(page.nextAfter).toBeNull();
    const by = (person: string) =>
      page.applications.find((row) => row.displayLabel === `Synthetic ${person} traders`)!;
    expect(by('erin')).toMatchObject({
      status: 'SUBMITTED',
      statement: 'Synthetic buyer erin wrote about two combine harvesters.',
      programmeTitle: 'Synthetic China agricultural machinery delegation',
      organiser: 'Synthetic Dhaka Agro Traders Association',
      address,
      pageState: 'OPEN',
      workspaceId,
    });
    expect(by('carol')).toMatchObject({
      status: 'DECLINED',
      note: 'Synthetic note: places are full this round.',
    });
    expect(by('dana').status).toBe('WAITLISTED');
    const text = JSON.stringify(page);
    for (const secret of [
      ids.bob!,
      ids.alice!,
      f.users.owner!.id,
      'principal',
      'email',
      '@example.invalid',
    ])
      expect(text).not.toContain(secret);
    expect(Object.keys(by('erin')).sort()).toEqual(
      (
        [
          'address',
          'appliedAt',
          'decisionVersion',
          'displayLabel',
          'id',
          'organiser',
          'pageState',
          'programmeId',
          'programmeTitle',
          'statement',
          'status',
          'workspaceId',
        ] satisfies (keyof StaffApplicationRow)[]
      ).sort(),
    );
  });

  test('an admin reads; an operator, a reviewer and a viewer are refused with a 403', async () => {
    await as(
      ctxOf('owner'),
      "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [f.tenantA, f.users.other!.id],
    );
    const adminCtx: RequestContext = { ...f.users.other!.ctx, tenantId: f.tenantA };
    expect((await staff.list(adminCtx, {})).total).toBe(4);
    for (const who of ['operator', 'reviewer', 'viewer'])
      await expect(staff.list(ctxOf(who), {})).rejects.toMatchObject({ status: 403 });
  });

  test('a customer, an outsider and a workspace that is not the staff one are refused', async () => {
    await expect(staff.list(ctxOf('outsider'), {})).rejects.toMatchObject({ status: 403 });
    await expect(
      staff.list({ ...ctxOf('owner'), tenantId: workspaceId }, {}),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      h.sql('bob', 'SELECT customer.staff_programme_applications(NULL,25)'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      as(ctxOf('owner'), 'SELECT customer.staff_programme_applications(NULL,26) AS r'),
    ).rejects.toMatchObject({ code: '22023' });
  });

  test('a stale authenticator gets the step up and works again once verified', async () => {
    await staleAuthenticator('owner', true);
    await expect(staff.list(ctxOf('owner'), {})).rejects.toMatchObject({
      status: 401,
      code: 'STEP_UP_REQUIRED',
    });
    await staleAuthenticator('owner', false);
    expect((await staff.list(ctxOf('owner'), {})).total).toBe(4);
  });
});

describe('what staff see', () => {
  test('pages run newest first and a cursor never repeats or skips a row', async () => {
    const seen: string[] = [];
    let after: string | undefined;
    for (let n = 0; n < 6; n++) {
      const page = await staff.list(ctxOf('owner'), { pageSize: 1, ...(after ? { after } : {}) });
      seen.push(...page.applications.map((row) => row.id));
      if (!page.nextAfter) break;
      after = page.nextAfter;
    }
    const all = (await staff.list(ctxOf('owner'), {})).applications.map((row) => row.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(4);
    expect(all[0]).toBe(applicationIds.erin);
    await expect(staff.list(ctxOf('owner'), { after: randomUUID() })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('a redacted application shows the placeholder, nothing else of it changes', async () => {
    await migrateCustomerProgrammeErasure(f.owner);
    const control = (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
      )
    ).rows[0].v as number;
    await f.owner.query(
      'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,true,$2,$3)',
      [control + 1, f.serviceId, 'Fixture control for the staff application reading tests'],
    );
    const filed = await h.sql<{ r: Row }>(
      'bob',
      'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
      [randomUUID(), 'file_erasure', '{}'],
    );
    expect(filed.r.changed).toBe(true);
    const queue = (await as(ctxOf('owner'), 'SELECT customer.erasure_queue(NULL,100,NULL) AS r'))
      .r as { id: string; principalId: string }[];
    const requestId = queue.find((item) => item.principalId === ids.bob)!.id;
    await as(ctxOf('owner'), 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      requestId,
      'received',
      'in_progress',
      null,
    ]);
    await as(ctxOf('owner'), 'SELECT customer.programme_words_remove($1,$2) AS r', [
      randomUUID(),
      requestId,
    ]);
    const bob = (await staff.list(ctxOf('owner'), {})).applications.find(
      (row) => row.id === applicationIds.bob,
    )!;
    expect(bob.displayLabel).not.toContain('bob');
    expect(bob.statement).not.toContain('bob');
    expect(bob).toMatchObject({ status: 'SUBMITTED', programmeTitle: copy().title });
    const stored = (
      await f.owner.query(
        'SELECT display_label,statement FROM customer_private.programme_application WHERE id=$1',
        [applicationIds.bob],
      )
    ).rows[0];
    expect({ displayLabel: bob.displayLabel, statement: bob.statement }).toEqual({
      displayLabel: stored.display_label,
      statement: stored.statement,
    });
  });
});

describe('read only', () => {
  test('reading writes no application, decision, invitation, event, outbox or audit row', async () => {
    const before = await counts();
    for (let n = 0; n < 3; n++) await staff.list(ctxOf('owner'), { pageSize: 2 });
    expect(await counts()).toEqual(before);
  });

  test('the only staff function of the module is the read: no decision, edit or export exists', async () => {
    const names = (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text AS n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
         WHERE s.nspname IN ('customer','customer_private') AND p.proname ILIKE '%staff%' AND p.proname ILIKE '%application%'
         ORDER BY 1`,
      )
    ).rows.map((row) => row.n);
    expect(names.sort()).toEqual([
      'customer.staff_programme_applications(uuid,integer)',
      'customer_private.staff_application_actor()',
    ]);
  });

  test('a staff session cannot decide an application through the organiser function', async () => {
    await expect(
      as(ctxOf('owner'), 'SELECT customer.programme_application_command($1,$2,$3) AS r', [
        randomUUID(),
        'decide',
        JSON.stringify(decide(applicationIds.erin!, 'DECLINED')),
      ]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|22023|23514)$/) });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.programme_application_decision WHERE application_id=$1',
          [applicationIds.erin],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});

describe('applications made before staff could read', () => {
  test('are never returned to staff, in any page, count or cursor, while the organiser still reads them', async () => {
    const organiser = (await pages('alice').applications({
      workspaceId,
      programmeId,
    })) as { applications: { id: string }[] };
    expect(organiser.applications.map((row) => row.id)).toContain(applicationIds.frank);
    const everything = await staff.list(ctxOf('owner'), {});
    expect(everything.total).toBe(4);
    expect(everything.applications.map((row) => row.id)).not.toContain(applicationIds.frank);
    expect(JSON.stringify(everything)).not.toContain('frank');
    for (const size of [1, 2, 3]) {
      const seen: string[] = [];
      let after: string | undefined;
      for (let n = 0; n < 6; n++) {
        const page = await staff.list(ctxOf('owner'), {
          pageSize: size,
          ...(after ? { after } : {}),
        });
        seen.push(...page.applications.map((row) => row.id));
        if (!page.nextAfter) break;
        after = page.nextAfter;
      }
      expect(seen).not.toContain(applicationIds.frank);
      expect(seen).toHaveLength(4);
    }
    await expect(staff.list(ctxOf('owner'), { after: applicationIds.frank })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  test('the stored moment is one row nobody can change or read through the runtime role', async () => {
    const moments = (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_application_staff_reading',
      )
    ).rows[0].n;
    expect(moments).toBe(1);
    await expect(
      f.owner.query(
        "UPDATE customer_private.programme_application_staff_reading SET effective_from='2000-01-01'",
      ),
    ).rejects.toMatchObject({ message: 'Immutable record; append a new record' });
    await expect(
      f.owner.query('DELETE FROM customer_private.programme_application_staff_reading'),
    ).rejects.toMatchObject({ message: 'Immutable record; append a new record' });
    await expect(
      f.owner.query(
        'INSERT INTO customer_private.programme_application_staff_reading(only_row) VALUES(false)',
      ),
    ).rejects.toBeTruthy();
    await expect(
      f.runtime.query('SELECT * FROM customer_private.programme_application_staff_reading'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
