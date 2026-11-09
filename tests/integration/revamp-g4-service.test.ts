import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import {
  CustomerWorkspaceLifecycleService,
  customerWorkspaceIsStale,
  customerWorkspaceLifecycleEnabled,
  customerWorkspaceLifecycleError,
  customerWorkspaceLifecycleInput,
  type CustomerWorkspaceLifecycleState,
} from '../../packages/auth/src/customer-workspace-lifecycle';

// CRUD G4, the service the routes will call: the app flag, strict input, the fresh provider session deciding who acts,
// the real database answers mapped to what a person can act on, and the closed control. Server-only.
let f: Fixture;
let h: ReturnType<typeof harness>;
let workspaceId: string;
let memberId: string;
const title = 'Synthetic service workspace';
const service = (person = 'alice', overrides: Partial<typeof options> = {}) =>
  new CustomerWorkspaceLifecycleService(f.runtime, f.auth, { ...options, ...overrides }, async () =>
    h.session(person),
  );
const signedOut = () =>
  new CustomerWorkspaceLifecycleService(f.runtime, f.auth, options, async () => null);
const rename = (name: string, expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  action: 'rename',
  commandId: randomUUID(),
  workspaceId,
  name,
  reason: 'The company changed its trading name',
  expectedVersion,
  ...extra,
});
const counts = () => h.lifecycleCounts();

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  h = harness(f, 'g4svc');
  await h.admit(['alice', 'bob', 'carol']);
  workspaceId = await h.provision('alice', title);
  memberId = await h.join('alice', 'bob', workspaceId);
  await h.join('alice', 'carol', workspaceId);
  await h.setControl(true);
});
afterAll(async () => {
  await f?.close();
});

