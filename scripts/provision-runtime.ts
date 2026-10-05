import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertRestrictedPool } from '../packages/db/src/index';
import { databasePool } from './database-pool';
import { z } from 'zod';
const v = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    MIGRATION_DATABASE_HOST: z.string().min(1),
    MIGRATION_ENVIRONMENT: z.literal('synthetic-preview'),
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
  throw new Error('An approved synthetic child database is required');
const roles = (
  [
    ['corridra_app_login', 'corridra_runtime', 'RUNTIME_DATABASE_URL'],
    ['corridra_identity_login', 'corridra_auth', 'AUTH_DATABASE_URL'],
  ] as const
).map(([role, group, key]) => {
  const password = randomBytes(32).toString('hex'),
    connection = new URL(url);
  connection.username = role;
  connection.password = password;
  return { role, group, key, password, connection: connection.toString() };
});
// Save generated credentials before creating roles so an interrupted command cannot lose them.
// Exclusive file creation prevents accidental replacement of a previous provisioning attempt.
await mkdir('.cache', { recursive: true });
await writeFile(
  '.cache/preview-runtime-secrets.json',
  JSON.stringify(Object.fromEntries(roles.map((r) => [r.key, r.connection]))),
  { mode: 0o600, flag: 'wx' },
);
const pool = databasePool(url.toString());
const db = await pool.connect();
try {
  await db.query('BEGIN');
  for (const { role, group, password } of roles) {
    if ((await db.query('SELECT FROM pg_roles WHERE rolname=$1', [role])).rowCount)
      throw new Error('Login already exists; rotate deliberately instead of overwriting');
    // Identifiers are fixed source literals; password is generated hex, never caller SQL.
    await db.query(
      `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    );
    await db.query(`GRANT ${group} TO ${role}`);
  }
  await db.query('COMMIT');
  for (const r of roles) {
    const check = databasePool(r.connection);
    try {
      await assertRestrictedPool(check, r.group);
    } finally {
      await check.end();
    }
  }
  console.log(
    'Restricted credentials saved to ignored .cache/preview-runtime-secrets.json. Import securely into this preview branch only.',
  );
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  db.release();
  await pool.end();
}
