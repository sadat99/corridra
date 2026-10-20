import { databasePool } from './database-pool';
import { migrateCustomerAuthority } from '../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../packages/db/src/customer-delivery-migrate';
import { migrateCustomerRequestDetails } from '../packages/db/src/customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from '../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../packages/db/src/customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from '../packages/db/src/customer-programme-migrate';
import { migrateCustomerParticipants } from '../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from '../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from '../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerMissionShares } from '../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerMemberRoles } from '../packages/db/src/customer-member-role-migrate';
import { migrateCustomerAdmission } from '../packages/db/src/customer-admission-migrate';
import { pinCustomerAuthority } from '../packages/auth/src/customer-authority-pin';
import { z } from 'zod';

// Owner-run release job only. It installs the optional customer modules, in dependency order, into the
// approved Frankfurt database. The default is a read-only report; nothing is written without
// INSTALL_APPLY=yes. Every installer is idempotent and refuses a changed or missing applied file.
const v = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    MIGRATION_DATABASE_HOST: z.string().min(1),
    INSTALL_APPLY: z.string().optional(),
    // Optional: pin the customer issuer and event executor after the modules are installed.
    CUSTOMER_ISSUER: z.string().optional(),
    CUSTOMER_EXECUTOR_ID: z.string().optional(),
  })
  .parse(process.env);
const url = new URL(v.MIGRATION_DATABASE_URL);
if (
  url.hostname !== v.MIGRATION_DATABASE_HOST ||
  !url.hostname.endsWith('.eu-central-1.aws.neon.tech') ||
  url.searchParams.get('sslmode') !== 'verify-full' ||
  url.username !== 'corridra_migrator' ||
  url.pathname !== '/corridra'
)
  throw new Error('Install target does not match the approved Frankfurt database');
const apply = v.INSTALL_APPLY === 'yes';

const registries = [
  'customer_migrations',
  'customer_commercial_migrations',
  'customer_company_migrations',
  'customer_decision_migrations',
  'customer_delivery_migrations',
  'customer_detail_migrations',
  'customer_organisation_profile_migrations',
  'customer_mission_draft_migrations',
  'customer_programme_migrations',
  'customer_participant_migrations',
  'customer_programme_context_migrations',
  'customer_programme_economics_migrations',
  'customer_programme_coordination_migrations',
  'customer_programme_templates_migrations',
  'customer_mission_share_migrations',
  'customer_admission_migrations',
  'customer_member_role_migrations',
];
// Order matters only for readability: each installer first installs what it depends on.
const installers: [string, (pool: ReturnType<typeof databasePool>) => Promise<void>][] = [
  ['customer authority', migrateCustomerAuthority],
  ['saved commercial reports', migrateCustomerSavedMissions],
  ['company continuity', migrateCustomerCompanies],
  ['report decisions', migrateCustomerDecisions],
  ['assigned missions', migrateCustomerDelivery],
  ['request details', migrateCustomerRequestDetails],
  ['organisation profiles', migrateCustomerOrganisationProfiles],
  ['guided request drafts', migrateCustomerMissionDrafts],
  ['programmes', migrateCustomerProgrammes],
  ['participants', migrateCustomerParticipants],
  ['programme context', migrateCustomerProgrammeContext],
  ['programme economics', migrateCustomerProgrammeEconomics],
  ['programme coordination', migrateCustomerProgrammeCoordination],
  ['programme templates', migrateCustomerProgrammeTemplates],
  ['mission sharing', migrateCustomerMissionShares],
  ['open synthetic admission', migrateCustomerAdmission],
  ['member roles and leaving', migrateCustomerMemberRoles],
];

const pool = databasePool(v.MIGRATION_DATABASE_URL);
async function report(label: string) {
  const out: string[] = [];
  for (const schema of registries) {
    const exists = await pool.query<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [schema + '.applied'],
    );
    if (!exists.rows[0]!.present) {
      out.push(`${schema}: not installed`);
      continue;
    }
    const rows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${schema}.applied`,
    );
    out.push(`${schema}: ${rows.rows[0]!.n} applied`);
  }
  const core = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM migrations.applied',
  );
  console.log(`${label}\ncore migrations applied: ${core.rows[0]!.n}\n${out.join('\n')}`);
}
try {
  await report(apply ? 'Before install' : 'Read-only report (nothing written)');
  if (apply) {
    for (const [name, install] of installers) {
      await install(pool);
      console.log(`installed or already current: ${name}`);
    }
    if (v.CUSTOMER_ISSUER || v.CUSTOMER_EXECUTOR_ID) {
      if (!v.CUSTOMER_ISSUER || !v.CUSTOMER_EXECUTOR_ID)
        throw new Error('Pinning needs both CUSTOMER_ISSUER and CUSTOMER_EXECUTOR_ID');
      const result = await pinCustomerAuthority(pool, {
        issuer: v.CUSTOMER_ISSUER,
        executorId: v.CUSTOMER_EXECUTOR_ID,
      });
      console.log(`customer issuer and executor: ${result.pinned}`);
    }
    await report('After install');
    console.log('Install complete. No secret values were written to output.');
  } else {
    console.log('Dry run only. Set INSTALL_APPLY=yes to install.');
  }
} finally {
  await pool.end();
}
