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
