import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { authorize, DomainError, type Permission, type Role } from '@corridra/domain';
export { Pool };
export type { PoolClient };
export type RequestContext = {
  token: string;
  tenantId: string;
  purpose: string;
  correlationId?: string;
  causationId?: string;
};
export type TenantTransaction = {
  db: PoolClient;
  actorId: string;
  tenantId: string;
  role: Role;
  purpose: string;
  freshMfa: boolean;
};
export function sessionHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export async function assertRestrictedPool(pool: Pool, group = 'corridra_runtime') {
  const {
    rows: [r],
  } = await pool.query(
    `SELECT r.rolsuper,r.rolbypassrls,pg_has_role(current_user,$1,'member') AS member,
 EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','identity') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_tables
 FROM pg_roles r WHERE r.rolname=current_user`,
    [group],
  );
  if (!r || r.rolsuper || r.rolbypassrls || r.owns_tables || !r.member)
    throw new Error('Runtime database identity is not restricted');
}
export async function withTenant<T>(
  pool: Pool,
  ctx: RequestContext,
  permission: Permission,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$3,true),set_config('corridra.correlation_id',$4,true),set_config('corridra.causation_id',$5,true)`,
      [
        sessionHash(ctx.token),
        ctx.tenantId,
        ctx.purpose,
        ctx.correlationId ?? randomUUID(),
        ctx.causationId ?? randomUUID(),
      ],
    );
    const {
      rows: [a],
    } = await db.query(
      'SELECT app.actor_id() AS actor_id,app.member_role($1::uuid) AS role,app.fresh_mfa() AS fresh',
      [ctx.tenantId],
    );
    if (!a?.actor_id || !a.role) throw new DomainError('Access denied');
    authorize(a.role, permission);
    if (['trust.verify', 'members.manage', 'config.manage'].includes(permission) && !a.fresh)
      throw new DomainError('Verify your authenticator again to continue', 401);
    const result = await work({
      db,
      actorId: a.actor_id,
      tenantId: ctx.tenantId,
      role: a.role,
      purpose: ctx.purpose,
      freshMfa: a.fresh,
    });
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
