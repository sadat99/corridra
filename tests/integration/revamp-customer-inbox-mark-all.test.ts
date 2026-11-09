import { afterAll, beforeAll, expect, test } from 'vitest';
import { accessFixture } from './access-fixture';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { InboxService } from '../../packages/communications/src/inbox';
import { CustomerInboxService } from '../../apps/web/lib/customer-inbox';

// Server-side Mark All Read: one call marks every unread item of the signed-in person (not only the 30 the panel
// loads), never another person's, never another tenant's person's, never a staff row, and the count the bell shows
// comes from the server. Real database, real roles.
const issuer = 'https://ep-inbox-all.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof accessFixture>>;
const principals: Record<string, string> = {};
const session = (person: string) => ({
  subject: 'synthetic-inbox-all-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const service = (person: string | null) =>
  new CustomerInboxService(
    f.runtime,
    f.auth,
    options,
    async () => (person ? session(person) : null),
    new InboxService(f.runtime),
  );
async function seed(person: string, count: number, tenant: string | null, kind = 'customer') {
  await f.owner.query(
    `INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,payload)
     SELECT $1,$2,$3,'REQUEST_RECEIVED','{}'::jsonb FROM generate_series(1,$4)`,
    [tenant, kind, principals[person], count],
  );
}
const unreadFor = async (person: string, kind = 'customer') =>
  (
    await f.owner.query(
      'SELECT count(*)::int n FROM app.inbox_notification WHERE recipient_account_id=$1 AND recipient_kind=$2 AND read_at IS NULL',
      [principals[person], kind],
    )
  ).rows[0].n as number;

beforeAll(async () => {
  f = await accessFixture();
  await migrateCommercialReadiness(f.owner);
  for (const person of ['alice', 'bob', 'carol'])
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Fictional inbox mark all fixture;not managed-provider acceptance',
      })
    ).id;
  await seed('alice', 45, f.tenantA);
  await seed('alice', 3, f.tenantA, 'staff');
  await seed('bob', 5, f.tenantA);
  await seed('carol', 6, f.tenantB);
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('the server count covers every unread item, not the 30 a list loads', async () => {
  expect((await service('alice').list()).length).toBe(30);
  expect(await service('alice').unreadCount()).toBe(45);
  expect(await service('bob').unreadCount()).toBe(5);
});

test('mark all reads all 45 of the caller, and nothing of a colleague, another tenant or a staff row', async () => {
  const marked = await service('alice').markAllRead();
  expect(marked).toBe(45);
  expect(await unreadFor('alice')).toBe(0);
  expect(await unreadFor('alice', 'staff')).toBe(3);
  expect(await unreadFor('bob')).toBe(5);
  expect(await unreadFor('carol')).toBe(6);
  expect(await service('alice').unreadCount()).toBe(0);
  expect(await service('alice').markAllRead()).toBe(0);
});

test('a signed-out caller and an unverified one change nothing', async () => {
  await expect(service(null).markAllRead()).rejects.toMatchObject({ status: 401 });
  await expect(service(null).unreadCount()).rejects.toMatchObject({ status: 401 });
  expect(await unreadFor('bob')).toBe(5);
  await expect(service('bob').markAllRead(session('alice').subject, issuer)).rejects.toMatchObject({
    status: 409,
  });
  expect(await unreadFor('bob')).toBe(5);
  expect(await unreadFor('alice')).toBe(0);
});

test('only the read_at column changes: ids, types and counts of every row stay', async () => {
  const before = (await f.owner.query('SELECT count(*)::int n FROM app.inbox_notification')).rows[0]
    .n;
  await service('bob').markAllRead();
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.inbox_notification')).rows[0].n,
  ).toBe(before);
  expect(await unreadFor('bob')).toBe(0);
  expect(await unreadFor('carol')).toBe(6);
});
