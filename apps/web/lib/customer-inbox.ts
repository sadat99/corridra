import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from '@corridra/auth/customer-session';
import type { DatabasePool } from '@corridra/db';
import type { InboxService } from '@corridra/communications/inbox';

/** Reuses inbox SQL inside a fresh verified customer transaction, including its recipient RLS. */
export class CustomerInboxService extends CustomerSessionBoundary {
  constructor(
    runtime: DatabasePool,
    auth: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private inbox: InboxService,
  ) {
    super(runtime, auth, options, readSession);
  }
  list(subject?: string, issuer?: string) {
    return this.transaction(
      (db, proof) => this.inbox.list({ kind: 'customer', proofHash: proof.hash }, 30, db),
      subject,
      issuer,
    );
  }
  markRead(id: string, subject?: string, issuer?: string) {
    return this.transaction(
      (db, proof) => this.inbox.markRead({ kind: 'customer', proofHash: proof.hash }, id, db),
      subject,
      issuer,
    );
  }
  /**
   * Marks every unread item of the signed-in person as read, in one statement. The recipient is the verified
   * customer (the same predicate the row policy checks), never a value the caller sends, so a colleague's items,
   * another workspace's people and staff rows are never touched. Returns how many it marked.
   */
  markAllRead(subject?: string, issuer?: string) {
    return this.transaction(
      async (db) =>
        (
          await db.query(
            `UPDATE app.inbox_notification SET read_at=clock_timestamp()
             WHERE recipient_kind='customer' AND recipient_account_id=customer.actor_id() AND read_at IS NULL`,
          )
        ).rowCount ?? 0,
      subject,
      issuer,
    );
  }
  /** How many items the signed-in person has not read, counted by the server over every item (not the 30 a list loads). */
  unreadCount(subject?: string, issuer?: string) {
    return this.transaction(
      async (db) =>
        Number(
          (
            await db.query(
              `SELECT count(*)::int AS n FROM app.inbox_notification
               WHERE recipient_kind='customer' AND recipient_account_id=customer.actor_id() AND read_at IS NULL`,
            )
          ).rows[0].n,
        ),
      subject,
      issuer,
    );
  }
}
