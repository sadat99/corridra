import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import {
  CustomerAccountLifecycleService,
  accountLifecycleWords,
  customerAccountLifecycleEnabled,
  customerAccountLifecycleError,
  customerAccountLifecycleInput,
} from '../../packages/auth/src/customer-account-lifecycle';
import { customerAccountGateEnabled } from '../../packages/auth/src/customer-account-gate';
import {
  CustomerErasureQueue,
  erasureQueueQuery,
  erasureTransitionInput,
} from '../../packages/auth/src/customer-erasure-queue';

// CRUD G5, the services the routes will call: the app flag, strict self-only input, the fresh provider session deciding
// who acts, the real database answers mapped to what a person can act on, and the thin staff queue. Server-only.
let f: Fixture;
let h: ReturnType<typeof harness>;
const phrase = 'Close my account';
const service = (person = 'alice', overrides: Partial<typeof options> = {}) =>
  new CustomerAccountLifecycleService(f.runtime, f.auth, { ...options, ...overrides }, async () =>
    h.session(person),
  );
const signedOut = () =>
  new CustomerAccountLifecycleService(f.runtime, f.auth, options, async () => null);
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.account_closure_event) closures,
 (SELECT count(*)::int FROM customer_private.account_lifecycle_request) requests,
 (SELECT count(*)::int FROM customer_private.erasure_request) erasures`)
  ).rows[0] as Record<string, number>;
const setControl = (enabled: boolean) =>
  f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) SELECT coalesce(max(version),0)+1,$1,$2,$3 FROM customer_private.account_lifecycle_control',
    [enabled, f.serviceId, 'Fixture control for the account service tests'],
  );

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerAccountLifecycle(f.owner);
  h = harness(f, 'g5svc');
  await h.admit(['alice', 'bob', 'carol', 'nina']);
  await h.provision('alice', 'Synthetic service workspace');
  await h.provision('carol', 'Synthetic carol workspace');
  await h.setControl(true);
});
afterAll(async () => {
  await f?.close();
});

describe('the app flag', () => {
  const on = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED: 'true',
  };
  test('is off by default and needs both customer workspaces and its own switch', () => {
    expect(customerAccountLifecycleEnabled({})).toBe(false);
    expect(
      customerAccountLifecycleEnabled({
        ...on,
        CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(
      customerAccountLifecycleEnabled({ ...on, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'false' }),
    ).toBe(false);
    expect(customerAccountLifecycleEnabled(on)).toBe(true);
    expect(customerAccountLifecycleEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
  });
  test('the server gate and the screens use one predicate, so they never disagree', () => {
    const cases = [
      {},
      on,
      { ...on, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'false' },
      { ...on, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: undefined },
      { ...on, CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED: 'false' },
      { ...on, VERCEL_ENV: 'production' },
      { ...on, DATA_ENVIRONMENT: 'real' },
    ];
    for (const env of cases)
      expect(customerAccountGateEnabled(env), JSON.stringify(env)).toBe(
        customerAccountLifecycleEnabled(env),
      );
    expect(
      customerAccountGateEnabled({ ...on, CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'false' }),
    ).toBe(false);
  });
});

describe('the input', () => {
  const id = randomUUID();
  test('accepts exactly the three actions, self only', () => {
    for (const input of [
      { action: 'close', commandId: id, confirmation: phrase },
      { action: 'undo', commandId: id },
      { action: 'file_erasure', commandId: id },
    ])
      expect(customerAccountLifecycleInput.safeParse(input).success).toBe(true);
  });
  test('rejects any id, subject or extra key, a wrong phrase, a missing command and an unknown action', () => {
    for (const input of [
      { action: 'close', commandId: id, confirmation: phrase, principalId: id },
      { action: 'undo', commandId: id, subject: 'x' },
      { action: 'file_erasure', commandId: id, issuer: 'x' },
      { action: 'close', commandId: id, confirmation: 'close my account' },
      { action: 'close', commandId: id, confirmation: ` ${phrase}` },
      { action: 'close', commandId: id },
      { action: 'undo' },
      { action: 'delete', commandId: id },
    ])
      expect(customerAccountLifecycleInput.safeParse(input).success, JSON.stringify(input)).toBe(
        false,
      );
  });
  test('the typed phrase is the one in the words constant', () => {
    expect(accountLifecycleWords.closePhrase).toBe(phrase);
  });
});

describe('what the database refused, said plainly', () => {
  test('maps each state to a status and keeps the database words', () => {
    const map = (code: string, message = 'Plain words') =>
      customerAccountLifecycleError({ code, message }) as {
        status: number;
        message: string;
        code?: string;
      };
    expect(map('42501')).toMatchObject({ status: 403, message: 'Plain words' });
    expect(map('22023')).toMatchObject({ status: 400 });
    expect(map('23514')).toMatchObject({ status: 409 });
    expect(map('0A000')).toMatchObject({ status: 503, code: 'unavailable' });
    for (const code of ['42P01', '3F000', '42883'])
      expect(map(code, 'relation x.y does not exist')).toMatchObject({
        status: 503,
        message: 'Account changes are unavailable',
      });
    const unknown = new Error('boom');
    expect(customerAccountLifecycleError(unknown)).toBe(unknown);
  });
});

describe('the service against the real database', () => {
  test('a closed control answers 503 and writes nothing', async () => {
    const before = await counts();
    const state = await service('alice').state();
    expect(state).toMatchObject({ open: false, status: 'active' });
    await expect(
      service('alice').command({ action: 'close', commandId: randomUUID(), confirmation: phrase }),
    ).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    expect(await counts()).toEqual(before);
    await setControl(true);
  });

  test('signed out is 401, an unverified person is refused, and a changed account is 409 before any write', async () => {
    const before = await counts();
    await expect(signedOut().state()).rejects.toMatchObject({ status: 401 });
    await expect(
      signedOut().command({ action: 'undo', commandId: randomUUID() }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service('alice').command(
        { action: 'file_erasure', commandId: randomUUID() },
        'synthetic-g5svc-someone-else',
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service('alice').command({
        action: 'file_erasure',
        commandId: randomUUID(),
        principalId: 'x',
      }),
    ).rejects.toBeDefined();
    expect(await counts()).toEqual(before);
  });

  test('a person with no workspace and a sole owner of a live workspace get plain 409 answers', async () => {
    await expect(
      service('nina').command({ action: 'close', commandId: randomUUID(), confirmation: phrase }),
    ).rejects.toMatchObject({
      status: 409,
      message:
        'There is no workspace on this account. Write to the privacy contact on the privacy page.',
    });
    await expect(
      service('carol').command({ action: 'close', commandId: randomUUID(), confirmation: phrase }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Transfer ownership or archive the workspace first',
    });
  });

  test('erasure, close, state and undo return the documented shapes and replay the same answer', async () => {
    const filed = await service('bob')
      .command({ action: 'file_erasure', commandId: randomUUID() })
      .catch((e) => e);
    expect(filed).toMatchObject({ status: 409 });
    const [aliceWorkspace] = (await h.state('alice')) as { workspaceId: string }[];
    await h.join('alice', 'bob', aliceWorkspace!.workspaceId);
    const command = randomUUID();
    const first = await service('bob').command({ action: 'file_erasure', commandId: command });
    expect(first).toMatchObject({
      operation: 'file_erasure',
      changed: true,
      reference: expect.stringMatching(/^ER-\d{6}$/),
    });
    expect(Object.keys(first).sort()).toEqual(
      ['changed', 'dueAt', 'filedAt', 'operation', 'reference'].sort(),
    );
    expect(await service('bob').command({ action: 'file_erasure', commandId: command })).toEqual(
      first,
    );
    const closeId = randomUUID();
    const closed = await service('bob').command({
      action: 'close',
      commandId: closeId,
      confirmation: phrase,
    });
    expect(Object.keys(closed).sort()).toEqual(
      ['changed', 'closedAt', 'operation', 'status', 'undoUntil'].sort(),
    );
    expect(closed).toMatchObject({ operation: 'close', changed: true, status: 'closed' });
    expect(
      await service('bob').command({ action: 'close', commandId: closeId, confirmation: phrase }),
    ).toEqual(closed);
    const state = await service('bob').state();
    expect(Object.keys(state).sort()).toEqual(
      ['blockers', 'canUndo', 'closedAt', 'erasure', 'open', 'status', 'undoUntil'].sort(),
    );
    expect(state).toMatchObject({
      open: true,
      status: 'closed',
      canUndo: true,
      closedAt: closed.operation === 'close' ? closed.closedAt : '',
      erasure: {
        reference: (first as { reference: string }).reference,
        status: 'received',
        note: null,
      },
    });
    expect(await service('bob').command({ action: 'undo', commandId: randomUUID() })).toEqual({
      operation: 'undo',
      changed: true,
      status: 'active',
      closedAt: null,
      undoUntil: null,
    });
    await expect(
      service('bob').command({ action: 'undo', commandId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409, message: 'Your account is not closed' });
  });
});

describe('the staff queue service', () => {
  const queue = () => new CustomerErasureQueue(f.runtime);
  const ctx = (who: 'owner' | 'operator') => f.users[who]!.ctx;

  test('validates its input strictly', () => {
    expect(erasureQueueQuery.safeParse({}).success).toBe(true);
    expect(erasureQueueQuery.parse({}).pageSize).toBe(25);
    for (const input of [{ pageSize: 0 }, { pageSize: 101 }, { status: 'x' }, { extra: 1 }])
      expect(erasureQueueQuery.safeParse(input).success).toBe(false);
    const base = { commandId: randomUUID(), requestId: randomUUID(), expectedState: 'received' };
    expect(erasureTransitionInput.safeParse({ ...base, toState: 'in_progress' }).success).toBe(
      true,
    );
    for (const input of [
      { ...base, toState: 'completed' },
      { ...base, toState: 'declined', note: 'short' },
      { ...base, toState: 'received' },
      { ...base, expectedState: 'completed', toState: 'declined', note: 'a long enough note here' },
      { ...base, toState: 'in_progress', extra: 1 },
    ])
      expect(erasureTransitionInput.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  test('a staff owner reads the queue with the closed-account fields and moves a request; an operator is refused', async () => {
    const rows = await queue().queue(ctx('owner'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference: expect.stringMatching(/^ER-\d{6}$/),
      status: 'received',
      accountStatus: 'active',
      closedAt: null,
      undoUntil: null,
    });
    await expect(queue().queue(ctx('operator'))).rejects.toMatchObject({ status: 403 });
    const request = rows[0]!.id;
    await expect(
      queue().transition(ctx('operator'), {
        commandId: randomUUID(),
        requestId: request,
        expectedState: 'received',
        toState: 'in_progress',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const command = randomUUID();
    const moved = await queue().transition(ctx('owner'), {
      commandId: command,
      requestId: request,
      expectedState: 'received',
      toState: 'in_progress',
    });
    expect(moved).toMatchObject({ status: 'in_progress', changed: true, note: null });
    await expect(
      queue().transition(ctx('owner'), {
        commandId: randomUUID(),
        requestId: request,
        expectedState: 'received',
        toState: 'in_progress',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await queue().queue(ctx('owner'), { status: 'in_progress' })).length).toBe(1);
    expect(await service('bob').state()).toMatchObject({ erasure: { status: 'in_progress' } });
  });
});
