import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, type Fixture, type Row } from './revamp-g4-support';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerPersonalProfiles } from '../../packages/db/src/customer-personal-profile-migrate';

// ADR-086, real database, real restricted roles, invented people only: optional self-reported personal details, append-only
// with an expected version and command replay, readable only by the person, refused for a closed account or one with an
// erasure request, events with ids only, and a staff-only placeholder for the words under an erasure request.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
const secretTitle = 'Synthetic zebratitle head of sourcing';
const secretInterest = 'quokkainterest machinery';
const stale = 'Profile changed; reload before saving';
const conflict = 'Command conflicts with original request';
const noWorkspace =
  'Personal details need a workspace on this account. Create or join a workspace first.';
const view = (person: string) =>
  h.sql<{ r: Row }>(person, 'SELECT customer.personal_profile_view() AS r').then((row) => row.r);
const save = (
  person: string,
  expected: number,
  details: Record<string, unknown>,
  command = randomUUID(),
) =>
  h
    .sql<{ r: Row }>(person, 'SELECT customer.personal_profile_command($1,$2,$3) AS r', [
      command,
      expected,
      JSON.stringify(details),
    ])
    .then((row) => row.r);
const note = (person: string, kind: string, command = randomUUID()) =>
  h
    .sql<{ r: Row }>(person, 'SELECT customer.account_security_note($1,$2) AS r', [command, kind])
    .then((row) => row.r);
