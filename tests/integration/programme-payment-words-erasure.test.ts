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
import { CustomerProgrammeTermsService } from '../../packages/auth/src/customer-programme-terms';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';

// Privacy: the payer reference and note a person typed into a programme payment declaration (real-use 0016) are replaced when staff
// action an erasure request (programme erasure module 0002). Real database, real restricted roles, invented people only. Amounts,
// dates, decisions and ledger rows stay. Every test owns its person, so the tests do not depend on their order.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let workspaceId = '';
let stampRequest = '';
let programmeId = '';
const registrations: Record<string, string> = {};
const declarations: Record<string, string[]> = {};
const people = ['alice', 'hana', 'ivan', 'jade', 'kate'];
const refusedState =
  'Words can be removed only for an erasure request that is in progress or completed';
const word = (who: string) => `payword${who}`;
const session = (person: string) => ({
  subject: `synthetic-ppw-${person}`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
  signedInAt: new Date(),
});
const programmes = (person: string) =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const participants = (person: string) =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const terms = (person: string) =>
  new CustomerProgrammeTermsService(f.runtime, f.auth, options, async () => session(person));
const ledger = (person: string) =>
  new CustomerProgrammeEconomicsService(f.runtime, f.auth, options, async () => session(person));
const as = (ctx: RequestContext, text: string, params: unknown[] = []) =>
  rawContext(f.runtime, ctx, text, params).then((result) => result.rows[0]);
const staff = (): RequestContext => f.users.owner!.ctx;
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const removePayments = (
  requestId: string,
  command: string = randomUUID(),
  ctx: RequestContext = staff(),
) =>
  as(ctx, 'SELECT customer.programme_payment_words_remove($1,$2) AS r', [command, requestId]).then(
    (row) => row.r as Row,
  );
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the payment words erasure tests'],
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
async function holders(text: string) {
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
        [`%${text}%`],
      )
    ).rows[0].n as number;
    if (n > 0) found.push(`${col.s}.${col.t}.${col.c}`);
  }
  return found.sort();
}
const outside = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event) events,
 (SELECT count(*)::int FROM app.outbox) outbox,
 (SELECT count(*)::int FROM app.audit_event) audit`)
  ).rows[0];
// Everything of one person's declarations except the two word columns, plus decisions, ledger rows and command rows without the request.
const money = (person: string) =>
  f.owner
    .query(
      `SELECT
 (SELECT coalesce(jsonb_agg(to_jsonb(d)-ARRAY['payer_reference','note'] ORDER BY d.id),'[]'::jsonb) FROM customer_private.programme_payment_declaration d WHERE d.declared_by=$1) declarations,
 (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.declaration_id),'[]'::jsonb) FROM customer_private.programme_payment_decision x
   WHERE x.declaration_id IN (SELECT id FROM customer_private.programme_payment_declaration WHERE declared_by=$1)) decisions,
 (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) FROM customer_private.programme_ledger_entry l
   WHERE l.registration_id IN (SELECT registration_id FROM customer_private.programme_payment_declaration WHERE declared_by=$1)) ledger,
 (SELECT coalesce(jsonb_agg(to_jsonb(c)-'request' ORDER BY c.command_id),'[]'::jsonb) FROM customer_private.programme_payment_command c WHERE c.actor_id=$1) commands`,
      [ids[person]],
    )
    .then((r) => r.rows[0] as Record<string, unknown>);

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
  h = harness(f, 'ppw');
  ids = await h.admit([...people, 'mona']);
  await setAccountControl(true);
  workspaceId = await h.provision('alice', 'Synthetic organiser workspace');
  for (const person of [...people.slice(1), 'mona'])
    await h.provision(person, `Synthetic ${person} workspace`);
  // mona has no payments; her request only gives the guard test a record row to point at.
  stampRequest = await request('mona');
  programmeId = (
    await programmes('alice').create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic organiser programme',
      reportingPurpose: 'Synthetic payment words erasure acceptance',
      acknowledged: true,
    })
  ).id;
  await terms('alice').publishTerms({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    included: 'Synthetic ground transport and hotel nights',
    excluded: null,
    cancellationTerms: 'Synthetic cancel up to fourteen days before',
    changeTerms: 'Synthetic agenda may change with notice',
    feesApply: true,
    feeNote: null,
    reason: 'Synthetic first version of the terms',
  });
  // Each person joins by code, the organiser records a fee, and the person declares a payment with free text of their own.
  // hana declares twice (the second has no note) and the organiser rejects the second with words of their own. ivan's declaration is
  // acknowledged. jade and kate declare once.
  for (const person of people.slice(1)) {
    const code = (await participants('alice').command({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      label: `Synthetic invitation for ${person}`,
      acknowledged: true,
    })) as { token: string };
    const joined = (await participants(person).command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId,
      token: code.token,
      displayLabel: `Synthetic participant ${person}`,
      consented: true,
    })) as { id: string };
    registrations[person] = joined.id;
    await ledger('alice').record({
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      entry: {
        kind: 'PARTICIPANT_FEE',
        costBasis: null,
        registrationId: joined.id,
        amountMinor: '120000',
        currency: 'BDT',
        occurredOn: day(-5),
        description: 'Synthetic fee recorded by the organiser',
      },
      acknowledged: true,
    });
    const declare = async (note: string | null) =>
      (
        (await ledger(person).declarePayment({
          commandId: randomUUID(),
          registrationId: joined.id,
          currency: 'BDT',
          amountMinor: '40000',
          paidOn: day(-1),
          payerReference: `Synthetic ${word(person)} transfer 8841`,
          note: note === null ? null : `Synthetic ${word(person)} ${note}`,
        })) as { declaration: { id: string } }
      ).declaration.id;
    declarations[person] = [await declare('note about the bank transfer')];
    if (person === 'hana') declarations[person]!.push(await declare(null));
  }
  const decide = (declarationId: string, decision: string, reason: string | null) =>
    ledger('alice').decidePayment({
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      declarationId,
      decision,
      reason,
      receivedAmountMinor: null,
      receivedOn: null,
    });
  await decide(declarations.ivan![0]!, 'ACKNOWLEDGED', null);
  await decide(
    declarations.hana![1]!,
    'REJECTED',
    'Synthetic organiser reason stays after erasure',
  );
  await decide(declarations.hana![0]!, 'ACKNOWLEDGED', null);
}, 240000);
afterAll(async () => {
  await f?.close();
});

describe('the install', () => {
  test('is recorded, gives the runtime role only the one function and keeps the table closed', async () => {
    await migrateCustomerProgrammeErasure(f.owner);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM customer_programme_erasure_migrations.applied WHERE name LIKE '0002%'",
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      f.runtime.query('SELECT * FROM customer_private.programme_payment_words_erasure'),
    ).rejects.toMatchObject({ code: '42501' });
    const grants = (
      await f.owner.query(
        `SELECT coalesce(string_agg(r.rolname,',' ORDER BY r.rolname),'') g FROM pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='customer.programme_payment_words_remove(uuid,uuid)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner`,
      )
    ).rows[0].g;
    expect(grants).toContain('corridra_runtime');
    expect(grants).not.toContain('corridra_auth');
  });

  test('without the payment declaration module the file only raises a notice, and a second run on an installed module refuses', async () => {
    const sql = readFileSync(
      resolve(
        'packages/db/customer-programme-erasure-migrations/0002_programme_payment_words_erasure.sql',
      ),
      'utf8',
    );
    const client = await f.owner.connect();
    try {
      const notices: string[] = [];
      client.on('notice', (n: { message?: string }) => notices.push(n.message ?? ''));
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE customer_private.programme_payment_command RENAME TO programme_payment_command_away',
      );
      await client.query(sql);
      expect(notices.join(' ')).toContain('Programme payment words erasure skipped');
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await expect(client.query(sql)).rejects.toMatchObject({
        message: expect.stringContaining('Programme payment words erasure prerequisite differs'),
      });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});

