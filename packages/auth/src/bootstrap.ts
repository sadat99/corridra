import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { sessionHash, type DatabasePool, type RequestContext } from '@corridra/db';
import { z } from 'zod';
import { countryCode } from '@corridra/domain/geography';
// Offline provisioning only. Never expose the schema-owner connection to a request handler.
export async function seedSyntheticWorkspace(pool: DatabasePool, input: unknown) {
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

// Controlled offline synthetic invitation. Never attach this schema-owner connection to HTTP.
// Customer accounts are separate; matching an email never grants execution or tenant access.
export async function provisionSyntheticContributor(
  pool: DatabasePool,
  ctx: RequestContext,
  input: unknown,
) {
  const v = z
    .object({
      email: z.email().refine((s) => s.endsWith('@example.invalid')),
      password: z.string().min(14).max(128),
      name: z.string().min(1).max(80),
      operatingCountry: countryCode,
    })
    .strict()
    .parse(input);
  const db = await pool.connect(),
    userId = randomUUID(),
    principalId = randomUUID(),
    password = await hashPassword(v.password);
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','synthetic_validation',true)",
      [sessionHash(ctx.token), ctx.tenantId],
    );
    const approval = (
      await db.query(
        "SELECT coalesce(app.can_access($1,'INTERNAL','synthetic_validation') AND app.member_role($1) IN ('owner','admin') AND app.fresh_mfa() AND EXISTS(SELECT FROM app.tenant WHERE id=$1 AND synthetic),false) AS approved",
        [ctx.tenantId],
      )
    ).rows[0];
    if (!approval?.approved) throw new Error('Reviewed synthetic invitation authority required');
    await db.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,false,false)',
      [userId, v.name, v.email],
    );
    await db.query(
      'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
      [randomUUID(), userId, password],
    );
    await db.query(
      'INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,$3)',
      [principalId, userId, v.operatingCountry],
    );
    await db.query('COMMIT');
    return { userId, principalId, requiresAuthenticator: true, tenantMembershipGranted: false };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
