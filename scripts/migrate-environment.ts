import { Pool } from '../packages/db/src/index';
import { migrate } from '../packages/db/src/migrate';
import { seedSyntheticWorkspace } from '../packages/auth/src/bootstrap';
import { z } from 'zod';
const v = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    MIGRATION_DATABASE_HOST: z.string().min(1),
    MIGRATION_ENVIRONMENT: z.enum(['nonprod-template', 'synthetic-preview']),
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
  throw new Error('Migration target does not match the approved Frankfurt database');
// Separate release job only. No build hook or production mode exists in Part 03.
const pool = new Pool({
  connectionString: v.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
try {
  await migrate(pool);
  if (process.env.SEED_SYNTHETIC === 'true') {
    if (v.MIGRATION_ENVIRONMENT !== 'synthetic-preview')
      throw new Error('Never seed accounts into a preview parent');
    await seedSyntheticWorkspace(pool, {
      email: process.env.SYNTHETIC_OPERATOR_EMAIL,
      password: process.env.SYNTHETIC_OPERATOR_PASSWORD,
      name: 'Synthetic Operator',
    });
  }
  console.log('Reviewed migrations applied. No secret values were written to output.');
} finally {
  await pool.end();
}
