import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { migrateCustomerRequestAdmission } from '../../packages/db/src/customer-request-admission-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import type { CustomerSession } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import type { CustomerWorkspaceOptions } from '../../packages/auth/src/customer-session';

const issuer =
  'https://ep-autumn-scene-b17sgino.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let f: Awaited<ReturnType<typeof fixture>>;
const open: CustomerWorkspaceOptions = {
  enabled: true,
  synthetic: true,
  production: false,
  issuer,
  openAdmission: true,
};
const session = (subject: string): CustomerSession => ({
  subject,
  expiresAt: new Date(Date.now() + 3600000),
  emailVerified: true,
});
const requests = (subject: string) =>
  new CustomerRequestService(f.runtime, f.auth, open, async () => session(subject));
const principal = async (subject: string) =>
  (
    await f.owner.query(
      'SELECT id,disabled_at FROM customer_private.principal WHERE issuer=$1 AND subject=$2',
      [issuer, subject],
    )
  ).rows[0];
const authority = async (subject: string) =>
  (
    await f.owner.query(
      `SELECT a.reason,a.disabled_at FROM customer_private.request_admission a
      JOIN customer_private.principal p ON p.id=a.principal_id WHERE p.issuer=$1 AND p.subject=$2`,
      [issuer, subject],
    )
  ).rows;
async function admitOnly(subject: string) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')`,
    [hash, issuer, subject],
  );
  await f.auth.query('SELECT customer_private.admit_verified_subject($1)', [hash]);
  await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
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

test('before the module, open admission leaves a new account without private request access', async () => {
  await admitOnly('synthetic-before-module');
  expect(await principal('synthetic-before-module')).toBeTruthy();
  expect(await authority('synthetic-before-module')).toHaveLength(0);
  await expect(requests('synthetic-before-module').list()).rejects.toThrow();
});

test('the module installs once, repeats safely and records its exact hash', async () => {
  await migrateCustomerRequestAdmission(f.owner);
  await migrateCustomerRequestAdmission(f.owner);
  const sql = await readFile(
    'packages/db/customer-request-admission-migrations/0001_admit_requests_with_open_admission.sql',
  );
  expect(
    (await f.owner.query('SELECT name,sha256 FROM customer_request_admission_migrations.applied'))
      .rows,
  ).toEqual([
    {
      name: '0001_admit_requests_with_open_admission.sql',
      sha256: createHash('sha256').update(sql).digest('hex'),
    },
  ]);
});

test('an account admitted before the module gets request access on its next visit', async () => {
  const page = await requests('synthetic-before-module').list();
  expect(page.synthetic).toBe(true);
  expect(page.requests).toEqual([]);
  const rows = await authority('synthetic-before-module');
  expect(rows).toHaveLength(1);
  expect(rows[0].reason).toContain('Open synthetic admission');
  expect(rows[0].disabled_at).toBeNull();
});

test('a fresh verified account gets one principal and one request authority at first use', async () => {
  const page = await requests('synthetic-fresh').list();
  expect(page.requests).toEqual([]);
  expect(await authority('synthetic-fresh')).toHaveLength(1);
  await requests('synthetic-fresh').list();
  expect(await authority('synthetic-fresh')).toHaveLength(1);
});

test('the owner-admitted account that was pinned first is brought in without a duplicate', async () => {
  await requests('synthetic-pinned-first').list();
  expect(await authority('synthetic-pinned-first')).toHaveLength(1);
});

test('a revoked request authority is never re-enabled', async () => {
  await requests('synthetic-request-revoked').list();
  await f.owner.query(
    `UPDATE customer_private.request_admission SET disabled_at=now()
    WHERE principal_id=(SELECT id FROM customer_private.principal WHERE issuer=$1 AND subject=$2)`,
    [issuer, 'synthetic-request-revoked'],
  );
  await expect(requests('synthetic-request-revoked').list()).rejects.toThrow();
  const rows = await authority('synthetic-request-revoked');
  expect(rows).toHaveLength(1);
  expect(rows[0].disabled_at).not.toBeNull();
});

test('a disabled principal gets no request authority and stays disabled', async () => {
  await admitOnly('synthetic-principal-disabled');
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=now() WHERE issuer=$1 AND subject=$2',
    [issuer, 'synthetic-principal-disabled'],
  );
  await f.owner.query(
    `DELETE FROM customer_private.request_admission
    WHERE principal_id=(SELECT id FROM customer_private.principal WHERE issuer=$1 AND subject=$2)`,
    [issuer, 'synthetic-principal-disabled'],
  );
  await expect(requests('synthetic-principal-disabled').list()).rejects.toThrow();
  expect(await authority('synthetic-principal-disabled')).toHaveLength(0);
  expect((await principal('synthetic-principal-disabled')).disabled_at).not.toBeNull();
});

test('the admission rules are unchanged: attestation only, auth role only, ceiling kept', async () => {
  const call = (pool: typeof f.auth, hash: string) =>
    pool.query('SELECT customer_private.admit_verified_subject($1)', [hash]);
  await expect(call(f.auth, 'not-a-hash')).rejects.toThrow('Customer access denied');
  await expect(call(f.auth, sessionHash(randomBytes(32).toString('hex')))).rejects.toThrow(
    'Customer access denied',
  );
  await expect(call(f.runtime, sessionHash(randomBytes(32).toString('hex')))).rejects.toThrow(
    /permission denied/i,
  );
  await f.owner.query(
    `INSERT INTO customer_private.principal(issuer,subject,admission_reason)
    SELECT $1,'synthetic-bulk-'||g,'Bulk fixture to reach the admission ceiling' FROM generate_series(1,2000) g
    ON CONFLICT DO NOTHING`,
    [issuer],
  );
  await expect(requests('synthetic-over-the-ceiling').list()).rejects.toThrow(/admission is full/i);
  expect(await principal('synthetic-over-the-ceiling')).toBeUndefined();
  expect(await authority('synthetic-over-the-ceiling')).toHaveLength(0);
  // An existing account is still served at the ceiling.
  expect((await requests('synthetic-fresh').list()).synthetic).toBe(true);
});

test('a changed or foreign registry row refuses to run', async () => {
  await f.owner.query(
    "UPDATE customer_request_admission_migrations.applied SET sha256=repeat('0',64)",
  );
  await expect(migrateCustomerRequestAdmission(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query(`UPDATE customer_request_admission_migrations.applied SET sha256=$1`, [
    createHash('sha256')
      .update(
        await readFile(
          'packages/db/customer-request-admission-migrations/0001_admit_requests_with_open_admission.sql',
        ),
      )
      .digest('hex'),
  ]);
  await migrateCustomerRequestAdmission(f.owner);
});
