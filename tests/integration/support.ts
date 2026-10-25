import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, sessionHash, type RequestContext } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
export const sandbox = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
export const connection = (
  database: string,
  user = 'postgres',
  password = sandbox.ownerPassword,
) => ({ host: '127.0.0.1', port: 54329, database, user, password });
export async function freshDatabase(name: string) {
  if (!/^corridra_(integration|upgrade|upgrade_third|restore)$/.test(name))
    throw new Error('Only isolated integration databases may be reset');
  const admin = new Pool(connection('postgres'));
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  return new Pool(connection(name));
}
export async function fixture(database = 'corridra_integration', through?: string) {
  const owner = await freshDatabase(database);
  await migrate(owner, through);
  const runtime = new Pool(connection(database, 'corridra_runtime_local', sandbox.runtimePassword));
  const auth = new Pool(connection(database, 'corridra_auth_local', sandbox.authPassword));
  const tenantA = randomUUID(),
    tenantB = randomUUID(),
    serviceId = randomUUID();
  const users: Record<
    string,
    { id: string; identityId: string; token: string; sessionId: string; ctx: RequestContext }
  > = {};
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [serviceId],
    );
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [serviceId, randomUUID(), randomUUID()],
    );
    await client.query(
      "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Synthetic North',true),($2,'Synthetic South',true)",
      [tenantA, tenantB],
    );
    for (const [label, tenant, role] of [
      ['owner', tenantA, 'owner'],
      ['operator', tenantA, 'operator'],
      ['reviewer', tenantA, 'reviewer'],
      ['viewer', tenantA, 'viewer'],
      ['other', tenantB, 'owner'],
      ['outsider', null, null],
    ]) {
      const id = randomUUID(),
        identityId = randomUUID(),
        token = randomBytes(32).toString('hex'),
        sessionId = randomUUID();
      await client.query(
        'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
        [identityId, `Synthetic ${label}`, `${label}@example.invalid`],
      );
      await client.query(
        "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
        [id, identityId],
      );
      await client.query(
        'INSERT INTO identity.session(id,"userId",token,"expiresAt") VALUES($1,$2,$3,now()+interval \'1 hour\')',
        [sessionId, identityId, token],
      );
      // Synthetic assurance fixtures exercise RLS. Separate provider tests exercise real MFA.
      await client.query("INSERT INTO identity.assurance VALUES($1,now(),'totp')", [sessionId]);
      if (tenant)
        await client.query('INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,$3)', [
          tenant,
          id,
          role,
        ]);
      users[label!] = {
        id,
        identityId,
        token,
        sessionId,
        ctx: { token, tenantId: tenant ?? tenantA, purpose: 'synthetic_validation' },
      };
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return {
    owner,
    runtime,
    auth,
    tenantA,
    tenantB,
    users,
    serviceId,
    async close() {
      await Promise.all([owner.end(), runtime.end(), auth.end()]);
    },
  };
}
export async function rawContext(
  pool: Pool,
  ctx: RequestContext,
  sql: string,
  args: unknown[] = [],
) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$3,true),set_config('corridra.correlation_id',$4,true),set_config('corridra.causation_id',$5,true)",
      [sessionHash(ctx.token), ctx.tenantId, ctx.purpose, randomUUID(), randomUUID()],
    );
    const r = await c.query(sql, args);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
