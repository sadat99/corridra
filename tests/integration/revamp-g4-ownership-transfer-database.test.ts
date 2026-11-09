import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';

// CRUD G4, handing ownership to an active member, real database and real restricted roles. One owner at every
// committed moment, only the named member can accept, the former owner becomes an admin and loses every owner-only
// power, and the database refuses every other change to a membership.
let f: Fixture;
let h: ReturnType<typeof harness>;
let workspaceId: string;
let name: string;
const members: Record<string, string> = {};
const principals: Record<string, string> = {};
const people = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina'];

const offer = (
  memberId: string,
  target = workspaceId,
  confirmName = name,
  expectedVersion = 0,
) => ({
  workspaceId: target,
  memberId,
  confirmName,
  expectedVersion,
});
const owners = async (target = workspaceId) =>
  (
    await f.owner.query(
      `SELECT p.subject FROM customer.membership m JOIN customer_private.principal p ON p.id=m.principal_id
      WHERE m.tenant_id=$1 AND m.role='owner'`,
      [target],
    )
  ).rows.map((row) => row.subject.replace('synthetic-g4own-', '') as string);
const role = async (person: string, target = workspaceId) =>
  (
    await f.owner.query(
      'SELECT role FROM customer.membership WHERE tenant_id=$1 AND principal_id=$2',
      [target, principals[person]],
    )
  ).rows[0]?.role as string | undefined;
const offerOf = async (person: string, target = workspaceId) =>
  ((await h.state(person, target)) as { offer: { offerId: string } | null }).offer?.offerId;
// A workspace of its own with an owner and invited members, for the cases that change ownership.
async function team(owner: string, invited: string[], label: string) {
  const target = await h.provision(owner, `Synthetic ${label} workspace`);
  const ids: Record<string, string> = {};
  for (const person of invited) ids[person] = await h.join(owner, person, target);
  return { target, name: `Synthetic ${label} workspace`, ids };
}
const hand = async (owner: string, to: string, target: string, title: string, id: string) => {
  const made = await h.ownership(owner, 'offer', offer(id, target, title));
  return h.ownership(to, 'accept', { offerId: made.offerId });
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  h = harness(f, 'g4own');
  Object.assign(principals, await h.admit(people));
  name = 'Synthetic transfer workspace';
  workspaceId = await h.provision('alice', name);
  for (const person of ['bob', 'carol', 'frank'])
    members[person] = await h.join('alice', person, workspaceId);
  await h.makeAdmin('erin', workspaceId);
  await h.setControl(true);
});
afterAll(async () => {
  await f?.close();
});

