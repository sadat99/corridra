import type { DatabasePool } from './index';

// ADR-087 U4, delivery of the member notice. Owner run only, through field_modules_action=member_notice_deliver. Kept apart
// from the migrator, which installs and never delivers.
export type MemberNoticeDelivery = {
  workspaceId: string;
  delivered: boolean;
  deliveredAt: Date;
  opensAt: Date;
  notices: number;
};

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
