import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { harness, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerPersonalProfiles } from '../../packages/db/src/customer-personal-profile-migrate';
import { migrateCustomerProfilePictures } from '../../packages/db/src/customer-profile-picture-migrate';
import { CustomerErasureQueue } from '../../packages/auth/src/customer-erasure-queue';
import { CustomerProfilePictureErasure } from '../../packages/auth/src/customer-profile-pictures';
import {
  AvatarStorage,
  avatarPath,
  type AvatarBackend,
} from '../../packages/evidence/src/avatar-storage';

// ADR-088, end to end over the real staff route, the real services, the real database and real restricted roles, with
// the picture store held in memory: a person reserves a picture upload and its files are written, then the upload dies
// before its commit or its clean-up. The person files an erasure request and staff start work. Completing the request
// within the hour of that upload is refused (409) and nothing is erased; once the reservation is an hour old completing
// succeeds, and its row and both of its files are gone.
const live = vi.hoisted(() => ({
  queue: null as unknown,
  pictures: null as unknown,
  storage: null as unknown,
  token: '',
}));
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
    customerProfilePictureErasure: live.pictures,
    avatarStorage: live.storage,
  }),
}));

const ref = 'vercel-blob:store_synthetic';
const files = new Map<string, Uint8Array>();
const memory: AvatarBackend = {
  async put(path, body) {
    if (files.has(path)) throw new Error('exists');
    files.set(path, body);
  },
  async get(path) {
    const body = files.get(path);
    if (!body) throw new Error('missing');
    return body;
  },
  async delete(path) {
    files.delete(path);
  },
};
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let tenant: string;
const hex = (text: string) => createHash('sha256').update(text).digest('hex');
const move = async (requestId: string, toState: 'in_progress' | 'completed') => {
  const { POST } = await import('../../apps/web/app/api/workspace/customer-erasure-queue/route');
  const response = await POST(
    new Request(`https://app.corridra.test/api/workspace/customer-erasure-queue?tenant=${tenant}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
      body: JSON.stringify({
        commandId: randomUUID(),
        requestId,
        expectedState: toState === 'in_progress' ? 'received' : 'in_progress',
        toState,
        ...(toState === 'completed' ? { note: 'Synthetic note: nothing was kept.' } : {}),
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const objects = async (person: string) =>
  (
    await f.owner.query(
      'SELECT id,state FROM customer_private.profile_picture_object WHERE principal_id=$1',
      [ids[person]],
    )
  ).rows as { id: string; state: string }[];
const requestState = async (requestId: string) =>
  (
    await f.owner.query(
      'SELECT state FROM customer_private.erasure_status_event WHERE request_id=$1 ORDER BY seq DESC LIMIT 1',
      [requestId],
    )
  ).rows[0]?.state as string;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  h = harness(f, 'ppicroute');
  ids = await h.admit(['gia']);
  await h.provision('gia', 'Synthetic gia workspace');
  await migrateCustomerAccountLifecycle(f.owner);
  await migrateCustomerPersonalProfiles(f.owner);
  await migrateCustomerProfilePictures(f.owner);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES((SELECT coalesce(max(version),0)+1 FROM customer_private.account_lifecycle_control),true,$1,$2)',
    [f.serviceId, 'Fixture control for the picture erasure route test'],
  );
  live.queue = new CustomerErasureQueue(f.runtime);
  live.pictures = new CustomerProfilePictureErasure(f.runtime);
  live.storage = new AvatarStorage(ref, { [ref]: memory });
  live.token = f.users.owner!.ctx.token;
  tenant = f.users.owner!.ctx.tenantId;
});
afterAll(async () => {
  await f?.close();
});

describe('completing an erasure request waits for a picture upload in flight', () => {
  test('409 within the hour with nothing erased, then completed with the row and both files gone', async () => {
    // The upload reserved and wrote both files, then died before its commit and before deleting them.
    const reserved = (
      await h.sql<{ r: { objectId: string } }>(
        'gia',
        'SELECT customer.profile_picture_reserve($1,$2,$3,$4) AS r',
        [randomUUID(), 0, hex('gia'), ref],
      )
    ).r.objectId;
    await memory.put(avatarPath(reserved, 'large'), new Uint8Array([1, 2, 3]));
    await memory.put(avatarPath(reserved, 'small'), new Uint8Array([4, 5]));
    await h.sql('gia', 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
      randomUUID(),
      'file_erasure',
      '{}',
    ]);
    const requestId = (
      await f.owner.query('SELECT id FROM customer_private.erasure_request WHERE principal_id=$1', [
        ids.gia,
      ])
    ).rows[0].id as string;

    const started = await move(requestId, 'in_progress');
    expect(started.status).toBe(200);
    expect(started.body.profilePicture).toEqual({ retired: 0, pending: 0 });

    const early = await move(requestId, 'completed');
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(
      /^A profile picture upload was still in progress when this request was filed\. Complete this request after \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/,
    );
    expect(await requestState(requestId)).toBe('in_progress');
    expect(await objects('gia')).toEqual([{ id: reserved, state: 'reserved' }]);
    expect([...files.keys()].sort()).toEqual(
      [avatarPath(reserved, 'large'), avatarPath(reserved, 'small')].sort(),
    );

    // An hour later.
    await f.owner.query(
      "UPDATE customer_private.profile_picture_object SET created_at=created_at-interval '61 minutes' WHERE id=$1",
      [reserved],
    );
    const done = await move(requestId, 'completed');
    expect(done.status).toBe(200);
    expect(done.body.profilePicture).toEqual({ retired: 1, pending: 0 });
    expect(await requestState(requestId)).toBe('completed');
    expect(await objects('gia')).toEqual([]);
    expect(files.size).toBe(0);
  });
});
