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
export type MemberNoticeRun = {
  deliveries: MemberNoticeDelivery[];
  // Real workspaces left out of all: made-up, demo or QA by the data cleanup classifier, or archived. Counts only.
  skipped: { listed: number; archived: number };
};

/**
 * ADR-087 4d. The 24-hour clock starts only when the inbox rows are written AND the /account notice is live, so before any
 * write the installer asks the live application. GET /api/customer-member-notice without a session answers 401 only when
 * CORRIDRA_MEMBER_NOTICE, saved reports, private requests and the inbox are all on (the route checks them in that order and
 * answers 404 or 503 otherwise). Anything but 401 refuses, with a plain message, before the database is touched.
 */
export async function assertMemberNoticeLive(
  origin: string | undefined,
  request: (url: string) => Promise<{ status: number }> = (url) =>
    fetch(url, { cache: 'no-store', redirect: 'manual' }),
) {
  let base: URL;
  try {
    base = new URL(origin ?? '');
  } catch {
    throw new Error(
      'Member notice delivery refused: the live app address is not set (repository variable APP_ORIGIN). Nothing was delivered.',
    );
  }
  if (base.protocol !== 'https:' || base.origin !== origin)
    throw new Error(
      'Member notice delivery refused: APP_ORIGIN must be the https origin of the live app. Nothing was delivered.',
    );
  let status: number;
  try {
    status = (await request(`${base.origin}/api/customer-member-notice`)).status;
  } catch {
    throw new Error(
      'Member notice delivery refused: the live app could not be reached, so the notice cannot be shown to be live. Nothing was delivered.',
    );
  }
  if (status === 404)
    throw new Error(
      'Member notice delivery refused: CORRIDRA_MEMBER_NOTICE is off on the live app (or the route is not deployed). Turn it on and redeploy first. Nothing was delivered.',
    );
  if (status !== 401)
    throw new Error(
      `Member notice delivery refused: the live app answered ${status}, so the notice would not show (saved reports, private requests or the inbox are off, or sign-in is unavailable). Nothing was delivered.`,
    );
}

/**
 * ADR-087 4d: delivers the member notice, one workspace at a time, in one transaction, through the owner-run database function.
 * all means every real (not synthetic) workspace without a delivery record, except archived workspaces and those in exclude.
 * A workspace delivered before keeps its first time and gets no new inbox row. Refuses unless the module is installed. Do not
 * run before U5 is merged and its install approved by the owner: the notice names a switch-on time that must come true.
 */
/** The made-up, demo and QA classification of the data cleanup inventory (packages/auth customer-data-cleanup), passed in. */
export type MemberNoticeClassifier = (
  pool: DatabasePool,
) => Promise<{ qa: { kept: { id: string }[]; listedOnly: string[] } }>;

export async function deliverMemberNotice(
  pool: DatabasePool,
  input: { targets: 'all' | string[]; deliveredBy: string; classify?: MemberNoticeClassifier },
): Promise<MemberNoticeRun> {
  // all reuses the data cleanup classifier (read only, in its own read-only transaction) for real workspaces whose name marks
  // them as QA tests; synthetic workspaces are never candidates anyway.
  const classified =
    input.targets === 'all' && input.classify ? await input.classify(pool) : undefined;
  const exclude = new Set(
    classified ? [...classified.qa.kept.map((row) => row.id), ...classified.qa.listedOnly] : [],
  );
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const installed = await db.query<{ present: boolean; archived: boolean }>(
      `SELECT to_regprocedure('customer_private.member_notice_deliver(uuid,text)') IS NOT NULL AS present,
        to_regprocedure('customer_private.workspace_archived(uuid)') IS NOT NULL AS archived`,
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'The member notice module is not installed, so no notice was delivered. Run field_modules_action=member_notice first.',
      );
    const skipped = { listed: 0, archived: 0 };
    let ids: string[];
    if (input.targets === 'all') {
      // The archived check is a fixed fragment chosen by whether the workspace lifecycle is installed; nothing from input is
      // placed in the text.
      const candidates = (
        await db.query<{ id: string; archived: boolean }>(
          `SELECT w.tenant_id::text AS id,
            ${installed.rows[0].archived ? 'customer_private.workspace_archived(w.tenant_id)' : 'false'} AS archived
           FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id
           WHERE NOT t.synthetic
            AND NOT EXISTS(SELECT FROM customer_private.member_notice_delivery d WHERE d.workspace_id=w.tenant_id)
           ORDER BY w.tenant_id`,
        )
      ).rows;
      ids = [];
      for (const row of candidates) {
        if (exclude.has(row.id)) skipped.listed += 1;
        else if (row.archived) skipped.archived += 1;
        else ids.push(row.id);
      }
    } else ids = input.targets;
    const deliveries: MemberNoticeDelivery[] = [];
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
      deliveries.push({
        workspaceId: id,
        delivered: row.delivered,
        deliveredAt: row.delivered_at,
        opensAt: row.opens_at,
        notices: row.notices,
      });
    }
    await db.query('COMMIT');
    return { deliveries, skipped };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/** Who ran the delivery, for the record: the GitHub actor and run when the workflow runs it. At most 200 characters. */
export function memberNoticeDispatcher(env: NodeJS.ProcessEnv = process.env) {
  const actor = env.GITHUB_ACTOR?.trim();
  const run = env.GITHUB_RUN_ID?.trim();
  const who = actor
    ? `${actor} via install-customer-modules member_notice_deliver${run ? ` run ${run}` : ''}`
    : 'install-customer-modules member_notice_deliver (no GitHub actor)';
  return who.slice(0, 200);
}
