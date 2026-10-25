// Pulse, application side (ADR-067). The database module (customer-notification-migrations) does the
// deciding: this file seals what the Corridra team's Move just queued, sends from a durable workflow,
// reads and saves a person's choices, and mutes. Nothing here logs an address, a name or message text.
import { createHash, createHmac } from 'node:crypto';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import {
  defaultNotificationPreferences,
  notificationPreferencesInput,
  type NotificationPreferences,
} from '@corridra/domain/notifications';
import { CustomerSessionBoundary } from './customer-session';
import { customerRequestsEnabled } from './customer-requests';
import { realUseEnabled } from './customer-production';
import { readAuthMailConfig, sendWithResend, type MailSender } from './customer-auth-mail';
import { renderPulse, type PulseKind } from './pulse-templates';
import { signPulseMute } from './pulse-mute';

/** The screens and routes for a person's choices. The database control is separate and starts closed. */
export function customerNotificationsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerRequestsEnabled(env) && env.CORRIDRA_PULSE_ENABLED === 'true';
}
/** Sending needs this switch, real use, and in the database the notification control. All three. */
export function pulseApplicationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_PULSE_ENABLED === 'true' && realUseEnabled(env);
}

export type PulseJob = { queueId: string; requestId: string; kind: PulseKind; key: string };
export type PulseStatus =
  'SENT' | 'DEAD' | 'SUPPRESSED' | 'CLOSED' | 'LEASED' | 'WAIT' | 'RETRY' | 'UNAVAILABLE';

/**
 * Where the verified account's address comes from, read at send time and never stored. The proof is the
 * message being sent and the secret-derived capability for it: a source that reads a real address must
 * check that the message is leased to this sender right now, so nobody can ask for an address outside a send.
 * A source with `available` false means nothing is claimed and every queued message expires unsent.
 */
export type RecipientPort = {
  available: boolean;
  resolve(
    principalId: string,
    proof: { queueId: string; capability: string },
  ): Promise<{ address: string; name?: string } | null>;
};
export const noRecipientSource: RecipientPort = {
  available: false,
  resolve: async () => null,
};

/**
 * The owner's choice of 25 October 2026 (ADR-067): the verified address on the sign-in account, read inside
 * the database while a message is leased to the sender (`customer.notification_recipient`), held in memory for
 * the one send and never written anywhere. Whether the person has email switched on is checked again there.
 * A person with no verified address gets nothing (the message ends as not sent); a database problem retries.
 */
