import { randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';

/**
 * A sample workspace where the browser test person is an ordinary operator, made when none exists yet, so a spec
 * that needs one does not depend on an earlier spec having left it behind (KI-65). Same rows and the same
 * bootstrap settings as the governance spec uses for its own restricted workspace. Returns the workspace id.
 */
export async function ensureOrdinaryOperatorScope(principalId: string, ownerPassword: string) {
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: ownerPassword,
  });
  try {
    const known = await db.query(
      "SELECT tenant_id FROM app.membership WHERE user_id=$1 AND role='operator' AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
      [principalId],
    );
    if (known.rows[0]) return known.rows[0].tenant_id as string;
    const tenant = randomUUID();
    const actor = randomUUID();
    await db.query('BEGIN');
    try {
      await db.query(
        "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
        [actor],
      );
      await db.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [actor, randomUUID(), randomUUID()],
      );
      await db.query(
        "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'V3 founder ordinary operator scope',true)",
        [tenant],
      );
      await db.query(
        "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'operator')",
        [tenant, principalId],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    return tenant;
  } finally {
    await db.end();
  }
}
