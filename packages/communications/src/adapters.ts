import type { DatabasePool } from '@corridra/db';
import { RealEmailChannel } from './real-outreach';
export type ChannelEffect = {
  id: string;
  capabilityHash: string;
  leaseId: string;
  /** The policy channel of the claimed message. Absent means a sample channel, as before ADR-090. */
  channel?: string;
};
export interface ChannelAdapter {
  deliver(effect: ChannelEffect): Promise<string>;
  /** True only for an adapter that carries the real email lane (ADR-090). */
  readonly email?: boolean;
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
/**
 * ADR-090. One adapter, two lanes that never cross: a message of the EMAIL channel goes only to the real email lane,
 * and every other channel goes only to the sample lane. The database refuses the wrong lane again on its side.
 */
export class OutreachChannel implements ChannelAdapter {
  readonly email = true;
  private sample: SyntheticChannel;
  private real: RealEmailChannel;
  constructor(
    pool: DatabasePool,
    secret: string,
    env: () => NodeJS.ProcessEnv = () => process.env,
  ) {
    this.sample = new SyntheticChannel(pool);
    this.real = new RealEmailChannel(pool, secret, env);
  }
  deliver(effect: ChannelEffect) {
    return effect.channel === 'EMAIL' ? this.real.deliver(effect) : this.sample.deliver(effect);
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
