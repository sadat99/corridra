import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, overlap as sharedOverlap, type Fixture } from './revamp-g4-support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';

// CRUD G4 and G5 follow-up, real database and real restricted roles: a transferred owner keeps admin access that no
// revocation can end (so no revocation may claim to), closing an account and provisioning a workspace run in turn, the
// events of an account stay on the workspace of the first event after the person is removed from it, the staff erasure
// queue is split between sample and real customers, and the archive gate is checked again on every install.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
const phrase = 'Close my account';
const keepsAdmin =
  'This person is or was an owner of this workspace and keeps admin access. Ask support to remove it.';
const firstArchive = 'Transfer ownership or archive the workspace first';
const closedAccount = 'That account is closed';
const noWorkspace =
  'There is no workspace on this account. Write to the privacy contact on the privacy page.';
const undoEnded =
  'The 30 days to undo have ended. Write to the privacy contact on the privacy page.';

const account = (person: string, operation: string, input: Record<string, unknown> = {}) =>
  h
    .sql<{ r: Record<string, unknown> }>(
      person,
      'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
      [randomUUID(), operation, JSON.stringify(input)],
    )
    .then((row) => row.r);
const close = (person: string) => account(person, 'close', { confirmation: phrase });
const revoke = (owner: string, target: string, memberId: string, command = randomUUID()) =>
  h
    .sql<{ r: Record<string, unknown> }>(
      owner,
      'SELECT customer.workspace_access_command($1,$2,$3) AS r',
      [
        command,
        'revoke',
        JSON.stringify({ workspaceId: target, kind: 'membership', targetId: memberId }),
      ],
    )
    .then((row) => row.r);
const memberCommand = (
  person: string,
  operation: string,
  input: Record<string, unknown>,
  command = randomUUID(),
) =>
  h
    .sql<{ r: Record<string, unknown> }>(
      person,
      'SELECT customer.workspace_member_command($1,$2,$3) AS r',
      [command, operation, JSON.stringify(input)],
    )
    .then((row) => row.r);
