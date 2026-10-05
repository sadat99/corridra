import { randomUUID } from 'node:crypto';
import { type DatabasePool } from '@corridra/db';
// Offline administrator action only. Never import into the app or a route.
export async function configureSyntheticIntake(
  pool: DatabasePool,
  tenantId: string,
  ownerId: string,
) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const r = await db.query(
      "SELECT FROM app.tenant t JOIN app.membership m ON m.tenant_id=t.id JOIN identity.principal p ON p.id=m.user_id WHERE t.id=$1 AND t.synthetic AND m.user_id=$2 AND m.role='owner' AND m.revoked_at IS NULL AND p.disabled_at IS NULL",
      [tenantId, ownerId],
    );
    if (!r.rowCount) throw new Error('Intake requires a synthetic tenant and its active owner');
    const old = await db.query('SELECT * FROM app.intake_destination WHERE singleton');
    if (old.rowCount) {
      if (old.rows[0].tenant_id !== tenantId || old.rows[0].owner_id !== ownerId)
        throw new Error('Existing destination cannot be replaced implicitly');
      await db.query('COMMIT');
      return;
    }
    const serviceId = randomUUID();
    await db.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [serviceId],
    );
    await db.query(
      "INSERT INTO app.intake_destination(tenant_id,service_id,owner_id,enabled,notice_version) VALUES($1,$2,$3,true,'synthetic-intake-2026-10-05-v1')",
      [tenantId, serviceId, ownerId],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
