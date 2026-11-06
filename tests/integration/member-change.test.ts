import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { AccessService } from '../../packages/auth/src/access';

// CRUD G9: an owner's role change or revoke names the membership version the owner saw and carries a command id.
// A change on an out-of-date view is refused and writes nothing; a retry after a lost answer is answered once from the
// audit event already written; the same id for a different change is refused. Real database, real roles.
let f: Awaited<ReturnType<typeof fixture>>;
let access: AccessService;
const row = async (userId: string) =>
  (
    await f.owner.query(
      'SELECT role,revoked_at,version FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
      [f.tenantA, userId],
    )
  ).rows[0];
const events = async (userId: string) =>
  (
    await f.owner.query(
      "SELECT causation_id,payload FROM app.domain_event WHERE tenant_id=$1 AND aggregate_type='membership' AND aggregate_id=$2 AND type='membership.update' ORDER BY occurred_at",
      [f.tenantA, userId],
    )
  ).rows;
const change = (
  userId: string,
  role: string,
  revoked: boolean,
  expectedVersion: number,
  commandId = randomUUID(),
  ctx = f.users.owner.ctx,
) => access.changeMember(ctx, { commandId, userId, role, revoked, expectedVersion });

// A write the way the invitation cancel makes it: as the owner, in a transaction, without the workspace lock.
async function lockFreeWrite(assignment: string) {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('corridra.session_hash',encode(sha256(convert_to($1,'UTF8')),'hex'),true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','synthetic_validation',true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$4,true)`,
      [f.users.owner.token, f.tenantA, randomUUID(), randomUUID()],
    );
    await client.query(
      `UPDATE app.membership SET ${assignment} WHERE tenant_id=$1 AND user_id=$2`,
      [f.tenantA, f.users.viewer.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  f = await fixture();
  access = new AccessService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});

describe('a member change names the version the owner saw', () => {
  test('the member list carries each membership version', async () => {
    const members = await access.members(f.users.owner.ctx);
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect(m.version).toBeGreaterThanOrEqual(1);
    const viewer = members.find((m) => m.user_id === f.users.viewer.id);
    expect(viewer.version).toBe((await row(f.users.viewer.id)).version);
  });

  test('a change on the current version is applied, advances the version and records the command id in the audit event', async () => {
    const before = await row(f.users.viewer.id);
    const commandId = randomUUID();
    const done = await change(f.users.viewer.id, 'reviewer', false, before.version, commandId);
    expect(done).toMatchObject({ updated: true, replayed: false, version: before.version + 1 });
    const after = await row(f.users.viewer.id);
    expect(after).toMatchObject({ role: 'reviewer', version: before.version + 1 });
    const recorded = (await events(f.users.viewer.id)).filter((e) => e.causation_id === commandId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({ role: 'reviewer', revoked: false });
  });

  test('a stale version is refused, nothing is written, and the member keeps what a newer change gave them', async () => {
    const seen = (await row(f.users.reviewer.id)).version;
    await change(f.users.reviewer.id, 'operator', false, seen);
    const afterFirst = await row(f.users.reviewer.id);
    const eventsBefore = (await events(f.users.reviewer.id)).length;
    // A second owner screen still shows the old version and tries to revoke.
    await expect(change(f.users.reviewer.id, 'reviewer', true, seen)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/reload/i),
    });
    expect(await row(f.users.reviewer.id)).toEqual(afterFirst);
    expect((await events(f.users.reviewer.id)).length).toBe(eventsBefore);
    // A version that was never real is refused too.
    await expect(
      change(f.users.reviewer.id, 'reviewer', true, afterFirst.version + 40),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('a command without an id or without a version is refused before the database', async () => {
    const before = await row(f.users.viewer.id);
    // The shape is checked first thing, so the refusal may come straight away; wrap it to treat both the same.
    const attempt = async (input: Record<string, unknown>) =>
      access.changeMember(f.users.owner.ctx, input);
    const body = { userId: f.users.viewer.id, role: 'viewer', revoked: false };
    const shape = { name: 'ZodError' };
    await expect(attempt({ ...body, expectedVersion: before.version })).rejects.toMatchObject(
      shape,
    );
    await expect(attempt({ ...body, commandId: randomUUID() })).rejects.toMatchObject(shape);
    await expect(
      attempt({ ...body, commandId: 'not-a-uuid', expectedVersion: before.version }),
    ).rejects.toMatchObject(shape);
    await expect(
      attempt({ ...body, commandId: randomUUID(), expectedVersion: before.version, extra: 1 }),
    ).rejects.toMatchObject(shape);
    await expect(
      attempt({ ...body, commandId: randomUUID(), expectedVersion: 1_000_001 }),
    ).rejects.toMatchObject(shape);
    for (const bad of [0, -1, 1.5, '2', null])
      await expect(
        attempt({ ...body, commandId: randomUUID(), expectedVersion: bad }),
      ).rejects.toMatchObject(shape);
    expect(await row(f.users.viewer.id)).toEqual(before);
  });
});

describe('a retry after a lost answer', () => {
  test('the same command with the same content is answered once and writes nothing more', async () => {
    const seen = (await row(f.users.viewer.id)).version;
    const commandId = randomUUID();
    const first = await change(f.users.viewer.id, 'viewer', false, seen, commandId);
    expect(first).toMatchObject({ replayed: false });
    const afterFirst = await row(f.users.viewer.id);
    const count = (await events(f.users.viewer.id)).length;
    // The answer was lost; the screen resends the same body, the old version included.
    const again = await change(f.users.viewer.id, 'viewer', false, seen, commandId);
    expect(again).toMatchObject({ updated: true, replayed: true, version: afterFirst.version });
    expect(await row(f.users.viewer.id)).toEqual(afterFirst);
    expect((await events(f.users.viewer.id)).length).toBe(count);
  });

  test('the same command id for a different revoke flag, a different role or another member is refused and writes nothing', async () => {
    const seen = (await row(f.users.viewer.id)).version;
    const commandId = randomUUID();
    await change(f.users.viewer.id, 'viewer', false, seen, commandId);
    const state = await row(f.users.viewer.id);
    const operatorState = await row(f.users.operator.id);
    const viewerEvents = (await events(f.users.viewer.id)).length;
    const operatorEvents = (await events(f.users.operator.id)).length;
    await expect(change(f.users.viewer.id, 'viewer', true, seen, commandId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/reused/i),
    });
    await expect(
      change(f.users.viewer.id, 'reviewer', false, seen, commandId),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/reused/i) });
    await expect(
      change(f.users.operator.id, 'viewer', false, seen, commandId),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/reused/i) });
    expect(await row(f.users.viewer.id)).toEqual(state);
    expect(await row(f.users.operator.id)).toEqual(operatorState);
    expect((await events(f.users.viewer.id)).length).toBe(viewerEvents);
    expect((await events(f.users.operator.id)).length).toBe(operatorEvents);
  });

  test('a retry with the member id in capitals is still the same command', async () => {
    const seen = (await row(f.users.viewer.id)).version;
    const commandId = randomUUID();
    await change(f.users.viewer.id, 'viewer', false, seen, commandId);
    const again = await change(f.users.viewer.id.toUpperCase(), 'viewer', false, seen, commandId);
    expect(again).toMatchObject({ updated: true, replayed: true });
  });

  test('an actor who lost the right to manage members cannot replay an earlier command', async () => {
    // A second owner makes a change, is then demoted, and retries the same command: authority is checked before
    // the replay lookup, so the answer is a refusal and not the old result.
    const helper = f.users.reviewer;
    const seenHelper = (await row(helper.id)).version;
    await change(helper.id, 'owner', false, seenHelper);
    const seen = (await row(f.users.viewer.id)).version;
    const commandId = randomUUID();
    await change(f.users.viewer.id, 'viewer', false, seen, commandId, helper.ctx);
    const current = (await row(helper.id)).version;
    await change(helper.id, 'reviewer', false, current);
    await expect(
      change(f.users.viewer.id, 'viewer', false, seen, commandId, helper.ctx),
    ).rejects.toThrow('Access denied');
  });

  test('a write that slips in between the read and the update is refused by the version, not overwritten', async () => {
    // A writer that does not take the workspace lock (cancelling an invitation) is simulated by bumping the
    // membership between a screen's load and its save: the stale save finds a different version.
    const seen = (await row(f.users.viewer.id)).version;
    await lockFreeWrite('revoked_at=now()');
    await expect(change(f.users.viewer.id, 'viewer', false, seen)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/reload/i),
    });
    expect((await row(f.users.viewer.id)).revoked_at).not.toBeNull();
    await lockFreeWrite('revoked_at=NULL');
  });
});

