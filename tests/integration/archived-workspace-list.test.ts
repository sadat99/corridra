import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';

// The workspace list carries an `archived` flag read from the database, so menus and pickers can stop offering an
// archived workspace for new work. The flag is display only: the same RLS scope decides which workspaces are listed.
let f: Fixture;
let h: ReturnType<typeof harness>;
let harbour: string;
let quay: string;
let separate: string;
let erinMember: string;
const quayName = 'Synthetic Quay workspace';
const keys = ['archived', 'id', 'name', 'organisationId', 'role', 'synthetic'];
const flags = async (person: string) =>
  Object.fromEntries(
    (await h.workspaces(person).list()).map((workspace) => [workspace.id, workspace.archived]),
  );

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'awl');
  await h.admit(['alice', 'carol', 'dave', 'erin']);
  harbour = await h.provision('alice', 'Synthetic Harbour workspace');
  quay = await h.provision('alice', quayName);
  separate = await h.provision('dave', 'Synthetic Dave separate workspace');
  await h.join('alice', 'carol', quay);
  erinMember = await h.join('alice', 'erin', quay);
});
afterAll(async () => {
  await f?.close();
});

test('without the lifecycle module every workspace is listed as not archived, in the same shape', async () => {
  const listed = await h.workspaces('alice').list();
  expect(listed.map((workspace) => workspace.id).sort()).toEqual([harbour, quay].sort());
  for (const workspace of listed) {
    expect(Object.keys(workspace).sort()).toEqual(keys);
    expect(workspace.archived).toBe(false);
  }
  expect(await flags('carol')).toEqual({ [quay]: false });
});

describe('with the lifecycle module installed', () => {
  beforeAll(async () => {
    await migrateCustomerWorkspaceLifecycle(f.owner);
    await h.setControl(true);
  });

  test('an archived workspace is flagged, the others are not, and Restore clears the flag', async () => {
    const order = (await h.workspaces('alice').list()).map((workspace) => workspace.id);
    await h.lifecycle('alice', 'archive', {
      workspaceId: quay,
      expectedVersion: 0,
      confirmName: quayName,
    });
    const listed = await h.workspaces('alice').list();
    expect(listed.map((workspace) => workspace.id)).toEqual(order);
    for (const workspace of listed) expect(Object.keys(workspace).sort()).toEqual(keys);
    expect(await flags('alice')).toEqual({ [harbour]: false, [quay]: true });
    await h.lifecycle('alice', 'restore', { workspaceId: quay, expectedVersion: 1 });
    expect(await flags('alice')).toEqual({ [harbour]: false, [quay]: false });
    await h.lifecycle('alice', 'archive', {
      workspaceId: quay,
      expectedVersion: 2,
      confirmName: quayName,
    });
  });

  test('a paused control or the app switch off still reports the archive the database enforces', async () => {
    await h.setControl(false);
    try {
      expect(await flags('alice')).toEqual({ [harbour]: false, [quay]: true });
      const previous = process.env.CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED;
      process.env.CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED = 'false';
      try {
        expect(await flags('alice')).toEqual({ [harbour]: false, [quay]: true });
      } finally {
        if (previous === undefined)
          delete process.env.CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED;
        else process.env.CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED = previous;
      }
    } finally {
      await h.setControl(true);
    }
  });

  test('the flag never widens or narrows who sees a workspace', async () => {
    expect(await flags('carol')).toEqual({ [quay]: true });
    expect(await flags('dave')).toEqual({ [separate]: false });
    expect(Object.keys(await flags('alice'))).not.toContain(separate);
    await h.workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId: quay,
      kind: 'membership',
      targetId: erinMember,
    });
    expect(await flags('erin')).toEqual({});
  });

  test('a signed-out or switched account is refused before anything is listed', async () => {
    const signedOut = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => null);
    await expect(signedOut.list()).rejects.toMatchObject({ status: 401 });
    await expect(h.workspaces('alice').list('synthetic-awl-someone-else')).rejects.toMatchObject({
      status: 409,
    });
  });
});