const roleOf = (person: string, target: string) =>
  h
    .sql<{ r: string | null }>(
      person,
      'SELECT (SELECT w.role FROM customer.collaborative_workspaces() w WHERE w.id=$1) AS r',
      [target],
    )
    .then((row) => row.r);
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.workspace_access_revocation) revocations,
 (SELECT count(*)::int FROM customer_private.workspace_member_role) roles,
 (SELECT count(*)::int FROM customer.membership) memberships,
 (SELECT count(*)::int FROM app.domain_event) events`)
  ).rows[0] as Record<string, number>;
const staff = (text: string, params: unknown[] = []) =>
  rawContext(f.runtime, f.users.owner!.ctx, text, params).then((result) => result.rows[0]);
const transition = (request: string, expected: string, to: string, note: string | null = null) =>
  staff('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
    randomUUID(),
    request,
    expected,
    to,
    note,
  ]).then((row) => row.r as Record<string, unknown>);
const queue = () =>
  staff('SELECT customer.erasure_queue(NULL,100,NULL) AS r').then(
    (row) => row.r as { id: string; principalId: string }[],
  );
const overlap = (
  person: string,
  first: (db: DatabaseClient) => Promise<unknown>,
  second: () => Promise<unknown>,
) => sharedOverlap(f, h, person, first, second);
const provisionIn = (name: string) => (db: DatabaseClient) =>
  db.query('SELECT customer.provision_workspace($1,$2)', [randomUUID(), name]);
const events = async (person: string) =>
  (
    await f.owner.query(
      `SELECT tenant_id,type,aggregate_version,payload FROM app.domain_event
       WHERE aggregate_type='customer_account_lifecycle' AND aggregate_id=$1 ORDER BY occurred_at,id`,
      [ids[person]],
    )
  ).rows as {
    tenant_id: string;
    type: string;
    aggregate_version: number;
    payload: Record<string, unknown>;
  }[];
// A workspace with an owner and invited members.
async function team(owner: string, invited: string[], label: string) {
  const name = `Synthetic ${label} workspace`;
  const target = await h.provision(owner, name);
  const members: Record<string, string> = {};
  for (const person of invited) members[person] = await h.join(owner, person, target);
  return { target, name, members };
}
const hand = async (owner: string, to: string, t: Awaited<ReturnType<typeof team>>) => {
  const made = await h.ownership(owner, 'offer', {
    workspaceId: t.target,
    memberId: t.members[to],
    confirmName: t.name,
    expectedVersion: 0,
  });
  await h.ownership(to, 'accept', { offerId: made.offerId });
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  h = harness(f, 'g45fu');
  ids = await h.admit([
    'ann',
    'ben',
    'cat',
    'dan',
    'eve',
    'fay',
    'gus',
    'hal',
    'ivy',
    'jon',
    'kim',
    'leo',
    'max',
    'ned',
    'oli',
    'pam',
    'quo',
    'rex',
    'sue',
    'tim',
    'uma',
  ]);
  await migrateCustomerAccountLifecycle(f.owner);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the follow-up tests'],
  );
});
afterAll(async () => {
  await f?.close();
});

describe('a former owner keeps admin access, so no revocation or role change may claim to end it', () => {
  test('after A hands to B and B hands to C, removing B, demoting B or B leaving is refused and writes nothing', async () => {
    const t = await team('ann', ['ben', 'cat'], 'chain');
    await hand('ann', 'ben', t);
    await hand('ben', 'cat', t);
    expect(await roleOf('ben', t.target)).toBe('admin');
    const before = await counts();
    await expect(revoke('cat', t.target, t.members.ben!)).rejects.toMatchObject({
      code: '23514',
      message: keepsAdmin,
    });
    await expect(
      memberCommand('cat', 'set_role', {
        workspaceId: t.target,
        memberId: t.members.ben,
        role: 'admin',
        expectedRole: 'member',
      }),
    ).rejects.toMatchObject({ code: '23514', message: keepsAdmin });
    await expect(memberCommand('ben', 'leave', { workspaceId: t.target })).rejects.toMatchObject({
      code: '23514',
      message: keepsAdmin,
    });
    // the current owner, who is also an invited member, cannot be removed or leave either
    await expect(revoke('cat', t.target, t.members.cat!)).rejects.toMatchObject({
      code: '23514',
      message: keepsAdmin,
    });
    await expect(memberCommand('cat', 'leave', { workspaceId: t.target })).rejects.toMatchObject({
      code: '23514',
      message: keepsAdmin,
    });
    expect(await counts()).toEqual(before);
    expect(await roleOf('ben', t.target)).toBe('admin');
    expect(await roleOf('cat', t.target)).toBe('owner');
    expect(await roleOf('ann', t.target)).toBe('admin');
  });

  test('the state read names every protected member with the access the person really has', async () => {
    const t = await team('dan', ['eve', 'fay', 'gus'], 'state');
    await hand('dan', 'eve', t);
    await hand('eve', 'fay', t);
    const state = (await h.state('fay', t.target)) as {
      protectedMembers: { memberId: string; role: string }[];
    };
    expect(state.protectedMembers).toEqual(
      expect.arrayContaining([
        { memberId: t.members.eve, role: 'admin' },
        { memberId: t.members.fay, role: 'owner' },
      ]),
    );
    expect(state.protectedMembers).toHaveLength(2);
    expect(JSON.stringify(state)).not.toContain(ids.eve!);
  });

  test('an invited admin and an invited member can still be demoted and removed, and really lose access', async () => {
    const t = await team('hal', ['ivy', 'jon'], 'ordinary');
    await memberCommand('hal', 'set_role', {
      workspaceId: t.target,
      memberId: t.members.ivy,
      role: 'admin',
      expectedRole: 'member',
    });
    expect(await roleOf('ivy', t.target)).toBe('admin');
    await memberCommand('hal', 'set_role', {
      workspaceId: t.target,
      memberId: t.members.ivy,
      role: 'member',
      expectedRole: 'admin',
    });
    expect(await roleOf('ivy', t.target)).toBe('member');
    await revoke('hal', t.target, t.members.ivy!);
    expect(await roleOf('ivy', t.target)).toBeNull();
    await memberCommand('jon', 'leave', { workspaceId: t.target });
    expect(await roleOf('jon', t.target)).toBeNull();
  });

  test('the database refuses the revocation and role rows themselves, whichever function writes them', async () => {
    const t = await team('kim', ['leo', 'max'], 'rows');
    await hand('kim', 'leo', t);
    await hand('leo', 'max', t);
    await expect(
      f.owner.query(
        'INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES($1,$2,$3)',
        [t.target, t.members.leo, ids.max],
      ),
    ).rejects.toMatchObject({ code: '23514', message: keepsAdmin });
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.workspace_member_role(tenant_id,member_id,version,role,changed_by) VALUES($1,$2,1,'member',$3)",
        [t.target, t.members.leo, ids.max],
      ),
    ).rejects.toMatchObject({ code: '23514', message: keepsAdmin });
  });
});

describe('closing an account and provisioning a workspace run in turn', () => {
  const archivedOwner = async (person: string) => {
    const name = `Synthetic ${person} workspace`;
    const target = await h.provision(person, name);
    await h.lifecycle(person, 'archive', {
      workspaceId: target,
      expectedVersion: 0,
      confirmName: name,
    });
    return target;
  };
  const liveOwnedByClosed = async () =>
    (
      await f.owner.query(
        `SELECT w.tenant_id FROM customer.workspace w JOIN customer.membership m ON m.tenant_id=w.tenant_id AND m.role='owner'
         WHERE NOT customer_private.workspace_archived(w.tenant_id)
         AND (SELECT e.state FROM customer_private.account_closure_event e WHERE e.principal_id=m.principal_id ORDER BY e.seq DESC LIMIT 1)='closed'`,
      )
    ).rows;

  test('a close that commits first makes the provisioning wait, then the provisioning is refused', async () => {
    await archivedOwner('ned');
    const { waited, answer } = await overlap(
      'ned',
      (db) =>
        db.query('SELECT customer.account_lifecycle_command($1,$2,$3)', [
          randomUUID(),
          'close',
          JSON.stringify({ confirmation: phrase }),
        ]),
      () => h.as('ned', (db) => provisionIn('Synthetic ned second workspace')(db)),
    );
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: closedAccount });
    expect(await liveOwnedByClosed()).toEqual([]);
  });

  test('a provisioning that commits first makes the close wait, then the close is refused', async () => {
    await archivedOwner('oli');
    const { waited, answer } = await overlap(
      'oli',
      provisionIn('Synthetic oli second workspace'),
      () => close('oli'),
    );
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: firstArchive });
    expect(await liveOwnedByClosed()).toEqual([]);
  });

  test('an account that is closed cannot provision, and a replay of an earlier provisioning still answers', async () => {
    const command = randomUUID();
    const first = await h.as(
      'ben',
      async (db) =>
        (
          await db.query('SELECT customer.provision_workspace($1,$2) AS id', [
            command,
            'Synthetic ben replay workspace',
          ])
        ).rows[0]!.id,
    );
    await h.lifecycle('ben', 'archive', {
      workspaceId: first,
      expectedVersion: 0,
      confirmName: 'Synthetic ben replay workspace',
    });
    await close('ben');
    await expect(
      h.as('ben', (db) => provisionIn('Synthetic ben late workspace')(db)),
    ).rejects.toMatchObject({ code: '23514', message: closedAccount });
    const again = await h.as(
      'ben',
      async (db) =>
        (
          await db.query('SELECT customer.provision_workspace($1,$2) AS id', [
            command,
            'Synthetic ben replay workspace',
          ])
        ).rows[0]!.id,
    );
    expect(again).toBe(first);
  });
});

describe('the workspace that carries a person account events', () => {
  const owner = 'ann';
  const joined = async (person: string) => {
    const t = await team(owner, [person], `chain ${person}`);
    return { ...t, memberId: t.members[person]! };
  };

  test('a member who closed, then is removed from their only workspace, can undo inside the window', async () => {
    const t = await joined('pam');
    await close('pam');
    await revoke(owner, t.target, t.memberId);
    const before = await events('pam');
    const undone = await account('pam', 'undo');
    expect(undone).toMatchObject({ operation: 'undo', changed: true, status: 'active' });
    const after = await events('pam');
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ type: 'customer.account.restored', tenant_id: t.target });
    expect(after.map((event) => event.aggregate_version)).toEqual([1, 2]);
    // a later close and an erasure request use the same workspace
    await close('pam');
    expect((await events('pam')).map((event) => event.tenant_id)).toEqual([
      t.target,
      t.target,
      t.target,
    ]);
  });

  test('a member who filed an erasure request, then is removed, still has it moved by staff', async () => {
    const t = await joined('quo');
    const filed = await account('quo', 'file_erasure');
    await revoke(owner, t.target, t.memberId);
    const request = (await queue()).find((row) => row.principalId === ids.quo)!.id;
    const note = 'Invoices and the audit trail are kept because the law requires them';
    await transition(request, 'received', 'in_progress');
    await transition(request, 'in_progress', 'completed', note);
    const trail = await events('quo');
    expect(trail.map((event) => event.type)).toEqual([
      'customer.account.erasure_requested',
      'customer.account.erasure_in_progress',
      'customer.account.erasure_completed',
    ]);
    expect(new Set(trail.map((event) => event.tenant_id))).toEqual(new Set([t.target]));
    // ids and a type only: no note, no name, no reason
    for (const event of trail) {
      expect(Object.keys(event.payload).sort()).toEqual(
        Object.keys(event.payload)
          .filter((key) => /id$|_kind$|^request_id$/.test(key))
          .sort(),
      );
      expect(JSON.stringify(event.payload)).not.toContain('kept because');
      expect(JSON.stringify(event.payload)).not.toContain(t.name);
    }
    expect(filed.reference).toMatch(/^ER-/);
  });

  test('a replayed undo answers with the first result and writes nothing more', async () => {
    const t = await joined('rex');
    await close('rex');
    await revoke(owner, t.target, t.memberId);
    const command = randomUUID();
    const run = () =>
      h.sql<{ r: Record<string, unknown> }>(
        'rex',
        'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
        [command, 'undo', '{}'],
      );
    const first = (await run()).r;
    const before = await counts();
    expect((await run()).r).toEqual(first);
    expect(await counts()).toEqual(before);
  });

  test('a person removed before ever closing or filing still needs a workspace, and the final path is told the truth', async () => {
    const t = await joined('sue');
    await revoke(owner, t.target, t.memberId);
    await expect(close('sue')).rejects.toMatchObject({ code: '23514', message: noWorkspace });
    await expect(account('sue', 'file_erasure')).rejects.toMatchObject({
      code: '23514',
      message: noWorkspace,
    });
    // closed, removed, then day 30 passes: no erasure request, and the refusal does not claim there is one
    const g = await joined('tim');
    await close('tim');
    await revoke(owner, g.target, g.memberId);
    await f.owner.query('ALTER TABLE customer_private.account_closure_event DISABLE TRIGGER USER');
    await f.owner.query(
      "UPDATE customer_private.account_closure_event SET occurred_at=occurred_at-interval '31 days',final_at=final_at-interval '31 days' WHERE principal_id=$1",
      [ids.tim],
    );
    await f.owner.query('ALTER TABLE customer_private.account_closure_event ENABLE TRIGGER USER');
    await expect(account('tim', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: undoEnded,
    });
    // with an erasure request on file, the reference is named
    const h2 = await joined('uma');
    await account('uma', 'file_erasure');
    await close('uma');
    await revoke(owner, h2.target, h2.memberId);
    await f.owner.query('ALTER TABLE customer_private.account_closure_event DISABLE TRIGGER USER');
    await f.owner.query(
      "UPDATE customer_private.account_closure_event SET occurred_at=occurred_at-interval '31 days',final_at=final_at-interval '31 days' WHERE principal_id=$1",
      [ids.uma],
    );
    await f.owner.query('ALTER TABLE customer_private.account_closure_event ENABLE TRIGGER USER');
    const reference = (
      await f.owner.query(
        'SELECT reference FROM customer_private.erasure_request WHERE principal_id=$1',
        [ids.uma],
      )
    ).rows[0].reference as string;
    await expect(account('uma', 'undo')).rejects.toMatchObject({
      code: '23514',
      message: `The 30 days to undo have ended. Your erasure request has the reference ${reference}. Write to the privacy contact on the privacy page.`,
    });
  });
});

describe('the staff erasure queue is split between sample and real customers', () => {
  test('staff of a sample workspace cannot read or move the request of a customer whose workspace is real', async () => {
    const t = await team('ivy', [], 'scope');
    await account('ivy', 'file_erasure');
    const visible = await queue();
    const request = visible.find((row) => row.principalId === ids.ivy)!.id;
    await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
    await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [t.target]);
    try {
      expect((await queue()).some((row) => row.principalId === ids.ivy)).toBe(false);
      await expect(transition(request, 'received', 'in_progress')).rejects.toMatchObject({
        code: '23514',
        message: 'Erasure request not found',
      });
      // the other side: a real staff workspace sees the real customer and not the sample ones
      const sides = await f.owner.query(
        `SELECT customer_private.erasure_in_scope($1) AS real_customer_real_staff,
         customer_private.erasure_in_scope($2) AS sample_customer_real_staff
         FROM (SELECT set_config('corridra.tenant_id',$3,false)) s`,
        [ids.ivy, ids.quo, t.target],
      );
      expect(sides.rows[0]).toEqual({
        real_customer_real_staff: true,
        sample_customer_real_staff: false,
      });
    } finally {
      await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [t.target]);
      await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
      await f.owner.query("SELECT set_config('corridra.tenant_id','',false)");
    }
    expect((await queue()).some((row) => row.principalId === ids.ivy)).toBe(true);
    await transition(request, 'received', 'in_progress');
  });
});

describe('the archive gate is checked again on every install', () => {
  const definition = async (signature: string) =>
    (await f.owner.query('SELECT pg_get_functiondef($1::regprocedure) AS d', [signature])).rows[0]
      .d as string;
  const gates = [
    [
      'customer.submit_private_request(uuid,uuid,jsonb)',
      ['\n PERFORM customer_private.workspace_open_guard(target);'],
    ],
    [
      'customer.workspace_access_command(uuid,text,jsonb)',
      [
        '\n  PERFORM customer_private.workspace_open_guard(target);',
        '\n   PERFORM customer_private.workspace_open_guard(target,false);',
      ],
    ],
  ] as const;

  test.each(gates)(
    'a later replacement of %s that drops the gate is put back when it is the reviewed text',
    async (signature, lines) => {
      const live = await definition(signature);
      const stripped = lines.reduce((text, line) => text.replace(line, ''), live);
      expect(stripped).not.toBe(live);
      await f.owner.query(stripped);
      expect(await definition(signature)).not.toContain('workspace_open_guard(target)');
      await migrateCustomerWorkspaceLifecycle(f.owner);
      expect(await definition(signature)).toBe(live);
    },
  );

  test.each(gates)(
    'a different replacement of %s that has no gate stops the install loudly and is left alone',
    async (signature, lines) => {
      const live = await definition(signature);
      const changed = lines
        .reduce((text, line) => text.replace(line, ''), live)
        .replace('BEGIN', 'BEGIN\n -- another module');
      await f.owner.query(changed);
      const replaced = await definition(signature);
      await expect(migrateCustomerWorkspaceLifecycle(f.owner)).rejects.toThrow(/gate is missing/);
      expect(await definition(signature)).toBe(replaced);
      await f.owner.query(live);
      await migrateCustomerWorkspaceLifecycle(f.owner);
      expect(await definition(signature)).toBe(live);
    },
  );
});
