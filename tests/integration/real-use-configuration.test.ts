import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';

let f: Awaited<ReturnType<typeof fixture>>;
let originalMemberships: unknown[];
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await pinCustomerAuthority(f.owner, {
    issuer: 'https://ep-real-config-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    executorId: f.serviceId,
  });
  await f.owner.query(
    `INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version)
    VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')`,
    [f.tenantA, f.serviceId, f.users.owner.id],
  );
  originalMemberships = (
    await f.owner.query('SELECT * FROM app.membership WHERE tenant_id=$1 ORDER BY user_id', [
      f.tenantA,
    ])
  ).rows;
});
afterAll(async () => {
  await f?.close();
});
const reason = 'Owner approved real-use admission with explicit scanning deferral';
test('restricted runtime and auth cannot configure admission', async () => {
  for (const pool of [f.runtime, f.auth])
    await expect(configureCustomerRealUse(pool, { enabled: true, reason })).rejects.toThrow();
  expect(
    (await f.owner.query('SELECT * FROM customer_private.real_use_configuration')).rowCount,
  ).toBe(0);
});
test('initialization creates separate provenance and preserves existing memberships exactly', async () => {
  expect(await configureCustomerRealUse(f.owner, { enabled: true, reason })).toEqual({
    enabled: true,
    changed: true,
  });
  const cfg = (await f.owner.query('SELECT * FROM customer_private.real_use_configuration'))
    .rows[0];
  expect(cfg.intake_tenant_id).not.toBe(f.tenantA);
  expect(
    (await f.owner.query('SELECT synthetic FROM app.tenant WHERE id=$1', [cfg.intake_tenant_id]))
      .rows[0].synthetic,
  ).toBe(false);
  expect(
    (
      await f.owner.query('SELECT * FROM app.membership WHERE tenant_id=$1 ORDER BY user_id', [
        f.tenantA,
      ])
    ).rows,
  ).toEqual(originalMemberships);
  const realMemberships = (
    await f.owner.query('SELECT * FROM app.membership WHERE tenant_id=$1 ORDER BY user_id', [
      cfg.intake_tenant_id,
    ])
  ).rows;
  expect(realMemberships.length).toBe(originalMemberships.length);
  for (const membership of realMemberships)
    expect(membership.allowed_purposes).toEqual(['commercial_qualification']);
  expect(
    (
      await f.owner.query(
        "SELECT value FROM app.config_version WHERE tenant_id=$1 AND key='evidence.scan_bypass'",
        [cfg.intake_tenant_id],
      )
    ).rows[0].value,
  ).toEqual({ enabled: true, reason });
});
test('exact retries are idempotent and pausing appends control without deleting configuration', async () => {
  expect(await configureCustomerRealUse(f.owner, { enabled: true, reason })).toEqual({
    enabled: true,
    changed: false,
  });
  expect(
    await configureCustomerRealUse(f.owner, {
      enabled: false,
      reason: 'Pause new admission while retaining all existing access',
    }),
  ).toEqual({ enabled: false, changed: true });
  expect(
    (
      await f.owner.query(
        'SELECT version,enabled FROM customer_private.real_use_admission_control ORDER BY version',
      )
    ).rows,
  ).toEqual([
    { version: 1, enabled: true },
    { version: 2, enabled: false },
  ]);
  expect(
    (await f.owner.query('SELECT enabled FROM customer_private.real_use_configuration')).rows,
  ).toEqual([{ enabled: true }]);
  expect(
    (await f.owner.query('SELECT customer_private.real_admission_open() AS open')).rows[0].open,
  ).toBe(false);
});
