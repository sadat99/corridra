import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  authorize,
  DomainError,
  type Permission,
  type Role,
  stepUpRequired,
} from '@corridra/domain';
export { Pool };
export type { PoolClient };
export type DatabaseClient = Pick<PoolClient, 'query' | 'release'>;
export type DatabasePool = Pick<Pool, 'query' | 'end'> & {
  connect(): Promise<DatabaseClient>;
};
export type RequestContext = {
  token: string;
  tenantId: string;
  purpose: string;
  correlationId?: string;
  causationId?: string;
};
export type TenantTransaction = {
  db: DatabaseClient;
  actorId: string;
  tenantId: string;
  role: Role;
  purpose: string;
  freshMfa: boolean;
};
export function sessionHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export async function assertRestrictedPool(
  pool: DatabasePool,
  group: 'corridra_runtime' | 'corridra_auth' = 'corridra_runtime',
) {
  const {
    rows: [r],
  } = await pool.query(
    `SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,pg_has_role(current_user,$1,'member') AS member,
 pg_has_role(current_user,CASE WHEN $1='corridra_runtime' THEN 'corridra_auth' ELSE 'corridra_runtime' END,'member') AS crosses_boundary,
 EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','identity') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_tables
 FROM pg_roles r WHERE r.rolname=current_user`,
    [group],
  );
  if (
    !r ||
    r.rolsuper ||
    r.rolbypassrls ||
    r.rolcreaterole ||
    r.rolcreatedb ||
    r.rolreplication ||
    r.crosses_boundary ||
    r.owns_tables ||
    !r.member
  )
    throw new Error('Runtime database identity is not restricted');
}
// Permissions that also need an authenticator check from the last few minutes (otherwise STEP_UP_REQUIRED).
const freshMfaPermissions: readonly Permission[] = [
  'trust.verify',
  'members.manage',
  'config.manage',
  'research.resolve',
  'communications.approve',
  'opportunities.accounting',
  'delivery.share',
  'viewas.open',
  'problems.triage',
  'programme.applications.read',
];
/** The session's actor, role and authenticator freshness in this workspace, refused unless they allow `permission`. */
async function currentAuthority(db: DatabaseClient, tenantId: string, permission: Permission) {
  const {
    rows: [a],
  } = await db.query<{ actor_id: string | null; role: Role | null; fresh: boolean }>(
    'SELECT app.actor_id() AS actor_id,app.member_role($1::uuid) AS role,app.fresh_mfa() AS fresh',
    [tenantId],
  );
  if (!a?.actor_id || !a.role) throw new DomainError('Access denied');
  authorize(a.role, permission);
  if (freshMfaPermissions.includes(permission) && !a.fresh) throw stepUpRequired();
  return { actorId: a.actor_id, role: a.role, freshMfa: a.fresh };
}
export async function withTenant<T>(
  pool: DatabasePool,
  ctx: RequestContext,
  permission: Permission,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let rollbackError: Error | undefined;
  try {
    await db.query('BEGIN');
    const processingPurpose =
      process.env.CORRIDRA_REAL_USE_ENABLED === 'true' && ctx.purpose === 'synthetic_validation'
        ? (
            await db.query<{ purpose: string }>(
              'SELECT app.tenant_processing_purpose($1) AS purpose',
              [ctx.tenantId],
            )
          ).rows[0].purpose
        : ctx.purpose;
    await db.query(
      `SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$3,true),set_config('corridra.correlation_id',$4,true),set_config('corridra.causation_id',$5,true)`,
      [
        sessionHash(ctx.token),
        ctx.tenantId,
        processingPurpose,
        ctx.correlationId ?? randomUUID(),
        ctx.causationId ?? randomUUID(),
      ],
    );
    const a = await currentAuthority(db, ctx.tenantId, permission);
    const result = await work({
      db,
      actorId: a.actorId,
      tenantId: ctx.tenantId,
      role: a.role,
      purpose: processingPurpose,
      freshMfa: a.freshMfa,
    });
    await db.query('COMMIT');
    return result;
  } catch (error) {
    rollbackError = await rollback(db);
    throw error;
  } finally {
    db.release(rollbackError);
  }
}
/**
 * Re-checks the caller's authority inside an open tenant transaction, for work that waited on a lock after
 * withTenant's own check. Only changes committed meanwhile are caught (a role change, a revocation, a sign-out, a
 * new or aged authenticator check); now() is fixed when the transaction began, so a check that merely ran out of
 * time during the wait is not.
 */
export async function reauthorize(tx: TenantTransaction, permission: Permission) {
  const a = await currentAuthority(tx.db, tx.tenantId, permission);
  if (a.actorId !== tx.actorId) throw new DomainError('Access denied');
}
/**
 * Ends a failed transaction. A failed ROLLBACK leaves the connection in an unknown state, so its error is returned
 * for release() to discard the connection, and the caller still reports the error that started the rollback.
 */
export async function rollback(db: DatabaseClient): Promise<Error | undefined> {
  try {
    await db.query('ROLLBACK');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error('Rollback failed');
  }
}
