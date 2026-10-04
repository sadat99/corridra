import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from '@corridra/db';
import { z } from 'zod';
// Offline provisioning only. Never expose the schema-owner connection to a request handler.
export async function seedSyntheticWorkspace(pool: Pool, input: unknown) {
  const v = z
    .object({
      email: z.email().refine((s) => s.endsWith('@example.invalid')),
      password: z.string().min(14).max(128),
      name: z.string().min(1).max(80),
    })
    .parse(input);
  const hash = await hashPassword(v.password),
    tenantId = randomUUID(),
    userId = randomUUID(),
    principalId = randomUUID(),
    serviceId = randomUUID();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [serviceId],
    );
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [serviceId, randomUUID(), randomUUID()],
    );
    await db.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,false,false)',
      [userId, v.name, v.email],
    );
    await db.query(
      'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
      [randomUUID(), userId, hash],
    );
    await db.query(
      "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
      [principalId, userId],
    );
    await db.query("INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Synthetic North',true)", [
      tenantId,
    ]);
    await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
      tenantId,
      principalId,
    ]);
    await db.query('COMMIT');
    return { tenantId, userId, principalId };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
export { hashPassword };
