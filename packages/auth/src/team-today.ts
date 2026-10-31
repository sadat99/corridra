import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';

// getTeamToday (commercial readiness program, 5.2, CQ-34, CQ-40, CQ-73). Counts for the team Today
// page, read inside withTenant with the person's own access and row level security. Owner: WS-D.
//
// - A request reaches app.mission only when the customer submits it. Its first internal status is
//   DRAFT, which means "received, waiting for review" (D6). Unsent guided drafts live in the
//   customer's private draft store and are never read here, so they never count.
// - Accepted quotes, reviewed replies and meetings come from optional modules or roles. When one
//   cannot be read (module not installed, role without access, authenticator check too old), its
//   name is listed in `unavailable` and its count is 0. The page shows "Not available" for it, never
//   a zero.
export type TeamToday = {
  newSubmittedRequests: number;
  overdueSubmittedRequests: number;
  acceptedQuotesNotStarted: number;
  repliesToReview: number;
  meetingsNextSevenDays: number;
  /** Counts that could not be read for this person. Never shown as zero. */
  unavailable?: TeamTodayCount[];
};
export type TeamTodayCount = Exclude<keyof TeamToday, 'unavailable'>;

/** Runs one optional read inside a savepoint so a refused read never aborts the others. */
async function optional(db: DatabaseClient, name: string, read: () => Promise<number>) {
  await db.query(`SAVEPOINT ${name}`);
  try {
    const n = await read();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return null;
  }
}

async function acceptedQuotes(db: DatabaseClient) {
  const installed = await db.query(
    `SELECT to_regprocedure('app.service_request_staff_list(uuid,integer)') IS NOT NULL AS ok`,
  );
  if (!installed.rows[0]?.ok) throw new Error('not installed');
  let after: string | null = null;
  let accepted = 0;
  // Fifty per page, at most twenty pages: a bounded read. Status "accepted" means the customer
  // accepted the quote and nobody has started the work yet.
  for (let page = 0; page < 20; page++) {
    const r = await db.query('SELECT app.service_request_staff_list($1,50) AS list', [after]);
    const list = r.rows[0]?.list as {
      requests: { status?: string }[];
      nextAfter: string | null;
    };
    accepted += list.requests.filter((item) => item.status === 'accepted').length;
    if (!list.nextAfter) return accepted;
    after = list.nextAfter;
  }
  throw new Error('too many to count');
}

export async function getTeamToday(pool: DatabasePool, ctx: RequestContext): Promise<TeamToday> {
  return withTenant(pool, ctx, 'missions.read', async ({ db }) => {
    const {
      rows: [m],
    } = await db.query(
      `SELECT count(*) FILTER (WHERE status='DRAFT')::int AS fresh,
        count(*) FILTER (WHERE status NOT IN ('CANCELLED','CLOSED') AND due_at<now())::int AS overdue
       FROM app.mission WHERE tenant_id=$1`,
      [ctx.tenantId],
    );
    const meetings = await optional(db, 'today_meetings', async () => {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM app.meeting WHERE tenant_id=$1 AND status='SCHEDULED'
          AND starts_at>=now() AND starts_at<=now()+interval '7 days'`,
        [ctx.tenantId],
      );
      return r.rows[0].n;
    });
    const replies = await optional(db, 'today_replies', async () => {
      const installed = await db.query(
        `SELECT to_regclass('app.recipient_reply_review') IS NOT NULL AS ok`,
      );
      if (!installed.rows[0]?.ok) throw new Error('not installed');
      const r = await db.query(
        `SELECT count(*)::int AS n FROM app.recipient_detail_response d WHERE d.tenant_id=$1
          AND NOT EXISTS(SELECT FROM app.recipient_reply_review v WHERE v.tenant_id=d.tenant_id AND v.response_id=d.id)`,
        [ctx.tenantId],
      );
      return r.rows[0].n;
    });
    const quotes = await optional(db, 'today_quotes', () => acceptedQuotes(db));
    const unavailable: TeamTodayCount[] = [];
    if (quotes === null) unavailable.push('acceptedQuotesNotStarted');
    if (replies === null) unavailable.push('repliesToReview');
    if (meetings === null) unavailable.push('meetingsNextSevenDays');
    return {
      newSubmittedRequests: m.fresh,
      overdueSubmittedRequests: m.overdue,
      acceptedQuotesNotStarted: quotes ?? 0,
      repliesToReview: replies ?? 0,
      meetingsNextSevenDays: meetings ?? 0,
      unavailable,
    };
  });
}
