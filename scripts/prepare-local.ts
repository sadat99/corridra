import { readFile } from 'node:fs/promises';
import { Pool } from '../packages/db/src/index';
import { migrate } from '../packages/db/src/migrate';
const c = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
const pool = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: c.ownerPassword,
  database: 'corridra_test',
});
// A fresh container answers pg_isready inside itself while the image's temporary start-up server is
// still running; the published port can refuse or reset the first connections until the real server is
// up (KI-35). So wait until a query over this connection is answered, then migrate.
async function waitForDatabase(attempts = 30, delayMs = 1000) {
  let last: unknown;
  // An idle connection that the server drops must not crash this script while it is waiting.
  const ignore = () => undefined;
  pool.on('error', ignore);
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await pool.query('SELECT 1');
        if (attempt > 1) console.log(`Local PostgreSQL answered on try ${attempt} of ${attempts}.`);
        return;
      } catch (error) {
        last = error;
        console.log(
          `Waiting for local PostgreSQL, try ${attempt} of ${attempts}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    pool.off('error', ignore);
  }
  throw new Error(
    `Local PostgreSQL did not answer a query on port 54329 after ${attempts} tries (${last instanceof Error ? last.message : String(last)})`,
  );
}
await waitForDatabase();
await migrate(pool);
for (const [name, group, password] of [
  ['corridra_runtime_local', 'corridra_runtime', c.runtimePassword],
  ['corridra_auth_local', 'corridra_auth', c.authPassword],
]) {
  const old = await pool.query('SELECT FROM pg_roles WHERE rolname=$1', [name]);
  if (!old.rowCount)
    await pool.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
  await pool.query(`GRANT ${group} TO ${name}`);
}
console.log(
  'Fresh foundation migrations applied; separate restricted runtime and auth identities created.',
);
await pool.end();
