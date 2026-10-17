import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';

const issuer = 'https://ep-context-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>;
const session = (subject: string): CustomerSession => ({
  subject,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const input = (name = 'Synthetic context workspace') => ({ name, commandId: randomUUID() });
const service = (subject: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(subject));
async function writes() {
  return (
    await f.owner.query(`SELECT
      (SELECT count(*)::int FROM customer.workspace) AS workspaces,
      (SELECT count(*)::int FROM customer.membership) AS memberships,
      (SELECT count(*)::int FROM customer.provision_request) AS requests,
      (SELECT count(*)::int FROM app.domain_event) AS events,
      (SELECT count(*)::int FROM app.audit_event) AS audits,
      (SELECT count(*)::int FROM app.outbox) AS outbox`)
  ).rows[0];
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const subject of ['synthetic-context-alice', 'synthetic-context-bob'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject,
      executorId: f.serviceId,
      reason: 'Explicit invented context-switch fixture; no provider identity or email',
    });
});
afterAll(async () => {
  if (f) await Promise.all([f.owner.end(), f.runtime.end(), f.auth.end()]);
});

test('matching context preserves owner listing and atomic idempotent provisioning', async () => {
  const alice = service('synthetic-context-alice');
  const command = input();
  const before = await writes();
  const first = await alice.provision(command, 'synthetic-context-alice');
  expect(await alice.provision(command, 'synthetic-context-alice')).toEqual(first);
  expect(await alice.list('synthetic-context-alice')).toEqual([first]);
  expect(first).toMatchObject({ role: 'owner', synthetic: true, organisationId: null });
  const after = await writes();
  for (const key of Object.keys(before)) expect(after[key] - before[key]).toBe(1);
});

test('a switched fresh provider identity rejects the mounted old account draft and list before writes', async () => {
  let current = 'synthetic-context-alice';
  const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
    session(current),
  );
  expect((await client.list(current)).length).toBe(1);
  current = 'synthetic-context-bob';
  const before = await writes();
  for (const operation of [
    () => client.list('synthetic-context-alice'),
    () => client.provision(input('Synthetic stale Alice draft'), 'synthetic-context-alice'),
  ])
    await expect(operation()).rejects.toMatchObject({
      status: 409,
      message: 'Your account changed. Reload before continuing.',
    });
  expect(await writes()).toEqual(before);
  expect(await client.list('synthetic-context-bob')).toEqual([]);
  expect((await service('synthetic-context-alice').list()).length).toBe(1);
  expect(
    (await f.auth.query('SELECT count(*)::int AS n FROM customer_private.session_proof')).rows[0].n,
  ).toBe(0);
});

test('claiming an admitted subject cannot replace the actual provider subject or create staff authority', async () => {
  const unadmitted = service('not-admitted');
  const before = await writes();
  const staffMemberships = (await f.owner.query('SELECT count(*)::int AS n FROM app.membership'))
    .rows[0].n;
  await expect(unadmitted.provision(input(), 'synthetic-context-alice')).rejects.toMatchObject({
    status: 409,
  });
  await expect(unadmitted.provision(input(), 'not-admitted')).rejects.toThrow(
    'Customer access denied',
  );
  expect(await writes()).toEqual(before);
  expect((await f.owner.query('SELECT count(*)::int AS n FROM app.membership')).rows[0].n).toBe(
    staffMemberships,
  );
});

test('invalid context is bounded and rejected before any provider call or database write', async () => {
  let calls = 0;
  const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => {
    calls++;
    return session('synthetic-context-alice');
  });
  const before = await writes();
  for (const expected of ['', 'x'.repeat(201), 'synthetic\ncontext', 'synthetic\u007fcontext']) {
    await expect(client.list(expected)).rejects.toMatchObject({ status: 400 });
    await expect(client.provision(input(), expected)).rejects.toMatchObject({ status: 400 });
  }
  expect(calls).toBe(0);
  expect(await writes()).toEqual(before);
});

test('context never bypasses absent, unverified or expired provider sessions', async () => {
  const before = await writes();
  for (const [candidate, status] of [
    [null, 401],
    [{ ...session('synthetic-context-alice'), emailVerified: false }, 403],
    [{ ...session('synthetic-context-alice'), expiresAt: new Date(0) }, 401],
  ] as const) {
    const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => candidate);
    await expect(client.provision(input(), 'synthetic-context-alice')).rejects.toMatchObject({
      status,
    });
    await expect(client.list('synthetic-context-alice')).rejects.toMatchObject({ status });
  }
  expect(await writes()).toEqual(before);
});

test('unscoped existing callers still use only the fresh current identity and cannot see another owner', async () => {
  const bob = service('synthetic-context-bob');
  expect(await bob.list()).toEqual([]);
  const created = await bob.provision(input('Synthetic Bob context'));
  expect(await bob.list()).toEqual([created]);
  expect((await service('synthetic-context-alice').list()).map((w) => w.id)).not.toContain(
    created.id,
  );
});