describe('the rules that were already there still hold', () => {
  test('the last active owner cannot be demoted or revoked, even on the current version', async () => {
    const owner = await row(f.users.owner.id);
    await expect(change(f.users.owner.id, 'viewer', false, owner.version)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/active owner/i),
    });
    await expect(change(f.users.owner.id, 'owner', true, owner.version)).rejects.toMatchObject({
      status: 409,
    });
    expect(await row(f.users.owner.id)).toEqual(owner);
  });

  test('only an owner with a fresh authenticator check may change a member, and an unknown member is not found', async () => {
    const seen = (await row(f.users.viewer.id)).version;
    await expect(
      change(f.users.viewer.id, 'viewer', true, seen, randomUUID(), f.users.operator.ctx),
    ).rejects.toThrow('Access denied');
    await expect(change(randomUUID(), 'viewer', false, 1)).rejects.toMatchObject({ status: 404 });
  });

  test('two owners changing the same member from the same view at once: exactly one wins', async () => {
    const seen = (await row(f.users.viewer.id)).version;
    const results = await Promise.allSettled([
      change(f.users.viewer.id, 'reviewer', false, seen),
      change(f.users.viewer.id, 'operator', false, seen),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    expect((await row(f.users.viewer.id)).version).toBe(seen + 1);
  });
});