describe('the app flag', () => {
  const on = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED: 'true',
  };
  test('is off by default and needs both customer workspaces and its own switch', () => {
    expect(customerWorkspaceLifecycleEnabled({})).toBe(false);
    expect(
      customerWorkspaceLifecycleEnabled({
        ...on,
        CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(
      customerWorkspaceLifecycleEnabled({ ...on, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'false' }),
    ).toBe(false);
    expect(customerWorkspaceLifecycleEnabled(on)).toBe(true);
    expect(customerWorkspaceLifecycleEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
  });
});

describe('the input', () => {
  const id = randomUUID();
  const valid = [
    rename('Synthetic Renamed Workspace', 0, { workspaceId: id }),
    { action: 'archive', commandId: id, workspaceId: id, expectedVersion: 1, confirmName: title },
    { action: 'restore', commandId: id, workspaceId: id, expectedVersion: 2 },
    {
      action: 'offer_transfer',
      commandId: id,
      workspaceId: id,
      memberId: id,
      confirmName: title,
      expectedVersion: 0,
    },
    { action: 'cancel_transfer', commandId: id, workspaceId: id, offerId: id },
    { action: 'accept_transfer', commandId: id, offerId: id },
    { action: 'decline_transfer', commandId: id, offerId: id },
  ];
  test('accepts exactly the seven actions with their own fields', () => {
    for (const input of valid)
      expect(customerWorkspaceLifecycleInput.safeParse(input).success).toBe(true);
  });
  test('rejects unknown keys, a missing id, a bad version, a short reason, a short name and an unknown action', () => {
    for (const input of [
      ...valid.map((value) => ({ ...value, principalId: id })),
      { ...valid[0], reason: 'too short' },
      { ...valid[0], name: ' a ' },
      { ...valid[0], expectedVersion: -1 },
      { ...valid[0], expectedVersion: 1.5 },
      { ...valid[0], workspaceId: 'not-a-uuid' },
      { ...valid[1], confirmName: '' },
      { ...valid[5], workspaceId: id },
      { action: 'delete', commandId: id, workspaceId: id },
      { ...valid[2], commandId: undefined },
    ])
      expect(customerWorkspaceLifecycleInput.safeParse(input).success, JSON.stringify(input)).toBe(
        false,
      );
  });
  test('keeps the typed name exactly as typed', () => {
    const parsed = customerWorkspaceLifecycleInput.parse({
      ...valid[1],
      confirmName: '  Spaced name ',
    });
    expect(parsed).toMatchObject({ confirmName: '  Spaced name ' });
  });
});

describe('what the database refused, said plainly', () => {
  test('maps each state to a status and keeps the database words', () => {
    const map = (code: string, message = 'Plain words') =>
      customerWorkspaceLifecycleError({ code, message }) as {
        status: number;
        message: string;
        code?: string;
      };
    expect(map('42501')).toMatchObject({ status: 403, message: 'Plain words' });
    expect(map('22023')).toMatchObject({ status: 400 });
    expect(map('23514')).toMatchObject({ status: 409 });
    expect(map('55000')).toMatchObject({ status: 409, code: 'archived' });
    expect(map('0A000')).toMatchObject({ status: 503, code: 'unavailable' });
    for (const code of ['42P01', '3F000', '42883'])
      expect(map(code)).toMatchObject({
        status: 503,
        message: 'Workspace changes are unavailable',
      });
    const unknown = new Error('boom');
    expect(customerWorkspaceLifecycleError(unknown)).toBe(unknown);
  });
});

describe('through the real session boundary and database', () => {
  test('rename, state, stale and restore work end to end, with the fresh session deciding who acts', async () => {
    const done = await service().command(rename('Synthetic Renamed Workspace', 0));
    expect(done).toEqual({
      workspaceId,
      name: 'Synthetic Renamed Workspace',
      archived: false,
      version: 1,
      operation: 'rename',
    });
    const state = (await service().state({ workspaceId })) as CustomerWorkspaceLifecycleState;
    expect(state).toMatchObject({
      open: true,
      name: 'Synthetic Renamed Workspace',
      version: 1,
      role: 'owner',
      archived: false,
      offer: null,
      ownerMemberId: null,
    });
    expect(Object.keys(state).sort()).toEqual(
      [
        'archived',
        'history',
        'keepsAccess',
        'name',
        'offer',
        'open',
        'ownerMemberId',
        'protectedMembers',
        'role',
        'version',
        'workspaceId',
      ].sort(),
    );
    expect(await service().state()).toEqual(
      expect.arrayContaining([{ workspaceId, archived: false, version: 1 }]),
    );
    const stale = await service().command(rename('Synthetic Another Name', 0));
    expect(customerWorkspaceIsStale(stale)).toBe(true);
    expect(stale).toMatchObject({ currentVersion: 1, currentName: 'Synthetic Renamed Workspace' });
    const archived = await service().command({
      action: 'archive',
      commandId: randomUUID(),
      workspaceId,
      expectedVersion: 1,
      confirmName: 'Synthetic Renamed Workspace',
    });
    expect(archived).toMatchObject({ archived: true, version: 2 });
    await expect(service().command(rename('Synthetic While Archived', 2))).rejects.toMatchObject({
      status: 409,
      message: 'Restore the workspace before renaming it',
    });
    await expect(
      service().command({
        action: 'restore',
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({ archived: false, version: 3 });
  });

  test('a repeat of a command answers the first result and writes nothing', async () => {
    const input = rename('Synthetic Repeated Name', 3);
    const first = await service().command(input);
    const before = await counts();
    expect(await service().command(input)).toEqual(first);
    expect(await counts()).toEqual(before);
    await expect(
      service().command({ ...input, name: 'Synthetic Different Name' }),
    ).rejects.toMatchObject({ status: 409, message: 'Command conflicts with original request' });
  });

  test('denials are 403, 400 and 503 with plain words and no write', async () => {
    const before = await counts();
    await expect(service('bob').command(rename('Synthetic Not Allowed', 4))).rejects.toMatchObject({
      status: 403,
      message: 'Workspace owner required',
    });
    await expect(
      service().command({
        action: 'archive',
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 4,
        confirmName: 'wrong',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Type the workspace name to confirm' });
    await h.setControl(false);
    await expect(service().command(rename('Synthetic While Paused', 4))).rejects.toMatchObject({
      status: 503,
      code: 'unavailable',
    });
    await h.setControl(true);
    expect(await counts()).toEqual(before);
    await expect(service('carol').state({ workspaceId })).resolves.toMatchObject({
      role: 'member',
    });
    await expect(service('bob').state({ workspaceId: randomUUID() })).rejects.toMatchObject({
      status: 403,
    });
  });

  test('a signed-out person gets 401, and a forged subject or issuer gets 409 before any write', async () => {
    const before = await counts();
    await expect(signedOut().command(rename('Synthetic Signed Out', 4))).rejects.toMatchObject({
      status: 401,
    });
    await expect(signedOut().state()).rejects.toMatchObject({ status: 401 });
    await expect(
      service().command(rename('Synthetic Forged Subject', 4), 'someone-else'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service().command(
        rename('Synthetic Forged Issuer', 4),
        h.session('alice').subject,
        'https://other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service().state({ workspaceId }, 'someone-else')).rejects.toMatchObject({
      status: 409,
    });
    expect(await counts()).toEqual(before);
  });

  test('a service switched off at the boundary, and unknown query keys, never reach the database', async () => {
    await expect(service('alice', { enabled: false }).state()).rejects.toMatchObject({
      status: 503,
    });
    await expect(service().state({ workspaceId, extra: 1 } as never)).rejects.toThrow();
  });

  test('hands over ownership through offer, accept and decline, and shows the pending offer', async () => {
    const offered = await service().command({
      action: 'offer_transfer',
      commandId: randomUUID(),
      workspaceId,
      memberId,
      confirmName: ((await service().state({ workspaceId })) as CustomerWorkspaceLifecycleState)
        .name,
      expectedVersion: 4,
    });
    expect(offered).toMatchObject({ operation: 'offer', toMemberId: memberId });
    const offerId = (offered as { offerId: string }).offerId;
    expect(await service('bob').state({ workspaceId })).toMatchObject({
      offer: { offerId, toYou: true, byYou: false },
    });
    await expect(
      service('carol').command({ action: 'accept_transfer', commandId: randomUUID(), offerId }),
    ).rejects.toMatchObject({ status: 403, message: 'Transfer offer unavailable' });
    await expect(
      service('alice').command({ action: 'decline_transfer', commandId: randomUUID(), offerId }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service('bob').command({ action: 'accept_transfer', commandId: randomUUID(), offerId }),
    ).resolves.toMatchObject({ operation: 'accept', status: 'accepted' });
    expect(await service('bob').state({ workspaceId })).toMatchObject({
      role: 'owner',
      ownerMemberId: memberId,
      offer: null,
    });
    expect(await service('alice').state({ workspaceId })).toMatchObject({ role: 'admin' });
    await expect(
      service('alice').command(rename('Synthetic Former Owner', 4)),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('a database without the module', () => {
  test('answers 503 plainly instead of a database error', async () => {
    const g = await fixture('corridra_upgrade');
    try {
      await migrateCustomerRealUse(g.owner);
      const gh = harness(g, 'g4none');
      await gh.admit(['alice']);
      const bare = new CustomerWorkspaceLifecycleService(g.runtime, g.auth, options, async () =>
        gh.session('alice'),
      );
      await expect(bare.state()).rejects.toMatchObject({
        status: 503,
        message: 'Workspace changes are unavailable',
      });
      await expect(bare.command(rename('Synthetic Not Installed', 0))).rejects.toMatchObject({
        status: 503,
      });
    } finally {
      await g.close();
    }
  });
});

describe('the module', () => {
  test('is reached only by the service, never by a request handler, and never mentions read-only or an em dash', () => {
    const source = readFileSync(
      resolve('packages/auth/src/customer-workspace-lifecycle.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/read-only|read only|—/i);
    const handlers: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          readFileSync(path, 'utf8').includes('customer-workspace-lifecycle-configuration')
        )
          handlers.push(path);
      }
    };
    walk(resolve('apps/web'));
    expect(handlers).toEqual([]);
  });
});
