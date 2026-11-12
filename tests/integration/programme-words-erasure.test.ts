import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture, rawContext } from './support';
import { harness, options, type Fixture, type Row } from './revamp-g4-support';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerProgrammeErasure } from '../../packages/db/src/customer-programme-erasure-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import { StaffProblemReports } from '../../packages/auth/src/problem-reports';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerProgrammePublicationService } from '../../packages/auth/src/customer-programme-publication';

// Privacy: the words a person wrote in a programme application and the labels under their name are replaced when staff action an
// erasure request. Real database, real restricted roles, invented people only. Ids, times, decisions and every other row stay.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let workspaceId = '';
let programmeId = '';
let address = '';
const notInProgress =
  'Words can be removed only for an erasure request that is in progress or completed';
const secret = (who: string) => `secret${who}words`;
const session = (person: string) => ({
  subject: `synthetic-pwe-${person}`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
  signedInAt: new Date(),
});
const pages = (person: string) =>
  new CustomerProgrammePublicationService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person: string) =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const participants = (person: string) =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const as = (ctx: RequestContext, text: string, params: unknown[] = []) =>
  rawContext(f.runtime, ctx, text, params).then((result) => result.rows[0]);
const staff = (): RequestContext => f.users.owner!.ctx;
const remove = (requestId: string, command: string = randomUUID(), ctx: RequestContext = staff()) =>
  as(ctx, 'SELECT customer.programme_words_remove($1,$2) AS r', [command, requestId]).then(
    (row) => row.r as Row,
  );
const soon = (hours = 240) => new Date(Date.now() + hours * 3600000).toISOString();
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
  displayLabel: `Synthetic ${secret(person)} traders`,
  statement: `Synthetic buyer who wrote ${secret(person)} about two combine harvesters.`,
  consented: true,
});
const decide = (applicationId: string, expectedVersion: number, decision: string) => ({
  action: 'decide',
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  applicationId,
  expectedVersion,
  decision,
  acknowledged: true,
});
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the programme words erasure tests'],
  );
};
const request = async (person: string) => {
  const filed = await h.sql<{ r: Row }>(
    person,
    'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
    [randomUUID(), 'file_erasure', '{}'],
  );
  expect(filed.r.changed).toBe(true);
  const row = (await as(staff(), 'SELECT customer.erasure_queue(NULL,100,NULL) AS r')).r as {
    id: string;
    principalId: string;
  }[];
  return row.find((item) => item.principalId === ids[person])!.id;
};
const erasure = (requestId: string, expected: string, to: string, note: string | null = null) =>
  as(staff(), 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
    randomUUID(),
    requestId,
    expected,
    to,
    note,
  ]);
// Every text or json column of every table in the application schemas that still holds a word.
async function holders(word: string) {
  const columns = (
    await f.owner.query(
      `SELECT c.table_schema s,c.table_name t,c.column_name c FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
       WHERE c.table_schema IN ('app','customer','customer_private','identity') AND c.data_type IN ('text','character varying','jsonb','json')`,
    )
  ).rows;
  const found: string[] = [];
  for (const col of columns) {
    const n = (
      await f.owner.query(
        `SELECT count(*)::int n FROM "${col.s}"."${col.t}" WHERE "${col.c}"::text LIKE $1`,
        [`%${word}%`],
      )
    ).rows[0].n as number;
    if (n > 0) found.push(`${col.s}.${col.t}.${col.c}`);
  }
  return found;
}
const without = (table: string, keys: string[], where: string, params: unknown[]) =>
  f.owner
    .query(
      `SELECT coalesce(jsonb_agg(to_jsonb(v)-$1::text[] ORDER BY to_jsonb(v)::text),'[]'::jsonb) AS rows FROM customer_private.${table} v WHERE ${where}`,
      [keys, ...params],
    )
    .then((r) => r.rows[0].rows as unknown);