describe('an offer', () => {
  test('is made by the owner to an active member, shown to the owner and to that member only', async () => {
    const before = await h.lifecycleCounts();
    const made = await h.ownership('alice', 'offer', offer(members.bob!));
    expect(made).toMatchObject({ workspaceId, toMemberId: members.bob, operation: 'offer' });
    const after = await h.lifecycleCounts();
    expect(after.offers! - before.offers!).toBe(1);
    for (const key of ['events', 'audits', 'outbox', 'deliveries', 'requests'] as const)
      expect(after[key]! - before[key]!).toBe(1);
    const expires = new Date(made.expiresAt as string).getTime() - Date.now();
    expect(expires).toBeGreaterThan(6.99 * 86400000);
    expect(expires).toBeLessThanOrEqual(7 * 86400000);
    expect(await h.state('alice', workspaceId)).toMatchObject({
      offer: { offerId: made.offerId, toMemberId: members.bob, toYou: false, byYou: true },
      ownerMemberId: null,
    });
    expect(await h.state('bob', workspaceId)).toMatchObject({
      offer: { offerId: made.offerId, toYou: true, byYou: false },
    });
    expect(((await h.state('carol', workspaceId)) as { offer: unknown }).offer).toBeNull();
    expect(((await h.state('erin', workspaceId)) as { offer: unknown }).offer).toBeNull();
    const event = (
      await f.owner.query(
        "SELECT payload::text AS p FROM app.domain_event WHERE type='customer.workspace.ownership.offered' AND tenant_id=$1",
        [workspaceId],
      )
    ).rows[0].p as string;
    expect(event).not.toContain('Synthetic');
    expect(await owners()).toEqual(['alice']);
  });

  test('a second open offer is refused, and cancel works, and then a new offer is accepted', async () => {
    const before = await h.lifecycleCounts();
    await expect(h.ownership('alice', 'offer', offer(members.carol!))).rejects.toMatchObject({
      code: '23514',
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    const open = (await offerOf('alice'))!;
    await expect(
      h.ownership('bob', 'cancel', { workspaceId, offerId: open }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      h.ownership('alice', 'cancel', { workspaceId, offerId: open }),
    ).resolves.toMatchObject({
      status: 'cancelled',
    });
    await expect(
      h.ownership('alice', 'cancel', { workspaceId, offerId: open }),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Offer is no longer open',
    });
    // A cancelled offer cannot be accepted by the person it named.
    await expect(h.ownership('bob', 'accept', { offerId: open })).rejects.toMatchObject({
      code: '42501',
      message: 'Transfer offer unavailable',
    });
    expect(await owners()).toEqual(['alice']);
    expect(((await h.state('bob', workspaceId)) as { offer: unknown }).offer).toBeNull();
  });

  test('is refused, with no write, for a non-owner, an unknown or revoked member, a wrong name and a stale version', async () => {
    const revoked = await h.join('alice', 'gina', workspaceId);
    await h.workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId,
      kind: 'membership',
      targetId: revoked,
    });
    const elsewhere = await team('dave', ['alice'], 'elsewhere');
    const before = await h.lifecycleCounts();
    const cases: [string, Record<string, unknown>, string][] = [
      ['bob', offer(members.carol!), '42501'],
      ['erin', offer(members.carol!), '42501'],
      ['dave', offer(members.carol!), '42501'],
      ['alice', offer(revoked), '42501'],
      ['alice', offer(elsewhere.ids.alice!), '42501'],
      ['alice', offer(randomUUID()), '42501'],
      ['alice', { ...offer(members.carol!), memberId: 'not-a-uuid' }, '22023'],
      ['alice', offer(members.carol!, workspaceId, 'synthetic transfer workspace'), '22023'],
      ['alice', { ...offer(members.carol!), extra: true }, '22023'],
    ];
    for (const [person, input, code] of cases)
      await expect(h.ownership(person, 'offer', input)).rejects.toMatchObject({ code });
    expect(
      await h.ownership('alice', 'offer', offer(members.carol!, workspaceId, name, 3)),
    ).toMatchObject({
      stale: true,
      currentVersion: 0,
      currentName: name,
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    expect(await owners()).toEqual(['alice']);
  });

  test('is refused for an admin who is not a workspace member, for a personal workspace, and while the control is paused', async () => {
    const personal = await team('dave', ['alice'], 'personal');
    await f.owner.query(
      'INSERT INTO customer_private.personal_workspace(principal_id,workspace_id) VALUES($1,$2)',
      [principals.dave, personal.target],
    );
    await expect(
      h.ownership('dave', 'offer', offer(personal.ids.alice!, personal.target, personal.name)),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'A personal workspace belongs to one person. Archive it instead',
    });
    await h.setControl(false);
    await expect(h.ownership('alice', 'offer', offer(members.carol!))).rejects.toMatchObject({
      code: '0A000',
    });
    await h.setControl(true);
    expect(await owners(personal.target)).toEqual(['dave']);
  });

  test('a repeat answers with the first result and the same id for another decision conflicts', async () => {
    const lone = await team('erin', ['frank'], 'repeat');
    const command = randomUUID();
    const input = offer(lone.ids.frank!, lone.target, lone.name);
    const first = await h.ownership('erin', 'offer', input, command);
    const before = await h.lifecycleCounts();
    expect(await h.ownership('erin', 'offer', input, command)).toEqual(first);
    expect(await h.lifecycleCounts()).toEqual(before);
    await expect(
      h.ownership('erin', 'cancel', { workspaceId: lone.target, offerId: first.offerId }, command),
    ).rejects.toMatchObject({ code: '23514', message: 'Command conflicts with original request' });
  });
});

describe('accepting', () => {
  test('only the named member can accept; one who was not named, and one who left, cannot', async () => {
    const made = await h.ownership('alice', 'offer', offer(members.bob!));
    const before = await h.lifecycleCounts();
    for (const person of ['alice', 'carol', 'erin', 'dave'])
      await expect(h.ownership(person, 'accept', { offerId: made.offerId })).rejects.toMatchObject({
        code: '42501',
      });
    await expect(h.ownership('carol', 'decline', { offerId: made.offerId })).rejects.toMatchObject({
      code: '42501',
      message: 'Transfer offer unavailable',
    });
    await expect(h.ownership('bob', 'accept', { offerId: randomUUID() })).rejects.toMatchObject({
      code: '42501',
      message: 'Transfer offer unavailable',
    });
    expect(await h.lifecycleCounts()).toEqual(before);
    // The named member leaves before accepting: the offer cannot be accepted, and nothing changes.
    await h.workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId,
      kind: 'membership',
      targetId: members.bob!,
    });
    const after = await h.lifecycleCounts();
    await expect(h.ownership('bob', 'accept', { offerId: made.offerId })).rejects.toMatchObject({
      code: '42501',
    });
    expect(await h.lifecycleCounts()).toEqual(after);
    expect(await owners()).toEqual(['alice']);
    await h.ownership('alice', 'cancel', { workspaceId, offerId: made.offerId });
  });

  test('an expired offer cannot be accepted or cancelled, and a new offer can then be made', async () => {
    const lone = await team('alice', ['bob'], 'expiry');
    await f.owner.query(
      `INSERT INTO customer_private.workspace_transfer_offer(tenant_id,from_principal_id,to_member_id,to_principal_id,command_id,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '8 days',clock_timestamp()-interval '1 day')`,
      [lone.target, principals.alice, lone.ids.bob, principals.bob, randomUUID()],
    );
    const expired = (
      await f.owner.query(
        'SELECT id FROM customer_private.workspace_transfer_offer WHERE tenant_id=$1',
        [lone.target],
      )
    ).rows[0].id as string;
    expect(((await h.state('bob', lone.target)) as { offer: unknown }).offer).toBeNull();
    await expect(h.ownership('bob', 'accept', { offerId: expired })).rejects.toMatchObject({
      code: '42501',
      message: 'Transfer offer unavailable',
    });
    await expect(
      h.ownership('alice', 'cancel', { workspaceId: lone.target, offerId: expired }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await owners(lone.target)).toEqual(['alice']);
    await expect(
      h.ownership('alice', 'offer', offer(lone.ids.bob!, lone.target, lone.name)),
    ).resolves.toMatchObject({ operation: 'offer' });
  });

  test('a decline is by the named member only and works while paused; accept is refused while paused', async () => {
    const lone = await team('alice', ['bob', 'carol'], 'decline');
    const made = await h.ownership('alice', 'offer', offer(lone.ids.bob!, lone.target, lone.name));
    await h.setControl(false);
    await expect(h.ownership('bob', 'accept', { offerId: made.offerId })).rejects.toMatchObject({
      code: '0A000',
    });
    await expect(h.ownership('bob', 'decline', { offerId: made.offerId })).resolves.toMatchObject({
      status: 'declined',
    });
    await h.setControl(true);
    await expect(h.ownership('bob', 'accept', { offerId: made.offerId })).rejects.toMatchObject({
      code: '42501',
    });
    expect(await owners(lone.target)).toEqual(['alice']);
    const next = await h.ownership(
      'alice',
      'offer',
      offer(lone.ids.carol!, lone.target, lone.name),
    );
    await h.setControl(false);
    await expect(
      h.ownership('alice', 'cancel', { workspaceId: lone.target, offerId: next.offerId }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await h.setControl(true);
  });

  test('moves ownership in one step: the new owner, the former owner as an admin, the history, one event chain', async () => {
    const made = await h.ownership('alice', 'offer', offer(members.carol!));
    const before = await h.lifecycleCounts();
    const command = randomUUID();
    const result = await h.ownership('carol', 'accept', { offerId: made.offerId }, command);
    expect(result).toEqual({
      workspaceId,
      offerId: made.offerId,
      operation: 'accept',
      status: 'accepted',
    });
    expect(await owners()).toEqual(['carol']);
    expect(await role('alice')).toBe('admin');
    expect(await role('carol')).toBe('owner');
    const after = await h.lifecycleCounts();
    expect(after.history! - before.history!).toBe(1);
    expect(after.outcomes! - before.outcomes!).toBe(1);
    expect(after.memberships! - before.memberships!).toBe(1);
    for (const key of ['events', 'audits', 'outbox', 'deliveries', 'requests'] as const)
      expect(after[key]! - before[key]!).toBe(1);
    const history = (
      await f.owner.query(
        `SELECT a.subject AS from_subject,b.subject AS to_subject,x.state FROM customer_private.workspace_ownership_history h
        JOIN customer_private.principal a ON a.id=h.from_principal_id JOIN customer_private.principal b ON b.id=h.to_principal_id
        JOIN customer_private.workspace_transfer_outcome x ON x.offer_id=h.offer_id WHERE h.tenant_id=$1`,
        [workspaceId],
      )
    ).rows;
    expect(history).toEqual([
      {
        from_subject: 'synthetic-g4own-alice',
        to_subject: 'synthetic-g4own-carol',
        state: 'accepted',
      },
    ]);
    expect(await h.state('carol', workspaceId)).toMatchObject({
      role: 'owner',
      offer: null,
      ownerMemberId: members.carol,
    });
    expect(await h.state('alice', workspaceId)).toMatchObject({
      role: 'admin',
      ownerMemberId: members.carol,
    });
    // A repeat of the accepted command answers the same and changes nothing; a second accept is refused.
    expect(await h.ownership('carol', 'accept', { offerId: made.offerId }, command)).toEqual(
      result,
    );
    expect(await h.lifecycleCounts()).toEqual(after);
    await expect(h.ownership('carol', 'accept', { offerId: made.offerId })).rejects.toMatchObject({
      code: '42501',
    });
  });

  test('two members accepting the same offer at once end with exactly one owner change', async () => {
    const lone = await team('alice', ['bob'], 'race');
    const made = await h.ownership('alice', 'offer', offer(lone.ids.bob!, lone.target, lone.name));
    const results = await Promise.allSettled([
      h.ownership('bob', 'accept', { offerId: made.offerId }),
      h.ownership('bob', 'accept', { offerId: made.offerId }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await owners(lone.target)).toEqual(['bob']);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_ownership_history WHERE tenant_id=$1',
          [lone.target],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('a sampler watching a workspace while ownership moves', () => {
  test('always reads exactly one owner, through repeated handovers', async () => {
    const chain = await team('alice', ['bob', 'carol', 'dave', 'erin'], 'sampler');
    const sampler = await f.owner.connect();
    const seen = new Set<number>();
    let polls = 0;
    let running = true;
    const poll = (async () => {
      while (running) {
        const row = (
          await sampler.query(
            "SELECT count(*) FILTER (WHERE role='owner')::int AS n FROM customer.membership WHERE tenant_id=$1",
            [chain.target],
          )
        ).rows[0];
        seen.add(row.n);
        polls++;
      }
    })();
    try {
      const order = ['alice', 'bob', 'carol', 'dave', 'erin'];
      for (let step = 0; step < order.length - 1; step++)
        await hand(
          order[step]!,
          order[step + 1]!,
          chain.target,
          chain.name,
          chain.ids[order[step + 1]!]!,
        );
    } finally {
      running = false;
      await poll;
      sampler.release();
    }
    expect(polls).toBeGreaterThan(5);
    expect([...seen]).toEqual([1]);
    expect(await owners(chain.target)).toEqual(['erin']);
    const roles = (
      await f.owner.query(
        'SELECT p.subject,m.role FROM customer.membership m JOIN customer_private.principal p ON p.id=m.principal_id WHERE m.tenant_id=$1 ORDER BY p.subject',
        [chain.target],
      )
    ).rows.map((row) => `${row.subject.replace('synthetic-g4own-', '')}:${row.role}`);
    expect(roles).toEqual(['alice:admin', 'bob:admin', 'carol:admin', 'dave:admin', 'erin:owner']);
  });
});

describe('after a handover', () => {
  let target: string;
  let title: string;
  let bobMember: string;
  const roles = (person: string) =>
    new CustomerMemberRoleService(f.runtime, f.auth, options, async () => h.session(person));
  const programmes = (person: string) =>
    new CustomerProgrammeService(f.runtime, f.auth, options, async () => h.session(person));
  const ownerOnly = (person: string, extra: string) =>
    [
      [
        'invite',
        () =>
          h.workspaces(person).access({
            action: 'invite',
            commandId: randomUUID(),
            workspaceId: target,
            label: `Synthetic invited ${extra}`,
          }),
      ],
      [
        'set role',
        () =>
          roles(person).command({
            action: 'set_role',
            commandId: randomUUID(),
            workspaceId: target,
            memberId: bobMember,
            role: 'admin',
            expectedRole: 'member',
          }),
      ],
      [
        'rename',
        () =>
          h.lifecycle(person, 'rename', {
            workspaceId: target,
            name: `Synthetic renamed by ${extra}`,
            reason: 'The new owner chose a new name',
            expectedVersion: 0,
          }),
      ],
      [
        'archive',
        () =>
          h.lifecycle(person, 'archive', {
            workspaceId: target,
            expectedVersion: 1,
            confirmName: title,
          }),
      ],
      [
        'revoke',
        () =>
          h.workspaces(person).access({
            action: 'revoke',
            commandId: randomUUID(),
            workspaceId: target,
            kind: 'membership',
            targetId: bobMember,
          }),
      ],
      ['offer', () => h.ownership(person, 'offer', offer(bobMember, target, title))],
    ] as const;

  const createProgramme = (person: string, extra: string) =>
    programmes(person).create({
      commandId: randomUUID(),
      workspaceId: target,
      name: `Synthetic programme ${extra}`,
      reportingPurpose: 'Synthetic planning of a buyer visit for the handover tests',
      acknowledged: true,
    });

  beforeAll(async () => {
    const lone = await team('alice', ['bob', 'carol'], 'after');
    target = lone.target;
    title = lone.name;
    bobMember = lone.ids.bob!;
    await hand('alice', 'carol', target, title, lone.ids.carol!);
  });

  test('the former owner is an admin who fails every owner-only operation, and writes nothing', async () => {
    expect(await owners(target)).toEqual(['carol']);
    const before = await h.lifecycleCounts();
    for (const [label, call] of ownerOnly('alice', 'former'))
      await expect(call(), label).rejects.toMatchObject({ code: '42501' });
    expect(await h.lifecycleCounts()).toEqual(before);
    // The former owner keeps what an admin has: they see the workspace and can still create programmes.
    expect(await h.state('alice', target)).toMatchObject({ role: 'admin' });
    await expect(createProgramme('alice', 'by the former owner')).resolves.toMatchObject({
      workspaceId: target,
    });
  });

  test('the new owner passes the owner-only operations the former owner just failed', async () => {
    const results: string[] = [];
    for (const [label, call] of ownerOnly('carol', 'owner')) {
      if (label === 'archive' || label === 'offer') continue;
      await call();
      results.push(label);
    }
    expect(results).toEqual(['invite', 'set role', 'rename', 'revoke']);
    expect(await h.state('carol', target)).toMatchObject({ role: 'owner', version: 1 });
  });
});

describe('the membership rows', () => {
  const tryIn = async (statements: string[], disableGuard = false) => {
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      if (disableGuard)
        await db.query('ALTER TABLE customer.membership DISABLE TRIGGER membership_guard');
      for (const statement of statements) await db.query(statement);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  };
  const lone = async () => {
    const t = await team('alice', ['bob'], 'rows');
    return { ...t, alice: principals.alice!, bob: principals.bob! };
  };

  test('are refused every change without a handover, even to the schema owner', async () => {
    const t = await lone();
    const immutable = { message: 'Immutable record; append a new record', code: '23514' };
    await expect(
      tryIn([`UPDATE customer.membership SET role='admin' WHERE tenant_id='${t.target}'`]),
    ).rejects.toMatchObject(immutable);
    await expect(
      tryIn([`UPDATE customer.membership SET role='member' WHERE tenant_id='${t.target}'`]),
    ).rejects.toMatchObject(immutable);
    await expect(
      tryIn([`DELETE FROM customer.membership WHERE tenant_id='${t.target}'`]),
    ).rejects.toMatchObject(immutable);
    await expect(
      tryIn([
        `UPDATE customer.membership SET created_at=created_at+interval '1 second' WHERE tenant_id='${t.target}'`,
      ]),
    ).rejects.toMatchObject(immutable);
    expect(await owners(t.target)).toEqual(['alice']);
  });

  test('refuse an owner to admin change that lacks the history row, or the new owner, even when one of them exists', async () => {
    const t = await lone();
    const offerId = randomUUID();
    const offerRow = `INSERT INTO customer_private.workspace_transfer_offer(id,tenant_id,from_principal_id,to_member_id,to_principal_id,command_id,expires_at)
      VALUES('${offerId}','${t.target}','${t.alice}','${t.ids.bob}','${t.bob}','${randomUUID()}',clock_timestamp()+interval '1 day')`;
    const history = `INSERT INTO customer_private.workspace_ownership_history(tenant_id,from_principal_id,to_principal_id,offer_id,command_id)
      VALUES('${t.target}','${t.alice}','${t.bob}','${offerId}','${randomUUID()}')`;
    const demote = `UPDATE customer.membership SET role='admin' WHERE tenant_id='${t.target}' AND principal_id='${t.alice}'`;
    const newOwner = `INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES('${t.target}','${t.bob}','owner')`;
    // History but no new owner.
    await expect(tryIn([offerRow, history, demote])).rejects.toMatchObject({ code: '23514' });
    // The new owner but no history.
    await expect(tryIn([newOwner, demote])).rejects.toMatchObject({ code: '23514' });
    expect(await owners(t.target)).toEqual(['alice']);
    // Both together are accepted by the guard and leave exactly one owner.
    await tryIn([offerRow, history, newOwner, demote]);
    expect(await owners(t.target)).toEqual(['bob']);
    // An admin can never be made owner again, with or without history.
    await expect(
      tryIn(
        [
          `UPDATE customer.membership SET role='owner' WHERE tenant_id='${t.target}' AND principal_id='${t.alice}'`,
        ],
        true,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await owners(t.target)).toEqual(['bob']);
  });

  test('cannot be committed with no owner or with two owners', async () => {
    const t = await lone();
    const zero = 'A workspace has exactly one owner';
    // No owner: a workspace with no owner row, and an owner demoted with the guard out of the way.
    const tenant = randomUUID();
    await expect(
      tryIn([
        `INSERT INTO app.tenant(id,name,synthetic) VALUES('${tenant}','Synthetic ownerless workspace',true)`,
        `INSERT INTO customer.workspace(tenant_id,created_by) VALUES('${tenant}','${t.alice}')`,
      ]),
    ).rejects.toMatchObject({ message: zero, code: '23514' });
    await expect(
      tryIn(
        [
          `UPDATE customer.membership SET role='admin' WHERE tenant_id='${t.target}' AND principal_id='${t.alice}'`,
        ],
        true,
      ),
    ).rejects.toMatchObject({ message: zero, code: '23514' });
    // Two owners.
    await expect(
      tryIn([
        `INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES('${t.target}','${t.bob}','owner')`,
      ]),
    ).rejects.toMatchObject({ message: zero, code: '23514' });
    expect(await owners(t.target)).toEqual(['alice']);
    // The ordinary way to make a workspace still commits: the workspace and its owner together.
    const fine = randomUUID();
    await tryIn([
      `INSERT INTO app.tenant(id,name,synthetic) VALUES('${fine}','Synthetic owned workspace',true)`,
      `INSERT INTO customer.workspace(tenant_id,created_by) VALUES('${fine}','${t.alice}')`,
      `INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES('${fine}','${t.alice}','owner')`,
    ]);
    expect(await owners(fine)).toEqual(['alice']);
  });

  test('the history, offers and outcomes stay append only and out of reach of the application logins', async () => {
    for (const table of [
      'workspace_ownership_history',
      'workspace_transfer_offer',
      'workspace_transfer_outcome',
    ]) {
      await expect(
        f.owner.query(`UPDATE customer_private.${table} SET command_id=command_id`),
      ).rejects.toMatchObject({
        message: 'Immutable record; append a new record',
      });
      await expect(f.owner.query(`DELETE FROM customer_private.${table}`)).rejects.toMatchObject({
        message: 'Immutable record; append a new record',
      });
      for (const pool of [f.runtime, f.auth])
        await expect(pool.query(`SELECT * FROM customer_private.${table}`)).rejects.toMatchObject({
          code: '42501',
        });
    }
    for (const statement of [
      "UPDATE customer.membership SET role='owner'",
      'DELETE FROM customer.membership',
      `INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES('${workspaceId}','${principals.frank}','owner')`,
    ])
      await expect(f.runtime.query(statement)).rejects.toThrow();
    await expect(f.auth.query("UPDATE customer.membership SET role='owner'")).rejects.toThrow();
  });
});
