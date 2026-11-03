import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';

// An environment that already installed 0001 records its hash, so 0001 may never change and the installer must
// accept it as applied. Later files are added to this module as new files.
const directory = resolve('packages/db/customer-programme-projection-migrations');
const first = '0001_consented_programme_projections.sql';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;
const registry = async () =>
  (
    await f.owner.query<{ name: string; sha256: string; applied_at: Date }>(
      'SELECT name,sha256,applied_at FROM customer_programme_projection_migrations.applied ORDER BY name',
    )
  ).rows;
beforeAll(async () => {
  f = await fixture('corridra_upgrade_third');
  await migrateCustomerOrganisationProfiles(f.owner);
  await migrateCustomerProgrammeTerms(f.owner);
  await migrateCustomerProgrammeContext(f.owner);
  await migrateCustomerMissionShares(f.owner);
  await f.owner.query('CREATE SCHEMA IF NOT EXISTS customer_programme_projection_migrations');
  await f.owner.query(
    'REVOKE ALL ON SCHEMA customer_programme_projection_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
  );
  await f.owner.query(
    'CREATE TABLE IF NOT EXISTS customer_programme_projection_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  // Install 0001 exactly as the installer did when it was released: the file, then its hash.
  const sql = readFileSync(`${directory}/${first}`, 'utf8');
  await f.owner.query(sql);
  await f.owner.query(
    'INSERT INTO customer_programme_projection_migrations.applied(name,sha256) VALUES($1,$2)',
    [first, sha(sql)],
  );
});
afterAll(async () => {
  await f?.close();
});

describe('upgrading an installed programme-projection module', () => {
  test('the installer recognises the installed file by its recorded hash and does not apply it again', async () => {
    const applied = await registry();
    await migrateCustomerProgrammeProjections(f.owner);
    expect(await registry()).toEqual(applied);
    expect(applied.map((row) => row.name)).toEqual([first]);
  });

  test('the released file is exactly the bytes whose hash is recorded in installed databases', () => {
    // Once a projection file is on main it never changes; a correction is always a new file.
    expect(sha(readFileSync(`${directory}/${first}`, 'utf8'))).toBe(
      'dc9430eb0ed5e8a5030fbe17f1f1d6c85e4860c96e43e20ac4fc97529024650b',
    );
  });
});
