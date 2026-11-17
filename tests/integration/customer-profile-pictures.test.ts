import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, type Fixture, type Row } from './revamp-g4-support';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerPersonalProfiles } from '../../packages/db/src/customer-personal-profile-migrate';
import { migrateCustomerProfilePictures } from '../../packages/db/src/customer-profile-picture-migrate';

// ADR-088, real database, real restricted roles, invented people only: a profile picture is a reference to two private
// files, readable only by the person, changed by reserve then commit with an expected version and command replay, removed
// with its files listed for deletion, refused for a closed account or one with an erasure request, events with ids only,
// and erased by staff under an erasure request.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
const store = 'vercel-blob:store_synthetic';
const hex = (text: string) => createHash('sha256').update(text).digest('hex');
const sql = (person: string, text: string, params: unknown[] = []) =>
  h.sql<{ r: Row }>(person, text, params).then((row) => row.r);
const view = (person: string) => sql(person, 'SELECT customer.profile_picture_view() AS r');
const reserve = (person: string, expected: number, command = randomUUID(), request = hex('a')) =>
  sql(person, 'SELECT customer.profile_picture_reserve($1,$2,$3,$4) AS r', [
    command,
    expected,
    request,
    store,
  ]);
const commit = (
  person: string,
  expected: number,
  object: string,
  command: string,
  request = hex('a'),
) =>
  sql(person, 'SELECT customer.profile_picture_commit($1,$2,$3,$4,$5,$6,$7,$8) AS r', [
    command,
    expected,
    request,
    object,
    hex('large' + object),
    2048,
    hex('small' + object),
    512,
  ]);
// A whole new picture: reserve, then commit with the same command.
const setPicture = async (person: string, expected: number, request = hex('a')) => {
  const command = randomUUID();
  const r = await reserve(person, expected, command, request);
  return {
    command,
    object: r.objectId as string,
    result: await commit(person, expected, r.objectId as string, command, request),
  };
};
const remove = (person: string, expected: number, command = randomUUID()) =>
  sql(person, 'SELECT customer.profile_picture_remove($1,$2,$3) AS r', [
    command,
    expected,
    hex('remove'),
  ]);
