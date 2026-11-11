import { randomUUID } from 'node:crypto';
import { rollback, type DatabaseClient, type DatabasePool } from '@corridra/db';
import { hash } from '@corridra/communications';
import type { ChannelAdapter } from '@corridra/communications/adapters';
export interface DurableOrchestrator {
  start(messageId: string): Promise<string>;
}
export class OutboxDispatcher {
  constructor(
    private pool: DatabasePool,
    private adapter: ChannelAdapter,
  ) {}
  async attempt(messageId: string, capability: string) {
    const capabilityHash = hash(capability),
      leaseId = randomUUID();
    const job = await this.claim(messageId, capabilityHash, leaseId);
    if (job.status !== 'CLAIMED') return job.status;
    try {
      if (!['SYNTHETIC', 'MANUAL'].includes(job.channel ?? ''))
        throw new Error('Unsupported channel');
      await this.adapter.deliver({ id: messageId, capabilityHash, leaseId });
      return (
        await this.pool.query("SELECT app.finish_communication($1,$2,$3,'DELIVERED') AS status", [
          messageId,
          capabilityHash,
          leaseId,
        ])
      ).rows[0].status as string;
    } catch {
      // No raw provider errors, contacts or payloads enter logs/checkpoints.
      // A persisted receipt wins over a lost acknowledgement.
      return (
        await this.pool.query("SELECT app.finish_communication($1,$2,$3,'TRANSIENT') AS status", [
          messageId,
          capabilityHash,
          leaseId,
        ])
      ).rows[0].status as string;
    }
  }
  /**
   * Claims the message and runs the CRUD G11 send-time check in one transaction on one connection. A message whose
   * contact was withdrawn, corrected or hidden after it was queued, or whose chain has an opted-out address, ends
   * DEAD with PERMANENT at once and is never retried. A fault anywhere rolls the claim back with it, so the message
   * stays PENDING for the next attempt instead of holding a lease. The transaction commits before deliver, because
   * the channel writes the receipt on its own connection and needs the committed claim; a change committed after
   * this check is caught by the receipt trigger, and the next attempt ends the message here.
   */
  private async claim(messageId: string, capabilityHash: string, leaseId: string) {
    const db = await this.pool.connect();
    let rollbackError: Error | undefined;
    try {
      await db.query('BEGIN');
      const job = (
        await db.query('SELECT app.claim_communication($1,$2,$3) AS job', [
          messageId,
          capabilityHash,
          leaseId,
        ])
      ).rows[0].job as { status: string; channel?: string };
      if (job.status === 'CLAIMED' && !(await this.contactActive(db, messageId, capabilityHash)))
        job.status = (
          await db.query("SELECT app.finish_communication($1,$2,$3,'PERMANENT') AS status", [
            messageId,
            capabilityHash,
            leaseId,
          ])
        ).rows[0].status as string;
      // A claim that did not answer CLAIMED may still have written its own end (SUPPRESSED, DEAD or DELIVERED) and
      // an attempt row, so it commits too.
      await db.query('COMMIT');
      return job;
    } catch (error) {
      rollbackError = await rollback(db);
      throw error;
    } finally {
      db.release(rollbackError);
    }
  }
  /** True unless the contact changes module is installed and says the message's contact can no longer be used. */
  private async contactActive(db: DatabaseClient, messageId: string, capabilityHash: string) {
    const changes = (
      await db.query(
        "SELECT to_regprocedure('app.private_contact_message_active(uuid,text)') IS NOT NULL AS installed",
      )
    ).rows[0] as { installed: boolean };
    if (!changes.installed) return true;
    return (
      await db.query('SELECT app.private_contact_message_active($1,$2) AS active', [
        messageId,
        capabilityHash,
      ])
    ).rows[0].active as boolean;
  }
}
