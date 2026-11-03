import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  sessionHash,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';

// In-app inbox (commercial readiness program, D7 and 5.3). Rows live in app.inbox_notification from
// the commercial readiness database module. Reads and marks are limited to the recipient by RLS; a
// write goes through app.inbox_record, which requires a signed-in writer. Owner after Wave 0: WS-E.

export const notificationTypes = [
  'TEAM_INVITE',
  'CONTRIBUTOR_INVITE',
  'PARTICIPANT_INVITE',
  'TASK_ASSIGNED',
  'QUOTE_SENT',
  'QUOTE_ACCEPTED',
  'REPORT_PUBLISHED',
  'REQUEST_RECEIVED',
  'REPLY_POSTED',
] as const;
export type NotificationType = (typeof notificationTypes)[number];
export type RecipientKind = 'staff' | 'customer';

export type InboxItem = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type RecordedNotification = {
  id: string;
  recipientAccountId: string;
  tenantId: string;
  payload: Record<string, unknown>;
};

const recordInput = z
  .object({
    recipientKind: z.enum(['staff', 'customer']),
    recipientAccountId: z.uuid(),
    tenantId: z.uuid().nullable().optional(),
    type: z.enum(notificationTypes),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** Staff writer or reader: the team session. Customer: the customer proof hash. */
export type InboxContext =
  { kind: 'staff'; ctx: RequestContext } | { kind: 'customer'; proofHash: string };

export class InboxService {
  constructor(private readonly pool: DatabasePool) {}

  /** Server composition resolves mail using its auth login, after SQL has selected the recipient. */
  async staffEmail(auth: DatabasePool, receipt: RecordedNotification): Promise<string | undefined> {
    const result = await auth.query<{ email: string }>(
      `SELECT u.email FROM identity.principal p JOIN identity."user" u ON u.id=p.identity_id
       WHERE p.id=$1 AND p.disabled_at IS NULL AND u."emailVerified" IS TRUE`,
      [z.uuid().parse(receipt.recipientAccountId)],
    );
    return result.rows[0]?.email;
  }

  async recordTaskAssigned(db: DatabaseClient, commandId: string): Promise<RecordedNotification> {
    const result = await db.query('SELECT app.record_task_assigned($1) receipt', [
      z.uuid().parse(commandId),
    ]);
    return result.rows[0].receipt;
  }

  async recordQuoteSent(db: DatabaseClient, commandId: string): Promise<RecordedNotification> {
    const result = await db.query('SELECT app.record_quote_sent($1) receipt', [
      z.uuid().parse(commandId),
    ]);
    return result.rows[0].receipt;
  }

  async recordQuoteAccepted(db: DatabaseClient, commandId: string): Promise<RecordedNotification> {
    const result = await db.query('SELECT customer.record_quote_accepted($1) receipt', [
      z.uuid().parse(commandId),
    ]);
    return result.rows[0].receipt;
  }

  async recordReplyPosted(
    db: DatabaseClient,
    replyId: string,
  ): Promise<RecordedNotification | null> {
    const result = await db.query('SELECT app.record_reply_posted($1) receipt', [
      z.uuid().parse(replyId),
    ]);
    return result.rows[0].receipt;
  }

  async recordReportPublished(
    db: DatabaseClient,
    commandId: string,
  ): Promise<RecordedNotification> {
    const result = await db.query('SELECT app.record_report_published($1) receipt', [
      z.uuid().parse(commandId),
    ]);
    return result.rows[0].receipt;
  }

  /** Uses the submitting transaction's verified customer proof; recipient choice stays in SQL. */
  async recordRequestReceived(db: DatabaseClient, requestId: string): Promise<string> {
    const result = await db.query('SELECT customer.record_request_received($1) id', [
      z.uuid().parse(requestId),
    ]);
    return result.rows[0].id;
  }

  private async run<T>(
    who: InboxContext,
    work: (
      q: (sql: string, args?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>,
    ) => Promise<unknown>,
    transaction?: DatabaseClient,
  ) {
    // The verified customer boundary supplies its configured transaction and owns its lifetime.
    if (transaction) return work((sql, args) => transaction.query(sql, args) as never);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      if (who.kind === 'staff')
        await db.query(
          "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$3,true),set_config('corridra.correlation_id',$4,true),set_config('corridra.causation_id',$4,true)",
          [
            sessionHash(who.ctx.token),
            who.ctx.tenantId,
            who.ctx.purpose,
            who.ctx.correlationId ?? randomUUID(),
          ],
        );
      else
        await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [
          who.proofHash,
        ]);
      const result = await work((sql, args) => db.query(sql, args) as never);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  /** Records one item for one recipient. Returns the new id. */
  async record(who: InboxContext, input: unknown): Promise<string> {
    const v = recordInput.parse(input);
    return (await this.run<{ id: string }>(who, async (q) => {
      const r = await q('SELECT app.inbox_record($1,$2,$3,$4,$5::jsonb) AS id', [
        v.recipientKind,
        v.recipientAccountId,
        v.tenantId ?? null,
        v.type,
        JSON.stringify(v.payload),
      ]);
      return r.rows[0]!.id;
    })) as string;
  }

  /** The signed-in person's own items, newest first. */
  async list(who: InboxContext, limit = 30, transaction?: DatabaseClient): Promise<InboxItem[]> {
    return (await this.run<{
      id: string;
      type: NotificationType;
      payload: Record<string, unknown>;
      read_at: Date | null;
      created_at: Date;
    }>(
      who,
      async (q) => {
        const r = await q(
          'SELECT id,type,payload,read_at,created_at FROM app.inbox_notification ORDER BY created_at DESC LIMIT $1',
          [Math.min(Math.max(limit, 1), 100)],
        );
        return r.rows.map((row) => ({
          id: row.id,
          type: row.type,
          payload: row.payload,
          readAt: row.read_at ? row.read_at.toISOString() : null,
          createdAt: row.created_at.toISOString(),
        }));
      },
      transaction,
    )) as InboxItem[];
  }

  /** Marks one of the person's own items as read. Another person's item is never changed. */
  async markRead(who: InboxContext, id: string, transaction?: DatabaseClient): Promise<boolean> {
    const target = z.uuid().parse(id);
    return (await this.run(
      who,
      async (q) => {
        const r = await q(
          'UPDATE app.inbox_notification SET read_at=now() WHERE id=$1 AND read_at IS NULL',
          [target],
        );
        return (r.rowCount ?? 0) > 0;
      },
      transaction,
    )) as boolean;
  }
}
