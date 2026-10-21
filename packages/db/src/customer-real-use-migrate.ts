import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerAuthority } from './customer-migrate';
import { migrateCustomerSavedMissions } from './customer-commercial-migrate';
import { migrateCustomerCompanies } from './customer-company-migrate';
import { migrateCustomerDecisions } from './customer-decision-migrate';
import { migrateCustomerDelivery } from './customer-delivery-migrate';
import { migrateCustomerRequestDetails } from './customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from './customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from './customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from './customer-programme-migrate';
import { migrateCustomerParticipants } from './customer-participant-migrate';
import { migrateCustomerProgrammeContext } from './customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from './customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from './customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from './customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from './customer-programme-pricing-migrate';
import { migrateCustomerMissionShares } from './customer-mission-share-migrate';
import { migrateCustomerMemberRoles } from './customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from './customer-organisation-link-migrate';
import { migrateCustomerProgrammeTerms } from './customer-programme-terms-migrate';
import { migrateCustomerServiceRequests } from './customer-service-request-migrate';
import { migrateCustomerAdmission } from './customer-admission-migrate';
import { migrateCustomerRequestAdmission } from './customer-request-admission-migrate';
// Explicit optional ADR056 authority. Installation alone does not activate real admission.
export async function migrateCustomerRealUse(pool: DatabasePool) {
  await migrateCustomerAuthority(pool);
  await migrateCustomerSavedMissions(pool);
  await migrateCustomerCompanies(pool);
  await migrateCustomerDecisions(pool);
  await migrateCustomerDelivery(pool);
  await migrateCustomerRequestDetails(pool);
  await migrateCustomerOrganisationProfiles(pool);
  await migrateCustomerMissionDrafts(pool);
  await migrateCustomerProgrammes(pool);
  await migrateCustomerParticipants(pool);
  await migrateCustomerProgrammeContext(pool);
  await migrateCustomerProgrammeEconomics(pool);
  await migrateCustomerProgrammeCoordination(pool);
  await migrateCustomerProgrammeTemplates(pool);
  await migrateCustomerProgrammePricing(pool);
  await migrateCustomerMissionShares(pool);
  await migrateCustomerMemberRoles(pool);
  await migrateCustomerOrganisationLinks(pool);
  await migrateCustomerProgrammeTerms(pool);
  await migrateCustomerServiceRequests(pool);
  await migrateCustomerAdmission(pool);
  await migrateCustomerRequestAdmission(pool);
  const directory = new URL('../customer-real-use-migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of files) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_real_use_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_real_use_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_real_use_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_real_use_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Customer real-use migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_real_use_migrations.applied(name,sha256) VALUES($1,$2)',
        [name, source.hash],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
