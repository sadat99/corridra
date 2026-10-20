import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import type { CustomerWorkspaceOptions } from '../../packages/auth/src/customer-session';

const issuer =
  'https://ep-autumn-scene-b17sgino.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let f: Awaited<ReturnType<typeof fixture>>;
const closed: CustomerWorkspaceOptions = {
  enabled: true,
  synthetic: true,
  production: false,
  issuer,
};
const open: CustomerWorkspaceOptions = { ...closed, openAdmission: true };
const session = (subject: string, emailVerified = true): CustomerSession => ({
  subject,
  expiresAt: new Date(Date.now() + 3600000),
  emailVerified,
});
const service = (subject: string, options = open, emailVerified = true) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
    session(subject, emailVerified),
  );
const request = () => ({ name: 'Synthetic open admission workspace', commandId: randomUUID() });
const principals = async (subject: string) =>
  (
    await f.owner.query(
      'SELECT id,admission_reason,disabled_at FROM customer_private.principal WHERE issuer=$1 AND subject=$2',
      [issuer, subject],
    )
  ).rows;
async function attest(subject: string, proofIssuer = issuer, seconds = 25) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+($4||' seconds')::interval)`,
    [hash, proofIssuer, subject, String(seconds)],
  );
  return hash;
}

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'synthetic-pinned-first',
    executorId: f.serviceId,
    reason: 'Explicit invented integration fixture; no provider identity or email',
  });
  await migrateCustomerAdmission(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('the module installs once, repeats safely and records its exact hash', async () => {
  await migrateCustomerAdmission(f.owner);
  const sql = await readFile(
    'packages/db/customer-admission-migrations/0001_open_synthetic_admission.sql',
  );
  expect(
    (await f.owner.query('SELECT name,sha256 FROM customer_admission_migrations.applied')).rows,
  ).toEqual([
    {
      name: '0001_open_synthetic_admission.sql',
      sha256: createHash('sha256').update(sql).digest('hex'),
    },
  ]);
  expect((await f.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n).toBe(
    29,
  );
});

test('with open admission a fresh verified account gets a workspace and one principal', async () => {
  const workspace = await service('synthetic-newcomer').provision(request());
  expect(workspace.role).toBe('owner');
  expect(workspace.synthetic).toBe(true);
  const rows = await principals('synthetic-newcomer');
  expect(rows).toHaveLength(1);
  expect(rows[0].admission_reason).toContain('Open synthetic admission');
  expect(rows[0].disabled_at).toBeNull();
  // A second call admits nobody new.
  await service('synthetic-newcomer').provision(request());
  expect(await principals('synthetic-newcomer')).toHaveLength(1);
});

test('without the switch an unadmitted account stays denied and nothing is written', async () => {
  await expect(service('synthetic-closed', closed).provision(request())).rejects.toThrow();
  expect(await principals('synthetic-closed')).toHaveLength(0);
});

test('an unverified email is refused before any admission', async () => {
  await expect(service('synthetic-unverified', open, false).provision(request())).rejects.toThrow(
    'Verify your email',
  );
  expect(await principals('synthetic-unverified')).toHaveLength(0);
});

test('a disabled principal is never re-enabled by open admission', async () => {
  await service('synthetic-revoked').provision(request());
  const [row] = await principals('synthetic-revoked');
  await f.owner.query('UPDATE customer_private.principal SET disabled_at=now() WHERE id=$1', [
    row.id,
  ]);
  await expect(service('synthetic-revoked').provision(request())).rejects.toThrow();
  const [after] = await principals('synthetic-revoked');
  expect(after.disabled_at).not.toBeNull();
  expect(await principals('synthetic-revoked')).toHaveLength(1);
});

test('the function accepts only a fresh attestation for the pinned issuer from the auth role', async () => {
  const call = (hash: string) =>
    f.auth.query('SELECT customer_private.admit_verified_subject($1)', [hash]);
  await expect(call('not-a-hash')).rejects.toThrow('Customer access denied');
  await expect(call(sessionHash(randomBytes(32).toString('hex')))).rejects.toThrow(
    'Customer access denied',
  );
  const otherIssuer = 'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
  await expect(call(await attest('synthetic-foreign-issuer', otherIssuer))).rejects.toThrow(
    'Customer access denied',
  );
  expect(await principals('synthetic-foreign-issuer')).toHaveLength(0);
  const good = await attest('synthetic-direct');
  const { rows } = await call(good);
  expect(rows[0].admit_verified_subject).toMatch(/^[0-9a-f-]{36}$/);
  await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [good]);
});

test('the runtime role cannot call the function', async () => {
  const hash = await attest('synthetic-runtime-attempt');
  await expect(
    f.runtime.query('SELECT customer_private.admit_verified_subject($1)', [hash]),
  ).rejects.toThrow(/permission denied/i);
  expect(await principals('synthetic-runtime-attempt')).toHaveLength(0);
  await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
});

test('admission stops at the ceiling and existing principals still work', async () => {
  await f.owner.query(
    `INSERT INTO customer_private.principal(issuer,subject,admission_reason)
    SELECT $1,'synthetic-bulk-'||g,'Bulk fixture to reach the admission ceiling' FROM generate_series(1,2000) g
    ON CONFLICT DO NOTHING`,
    [issuer],
  );
  await expect(service('synthetic-over-the-ceiling').provision(request())).rejects.toThrow(
    /admission is full/i,
  );
  expect(await principals('synthetic-over-the-ceiling')).toHaveLength(0);
  expect((await service('synthetic-newcomer').provision(request())).role).toBe('owner');
});
