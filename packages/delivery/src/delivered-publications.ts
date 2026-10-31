import type { DatabasePool } from '@corridra/db';

// listDeliveredPublications (commercial readiness program, 5.2, CQ-77). Returns approved publications
// for requests the signed-in customer created, so the customer Library, room and Your Move can show
// them. Built on the existing reviewed account delivery (customer.assigned_missions): the team approved
// each report for the original request creator, and the database re-checks the staff scope, the link
// expiry and the request owner on every read. Scope comes only from the customer proof, never from an id
// the browser sends. Owner after Wave 0: WS-C.
//
// Call it inside a CustomerSessionBoundary transaction (the proof lives only for that transaction). It
// opens its own read on the same database and returns [] when the reviewed delivery module is missing.
export type DeliveredPublication = {
  id: string;
  title: string;
  requestId: string;
  /** When the report became available to the customer. Empty when the reviewed read does not say. */
  publishedAt: string;
  href: string;
  /** Last moment the customer can open it (link expiry or request retention, whichever is first). */
  expiresAt?: string;
};

type Summary = {
  id: string;
  requestId: string;
  available: boolean;
  title?: string;
  expiresAt?: string;
  savedResourceId?: string | null;
  publishedAt?: string;
};

const pageSize = 25;
const maxPages = 4;

export async function listDeliveredPublications(
  pool: DatabasePool,
  customerProofHash: string,
  customerAccountId: string,
): Promise<DeliveredPublication[]> {
  // The account id is informational only; the proof decides whose requests are read.
  void customerAccountId;
  // No proof or no database (the Wave 0 contract check passes an empty object): nothing to read.
  if (!/^[a-f0-9]{64}$/.test(customerProofHash) || typeof pool?.connect !== 'function') return [];
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),
       set_config('corridra.tenant_id','',true),set_config('corridra.customer_workspace_id','',true),
       set_config('corridra.purpose','synthetic_validation',true),set_config('corridra.real_report_signed_in',$2,true)`,
      [
        customerProofHash,
        // Same owner switch as realReportSignedInEnabled: on unless set to exactly "false".
        process.env.CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED === 'false' ? 'off' : 'on',
      ],
    );
    const items: Summary[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const result: { assignments: Summary[]; nextAfter: string | null } = (
        await db.query('SELECT customer.assigned_missions($1,$2) result', [after, pageSize])
      ).rows[0].result;
      items.push(...result.assignments);
      if (!result.nextAfter) break;
      after = result.nextAfter;
    }
    await db.query('COMMIT');
    return items
      .filter((item) => item.available && item.title)
      .map((item) => ({
        id: item.id,
        title: item.title!,
        requestId: item.requestId,
        publishedAt: item.publishedAt ?? '',
        href: item.savedResourceId
          ? `/account/missions/${item.savedResourceId}`
          : '/account#assigned-missions',
        ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      }));
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    // Module not installed (function or schema missing): nothing delivered yet.
    if (['42883', '3F000', '42P01'].includes((error as { code?: string }).code ?? '')) return [];
    throw error;
  } finally {
    db.release();
  }
}
