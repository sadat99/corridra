import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';

let f: Awaited<ReturnType<typeof fixture>>;
let intakeService: string;
const reason = 'Owner approved real use with deferred scanning and retained access controls';
beforeEach(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await pinCustomerAuthority(f.owner, {
    issuer: 'https://ep-real-distinct.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    executorId: f.serviceId,
  });
  intakeService = randomUUID();
  await f.owner.query(
    "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
    [intakeService],
  );
  await f.owner.query(
    `INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version)
    VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')`,
    [f.tenantA, intakeService, f.users.owner.id],
  );
});
afterEach(async () => {
  await f?.close();
});

test('independent active intake and customer executors enable without repinning either authority', async () => {
  const original = (await f.owner.query('SELECT * FROM customer_private.configuration')).rows;
  const destination = (await f.owner.query('SELECT * FROM app.intake_destination')).rows;
  expect(await configureCustomerRealUse(f.owner, { enabled: true, reason })).toEqual({
    enabled: true,
    changed: true,
  });
  expect((await f.owner.query('SELECT * FROM customer_private.configuration')).rows).toEqual(
    original,
  );
  expect((await f.owner.query('SELECT * FROM app.intake_destination')).rows).toEqual(destination);
  const real = (
    await f.owner.query('SELECT executor_id,owner_id FROM customer_private.real_use_configuration')
  ).rows[0];
  expect(real).toEqual({ executor_id: f.serviceId, owner_id: f.users.owner.id });
  expect(
    (await f.owner.query('SELECT customer_private.real_admission_open() AS open')).rows[0].open,
  ).toBe(true);
});
for (const which of ['intake', 'customer'] as const)
  test(`disabled ${which} service cannot initialize real admission`, async () => {
    await f.owner.query('UPDATE identity.principal SET disabled_at=clock_timestamp() WHERE id=$1', [
      which === 'intake' ? intakeService : f.serviceId,
    ]);
    await expect(configureCustomerRealUse(f.owner, { enabled: true, reason })).rejects.toThrow(
      'Pinned issuer, active executor and existing intake owner are required',
    );
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::integer AS n FROM customer_private.real_use_configuration',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::integer AS n FROM customer_private.real_use_admission_control',
        )
      ).rows[0].n,
    ).toBe(0);
  });