describe('the guard', () => {
  test('both tables keep refusing deletes and every update with the same message, placeholders without a record row included', async () => {
    const refused = { code: '23514', message: 'Immutable record; append a new record' };
    for (const sql of [
      "UPDATE customer_private.programme_payment_declaration SET payer_reference='Synthetic changed words'",
      "UPDATE customer_private.programme_payment_declaration SET payer_reference='Synthetic removed words' WHERE payer_reference IS NOT NULL",
      'UPDATE customer_private.programme_payment_declaration SET amount_minor=amount_minor+1',
      'DELETE FROM customer_private.programme_payment_declaration',
      "UPDATE customer_private.programme_payment_command SET request=jsonb_set(request,'{payload,note}','\"Synthetic removed words\"') WHERE request->'payload'->>'note' IS NOT NULL",
      "UPDATE customer_private.programme_payment_command SET action='DECIDE'",
      'DELETE FROM customer_private.programme_payment_command',
    ])
      await expect(f.owner.query(sql)).rejects.toMatchObject(refused);
  });

  test('with a record row only the exact placeholder change passes, and nothing else on the row', async () => {
    const client = await f.owner.connect();
    try {
      const declaration = declarations.ivan![0]!;
      const stamp = async (key: string) =>
        client.query(
          `INSERT INTO customer_private.programme_payment_words_erasure(source,row_key,principal_id,erasure_request_id,staff_principal_id,command_id)
           VALUES('declaration',$1,$2,$5,$3,$4)`,
          [key, ids.ivan, f.users.owner!.id, randomUUID(), stampRequest],
        );
      const attempt = async (key: string, change: string, ok: boolean) => {
        await client.query('BEGIN');
        try {
          const made = await stamp(key);
          expect(made.rowCount).toBe(1);
          const run = client.query(
            `UPDATE customer_private.programme_payment_declaration SET ${change} WHERE id='${declaration}'`,
          );
          if (ok) await run;
          else await expect(run).rejects.toMatchObject({ code: '23514' });
        } finally {
          await client.query('ROLLBACK');
        }
      };
      const both = "payer_reference='Synthetic removed words',note='Synthetic removed words'";
      await attempt(declaration, both, true);
      await attempt(randomUUID(), both, false);
      await attempt(
        declaration,
        "payer_reference='Synthetic other words here',note='Synthetic removed words'",
        false,
      );
      await attempt(declaration, `${both},amount_minor=amount_minor+1`, false);
      await attempt(declaration, `${both},paid_on=paid_on-1`, false);
      await attempt(declaration, "payer_reference=NULL,note='Synthetic removed words'", false);
    } finally {
      client.release();
    }
    // The non-sample placeholder meets the real-context minimum length of payer_reference and note (2).
    expect('Removed at request'.length).toBeGreaterThanOrEqual(2);
  });
});

