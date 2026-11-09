import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';

// CRUD G4 and G5 together: closing an account races with the two things that can give the person a live workspace
// to own, accepting an ownership offer and restoring an archived workspace. Whatever the order, no live workspace may
// end up with a closed account as its owner. Each race holds the first command uncommitted, starts the second, proves
// that the second really waited on a lock, and then lets the first commit.
let f: Fixture;
let h: ReturnType<typeof harness>;
const phrase = 'Close my account';
const firstArchive = 'Transfer ownership or archive the workspace first';
const closedAccount = 'That account is closed';
type Answer = { ok?: unknown; error?: { code?: string; message: string } };

const closeIn = (db: DatabaseClient) =>
  db.query('SELECT customer.account_lifecycle_command($1,$2,$3)', [
    randomUUID(),
    'close',
    JSON.stringify({ confirmation: phrase }),
  ]);
const close = (person: string) =>
  h.sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
    randomUUID(),
    'close',
    JSON.stringify({ confirmation: phrase }),
  ]);
const restoreIn = (workspaceId: string) => (db: DatabaseClient) =>
  db.query('SELECT customer.workspace_lifecycle_command($1,$2,$3)', [
    randomUUID(),
    'restore',
    JSON.stringify({ workspaceId, expectedVersion: 1 }),
  ]);
const acceptIn = (offerId: string) => (db: DatabaseClient) =>
  db.query('SELECT customer.workspace_ownership_command($1,$2,$3)', [
    randomUUID(),
    'accept',
    JSON.stringify({ offerId }),
  ]);

// Runs `first` for `person` inside a transaction that stays open while `second` starts, then commits it.
async function overlap(
  person: string,
  first: (db: DatabaseClient) => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  let racing: Promise<Answer> | undefined;
  let waited = false;
  let settled = false;
  await h.as(person, async (db) => {
    await first(db);
    racing = second().then(
      (ok): Answer => ({ ok }),
      (error: { code?: string; message: string }): Answer => ({ error }),
    );
    void racing.then(() => {
      settled = true;
    });
    for (let attempt = 0; attempt < 30 && !waited && !settled; attempt++) {
      const waiting = await f.owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock'",
      );
      waited = waiting.rows[0].n > 0;
      if (!waited) await new Promise((done) => setTimeout(done, 100));
    }
  });
  return { waited, answer: await racing! };
}

const closedOwnersOfLiveWorkspaces = async () =>
  (
    await f.owner.query(
      `SELECT w.tenant_id FROM customer.workspace w JOIN customer.membership m ON m.tenant_id=w.tenant_id AND m.role='owner'
       WHERE NOT customer_private.workspace_archived(w.tenant_id)
       AND (SELECT e.state FROM customer_private.account_closure_event e WHERE e.principal_id=m.principal_id ORDER BY e.seq DESC LIMIT 1)='closed'`,
    )
  ).rows;

// An owner with an archived workspace only.
async function archivedOwner(person: string) {
  const workspaceId = await h.provision(person, `Synthetic ${person} workspace`);
  await h.lifecycle(person, 'archive', {
    workspaceId,
    expectedVersion: 0,
    confirmName: `Synthetic ${person} workspace`,
  });
  return workspaceId;
}
// A member of the named owner's workspace with an open offer of ownership.
async function offered(owner: string, member: string) {
  const workspaceId = await h.provision(owner, `Synthetic ${owner} workspace`);
  const memberId = await h.join(owner, member, workspaceId);
  const result = await h.ownership(owner, 'offer', {
    workspaceId,
    memberId,
    confirmName: `Synthetic ${owner} workspace`,
    expectedVersion: 0,
  });
  return { workspaceId, offerId: result.offerId as string };
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'g45race');
  await h.admit(['rita', 'sam', 'olga', 'xena', 'paul', 'yara', 'zed', 'quin', 'ruth', 'tess']);
  await migrateCustomerAccountLifecycle(f.owner);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the account lifecycle race tests'],
  );
});
afterAll(async () => {
  await f?.close();
});

describe('closing an account while a workspace is being restored', () => {
  test('a restore that commits first makes the close wait, then the close is refused', async () => {
    const workspaceId = await archivedOwner('rita');
    const { waited, answer } = await overlap('rita', restoreIn(workspaceId), () => close('rita'));
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: firstArchive });
    expect(await closedOwnersOfLiveWorkspaces()).toEqual([]);
  });

  test('a close that commits first makes the restore wait, then the restore is refused', async () => {
    const workspaceId = await archivedOwner('sam');
    const { waited, answer } = await overlap('sam', closeIn, () =>
      h.lifecycle('sam', 'restore', { workspaceId, expectedVersion: 1 }),
    );
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: closedAccount });
    expect(await closedOwnersOfLiveWorkspaces()).toEqual([]);
    expect(
      (
        await f.owner.query('SELECT customer_private.workspace_archived($1) AS archived', [
          workspaceId,
        ])
      ).rows[0].archived,
    ).toBe(true);
  });
});

describe('closing an account while ownership is being accepted', () => {
  test('an acceptance that commits first makes the close wait, then the close is refused', async () => {
    const { offerId } = await offered('olga', 'xena');
    const { waited, answer } = await overlap('xena', acceptIn(offerId), () => close('xena'));
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: firstArchive });
    expect(await closedOwnersOfLiveWorkspaces()).toEqual([]);
  });

  test('a close that commits first makes the acceptance wait, then the acceptance is refused', async () => {
    const { workspaceId, offerId } = await offered('paul', 'yara');
    const { waited, answer } = await overlap('yara', closeIn, () =>
      h.ownership('yara', 'accept', { offerId }),
    );
    expect(waited).toBe(true);
    expect(answer.error).toMatchObject({ code: '23514', message: closedAccount });
    expect(await closedOwnersOfLiveWorkspaces()).toEqual([]);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int AS n FROM customer.membership m JOIN customer_private.principal p ON p.id=m.principal_id WHERE m.tenant_id=$1 AND m.role='owner' AND p.subject=$2",
          [workspaceId, h.session('paul').subject],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('an offer to an account that is closed is refused, and nothing is written', async () => {
    const workspaceId = await h.provision('zed', 'Synthetic zed workspace');
    const memberId = await h.join('zed', 'quin', workspaceId);
    await close('quin');
    const before = await h.lifecycleCounts();
    await expect(
      h.ownership('zed', 'offer', {
        workspaceId,
        memberId,
        confirmName: 'Synthetic zed workspace',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: '23514', message: closedAccount });
    expect(await h.lifecycleCounts()).toEqual(before);
  });

  test('an acceptance by an account that closed after the offer is refused, even when nothing races', async () => {
    const { offerId } = await offered('ruth', 'tess');
    await close('tess');
    await expect(h.ownership('tess', 'accept', { offerId })).rejects.toMatchObject({
      code: '23514',
      message: closedAccount,
    });
    expect(await closedOwnersOfLiveWorkspaces()).toEqual([]);
  });
});
