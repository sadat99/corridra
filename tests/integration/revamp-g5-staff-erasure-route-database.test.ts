import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { CustomerErasureQueue } from '../../packages/auth/src/customer-erasure-queue';

// CRUD G5, staff side, end to end: the real route over the real service, the real database and the real restricted
// roles. A staff workspace on the sample side sees only sample customers; a customer whose workspace is real is
// not in its list, and moving that request is refused with the same "not found" words. The real staff side is proven
// in revamp-g4-g5-followup-database.test.ts: every staff route in the web layer uses the sample purpose today, so a
// real staff workspace cannot reach this page yet.
const live = vi.hoisted(() => ({ queue: null as unknown, token: '' }));
const web = createRequire(resolve('apps/web/package.json'));
const lifecycleFile = web.resolve('@corridra/auth/customer-account-lifecycle');
vi.doMock(lifecycleFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(lifecycleFile)),
  customerAccountLifecycleEnabled: () => true,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: { getSession: async () => ({ token: live.token }) },
    customerErasureQueue: live.queue,
  }),
}));

let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let tenant: string;
const route = async () =>
  await import('../../apps/web/app/api/workspace/customer-erasure-queue/route');
const url = (extra = '') =>
  `https://app.corridra.test/api/workspace/customer-erasure-queue?tenant=${tenant}${extra}`;
const list = async () => {
  const { GET } = await route();
  const response = await GET(new Request(url('&pageSize=100')));
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: { id: string; reference: string }[];
    nextAfter: number | null;
  };
};
const move = async (
  requestId: string,
  toState: string,
  note?: string,
  commandId = randomUUID(),
) => {
  const { POST } = await route();
  const response = await POST(
    new Request(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
      body: JSON.stringify({
        commandId,
        requestId,
        expectedState: toState === 'in_progress' ? 'received' : 'in_progress',
        toState,
        ...(note ? { note } : {}),
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const requestOf = async (person: string) =>
  (
    await f.owner.query('SELECT id FROM customer_private.erasure_request WHERE principal_id=$1', [
      ids[person],
    ])
  ).rows[0].id as string;
const filed = async (person: string) => {
  const target = await h.provision(person, `Synthetic ${person} route workspace`);
  await h.sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
    randomUUID(),
    'file_erasure',
    JSON.stringify({}),
  ]);
  return { target, id: await requestOf(person) };
};
const flip = async (workspace: string, synthetic: boolean) => {
  await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
  await f.owner.query('UPDATE app.tenant SET synthetic=$2 WHERE id=$1', [workspace, synthetic]);
  await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  h = harness(f, 'g5route');
  ids = await h.admit(['ada', 'bea', 'cyd', 'dee', 'eli', 'fay']);
  await migrateCustomerAccountLifecycle(f.owner);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the staff route tests'],
  );
  live.queue = new CustomerErasureQueue(f.runtime);
  live.token = f.users.owner!.ctx.token;
  tenant = f.users.owner!.ctx.tenantId;
});
afterAll(async () => {
  await f?.close();
});

describe('the staff route over the real database', () => {
  test('lists a filed request with only the staff fields, and never the internal person id', async () => {
    const ada = await filed('ada');
    const body = await list();
    expect(body.items.map((item) => item.id)).toContain(ada.id);
    const text = JSON.stringify(body);
    expect(text).not.toContain(ids.ada!);
    expect(text).not.toContain('principal');
  });

  test('a customer whose workspace is real is not listed, and moving that request is refused as not found', async () => {
    const real = await filed('bea');
    const sample = await filed('cyd');
    await flip(real.target, false);
    try {
      const seen = (await list()).items.map((item) => item.id);
      expect(seen).toContain(sample.id);
      expect(seen).not.toContain(real.id);
      const refused = await move(real.id, 'in_progress');
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe('Erasure request not found');
      // the request did not move
      const states = await f.owner.query(
        'SELECT state FROM customer_private.erasure_status_event WHERE request_id=$1 ORDER BY seq',
        [real.id],
      );
      expect(states.rows.map((row) => row.state)).toEqual(['received']);
    } finally {
      await flip(real.target, true);
    }
    expect((await list()).items.map((item) => item.id)).toContain(real.id);
  });

  test('moves a request in order: start work, then a note is needed to complete it, and the person can read it', async () => {
    const id = await requestOf('ada');
    const started = await move(id, 'in_progress');
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('in_progress');
    expect((await move(id, 'completed')).status).toBe(400);
    expect((await move(id, 'completed', 'too short')).status).toBe(400);
    const done = await move(
      id,
      'completed',
      'Kept the invoices the law requires; the rest is erased',
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
    const row = (await list()).items.find((item) => item.id === id) as unknown as {
      status: string;
      note: string;
    };
    expect(row.status).toBe('completed');
    expect(row.note).toContain('Kept the invoices');
  });
});

describe('refusals through the real route change nothing', () => {
  const statesOf = async (id: string) =>
    (
      await f.owner.query(
        'SELECT state FROM customer_private.erasure_status_event WHERE request_id=$1 ORDER BY seq',
        [id],
      )
    ).rows.map((row) => row.state as string);

  test('staff who may not manage requests get 403 on the list and on a move, and the request stays received', async () => {
    const { id } = await filed('dee');
    live.token = f.users.operator!.ctx.token;
    try {
      const { GET } = await route();
      expect((await GET(new Request(url()))).status).toBe(403);
      expect((await move(id, 'in_progress')).status).toBe(403);
    } finally {
      live.token = f.users.owner!.ctx.token;
    }
    expect(await statesOf(id)).toEqual(['received']);
  });

  test('a note with a line break is refused in plain words and the request stays received', async () => {
    const { id } = await filed('eli');
    expect((await move(id, 'in_progress')).status).toBe(200);
    const refused = await move(id, 'completed', 'Kept the invoices\nthe law requires');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(
      'Notes must be on one line, with no line breaks, tabs or control characters',
    );
    expect(await statesOf(id)).toEqual(['received', 'in_progress']);
  });

  test('the same command sent twice moves the request once and answers the same way', async () => {
    const { id } = await filed('fay');
    const command = randomUUID();
    const first = await move(id, 'in_progress', undefined, command);
    const second = await move(id, 'in_progress', undefined, command);
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(false);
    expect(await statesOf(id)).toEqual(['received', 'in_progress']);
  });
});
