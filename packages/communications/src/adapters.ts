import type { DatabasePool } from '@corridra/db';
export type ChannelEffect = { id: string; capabilityHash: string; leaseId: string };
export interface ChannelAdapter {
  deliver(effect: ChannelEffect): Promise<string>;
}
export class SyntheticChannel implements ChannelAdapter {
  constructor(private pool: DatabasePool) {}
  async deliver(effect: ChannelEffect) {
    return (
      await this.pool.query('SELECT app.deliver_synthetic($1,$2,$3) AS receipt', [
        effect.id,
        effect.capabilityHash,
        effect.leaseId,
      ])
    ).rows[0].receipt as string;
  }
}
export type EmailReadiness = {
  sendPermission: string;
  reviewedPolicy: string;
  verifiedSenderDomain: string;
  providerIdempotency: true;
};
export class EmailChannel implements ChannelAdapter {
  constructor(
    private readiness: EmailReadiness | null,
    private transport?: ChannelAdapter,
  ) {}
  async deliver(effect: ChannelEffect) {
    if (
      !this.readiness?.sendPermission ||
      !this.readiness.reviewedPolicy ||
      !this.readiness.verifiedSenderDomain ||
      !this.readiness.providerIdempotency ||
      !this.transport
    )
      throw new Error('Real email readiness is not established');
    return this.transport.deliver(effect);
  }
}
