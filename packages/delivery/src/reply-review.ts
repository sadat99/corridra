import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { permits, stepUpRequired } from '@corridra/domain';
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
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, tenantId, role }) => {
      const open = (await db.query<{ open: boolean }>('SELECT app.reply_review_status() AS open'))
        .rows[0].open;
      // Where ADR-087 U2 is installed a viewer's read policy returns no review row (it reaches reviews through the reply
      // policy), so a role without delivery.read_body reads the review state through app.reply_review_meta: decision and
      // date only, with the reason, the asked terms and the note left out. Before U2 the function does not exist.
      const meta =
        !permits(role, 'delivery.read_body') &&
        Boolean(
          (
            await db.query(
              "SELECT to_regprocedure('app.reply_review_meta(uuid)') IS NOT NULL AS ok",
            )
          ).rows[0]?.ok,
        );
      const { rows } = await db.query(
        meta
          ? `SELECT id,response_id,decision,NULL::text reason_code,NULL::text[] ask_terms,NULL::text note,created_at FROM (
               SELECT id,response_id,decision,created_at FROM app.reply_review_meta($1) ORDER BY created_at DESC,id DESC LIMIT 500
             ) newest ORDER BY created_at,id`
          : `SELECT id,response_id,decision,reason_code,ask_terms,note,created_at FROM (
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
      if (!freshMfa) throw stepUpRequired();
      const args = [value.commandId, value.responseId];
      const tail = [
        value.decision,
        value.decision === 'REJECT' ? value.reasonCode : null,
        value.decision === 'ASK' ? value.askTerms : null,
        value.note ?? null,
      ];
      // Where answer correction is installed the decision is bound to the version the reviewer read, so a
      // correction that lands in between cannot be published, asked on or rejected unseen. A card that sends
      // no version is treated as having read the first answer. Without correction the original call is used.
      const bound = (
        await db.query<{ ok: boolean }>(
          `SELECT to_regprocedure('app.review_recipient_reply_seen(uuid,uuid,integer,text,text,text[],text)') IS NOT NULL AS ok`,
        )
      ).rows[0].ok;
      const { rows } = bound
        ? await db.query<{ r: { id: string; replayed: boolean } }>(
            'SELECT app.review_recipient_reply_seen($1,$2,$3,$4,$5,$6,$7) AS r',
            [...args, value.seen ?? 0, ...tail],
          )
        : await db.query<{ r: { id: string; replayed: boolean } }>(
            'SELECT app.review_recipient_reply($1,$2,$3,$4,$5,$6) AS r',
            [...args, ...tail],
          );
      return rows[0].r;
    });
  }
}