describe('removal under an erasure request', () => {
  test('a received request, a stranger and an unknown request are refused and nothing changes', async () => {
    const kateRequest = await request('kate');
    const before = await holders(word('kate'));
    expect(before).not.toEqual([]);
    const events = await outside();
    await expect(removePayments(kateRequest)).rejects.toMatchObject({
      code: '23514',
      message: refusedState,
    });
    await expect(removePayments(randomUUID())).rejects.toMatchObject({
      code: '23514',
      message: 'Erasure request not found',
    });
    await expect(
      removePayments(kateRequest, randomUUID(), f.users.operator!.ctx),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.sql('kate', 'SELECT customer.programme_payment_words_remove($1,$2)', [
        randomUUID(),
        kateRequest,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await holders(word('kate'))).toEqual(before);
    expect(await outside()).toEqual(events);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.programme_payment_words_erasure WHERE erasure_request_id=$1',
          [kateRequest],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test("replaces only that person's payer reference and note, in the row and in the replay record, and nothing else", async () => {
    const hanaRequest = await request('hana');
    await erasure(hanaRequest, 'received', 'in_progress');
    const keep = await money('hana');
    const ivanWords = await holders(word('ivan'));
    expect(ivanWords).not.toEqual([]);
    const events = await outside();
    const command = randomUUID();
    const done = await removePayments(hanaRequest, command);
    expect(done).toMatchObject({ removed: 4, declarations: 2, commandRecords: 2 });
    expect(await holders(word('hana'))).toEqual([]);
    expect(await money('hana')).toEqual(keep);
    expect(await outside()).toEqual(events);
    // The placeholder follows the sample context; a field that was empty stays empty.
    const rows = (
      await f.owner.query(
        'SELECT payer_reference,note FROM customer_private.programme_payment_declaration WHERE declared_by=$1 ORDER BY declared_at',
        [ids.hana],
      )
    ).rows;
    expect(rows).toEqual([
      { payer_reference: 'Synthetic removed words', note: 'Synthetic removed words' },
      { payer_reference: 'Synthetic removed words', note: null },
    ]);
    const requests = (
      await f.owner.query(
        "SELECT request->'payload' p FROM customer_private.programme_payment_command WHERE actor_id=$1 AND action='DECLARE' ORDER BY created_at",
        [ids.hana],
      )
    ).rows.map((r) => r.p);
    expect(requests[0]).toMatchObject({
      payerReference: 'Synthetic removed words',
      note: 'Synthetic removed words',
    });
    expect(requests[1]).toMatchObject({ payerReference: 'Synthetic removed words', note: null });
    // The organiser's own words (the rejection reason) and everyone else's words stay.
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM customer_private.programme_payment_decision WHERE reason='Synthetic organiser reason stays after erasure'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await holders(word('ivan'))).toEqual(ivanWords);
    // The same command answers with the same counts; a new command finds nothing left; a changed request is refused.
    expect(await removePayments(hanaRequest, command)).toEqual(done);
    expect(await removePayments(hanaRequest)).toMatchObject({ removed: 0 });
    await expect(removePayments(randomUUID(), command)).rejects.toMatchObject({ code: '23514' });
    const recorded = await f.owner.query(
      'SELECT erasure_request_id FROM customer_private.programme_payment_words_erasure WHERE erasure_request_id=$1',
      [hanaRequest],
    );
    expect(recorded.rows).toHaveLength(4);
  });

  test('one removal through the staff service reports both counts in the same step and is safe to repeat', async () => {
    const jadeRequest = await request('jade');
    await erasure(jadeRequest, 'received', 'in_progress');
    const input = {
      action: 'remove_words',
      commandId: randomUUID(),
      erasureRequestId: jadeRequest,
    };
    const service = new StaffProblemReports(f.runtime);
    const done = await service.removeWords(staff(), input);
    expect(done).toMatchObject({ removed: 0, paymentWords: 2 });
    expect(typeof done.programmeWords).toBe('number');
    expect(await service.removeWords(staff(), input)).toEqual(done);
    expect(await holders(word('jade'))).toEqual([]);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.programme_payment_words_erasure WHERE command_id=$1',
          [input.commandId],
        )
      ).rows[0].n,
    ).toBe(2);
  });
});
