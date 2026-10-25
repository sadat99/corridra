import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  replyReviewCommand,
  type ReplyReviewReason,
  type ReplyTermName,
  type StoredReview,
} from '@corridra/domain/reply-review';

// The Corridra team's review of supplier replies (ADR-069). The database is the authority: it checks the
// control, the role, a fresh authenticator check, that the reply belongs to this workspace and is still
// retained, and that no final decision exists. This service gives the command its shape and permission.
export class ReplyReviewService {
  constructor(private pool: DatabasePool) {}

  /** Whether the database side is open, and the newest 500 reviews in this workspace, oldest first. */
  list(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, tenantId }) => {
      const open = (await db.query<{ open: boolean }>('SELECT app.reply_review_status() AS open'))
        .rows[0].open;
      const { rows } = await db.query(
        `SELECT id,response_id,decision,reason_code,ask_terms,note,created_at FROM (
           SELECT id,response_id,decision,reason_code,ask_terms,note,created_at
           FROM app.recipient_reply_review WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500
         ) newest ORDER BY created_at,id`,
        [tenantId],
      );
      return {
        open,
        reviews: rows.map((row): StoredReview => ({
          id: row.id,
          responseId: row.response_id,
          decision: row.decision,
          reasonCode: (row.reason_code as ReplyReviewReason | null) ?? null,
          askTerms: (row.ask_terms as ReplyTermName[] | null) ?? null,
          note: row.note ?? null,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      };
    });
  }

  /** Publish, ask or reject. Idempotent by command id. */
  async review(ctx: RequestContext, input: unknown) {
    const value = replyReviewCommand.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db, freshMfa }) => {
      if (!freshMfa) throw new DomainError('Verify your authenticator again to continue', 401);
      const { rows } = await db.query<{ r: { id: string; replayed: boolean } }>(
        'SELECT app.review_recipient_reply($1,$2,$3,$4,$5,$6) AS r',
        [
          value.commandId,
          value.responseId,
          value.decision,
          value.decision === 'REJECT' ? value.reasonCode : null,
          value.decision === 'ASK' ? value.askTerms : null,
          value.note ?? null,
        ],
      );
      return rows[0].r;
    });
  }
}