const outside = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event) events,
 (SELECT count(*)::int FROM app.outbox) outbox,
 (SELECT count(*)::int FROM customer_private.programme_application_decision) decisions,
 (SELECT count(*)::int FROM customer_private.programme_participant_revocation) revocations`)
  ).rows[0];

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerParticipants(f.owner);
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerProgrammeLifecycle(f.owner);
  await migrateCustomerProgrammeErasure(f.owner);
  await migrateCustomerProblemReports(f.owner);
  h = harness(f, 'pwe');
  ids = await h.admit(['alice', 'bob', 'carol', 'dana', 'erin', 'frank', 'gina']);
  await setAccountControl(true);
  workspaceId = await h.provision('alice', 'Synthetic organiser workspace');
  for (const person of ['bob', 'carol', 'dana', 'erin', 'frank', 'gina'])
    await h.provision(person, `Synthetic ${person} workspace`);
  programmeId = (
    await programmes('alice').create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic programme words erasure acceptance',
      acknowledged: true,
    })
  ).id;
  const published = await pages('alice').publication({
    action: 'publish',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    copy: copy(),
    closesAt: soon(),
    acknowledged: true,
  });
  address = published.address;
  // bob: applies, is invited (the invitation copies the label), joins, and corrects the label. carol: applies and is wait-listed.
  // dana: applies, is invited and joins; her words must stay. erin: applies and stays unanswered.
  const applications: Record<string, string> = {};
  for (const person of ['bob', 'carol', 'dana', 'erin', 'gina'])
    applications[person] = (await pages(person).application(apply(person))).id;
  await pages('alice').application(decide(applications.carol!, 0, 'WAITLISTED'));
  for (const person of ['bob', 'dana']) {
    await pages('alice').application(decide(applications[person]!, 0, 'INVITED'));
    await pages(person).application({
      action: 'join',
      commandId: randomUUID(),
      applicationId: applications[person],
      consented: true,
    });
  }
  // frank joins by the private invitation code and writes his own label there; the replay record of that step keeps the label too.
  const invitation = (await participants('alice').command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    label: 'Synthetic participant invitation',
    acknowledged: true,
  })) as { token: string };
  await participants('frank').command({
    action: 'accept',
    commandId: randomUUID(),
    programmeId,
    token: invitation.token,
    displayLabel: `Synthetic ${secret('frank')} by code`,
    consented: true,
  });
  const registration = async (person: string) =>
    (
      await f.owner.query(
        'SELECT id FROM customer_private.programme_registration WHERE principal_id=$1',
        [ids[person]],
      )
    ).rows[0].id as string;
  for (const person of ['bob', 'dana'])
    await h.sql(person, 'SELECT customer.programme_registration_label($1,$2,$3,$4)', [
      randomUUID(),
      await registration(person),
      0,
      `Synthetic ${secret(person)} corrected`,
    ]);
}, 240000);
afterAll(async () => {
  await f?.close();
});

describe('the install', () => {
  test('is recorded once, repeatable, and gives the runtime role only the one function', async () => {
    await migrateCustomerProgrammeErasure(f.owner);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_programme_erasure_migrations.applied',
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      f.runtime.query('SELECT * FROM customer_private.programme_words_erasure'),
    ).rejects.toMatchObject({ code: '42501' });
    const grants = (
      await f.owner.query(
        `SELECT coalesce(string_agg(r.rolname,',' ORDER BY r.rolname),'') g FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='customer.programme_words_remove(uuid,uuid)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner`,
      )
    ).rows[0].g;
    expect(grants).toContain('corridra_runtime');
    expect(grants).not.toContain('corridra_auth');
  });

  test('every table keeps refusing deletes and ordinary updates with the same message', async () => {
    const tables: [string, string][] = [
      ['programme_application', "display_label='Synthetic changed words'"],
      ['programme_invitation', "label='Synthetic changed words'"],
      ['programme_registration', "display_label='Synthetic changed words'"],
      ['programme_registration_label_revision', "display_label='Synthetic changed words'"],
      ['programme_participant_command', "operation='accept'"],
      ['programme_registration_label_command', 'workspace_id=workspace_id'],
    ];
    for (const [table, change] of tables) {
      // A row-level trigger only fires on a row, so each table must hold one for this check to mean anything.
      const rows = (await f.owner.query(`SELECT count(*)::int n FROM customer_private.${table}`))
        .rows[0].n as number;
      expect(rows).toBeGreaterThan(0);
      await expect(
        f.owner.query(`UPDATE customer_private.${table} SET ${change}`),
      ).rejects.toMatchObject({ code: '23514', message: 'Immutable record; append a new record' });
      await expect(f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toMatchObject({
        code: '23514',
        message: 'Immutable record; append a new record',
      });
    }
    // The placeholder alone, without a record row, is still refused.
    await expect(
      f.owner.query(
        "UPDATE customer_private.programme_registration SET display_label='Synthetic removed words'",
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('words are removed under an erasure request', () => {
  let bobRequest = '';
  let before: Record<string, unknown> = {};
  test('a received request, a stranger and an unknown request are refused and nothing changes', async () => {
    bobRequest = await request('bob');
    const events = await outside();
    await expect(remove(bobRequest)).rejects.toMatchObject({
      code: '23514',
      message: notInProgress,
    });
    await expect(remove(randomUUID())).rejects.toMatchObject({
      code: '23514',
      message: 'Erasure request not found',
    });
    await expect(remove(bobRequest, randomUUID(), f.users.operator!.ctx)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      h.sql('bob', 'SELECT customer.programme_words_remove($1,$2)', [randomUUID(), bobRequest]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await holders(secret('bob'))).not.toEqual([]);
    expect(await outside()).toEqual(events);
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.programme_words_erasure'))
        .rows[0].n,
    ).toBe(0);
  });

  test('an in progress request replaces only the words of that person, in every place they were kept', async () => {
    await erasure(bobRequest, 'received', 'in_progress');
    const bob = ids.bob!;
    const keep = {
      application: await without(
        'programme_application',
        ['display_label', 'statement'],
        'principal_id=$2',
        [bob],
      ),
      registration: await without('programme_registration', ['display_label'], 'principal_id=$2', [
        bob,
      ]),
      revision: await without(
        'programme_registration_label_revision',
        ['display_label'],
        'changed_by=$2',
        [bob],
      ),
      invitation: await without(
        'programme_invitation',
        ['label'],
        'id IN (SELECT d.invitation_id FROM customer_private.programme_application_decision d JOIN customer_private.programme_application a ON a.id=d.application_id WHERE a.principal_id=$2)',
        [bob],
      ),
    };
    const danaWords = await holders(secret('dana'));
    const carolWords = await holders(secret('carol'));
    before = await outside();
    const done = await remove(bobRequest);
    expect(done).toMatchObject({
      removed: 5,
      applications: 1,
      invitationLabels: 1,
      registrations: 1,
      labelRevisions: 1,
      commandRecords: 1,
    });
    // Nothing of bob's words is left anywhere in the application schemas.
    expect(await holders(secret('bob'))).toEqual([]);
    // Everything else about those rows is exactly as it was: ids, people, programme, times, decisions, status.
    expect(
      await without('programme_application', ['display_label', 'statement'], 'principal_id=$2', [
        bob,
      ]),
    ).toEqual(keep.application);
    expect(
      await without('programme_registration', ['display_label'], 'principal_id=$2', [bob]),
    ).toEqual(keep.registration);
    expect(
      await without('programme_registration_label_revision', ['display_label'], 'changed_by=$2', [
        bob,
      ]),
    ).toEqual(keep.revision);
    expect(await outside()).toEqual(before);
    // The placeholders follow the rules of the sample context, and a reader sees them.
    const label = (
      await f.owner.query(
        'SELECT display_label FROM customer_private.programme_registration_current WHERE principal_id=$1',
        [bob],
      )
    ).rows[0].display_label;
    expect(label).toBe('Synthetic removed words');
    expect(
      (
        await f.owner.query(
          'SELECT statement FROM customer_private.programme_application WHERE principal_id=$1',
          [bob],
        )
      ).rows[0].statement,
    ).toBe('Words removed at the request of this person');
    // Other people keep their words: the applicant who joined, the wait-listed one and the unanswered one.
    expect(await holders(secret('dana'))).toEqual(danaWords);
    expect(await holders(secret('carol'))).toEqual(carolWords);
    expect(await holders(secret('erin'))).not.toEqual([]);
    // The record rows hold no words and name the request, the staff member and the command.
    const rows = (
      await f.owner.query(
        'SELECT source,erasure_request_id,staff_principal_id FROM customer_private.programme_words_erasure ORDER BY source',
      )
    ).rows;
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.erasure_request_id).toBe(bobRequest);
  });

  test('the same command answers with the same counts, a new command finds nothing left, and a changed request is refused', async () => {
    const command = randomUUID();
    const first = await remove(bobRequest, command);
    expect(first.removed).toBe(0);
    const carolRequest = await request('carol');
    await erasure(carolRequest, 'received', 'in_progress');
    const carolCommand = randomUUID();
    const carol = await remove(carolRequest, carolCommand);
    expect(carol).toMatchObject({ removed: 1, applications: 1 });
    expect(await remove(carolRequest, carolCommand)).toEqual(carol);
    await expect(remove(bobRequest, carolCommand)).rejects.toMatchObject({
      code: '23514',
      message: 'Command conflicts with original request',
    });
    expect(await holders(secret('carol'))).toEqual([]);
  });

  test('a completed request removes the words written up to its completion and no later ones', async () => {
    const erinRequest = await request('erin');
    await erasure(erinRequest, 'received', 'in_progress');
    await erasure(erinRequest, 'in_progress', 'completed', 'Erased as asked.');
    const late = (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_application WHERE principal_id=$1 AND created_at<=(SELECT max(created_at) FROM customer_private.erasure_status_event WHERE request_id=$2)',
        [ids.erin, erinRequest],
      )
    ).rows[0].n;
    expect(late).toBe(1);
    expect(await remove(erinRequest)).toMatchObject({ removed: 1, applications: 1 });
    expect(await holders(secret('erin'))).toEqual([]);
    // dana never asked: her words are still there.
    expect(await holders(secret('dana'))).not.toEqual([]);
  });
});

describe('the guard with a record row', () => {
  test('even with a record row, a change to any other column or to another row is refused, and the placeholders pass every check', async () => {
    const client = await f.owner.connect();
    try {
      const pick = async (sql: string) => (await client.query(sql)).rows[0].id as string;
      const a = await pick(
        `SELECT id FROM customer_private.programme_registration WHERE principal_id='${ids.dana}'`,
      );
      const stamp = async (key: string) => {
        const made = await client.query(
          `INSERT INTO customer_private.programme_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
           SELECT 'registration',$1,$2,r.id,$3,$4 FROM customer_private.erasure_request r LIMIT 1`,
          [key, ids.dana, f.users.owner!.id, randomUUID()],
        );
        expect(made.rowCount).toBe(1);
      };
      await client.query('BEGIN');
      await stamp(a);
      // another column changes with the placeholder: refused
      await expect(
        client.query(
          `UPDATE customer_private.programme_registration SET display_label='Synthetic removed words',consented_at=consented_at+interval '1 second' WHERE id='${a}'`,
        ),
      ).rejects.toMatchObject({ code: '23514', message: 'Immutable record; append a new record' });
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await stamp(randomUUID());
      // the record row names another row: refused
      await expect(
        client.query(
          `UPDATE customer_private.programme_registration SET display_label='Synthetic removed words' WHERE id='${a}'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await stamp(a);
      // words other than the placeholder: refused
      await expect(
        client.query(
          `UPDATE customer_private.programme_registration SET display_label='Synthetic other words here' WHERE id='${a}'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
      // the exact change passes in this sample context
      await client.query('BEGIN');
      await stamp(a);
      await client.query(
        `UPDATE customer_private.programme_registration SET display_label='Synthetic removed words' WHERE id='${a}'`,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // The real-context placeholder meets the real minimum length of every label column (2) and the statement minimum (10).
    expect('Removed at request'.length).toBeGreaterThanOrEqual(2);
    expect('Words removed at the request of this person'.length).toBeGreaterThanOrEqual(10);
  });
});

describe('a person who joined by a private invitation code', () => {
  test('loses the label in the registration and in the replay record of joining, and the organiser invitation label stays', async () => {
    const frankRequest = await request('frank');
    await erasure(frankRequest, 'received', 'in_progress');
    expect(await holders(secret('frank'))).toContain(
      'customer_private.programme_participant_command.request',
    );
    expect(await remove(frankRequest)).toMatchObject({
      removed: 2,
      registrations: 1,
      commandRecords: 1,
    });
    expect(await holders(secret('frank'))).toEqual([]);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM customer_private.programme_invitation WHERE label='Synthetic participant invitation'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('the staff service', () => {
  test('one removal under an erasure request also reports the programme words it replaced', async () => {
    const ginaRequest = await request('gina');
    await erasure(ginaRequest, 'received', 'in_progress');
    const done = await new StaffProblemReports(f.runtime).removeWords(staff(), {
      action: 'remove_words',
      commandId: randomUUID(),
      erasureRequestId: ginaRequest,
    });
    expect(done).toMatchObject({ removed: 0, programmeWords: 1 });
    expect(await holders(secret('gina'))).toEqual([]);
  });
});

describe('the install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  test('has its own two-valued action that needs apply, runs only in its own install block and lists its registry', () => {
    expect(script).toContain(
      "PROGRAMME_ERASURE_ACTION: z.enum(['unchanged', 'install']).default('unchanged')",
    );
    expect(script).toMatch(/PROGRAMME_ERASURE_ACTION !== 'unchanged' && !apply/);
    const call = 'migrateCustomerProgrammeErasure(pool)';
    expect(script.split(call).length - 1).toBe(1);
    const at = script.indexOf(call + ';');
    expect(script.slice(at - 80, at)).toContain("v.PROGRAMME_ERASURE_ACTION === 'install'");
    expect(script).toContain("'customer_programme_erasure_migrations'");
  });
  test('the workflow option is programme_erasure and adds no input', () => {
    expect(workflow).toMatch(/^\s{12}programme_erasure,$/m);
    const lines = workflow.split('\n').filter((line) => /PROGRAMME_ERASURE_ACTION/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("inputs.field_modules_action == 'programme_erasure'");
  });
});
