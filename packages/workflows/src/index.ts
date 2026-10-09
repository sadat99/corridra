import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@corridra/db';
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
    const job = (
      await this.pool.query('SELECT app.claim_communication($1,$2,$3) AS job', [
        messageId,
        capabilityHash,
        leaseId,
      ])
    ).rows[0].job as { status: string; channel?: string };
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
}
