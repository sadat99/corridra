// Mission mail, application side. The database module (customer-mission-mail-migrations) does the
// deciding: this file queues inside the customer's own request transaction, sends from a durable
// workflow, and mutes. Nothing here logs an address, a name or message text.
import { createHmac, createHash } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@corridra/db';
import { realUseEnabled } from './customer-production';
import { readAuthMailConfig, sendWithResend, type MailSender } from './customer-auth-mail';
import { renderMissionMail } from './mission-mail-templates';
import { signMissionMailMute } from './mission-mail-mute';
import { readFounderLine } from './mission-mail-gate';

export type MissionMailJob = {
  queueId: string;
  requestId: string;
  kind: 'request-received';
  key: string;
};
export const receivedKey = 'received';

/** Both must be on: this switch and, in the database, the mission mail control. */
export function missionMailApplicationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_MISSION_EMAIL_ENABLED === 'true' && realUseEnabled(env);
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only the application can compute this. The database keeps its digest and asks for it to claim. */
export function missionMailCapability(
  secret: string,
  requestId: string,
  kind: string,
  key: string,
) {
  return createHmac('sha256', secret)
    .update(`mission-mail-send-v1:${requestId}:${kind}:${key}`)
    .digest('base64url');
}

const objectivePhrases: Record<string, string> = {
  'Sell in a new market': 'selling in a new market',
  'Find customers or distributors': 'finding customers or distributors',
  'Source suppliers': 'sourcing suppliers',
  'Make an upcoming business trip more productive':
    'making an upcoming business trip more productive',
  'Run a multi-company mission': 'running a multi-company mission',
};
/** A short lower case phrase for "Your request about ...". Empty for anything else. */
export function jobPhrase(objective: unknown) {
  return typeof objective === 'string' ? (objectivePhrases[objective] ?? '') : '';
}

export type MissionMailPort = {
  /** Runs inside the request transaction. Never throws for a mail problem. */
  enqueue(
    db: DatabaseClient,
    input: { requestId: string; email: string; name: string; objective: unknown },
  ): Promise<MissionMailJob | null>;
  /** Called after the transaction commits. Never throws for a mail problem. */
  dispatch(job: MissionMailJob): Promise<void>;
};

export type SendStatus =
  'SENT' | 'DEAD' | 'SUPPRESSED' | 'CLOSED' | 'LEASED' | 'WAIT' | 'RETRY' | 'UNAVAILABLE';

export class MissionMailService {
  constructor(
    private runtime: Pick<DatabasePool, 'query'>,
    private secret: string,
    private sender: MailSender = sendWithResend,
  ) {}

  /** Inside a savepoint, so a mail problem can never fail or roll back the request. */
  async enqueue(
    db: DatabaseClient,
    input: { requestId: string; email: string; name: string; objective: unknown },
  ): Promise<MissionMailJob | null> {
    let saved = false;
    try {
      const capability = missionMailCapability(
        this.secret,
        input.requestId,
        'request-received',
        receivedKey,
      );
      const mute = signMissionMailMute(this.secret, input.requestId);
      await db.query('SAVEPOINT mission_mail');
      saved = true;
      const result = (
        await db.query('SELECT customer.enqueue_mission_mail($1,$2,$3,$4,$5,$6,$7,$8) AS r', [
          input.requestId,
          'request-received',
          receivedKey,
          input.email,
          input.name.slice(0, 80),
          jobPhrase(input.objective),
          sha(capability),
          sha(mute),
        ])
      ).rows[0]?.r as { queued?: boolean; id?: string } | undefined;
      await db.query('RELEASE SAVEPOINT mission_mail');
      if (!result?.queued || !result.id) return null;
      return {
        queueId: result.id,
        requestId: input.requestId,
        kind: 'request-received',
        key: receivedKey,
      };
    } catch (error) {
      if (saved) {
        await db.query('ROLLBACK TO SAVEPOINT mission_mail');
        await db.query('RELEASE SAVEPOINT mission_mail');
      }
      console.info(
        JSON.stringify({
          event: 'mission_mail_enqueue_skipped',
          code: (error as { code?: string }).code ?? 'error',
        }),
      );
      return null;
    }
  }

  /** One send attempt. The database decides whether there is anything to send. */
  async send(job: MissionMailJob, env: NodeJS.ProcessEnv = process.env): Promise<SendStatus> {
    if (!missionMailApplicationEnabled(env)) return 'UNAVAILABLE';
    const config = readAuthMailConfig(env);
    if (!config) return 'UNAVAILABLE';
    const capability = missionMailCapability(this.secret, job.requestId, job.kind, job.key);
    const claim = (
      await this.runtime.query('SELECT customer.claim_mission_mail($1,$2) AS r', [
        job.queueId,
        capability,
      ])
    ).rows[0].r as {
      status: string;
      address?: string;
      name?: string;
      job?: string;
    };
    if (claim.status !== 'CLAIMED' || !claim.address) return claim.status as SendStatus;
    const finish = async (outcome: 'SENT' | 'TRANSIENT' | 'PERMANENT') =>
      (
        await this.runtime.query('SELECT customer.finish_mission_mail($1,$2,$3) AS r', [
          job.queueId,
          capability,
          outcome,
        ])
      ).rows[0].r.status as string;
    let message;
    try {
      const origin = new URL(env.APP_ORIGIN as string).origin;
      message = renderMissionMail({
        kind: 'request-received',
        name: claim.name,
        job: claim.job,
        codeSignIn: env.CORRIDRA_CUSTOMER_CODE_SIGNIN === 'true',
        founderLine: readFounderLine(env),
        link: `${origin}/account/requests/${job.requestId}`,
        muteLink: `${origin}/mute/${job.requestId}#t=${signMissionMailMute(this.secret, job.requestId)}`,
        manageLink: `${origin}/account`,
      });
    } catch {
      await finish('PERMANENT');
      return 'DEAD';
    }
    try {
      await this.sender({
        config,
        to: claim.address,
        message,
        idempotencyKey: `mission-mail:${job.queueId}`,
      });
    } catch {
      return ((await finish('TRANSIENT')) === 'DEAD' ? 'DEAD' : 'RETRY') as SendStatus;
    }
    return (await finish('SENT')) as SendStatus;
  }

  /** No sign-in. The database accepts only the link token that belongs to this request. */
  async mute(requestId: string, token: string) {
    const result = await this.runtime.query('SELECT customer.mute_mission_mail($1,$2) AS r', [
      requestId,
      token,
    ]);
    return result.rows[0].r as { muted: boolean; already: boolean };
  }
}