const staffCtx = (): RequestContext => f.users.owner!.ctx;
const staff = (text: string, params: unknown[] = []) =>
  rawContext(f.runtime, staffCtx(), text, params).then((result) => result.rows[0] as Row);
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.personal_profile_revision) revisions,
 (SELECT count(*)::int FROM customer_private.personal_profile_command) commands,
 (SELECT count(*)::int FROM customer_private.account_security_note) notes,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type IN ('customer_personal_profile','customer_account_security')) events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type IN ('customer_personal_profile','customer_account_security')) audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type IN ('customer_personal_profile','customer_account_security')) outbox,
 (SELECT count(*)::int FROM app.outbox_delivery d JOIN app.domain_event e ON e.id=d.event_id WHERE e.aggregate_type IN ('customer_personal_profile','customer_account_security')) deliveries`)
  ).rows[0] as Record<string, number>;
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the personal profile tests'],
  );
};
const fileErasure = async (person: string) => {
  const filed = await h.sql<{ r: Row }>(
    person,
    'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
    [randomUUID(), 'file_erasure', '{}'],
  );
  expect(filed.r.changed).toBe(true);
  const queue = (await staff('SELECT customer.erasure_queue(NULL,100,NULL) AS r')).r as {
    id: string;
    principalId: string;
  }[];
  return queue.find((item) => item.principalId === ids[person])!.id;
};
const definitions = async () =>
  (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) d,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer','customer_private') ORDER BY 1`,
    )
  ).rows;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'ppr');
  ids = await h.admit(['alice', 'bob', 'carol', 'dave', 'erin', 'nina']);
  for (const person of ['alice', 'bob', 'carol', 'dave', 'erin'])
    await h.provision(person, `Synthetic ${person} workspace`);
  await migrateCustomerAccountLifecycle(f.owner);
  await migrateCustomerPersonalProfiles(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('install', () => {
  test('a second install is a no-op', async () => {
    const before = await definitions();
    await migrateCustomerPersonalProfiles(f.owner);
    expect(await definitions()).toEqual(before);
    expect(
      (await f.owner.query('SELECT name FROM customer_personal_profile_migrations.applied')).rows,
    ).toEqual([{ name: '0001_personal_profile.sql' }]);
  });
  test('the runtime role reaches no table and every table has row security', async () => {
    for (const table of [
      'personal_profile_revision',
      'personal_profile_command',
      'account_security_note',
      'personal_profile_erasure',
    ]) {
      await expect(
        h.sql('alice', `SELECT count(*) FROM customer_private.${table}`),
      ).rejects.toMatchObject({ code: '42501' });
      const row = (
        await f.owner.query(
          "SELECT c.relrowsecurity rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_private' AND c.relname=$1",
          [table],
        )
      ).rows[0];
      expect(row.rls).toBe(true);
    }
  });
  test('corridra_runtime may run app.intake_budget', async () => {
    const row = (
      await f.owner.query(
        "SELECT has_function_privilege('corridra_runtime','app.intake_budget(text,integer)','EXECUTE') AS ok",
      )
    ).rows[0];
    expect(row.ok).toBe(true);
  });
});

describe('the person edits their own details', () => {
  test('starts empty, self-reported and unverified, with nothing mandatory', async () => {
    expect(await view('alice')).toEqual({
      currentVersion: 0,
      profile: null,
      provenance: 'SELF_REPORTED',
      verified: false,
    });
    const first = await save('alice', 0, {});
    expect(first).toMatchObject({ currentVersion: 1, superseded: false });
  });
  test('a save appends a revision; a stale expected version is refused and writes nothing', async () => {
    const details = {
      title: 'Synthetic buyer',
      baseCountry: 'BD',
      interests: ['Machinery', 'Knitwear'],
      contactMethod: 'EMAIL',
      initialsPreference: 'NAME_INITIALS',
    };
    const saved = await save('alice', 1, details);
    expect(saved.profile).toMatchObject({ ...details, version: 2 });
    const before = await counts();
    await expect(save('alice', 1, { title: 'Synthetic other' })).rejects.toMatchObject({
      code: '23514',
      message: stale,
    });
    expect(await counts()).toEqual(before);
    expect((await view('alice')).profile).toMatchObject({ ...details, version: 2 });
  });
  test('the same command replays the first answer; a different payload is refused', async () => {
    const command = randomUUID();
    const first = await save('alice', 2, { title: 'Synthetic lead' }, command);
    const before = await counts();
    const again = await save('alice', 2, { title: 'Synthetic lead' }, command);
    expect(again.profile).toEqual(first.profile);
    expect(again.commandId).toBe(command);
    expect(await counts()).toEqual(before);
    await expect(save('alice', 2, { title: 'Synthetic else' }, command)).rejects.toMatchObject({
      code: '23514',
      message: conflict,
    });
    await expect(save('alice', 3, { title: 'Synthetic lead' }, command)).rejects.toMatchObject({
      code: '23514',
      message: conflict,
    });
  });
  test('every bound is enforced', async () => {
    const version = (await view('alice')).currentVersion as number;
    const bad: Record<string, unknown>[] = [
      { title: 'x'.repeat(81) },
      { title: '' },
      { title: ' padded' },
      { title: 'tab\there' },
      { title: 5 },
      { baseCountry: 'XX' },
      { baseCountry: 'bd' },
      { interests: Array.from({ length: 11 }, (_, i) => `word${i}`) },
      { interests: ['Machinery', 'machinery'] },
      { interests: ['a'] },
      { interests: ['x'.repeat(61)] },
      { interests: [' padded'] },
      { interests: 'Machinery' },
      { contactMethod: 'PHONE' },
      { contactMethod: null },
      { initialsPreference: 'FULL' },
      { phone: '+8801700000000' },
      { picture: 'https://example.test/a.png' },
    ];
    for (const details of bad)
      await expect(save('alice', version, details)).rejects.toMatchObject({ code: '23514' });
    expect(
      await save('alice', version, {
        title: 'x'.repeat(80),
        baseCountry: null,
        interests: Array.from({ length: 10 }, (_, i) => `word${i}`),
        contactMethod: 'NO_PREFERENCE',
        initialsPreference: 'NONE',
      }),
    ).toMatchObject({ currentVersion: version + 1 });
  });
  test('history lists versions only, newest first, paged', async () => {
    const page = (
      await h.sql<{ r: Row }>('alice', 'SELECT customer.personal_profile_history(NULL,2) AS r')
    ).r as { revisions: { version: number }[]; nextBefore: number | null };
    expect(page.revisions.map((r) => r.version)).toEqual([4, 3]);
    expect(page.nextBefore).toBe(3);
    expect(JSON.stringify(page)).not.toContain('word0');
  });
});

describe('nobody else', () => {
  test('another principal reads only their own empty details and cannot reuse a command', async () => {
    expect(await view('bob')).toMatchObject({ currentVersion: 0, profile: null });
    const command = randomUUID();
    await save('alice', 4, { title: 'Synthetic shared id' }, command);
    await expect(save('bob', 0, { title: 'Synthetic shared id' }, command)).rejects.toMatchObject({
      code: '23514',
      message: conflict,
    });
    expect(await view('bob')).toMatchObject({ currentVersion: 0, profile: null });
  });
  test('no session is refused', async () => {
    const db = await f.runtime.connect();
    try {
      await expect(db.query('SELECT customer.personal_profile_view()')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      db.release();
    }
  });
  test('a person with no workspace is refused with clear words and nothing is written', async () => {
    expect(await view('nina')).toMatchObject({ currentVersion: 0, profile: null });
    const before = await counts();
    await expect(save('nina', 0, { title: 'Synthetic nobody' })).rejects.toMatchObject({
      code: '23514',
      message: noWorkspace,
    });
    expect(await counts()).toEqual(before);
  });
});

describe('records cannot be rewritten', () => {
  test('UPDATE and DELETE are rejected, even for the schema owner', async () => {
    await note('alice', 'name_changed');
    for (const sql of [
      "UPDATE customer_private.personal_profile_revision SET details='{}'::jsonb",
      'DELETE FROM customer_private.personal_profile_revision',
      "UPDATE customer_private.personal_profile_command SET request='{}'::jsonb",
      'DELETE FROM customer_private.personal_profile_command',
      'DELETE FROM customer_private.account_security_note',
      "UPDATE customer_private.account_security_note SET kind='password_changed'",
    ])
      await expect(f.owner.query(sql)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('events', () => {
  test('one event, audit, outbox and delivery row per save, ids only', async () => {
    const before = await counts();
    const version = (await view('bob')).currentVersion as number;
    await save('bob', version, { title: secretTitle, interests: [secretInterest] });
    const after = await counts();
    expect(after.revisions - before.revisions).toBe(1);
    expect(after.commands - before.commands).toBe(1);
    expect(after.events - before.events).toBe(1);
    expect(after.audits - before.audits).toBe(1);
    expect(after.outbox - before.outbox).toBe(1);
    expect(after.deliveries - before.deliveries).toBe(1);
    const events = (
      await f.owner.query(
        "SELECT type,tenant_id,payload::text p FROM app.domain_event WHERE aggregate_type='customer_personal_profile' AND aggregate_id=$1",
        [ids.bob],
      )
    ).rows;
    expect(events.map((e) => e.type)).toEqual(['customer.personal_profile.revised']);
    const tenant = (
      await f.owner.query(
        'SELECT tenant_id FROM customer_private.account_chain WHERE principal_id=$1',
        [ids.bob],
      )
    ).rows[0].tenant_id;
    expect(events[0].tenant_id).toBe(tenant);
    for (const word of ['zebratitle', 'quokkainterest', 'Synthetic'])
      expect(events[0].p).not.toContain(word);
  });
  test('an account security note is recorded once, replayed by command, and carries a kind only', async () => {
    const before = await counts();
    const command = randomUUID();
    expect(await note('bob', 'name_changed', command)).toMatchObject({ replayed: false });
    expect(await note('bob', 'name_changed', command)).toMatchObject({ replayed: true });
    await expect(note('bob', 'password_changed', command)).rejects.toMatchObject({
      code: '23514',
      message: conflict,
    });
    await expect(note('bob', 'email_changed')).rejects.toMatchObject({ code: '23514' });
    const noted = await h.sql<{ r: boolean }>(
      'bob',
      'SELECT customer.account_security_noted($1) AS r',
      [command],
    );
    expect(noted.r).toBe(true);
    const otherNoted = await h.sql<{ r: boolean }>(
      'alice',
      'SELECT customer.account_security_noted($1) AS r',
      [command],
    );
    expect(otherNoted.r).toBe(false);
    const after = await counts();
    expect(after.notes - before.notes).toBe(1);
    expect(after.events - before.events).toBe(1);
    const payload = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='customer.account_security.changed' AND aggregate_id=$1",
        [ids.bob],
      )
    ).rows[0].payload as Row;
    expect(Object.keys(payload).sort()).toEqual(
      ['initiator_id', 'initiator_kind', 'kind', 'principal_id'].sort(),
    );
  });
});

describe('closed and erasure-pending accounts', () => {
  test('a closed account is refused', async () => {
    await save('carol', 0, { title: 'Synthetic carol' });
    await f.owner.query(
      `INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',clock_timestamp(),clock_timestamp()+interval '720 hours',$2`,
      [ids.carol, randomUUID()],
    );
    await expect(view('carol')).rejects.toMatchObject({ code: '42501' });
    await expect(save('carol', 1, { title: 'Synthetic later' })).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      h.sql('carol', 'SELECT customer.account_security_noted($1)', [randomUUID()]),
    ).rejects.toMatchObject({ code: '42501' });
  });
  test('an account with a filed erasure request is refused', async () => {
    await setAccountControl(true);
    await save('dave', 0, { title: 'Synthetic dave' });
    await fileErasure('dave');
    await expect(view('dave')).rejects.toMatchObject({ code: '42501' });
    await expect(save('dave', 1, { title: 'Synthetic later' })).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('erasure placeholder', () => {
  test('only staff replace the title and interests, under an erasure request in progress', async () => {
    await setAccountControl(true);
    await save('erin', 0, {
      title: 'Synthetic erinsecret title',
      interests: ['erinsecret one', 'Machinery'],
      baseCountry: 'SG',
      contactMethod: 'IN_APP',
    });
    const request = await fileErasure('erin');
    await expect(
      h.sql('erin', 'SELECT customer.personal_profile_remove_words($1,$2)', [
        randomUUID(),
        request,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      staff('SELECT customer.personal_profile_remove_words($1,$2) AS r', [randomUUID(), request]),
    ).rejects.toMatchObject({ code: '23514' });
    await staff('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      request,
      'received',
      'in_progress',
      null,
    ]);
    // A direct change is still refused before staff record the item.
    await expect(
      f.owner.query(
        `UPDATE customer_private.personal_profile_revision SET details=details||'{"title":"Removed at request"}' WHERE principal_id=$1`,
        [ids.erin],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const command = randomUUID();
    const result = await staff('SELECT customer.personal_profile_remove_words($1,$2) AS r', [
      command,
      request,
    ]);
    expect(result.r).toMatchObject({ removed: 2, revisions: 1, commandRecords: 1 });
    const replay = await staff('SELECT customer.personal_profile_remove_words($1,$2) AS r', [
      command,
      request,
    ]);
    expect(replay.r).toEqual(result.r);
    const row = (
      await f.owner.query(
        'SELECT r.details,c.request FROM customer_private.personal_profile_revision r JOIN customer_private.personal_profile_command c ON c.revision_id=r.id WHERE r.principal_id=$1',
        [ids.erin],
      )
    ).rows[0];
    expect(row.details).toEqual({
      title: 'Removed at request',
      interests: [],
      baseCountry: 'SG',
      contactMethod: 'IN_APP',
    });
    expect(row.request.details).toEqual(row.details);
    // Even with a record row, only the placeholder change is allowed.
    await expect(
      f.owner.query(
        `UPDATE customer_private.personal_profile_revision SET details=details||'{"title":"Something else"}' WHERE principal_id=$1`,
        [ids.erin],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.owner.query(
        `UPDATE customer_private.personal_profile_revision SET details=details||'{"baseCountry":"BD"}' WHERE principal_id=$1`,
        [ids.erin],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const left = (
      await f.owner.query(
        `SELECT count(*)::int n FROM customer_private.personal_profile_revision r, customer_private.personal_profile_command c
         WHERE r.details::text LIKE '%erinsecret%' OR c.request::text LIKE '%erinsecret%'`,
      )
    ).rows[0].n;
    expect(left).toBe(0);
  });
});