export function databaseRecipientSource(pool: DatabasePool): RecipientPort {
  return {
    available: true,
    resolve: async (_principalId, proof) => {
      const answer = (
        await pool.query('SELECT customer.notification_recipient($1,$2) AS r', [
          proof.queueId,
          proof.capability,
        ])
      ).rows[0].r as { found?: boolean; address?: string; name?: string } | null;
      if (!answer?.found || !answer.address) return null;
      return { address: answer.address, name: answer.name || undefined };
    },
  };
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only the application can compute this. The database keeps its digest and asks for it to claim. */
export function pulseCapability(secret: string, queueId: string) {
  return createHmac('sha256', secret).update(`pulse-send-v1:${queueId}`).digest('base64url');
}

// Server-only: the actual current provider session decides who is acting. A person reads and saves their
// own choices and nothing else.
export class CustomerNotificationService extends CustomerSessionBoundary {
  async read(expectedSubject?: string, expectedIssuer?: string): Promise<NotificationPreferences> {
    return this.transaction(
      async (db) => {
        const row = (
          await db.query<{ r: Record<string, unknown> }>(
            'SELECT customer.notification_preferences() AS r',
          )
        ).rows[0].r;
        const fromDatabase = {
          kinds: (row.kinds as string[]) ?? defaultNotificationPreferences.kinds,
          digest: row.digest === true,
          quietStart: (row.quietStart as string | null) ?? null,
          quietEnd: (row.quietEnd as string | null) ?? null,
          timeZone: (row.timeZone as string) ?? defaultNotificationPreferences.timeZone,
          language: (row.language as string | null) ?? null,
        };
        return {
          ...notificationPreferencesInput.parse(fromDatabase),
          version: Number(row.version ?? 0),
          open: row.open === true,
          synthetic: row.synthetic === true,
        };
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async save(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const value = notificationPreferencesInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ r: { saved: boolean; version?: number; reason?: string } }>(
            'SELECT customer.set_notification_preferences($1,$2,$3,$4,$5,$6) AS r',
            [
              value.kinds,
              value.digest,
              value.quietStart,
              value.quietEnd,
              value.timeZone,
              value.language,
            ],
          )
        ).rows[0].r,
      expectedSubject,
      expectedIssuer,
    );
  }
}

export class PulseService {
  constructor(
    private pool: DatabasePool,
    private secret: string,
    private recipients: RecipientPort = noRecipientSource,
    private sender: MailSender = sendWithResend,
  ) {}

  /** False without an address source. Nothing is started while it is false. */
  get canSend() {
    return pulseApplicationEnabled() && this.recipients.available;
  }

  /**
   * Inside the Corridra team's own transaction, after Move records were set: queue a message for each
   * Move held by the customer and seal it. A mail problem never fails or rolls back the Move; the Move is
   * already stored, and this runs in its own transaction.
   */
  async enqueueForCommand(
    ctx: RequestContext,
    commandId: string,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<PulseJob[]> {
    if (!pulseApplicationEnabled(env)) return [];
    try {
      return await withTenant(this.pool, ctx, 'missions.manage', async ({ db }) => {
        const result = (
          await db.query('SELECT customer.enqueue_move_notifications($1) AS r', [commandId])
        ).rows[0].r as { queued: number; jobs: PulseJob[] };
        for (const job of result.jobs) {
          await db.query('SELECT customer.seal_notification($1,$2,$3)', [
            job.queueId,
            sha(pulseCapability(this.secret, job.queueId)),
            sha(signPulseMute(this.secret, job.requestId)),
          ]);
        }
        return result.jobs.map(({ queueId, requestId, kind, key }) => ({
          queueId,
          requestId,
          kind,
          key,
        }));
      });
    } catch (error) {
      console.info(
        JSON.stringify({
          event: 'pulse_enqueue_skipped',
          code: (error as { code?: string }).code ?? 'error',
        }),
      );
      return [];
    }
  }

  /** One send attempt. The database decides whether there is anything to send. */
  async send(job: PulseJob, env: NodeJS.ProcessEnv = process.env): Promise<PulseStatus> {
    if (!pulseApplicationEnabled(env) || !this.recipients.available) return 'UNAVAILABLE';
    const config = readAuthMailConfig(env);
    if (!config) return 'UNAVAILABLE';
    const capability = pulseCapability(this.secret, job.queueId);
    const claim = (
      await this.pool.query('SELECT customer.claim_notification($1,$2) AS r', [
        job.queueId,
        capability,
      ])
    ).rows[0].r as {
      status: string;
      principalId?: string;
      language?: string | null;
      digest?: boolean;
      items?: { requestId: string; kind: PulseKind; title: string; date: string | null }[];
    };
    if (claim.status !== 'CLAIMED' || !claim.items?.length || !claim.principalId)
      return claim.status as PulseStatus;
    const finish = async (outcome: 'SENT' | 'TRANSIENT' | 'PERMANENT') =>
      (
        await this.pool.query('SELECT customer.finish_notification($1,$2,$3) AS r', [
          job.queueId,
          capability,
          outcome,
        ])
      ).rows[0].r.status as string;
    let to: { address: string; name?: string } | null;
    try {
      to = await this.recipients.resolve(claim.principalId, { queueId: job.queueId, capability });
    } catch {
      return ((await finish('TRANSIENT')) === 'DEAD' ? 'DEAD' : 'RETRY') as PulseStatus;
    }
    if (!to) {
      await finish('PERMANENT');
      return 'DEAD';
    }
    let message;
    try {
      const origin = new URL(env.APP_ORIGIN as string).origin;
      const manageLink = `${origin}/account/notifications`;
      const first = claim.items[0];
      message =
        claim.digest || claim.items.length > 1
          ? renderPulse({
              kind: 'digest',
              name: to.name,
              items: claim.items.map(({ kind, title, date }) => ({ kind, title, date })),
              link: `${origin}/account/move`,
              manageLink,
              locale: claim.language ?? undefined,
            })
          : renderPulse({
              kind: first.kind,
              name: to.name,
              title: first.title,
              date: first.date,
              link: `${origin}/account/requests/${first.requestId}`,
              muteLink: `${origin}/pulse/mute/${first.requestId}#t=${signPulseMute(this.secret, first.requestId)}`,
              manageLink,
              locale: claim.language ?? undefined,
            });
    } catch {
      await finish('PERMANENT');
      return 'DEAD';
    }
    try {
      await this.sender({
        config,
        to: to.address,
        message,
        idempotencyKey: `pulse:${job.queueId}`,
      });
    } catch {
      return ((await finish('TRANSIENT')) === 'DEAD' ? 'DEAD' : 'RETRY') as PulseStatus;
    }
    return (await finish('SENT')) as PulseStatus;
  }

  /** No sign-in. The database accepts only the link token that belongs to this request. */
  async mute(requestId: string, token: string) {
    const result = await this.pool.query('SELECT customer.mute_notifications($1,$2) AS r', [
      requestId,
      token,
    ]);
    return result.rows[0].r as { muted: boolean; already: boolean };
  }
}
