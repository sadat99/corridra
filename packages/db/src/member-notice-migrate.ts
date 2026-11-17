import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 U4, the member notice. Explicit optional installation, reached only through field_modules_action=member_notice: adds
// MEMBER_NOTICE to the inbox type check (hash guarded), the per-workspace delivery record, the per-member dismissal, the owner-run
// delivery function and the two customer functions. Installing writes no row and opens no access. It refuses unless the customer
// real-use modules are installed, like the other ADR-087 modules. The rollback folder is never applied. No runtime request
// receives this owner connection.
export function migrateMemberNotice(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateMemberNotice', () => migrateMemberNoticeRun(pool));
}

async function migrateMemberNoticeRun(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../member-notice-migrations/', import.meta.url),
    schema: 'member_notice_migrations',
    label: 'Member notice',
  });
}

export type MemberNoticeDelivery = {
  workspaceId: string;
  delivered: boolean;
  deliveredAt: Date;
  opensAt: Date;
  notices: number;
};

const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parses the owner's workspace list for member_notice_deliver: the word all, or workspace ids separated by commas, spaces or
 * new lines. Anything else refuses before the database is touched.
 */
export function memberNoticeTargets(text: string | undefined): 'all' | string[] {
  const value = (text ?? '').trim().toLowerCase();
  if (value === 'all') return 'all';
  const ids = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
  if (ids.length === 0)
    throw new Error('Member notice delivery needs the word all or at least one workspace id');
  for (const id of ids)
    if (!workspaceId.test(id))
      throw new Error(`Member notice delivery: not a workspace id: ${id.slice(0, 8)}`);
  return ids;
}

/**
 * ADR-087 4d: delivers the member notice, one workspace at a time, in one transaction, through the owner-run database function.
 * all means every real (not synthetic) workspace without a delivery record. A workspace delivered before keeps its first time
 * and gets no new inbox row. Refuses unless the module is installed. Do not run before U5 is merged and its install approved by
 * the owner: the notice names a switch-on time that must come true.
 */
export async function deliverMemberNotice(
  pool: DatabasePool,
  input: { targets: 'all' | string[]; deliveredBy: string },
): Promise<MemberNoticeDelivery[]> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const installed = await db.query<{ present: boolean }>(
      "SELECT to_regprocedure('customer_private.member_notice_deliver(uuid,text)') IS NOT NULL AS present",
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'The member notice module is not installed, so no notice was delivered. Run field_modules_action=member_notice first.',
      );
    const ids =
      input.targets === 'all'
        ? (
            await db.query<{ id: string }>(
              `SELECT w.tenant_id::text AS id FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id
               WHERE NOT t.synthetic
                AND NOT EXISTS(SELECT FROM customer_private.member_notice_delivery d WHERE d.workspace_id=w.tenant_id)
               ORDER BY w.tenant_id`,
            )
          ).rows.map((row) => row.id)
        : input.targets;
    const out: MemberNoticeDelivery[] = [];
    for (const id of ids) {
      const row = (
        await db.query<{
          delivered: boolean;
          delivered_at: Date;
          opens_at: Date;
          notices: number;
        }>('SELECT * FROM customer_private.member_notice_deliver($1::uuid,$2)', [
          id,
          input.deliveredBy,
        ])
      ).rows[0]!;
      out.push({
        workspaceId: id,
        delivered: row.delivered,
        deliveredAt: row.delivered_at,
        opensAt: row.opens_at,
        notices: row.notices,
      });
    }
    await db.query('COMMIT');
    return out;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
