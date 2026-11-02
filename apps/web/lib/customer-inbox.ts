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
}
