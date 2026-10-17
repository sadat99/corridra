import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';

const issuer = 'https://ep-issuer-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const otherIssuer = issuer.replace('ep-issuer-fixture', 'ep-other-fixture');
const subject = 'synthetic-same-subject';
const session = (): CustomerSession => ({
  subject,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const options = { enabled: true, synthetic: true, production: false, issuer };
const input = () => ({ commandId: randomUUID(), name: 'Synthetic issuer context' });
let f: Awaited<ReturnType<typeof fixture>>;
const service = (provider = issuer) =>
  new CustomerWorkspaceService(f.runtime, f.auth, { ...options, issuer: provider }, async () =>
    session(),
  );
async function writes() {
  return (
    await f.owner.query(`SELECT
    (SELECT count(*)::int FROM customer.workspace) AS workspaces,
    (SELECT count(*)::int FROM customer.membership) AS memberships,
    (SELECT count(*)::int FROM customer.provision_request) AS requests,
    (SELECT count(*)::int FROM app.domain_event) AS events,
    (SELECT count(*)::int FROM app.audit_event) AS audits,
    (SELECT count(*)::int FROM app.outbox) AS outbox,
    (SELECT count(*)::int FROM app.outbox_delivery) AS deliveries,
    (SELECT count(*)::int FROM customer_private.session_proof) AS proofs`)
  ).rows[0];
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject,
    executorId: f.serviceId,
    reason: 'Invented issuer-boundary test fixture; no real provider account',
  });
});
afterAll(async () => {
  await f?.close();
});

test('matching issuer and subject preserve atomic provisioning and safe retry', async () => {
  const client = service();
  const request = input();
  const before = await writes();
  const created = await client.provision(request, subject, issuer);
  expect(await client.provision(request, subject, issuer)).toEqual(created);
  expect(await client.list(subject, issuer)).toEqual([created]);
  const after = await writes();
  for (const key of Object.keys(before))
    expect(after[key] - before[key]).toBe(key === 'proofs' ? 0 : 1);
});

test('the same subject at a changed issuer rejects the mounted old issuer before proofs or permanent writes', async () => {
  const before = await writes();
  const switched = service(otherIssuer);
  await expect(switched.list(subject, issuer)).rejects.toMatchObject({ status: 409 });
  await expect(switched.provision(input(), subject, issuer)).rejects.toMatchObject({ status: 409 });
  await expect(switched.list(undefined, issuer)).rejects.toMatchObject({ status: 409 });
  await expect(service().list(subject, otherIssuer)).rejects.toMatchObject({ status: 409 });
  expect(await writes()).toEqual(before);
  // A claimed matching context still cannot move the database's pinned issuer or admission.
  await expect(switched.provision(input(), subject, otherIssuer)).rejects.toThrow(
    'Customer access denied',
  );
  expect(await writes()).toEqual(before);
});

test('malformed issuer context is bounded and denied before provider or database access', async () => {
  let calls = 0;
  const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => {
    calls++;
    return session();
  });
  const before = await writes();
  for (const expected of [
    '',
    'https://example.invalid/corridra/auth',
    issuer + '?other=1',
    issuer.replace('https:', 'http:'),
    issuer.replace('https://', 'https://untrusted@'),
    'x'.repeat(501),
    issuer + '\n',
  ]) {
    await expect(client.list(subject, expected)).rejects.toMatchObject({ status: 400 });
    await expect(client.provision(input(), subject, expected)).rejects.toMatchObject({
      status: 400,
    });
  }
  expect(calls).toBe(0);
  expect(await writes()).toEqual(before);
});

test('issuer context cannot replace fresh verified identity and old callers retain their original authority', async () => {
  const before = await writes();
  for (const [candidate, status] of [
    [null, 401],
    [{ ...session(), emailVerified: false }, 403],
    [{ ...session(), expiresAt: new Date(0) }, 401],
  ] as const) {
    const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => candidate);
    await expect(client.list(subject, issuer)).rejects.toMatchObject({ status });
    await expect(client.provision(input(), subject, issuer)).rejects.toMatchObject({ status });
  }
  expect(await writes()).toEqual(before);
  expect(await service().list()).toEqual(await service().list(subject, issuer));
});
