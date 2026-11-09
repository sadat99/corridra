import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import {
  CustomerErasureQueue,
  resetErasureScopeProbe,
} from '../../packages/auth/src/customer-erasure-queue';

// CRUD G5, staff side, with ONLY the account module that is live in production today (0001). Module 0001 creates
// the queue and the move functions WITHOUT the sample or real split; only 0003 and 0004 add it. With just 0001
// installed the route must answer 503 on GET and POST, return no rows and change no request, and it must start working
// soon after 0002 to 0004 are installed, with no redeploy. The same route over the fully installed module is in
// revamp-g5-staff-erasure-route-database.test.ts.
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
const url = `https://app.corridra.test/api/workspace/customer-erasure-queue?tenant=`;
const get = async () => (await route()).GET(new Request(url + tenant + '&pageSize=100'));
const post = async (body: Record<string, unknown>) =>
  (await route()).POST(
    new Request(url + tenant, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
      body: JSON.stringify(body),
    }),
  );
const sql = async (name: string) =>
  await readFile(
    new URL(`../../packages/db/customer-account-lifecycle-migrations/${name}`, import.meta.url),
    'utf8',
  );
const statesOf = async (id: string) =>
  (
    await f.owner.query(
      'SELECT state FROM customer_private.erasure_status_event WHERE request_id=$1 ORDER BY seq',
      [id],
    )
  ).rows.map((row) => row.state as string);

beforeAll(async () => {
  f = await fixture('corridra_upgrade');
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  // Exactly what production has (install 42364802587, "1 applied"): the first account module and nothing after it.
  await f.owner.query(await sql('0001_account_closure_and_erasure.sql'));
  h = harness(f, 'g5only');
  ids = await h.admit(['gia']);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the only-0001 test'],
  );
  live.queue = new CustomerErasureQueue(f.runtime);
  live.token = f.users.owner!.ctx.token;
  tenant = f.users.owner!.ctx.tenantId;
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await f?.close();
});

describe('with only module 0001 installed', () => {
  let request = '';

  test('the shipped functions really have no sample or real split (the hazard this guard covers)', async () => {
    await h.provision('gia', 'Synthetic only-0001 workspace');
    await h.sql('gia', 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
      randomUUID(),
      'file_erasure',
      JSON.stringify({}),
    ]);
    request = (
      await f.owner.query('SELECT id FROM customer_private.erasure_request WHERE principal_id=$1', [
        ids.gia,
      ])
    ).rows[0].id as string;
    const scope = await f.owner.query(
      "SELECT to_regprocedure('customer_private.erasure_in_scope(uuid)') IS NOT NULL AS present",
    );
    expect(scope.rows[0].present).toBe(false);
  });

  test('GET answers 503 and returns no rows', async () => {
    const response = await get();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.items).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(request);
  });

  test('POST answers 503 and the request does not move', async () => {
    const response = await post({
      commandId: randomUUID(),
      requestId: request,
      expectedState: 'received',
      toState: 'in_progress',
    });
    expect(response.status).toBe(503);
    expect(await statesOf(request)).toEqual(['received']);
  });

  test('the same holds right after installing, until the check runs again', async () => {
    await f.owner.query(await sql('0002_account_chain_and_undo_words.sql'));
    await f.owner.query(await sql('0003_erasure_queue_scope.sql'));
    await f.owner.query(await sql('0004_erasure_scope_by_workspaces.sql'));
    // a missing module is remembered for a minute, so this is still refused and nothing moved
    expect((await get()).status).toBe(503);
    expect(await statesOf(request)).toEqual(['received']);
  });

  test('a minute later the check runs again, finds the module and the page works with no redeploy', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61000 });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toContain(request);
    const moved = await post({
      commandId: randomUUID(),
      requestId: request,
      expectedState: 'received',
      toState: 'in_progress',
    });
    expect(moved.status).toBe(200);
    expect(await statesOf(request)).toEqual(['received', 'in_progress']);
  });

  test('once found it stays found, and a fresh process starts by asking again', async () => {
    expect((await get()).status).toBe(200);
    resetErasureScopeProbe();
    expect((await get()).status).toBe(200);
  });
});