const staffCtx = (): RequestContext => f.users.owner!.ctx;
const staff = (text: string, params: unknown[] = []) =>
  rawContext(f.runtime, staffCtx(), text, params).then((result) => result.rows[0] as Row);
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the profile picture tests'],
  );
};
const fileErasure = async (person: string) => {
  await sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
    randomUUID(),
    'file_erasure',
    '{}',
  ]);
  const queue = (await staff('SELECT customer.erasure_queue(NULL,100,NULL) AS r')).r as {
    id: string;
    principalId: string;
  }[];
  return queue.find((item) => item.principalId === ids[person])!.id;
};
const objects = async (person: string) =>
  (
    await f.owner.query(
      'SELECT id,state FROM customer_private.profile_picture_object WHERE principal_id=$1 ORDER BY created_at',
      [ids[person]],
    )
  ).rows as { id: string; state: string }[];

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'ppic');
  ids = await h.admit(['alice', 'bob', 'carol', 'dave', 'erin', 'faye', 'nina', 'omar']);
  for (const person of ['alice', 'bob', 'carol', 'dave', 'erin', 'faye', 'omar'])
    await h.provision(person, `Synthetic ${person} workspace`);
  await migrateCustomerAccountLifecycle(f.owner);
  await migrateCustomerPersonalProfiles(f.owner);
  await migrateCustomerProfilePictures(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('install and access', () => {
  test('a second install is a no-op and the runtime role reaches no table', async () => {
    await migrateCustomerProfilePictures(f.owner);
    expect(
      (await f.owner.query('SELECT name FROM customer_profile_picture_migrations.applied')).rows,
    ).toEqual([{ name: '0001_profile_picture.sql' }]);
    for (const table of [
      'profile_picture_object',
      'profile_picture_head',
      'profile_picture_command',
      'profile_picture_erasure',
    ]) {
      await expect(
        h.sql('alice', `SELECT count(*) FROM customer_private.${table}`),
      ).rejects.toMatchObject({ code: '42501' });
      const rls = (
        await f.owner.query(
          "SELECT c.relrowsecurity rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_private' AND c.relname=$1",
          [table],
        )
      ).rows[0].rls;
      expect(rls).toBe(true);
    }
  });
  test('the private helpers are not callable by the runtime role', async () => {
    await expect(
      h.sql('alice', 'SELECT customer_private.profile_picture_shape($1)', [ids.bob]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('set, read, replace and remove', () => {
  test('an empty view, then a picture that only its owner reads', async () => {
    expect(await view('alice')).toEqual({ currentVersion: 0, picture: null });
    const { result, object } = await setPicture('alice', 0);
    expect(result).toMatchObject({ currentVersion: 1, replayed: false, pending: [] });
    expect(result.picture).toMatchObject({ id: object, storageRef: store, largeBytes: 2048 });
    expect((await view('alice')).picture).toMatchObject({ id: object });
    // Another person sees only their own (empty) picture: there is no argument that names someone else.
    expect(await view('bob')).toEqual({ currentVersion: 0, picture: null });
  });
  test('another person cannot commit, purge or overwrite with someone else’s object', async () => {
    const mine = await reserve('carol', 0);
    const command = randomUUID();
    await expect(commit('bob', 0, mine.objectId as string, command)).rejects.toMatchObject({
      code: '23514',
    });
    expect(
      await sql('bob', 'SELECT customer.profile_picture_purged($1::uuid[]) AS r', [
        [mine.objectId],
      ]),
    ).toBe(0);
    const alicePicture = (await view('alice')).picture as { id: string };
    expect(
      await sql('bob', 'SELECT customer.profile_picture_purged($1::uuid[]) AS r', [
        [alicePicture.id],
      ]),
    ).toBe(0);
    expect((await view('alice')).picture).toMatchObject({ id: alicePicture.id });
  });
  test('a replay answers the first result; the same command with another picture is refused', async () => {
    const command = randomUUID();
    const r = await reserve('bob', 0, command, hex('bob'));
    const first = await commit('bob', 0, r.objectId as string, command, hex('bob'));
    const again = await reserve('bob', 0, command, hex('bob'));
    expect(again).toMatchObject({ replayed: true, currentVersion: 1 });
    expect(again.picture).toEqual(first.picture);
    await expect(reserve('bob', 0, command, hex('other'))).rejects.toMatchObject({
      code: '23514',
      message: 'Command conflicts with original request',
    });
    // Another person replaying bob's command is refused too.
    await expect(reserve('alice', 1, command, hex('bob'))).rejects.toMatchObject({
      code: '23514',
    });
  });
  test('a stale version is refused before anything is reserved', async () => {
    const before = (await objects('alice')).length;
    await expect(reserve('alice', 0)).rejects.toMatchObject({
      code: '23514',
      message: 'Picture changed; reload before saving',
    });
    expect((await objects('alice')).length).toBe(before);
  });
  test('replacing retires the old object and lists it; purging deletes its row, never the current one', async () => {
    const old = ((await view('alice')).picture as { id: string }).id;
    const { result, object } = await setPicture('alice', 1, hex('second'));
    expect(result.currentVersion).toBe(2);
    expect(result.pending).toEqual([{ id: old, storageRef: store }]);
    expect(
      await sql('alice', 'SELECT customer.profile_picture_purged($1::uuid[]) AS r', [
        [old, object],
      ]),
    ).toBe(1);
    expect((await objects('alice')).map((o) => o.state)).toEqual(['current']);
  });
  test('remove retires the picture, lists its files and leaves no current picture', async () => {
    const current = ((await view('alice')).picture as { id: string }).id;
    const removed = await remove('alice', 2);
    expect(removed).toMatchObject({ currentVersion: 3, picture: null });
    expect(removed.pending).toEqual([{ id: current, storageRef: store }]);
    await sql('alice', 'SELECT customer.profile_picture_purged($1::uuid[]) AS r', [[current]]);
    expect(await objects('alice')).toEqual([]);
    await expect(remove('alice', 3)).rejects.toMatchObject({
      message: 'There is no picture to remove',
    });
  });
  test('at most three unfinished uploads at once', async () => {
    for (let i = 0; i < 3; i++) await reserve('omar', 0);
    await expect(reserve('omar', 0)).rejects.toMatchObject({ code: '54000' });
  });
  test('a person with no workspace is refused before anything is written', async () => {
    await expect(reserve('nina', 0)).rejects.toMatchObject({
      code: '23514',
      message:
        'Personal details need a workspace on this account. Create or join a workspace first.',
    });
    expect(await objects('nina')).toEqual([]);
  });
});

describe('events', () => {
  test('one event per change with ids, a version and an action only', async () => {
    const rows = (
      await f.owner.query(
        "SELECT type,payload FROM app.domain_event WHERE aggregate_type='customer_profile_picture' AND aggregate_id=$1 ORDER BY aggregate_version",
        [ids.alice],
      )
    ).rows as { type: string; payload: Record<string, unknown> }[];
    expect(rows.map((r) => r.payload.action)).toEqual(['set', 'set', 'removed']);
    for (const row of rows) {
      expect(row.type).toBe('customer.profile_picture.changed');
      expect(Object.keys(row.payload).sort()).toEqual(
        ['action', 'initiator_id', 'initiator_kind', 'objectId', 'principal_id', 'version'].sort(),
      );
      expect(JSON.stringify(row.payload)).not.toContain(store);
    }
  });
});

describe('closed and erasure', () => {
  test('a closed account is refused', async () => {
    await setPicture('carol', 0, hex('carol'));
    await f.owner.query(
      `WITH t AS (SELECT clock_timestamp() AS at)
       INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
      [ids.carol, randomUUID()],
    );
    await expect(view('carol')).rejects.toMatchObject({ code: '42501' });
    await expect(reserve('carol', 1)).rejects.toMatchObject({ code: '42501' });
    await expect(remove('carol', 1)).rejects.toMatchObject({ code: '42501' });
  });
  test('an erasure request refuses the person, and staff erase every picture under it', async () => {
    await setAccountControl(true);
    await setPicture('erin', 0, hex('erin'));
    const request = await fileErasure('erin');
    await expect(view('erin')).rejects.toMatchObject({ code: '42501' });
    // Not the person, and not before the request is in progress.
    await expect(
      h.sql('erin', 'SELECT customer.profile_picture_erase($1,$2)', [randomUUID(), request]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      staff('SELECT customer.profile_picture_erase($1,$2) AS r', [randomUUID(), request]),
    ).rejects.toMatchObject({ code: '23514' });
    await staff('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      request,
      'received',
      'in_progress',
      null,
    ]);
    const command = randomUUID();
    const erased = (
      await staff('SELECT customer.profile_picture_erase($1,$2) AS r', [command, request])
    ).r as { retired: number; pending: { id: string }[] };
    expect(erased.retired).toBe(1);
    expect(erased.pending).toHaveLength(1);
    expect(
      (
        await f.owner.query(
          'SELECT (SELECT count(*)::int FROM customer_private.profile_picture_head WHERE principal_id=$1) heads,(SELECT count(*)::int FROM customer_private.profile_picture_command WHERE actor_id=$1) commands',
          [ids.erin],
        )
      ).rows[0],
    ).toEqual({ heads: 0, commands: 0 });
    // The same command answers the same; the staff purge deletes the rows of deleted files.
    expect(
      (
        (await staff('SELECT customer.profile_picture_erase($1,$2) AS r', [command, request]))
          .r as { retired: number }
      ).retired,
    ).toBe(1);
    expect(
      (
        await staff('SELECT customer.profile_picture_erase_purged($1,$2::uuid[]) AS r', [
          request,
          erased.pending.map((p) => p.id),
        ])
      ).r,
    ).toBe(1);
    expect(await objects('erin')).toEqual([]);
    const record = (
      await f.owner.query(
        "SELECT to_jsonb(e)-ARRAY['command_id','erasure_request_id','principal_id','staff_principal_id','created_at'] AS rest FROM customer_private.profile_picture_erasure e WHERE erasure_request_id=$1",
        [request],
      )
    ).rows;
    expect(record[0].rest).toEqual({ retired: 1 });
  });
  test('an upload still writing its files when staff erase keeps its reservation until it is an hour old', async () => {
    await setAccountControl(true);
    await setPicture('faye', 0, hex('faye'));
    // The upload has reserved and is writing its files when the erasure runs.
    const command = randomUUID();
    const writing = (await reserve('faye', 1, command, hex('faye-2'))).objectId as string;
    const request = await fileErasure('faye');
    await staff('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      request,
      'received',
      'in_progress',
      null,
    ]);
    const eraseCommand = randomUUID();
    const erase = async () =>
      (await staff('SELECT customer.profile_picture_erase($1,$2) AS r', [eraseCommand, request]))
        .r as { retired: number; pending: { id: string }[] };
    const first = await erase();
    // Only the current picture is retired and listed; the young reservation is neither.
    expect(first.retired).toBe(1);
    expect(first.pending.map((p) => p.id)).not.toContain(writing);
    expect(first.pending).toHaveLength(1);
    const purge = (objects: string[]) =>
      staff('SELECT customer.profile_picture_erase_purged($1,$2::uuid[]) AS r', [
        request,
        objects,
      ]).then((row) => row.r);
    // Even when named, the staff purge does not drop the reservation the upload is still writing.
    expect(await purge([writing, ...first.pending.map((p) => p.id)])).toBe(1);
    expect(await objects('faye')).toEqual([{ id: writing, state: 'reserved' }]);
    // The upload finishes its files and commits: refused, so the server deletes the files it wrote.
    await expect(commit('faye', 1, writing, command, hex('faye-2'))).rejects.toMatchObject({
      code: '42501',
    });
    expect(await objects('faye')).toEqual([{ id: writing, state: 'reserved' }]);
    // An hour later the same transition sent again replays and lists the reservation; its row then goes.
    await f.owner.query(
      "UPDATE customer_private.profile_picture_object SET created_at=created_at-interval '61 minutes' WHERE id=$1",
      [writing],
    );
    const later = await erase();
    expect(later.retired).toBe(1);
    expect(later.pending.map((p) => p.id)).toEqual([writing]);
    expect(await purge([writing])).toBe(1);
    expect(await objects('faye')).toEqual([]);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.profile_picture_erasure WHERE erasure_request_id=$1',
          [request],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
